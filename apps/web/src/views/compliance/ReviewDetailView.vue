<script setup lang="ts">
import {
  ApplicationMaterialStatus,
  ApplicationMaterialStatusLabel,
  CustomerKindLabel,
  CustomerSubTypeLabel,
  MaterialSourceLabel,
  type MaterialSource,
  ReviewAuditTypeLabel,
  ReviewDecisionAction,
  ReviewFinalResultLabel,
  type ApplicationMaterialVO,
  type ReviewCaseVO,
  type ReviewMaterialHistoryVO,
  type ReviewMaterialVerdict,
} from "@bv/shared";
import type { CustomerEventVO } from "@bv/shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft } from "@element-plus/icons-vue";
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { MATERIAL_STATUS_TONE, REVIEW_FINAL_TONE } from "@/components/statusTones";
import { decideReviewCase, fetchReviewCase, openFilePreview } from "@/api/access";
import { fetchCustomerEvents } from "@/api/customer";
import { localizeText } from "@/i18n";
import { formatDateTime, formatRelative } from "@/utils/format";

const { t } = useI18n();

const route = useRoute();
const router = useRouter();
const caseId = route.params.id as string;

const loading = ref(true);
const submitting = ref(false);
const reviewCase = ref<ReviewCaseVO | null>(null);

function customerKindText(kind: string | null | undefined) {
  if (!kind) return "—";
  return localizeText(CustomerKindLabel[kind as keyof typeof CustomerKindLabel] ?? kind);
}

function subjectTypeText(kind: string | null | undefined) {
  if (!kind) return "—";
  return localizeText(CustomerSubTypeLabel[kind as keyof typeof CustomerSubTypeLabel] ?? kind);
}

/** 单份材料判定草稿：material_key -> {verdict, reason} */
const verdicts = reactive(new Map<string, { verdict: "ACCEPTED" | "RETURNED"; reason: string }>());

const pending = computed(() => reviewCase.value?.status === "PENDING");

const decisionDialog = reactive({
  visible: false,
  action: ReviewDecisionAction.REJECT as ReviewDecisionAction,
  reason: "",
  /** 驳回时选择需要退回的材料项（demo：退回在结论区统一多选） */
  returnKeys: [] as string[],
});

/** 客户档案最近动态（demo 审核详情侧栏「活动」） */
const activities = ref<CustomerEventVO[]>([]);

async function load() {
  loading.value = true;
  try {
    reviewCase.value = await fetchReviewCase(caseId);
    verdicts.clear();
    for (const verdict of reviewCase.value.material_verdicts) {
      verdicts.set(verdict.material_key, {
        verdict: verdict.verdict as "ACCEPTED" | "RETURNED",
        reason: verdict.reason ?? "",
      });
    }
    loadActivities(reviewCase.value.customer_id);
  } finally {
    loading.value = false;
  }
}

async function loadActivities(customerId: string) {
  try {
    activities.value = (await fetchCustomerEvents(customerId)).slice(0, 6);
  } catch {
    activities.value = [];
  }
}

/** demo：材料行只有「通过」按钮，再点取消判定 */
function toggleAccept(materialKey: string) {
  if (verdicts.get(materialKey)?.verdict === "ACCEPTED") {
    verdicts.delete(materialKey);
  } else {
    verdicts.set(materialKey, { verdict: "ACCEPTED", reason: "" });
  }
}

function verdictOf(materialKey: string) {
  return verdicts.get(materialKey);
}

function requirementNameOf(material: ApplicationMaterialVO): string {
  /* 清单外材料显示交易员填的自定义说明，避免合规侧只看到一个文件名 */
  if (!material.requirement_item_id) return material.custom_item_name ?? "";
  return reviewCase.value?.requirements?.find(req => req.item_id === material.requirement_item_id)?.name ?? "";
}

function rejectMaterialLabel(material: ApplicationMaterialVO): string {
  const fileName = material.file?.original_name || material.name;
  const requirementName = requirementNameOf(material);
  if (!requirementName || requirementName === fileName) return fileName;
  return `${fileName} · ${requirementName}`;
}

function collectVerdicts(returnKeys: string[], reason: string | null): ReviewMaterialVerdict[] {
  const returned = new Set(returnKeys);
  const result: ReviewMaterialVerdict[] = [];
  for (const [material_key, value] of verdicts.entries()) {
    if (returned.has(material_key)) continue;
    result.push({ material_key, verdict: value.verdict as ApplicationMaterialStatus, reason: null });
  }
  for (const material_key of returned) {
    result.push({
      material_key,
      verdict: ApplicationMaterialStatus.RETURNED,
      reason,
    });
  }
  return result;
}

async function approve() {
  await ElMessageBox.confirm(
    t("compliance.detail.approveConfirm", { name: reviewCase.value?.customer_name ?? "" }),
    t("compliance.detail.approve"),
    {
      type: "success",
      confirmButtonText: t("compliance.detail.confirmPass"),
      cancelButtonText: t("compliance.detail.cancel"),
    },
  );
  await decide(ReviewDecisionAction.APPROVE, null);
}

/* ---- 条件性放行（延期补件设置）需求 §3 ---- */
const conditionalDialog = reactive({
  visible: false,
  due_at: null as Date | null,
  missing: [] as string[],
  limit_amount: null as number | null,
  limit_currency: "USD",
  restrict: true,
  notes: "",
});

function quickDue(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function setQuickDue(days: number) {
  conditionalDialog.due_at = quickDue(days);
}

function openConditional() {
  Object.assign(conditionalDialog, {
    visible: true,
    due_at: quickDue(7),
    missing: [],
    limit_amount: null,
    limit_currency: "USD",
    restrict: true,
    notes: "",
  });
}

/** 缺失材料候选：本渠道 KYC 清单项 */
const deferralOptions = computed(() => reviewCase.value?.requirements ?? []);

const LIMIT_CURRENCIES = ["USD", "HKD", "USDT", "CNY", "EUR"];

async function confirmConditional() {
  const due = conditionalDialog.due_at;
  if (!due || due.getTime() <= Date.now()) return ElMessage.warning(t("compliance.detail.condDueInvalid"));
  if (!conditionalDialog.missing.length) return ElMessage.warning(t("compliance.detail.condMissingRequired"));
  if (!conditionalDialog.notes.trim()) return ElMessage.warning(t("compliance.detail.condNotesRequired"));
  submitting.value = true;
  try {
    reviewCase.value = await decideReviewCase(caseId, {
      action: ReviewDecisionAction.CONDITIONAL,
      reason: conditionalDialog.notes.trim(),
      material_verdicts: [],
      deferral: {
        due_at: due.getTime(),
        missing_item_ids: [...conditionalDialog.missing],
        limit_amount: conditionalDialog.limit_amount || null,
        limit_currency: conditionalDialog.limit_currency,
        restrict_large_outflow: conditionalDialog.restrict,
      },
    });
    conditionalDialog.visible = false;
    ElMessage.success(t("compliance.detail.decided"));
  } finally {
    submitting.value = false;
  }
}

/** 已处理工单的延期设置快照（结论卡展示） */
const caseDeferral = computed(() => reviewCase.value?.decision?.deferral ?? null);

function openDecision(action: ReviewDecisionAction) {
  decisionDialog.action = action;
  decisionDialog.reason = "";
  decisionDialog.returnKeys = [];
  decisionDialog.visible = true;
}

async function confirmDecision() {
  if (!decisionDialog.reason.trim()) {
    ElMessage.warning(t("compliance.detail.reasonRequired"));
    return;
  }
  await decide(decisionDialog.action, decisionDialog.reason.trim(), decisionDialog.returnKeys);
  decisionDialog.visible = false;
}

async function decide(action: ReviewDecisionAction, reason: string | null, returnKeys: string[] = []) {
  submitting.value = true;
  try {
    reviewCase.value = await decideReviewCase(caseId, {
      action,
      reason,
      material_verdicts:
        action === ReviewDecisionAction.APPROVE ? [] : collectVerdicts(returnKeys, reason),
    });
    ElMessage.success(t("compliance.detail.decided"));
  } finally {
    submitting.value = false;
  }
}

const DIALOG_TITLE = computed<Record<string, string>>(() => ({
  REJECT: t("compliance.detail.reject"),
  TERMINATE: t("compliance.detail.terminateTitle"),
}));

const DIALOG_HINT = computed<Record<string, string>>(() => ({
  REJECT: t("compliance.detail.rejectHint"),
  TERMINATE: t("compliance.detail.terminateHint"),
}));

/* ---- 审核材料表（参考运营交易系统：材料清单为主轴，可展开历史驳回版本） ---- */

interface MaterialRow {
  rowKey: string;
  kind: "current" | "history";
  index: number | null;
  hasHistory: boolean;
  reqKey: string;
  name: string;
  description: string | null;
  material: ApplicationMaterialVO | null;
  history: ReviewMaterialHistoryVO | null;
}

const expandedReqs = ref(new Set<string>());

function toggleHistory(reqKey: string) {
  const next = new Set(expandedReqs.value);
  if (next.has(reqKey)) next.delete(reqKey);
  else next.add(reqKey);
  expandedReqs.value = next;
}

const materialRows = computed<MaterialRow[]>(() => {
  const rc = reviewCase.value;
  if (!rc) return [];
  const requirements = rc.requirements ?? [];
  const materials = rc.materials_snapshot ?? [];
  const historyAll = rc.material_history ?? [];
  const usedMaterial = new Set<string>();
  const usedHistory = new Set<string>();
  const rows: MaterialRow[] = [];
  let index = 0;
  const histKey = (h: ReviewMaterialHistoryVO) => `${h.case_no}:${h.material_key}`;

  const pushGroup = (
    reqKey: string,
    name: string,
    description: string | null,
    mats: ApplicationMaterialVO[],
    hist: ReviewMaterialHistoryVO[],
  ) => {
    index += 1;
    const expanded = expandedReqs.value.has(reqKey);
    rows.push({
      rowKey: reqKey, kind: "current", index, hasHistory: hist.length > 0,
      reqKey, name, description, material: mats[0] ?? null, history: null,
    });
    mats.slice(1).forEach((m, i) => rows.push({
      rowKey: `${reqKey}-m${i}`, kind: "current", index: null, hasHistory: false,
      reqKey, name: m.name, description: null, material: m, history: null,
    }));
    if (expanded) {
      hist.forEach((h, i) => rows.push({
        rowKey: `${reqKey}-h${i}`, kind: "history", index: null, hasHistory: false,
        reqKey, name: h.name, description: null, material: null, history: h,
      }));
    }
  };

  for (const req of requirements) {
    const mats = materials.filter(m => m.requirement_item_id === req.item_id);
    mats.forEach(m => usedMaterial.add(m.material_key));
    const hist = historyAll.filter(
      h => h.requirement_item_id === req.item_id || (!h.requirement_item_id && mats.some(m => m.name === h.name)),
    );
    hist.forEach(h => usedHistory.add(histKey(h)));
    pushGroup(req.item_id, req.name, req.description, mats, hist);
  }
  for (const m of materials) {
    if (usedMaterial.has(m.material_key)) continue;
    const hist = historyAll.filter(
      h => !usedHistory.has(histKey(h)) && (h.material_key === m.material_key || h.name === m.name),
    );
    hist.forEach(h => usedHistory.add(histKey(h)));
    pushGroup(`extra-${m.material_key}`, m.name, null, [m], hist);
  }
  const orphan = historyAll.filter(h => !usedHistory.has(histKey(h)));
  if (orphan.length) pushGroup("orphan-history", t("compliance.detail.orphanHistory"), null, [], orphan);
  return rows;
});

function sizeText(size: number | null | undefined): string {
  if (!size) return "—";
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(size / 1024))}KB`;
}

const materialRowClass = ({ row }: { row: MaterialRow }) => (row.kind === "history" ? "history-row" : "");

const MATERIAL_TAG: Record<string, string> = MATERIAL_STATUS_TONE;

const FINAL_TAG: Record<string, string> = REVIEW_FINAL_TONE;

onMounted(load);
</script>

<template>
  <div v-loading="loading">
    <template v-if="reviewCase">
      <header class="page-header">
        <div>
          <p class="eyebrow">{{ t("compliance.detail.eyebrow") }}</p>
          <h1>
            {{ reviewCase.customer_name }}
            <el-tag :type="reviewCase.audit_type === 'RESUBMIT' ? 'warning' : 'info'" size="small">
              {{ localizeText(ReviewAuditTypeLabel[reviewCase.audit_type]) }}
            </el-tag>
            <el-tag v-if="reviewCase.final_result" :type="FINAL_TAG[reviewCase.final_result]" size="small">
              {{ localizeText(ReviewFinalResultLabel[reviewCase.final_result]) }}
            </el-tag>
          </h1>
          <p class="subtitle">
            {{ t("compliance.detail.subtitleCode", { code: reviewCase.customer_code || "—" }) }}
          </p>
        </div>
        <el-button :icon="ArrowLeft" @click="router.push('/compliance/review')">{{ t("compliance.detail.back") }}</el-button>
      </header>

      <div class="detail-layout">
        <div class="detail-main">
          <el-card shadow="never" class="block">
            <h4 class="block-title">{{ t("compliance.detail.formTitle") }}</h4>
            <div class="submission-grid">
              <div class="submission-field">
                <span>{{ t("compliance.detail.cnName") }}</span>
                <strong>{{ reviewCase.form_snapshot.customer_cn_name || "—" }}</strong>
              </div>
              <div class="submission-field">
                <span>{{ t("compliance.detail.enName") }}</span>
                <strong>{{ reviewCase.form_snapshot.customer_en_name || "—" }}</strong>
              </div>
              <div class="submission-field">
                <span>{{ t("compliance.detail.customerKind") }}</span>
                <strong>
                  {{ customerKindText(reviewCase.customer_kind) }}
                  <template v-if="reviewCase.customer_sub_type"> · {{ subjectTypeText(reviewCase.customer_sub_type) }}</template>
                </strong>
              </div>
              <div class="submission-field">
                <span>{{ t("compliance.detail.scenario") }}</span>
                <strong>{{ reviewCase.scenario_name || "—" }}</strong>
              </div>
              <div class="submission-field">
                <span>{{ t("compliance.detail.channel") }}</span>
                <strong>{{ reviewCase.channel_name || reviewCase.channel_code || "—" }}</strong>
              </div>
              <div class="submission-field">
                <span>{{ t("compliance.detail.submitterAndTime") }}</span>
                <strong>{{ reviewCase.submitted_by_name || "—" }} · {{ formatDateTime(reviewCase.submitted_at) }}</strong>
              </div>
              <div class="submission-field">
                <span>{{ t("compliance.detail.onboardCompany") }}</span>
                <strong>{{ reviewCase.form_snapshot.onboard_company || "—" }}</strong>
              </div>
              <div class="submission-field wide">
                <span>{{ t("compliance.detail.businessNote") }}</span>
                <strong>{{ reviewCase.form_snapshot.business_note || "—" }}</strong>
              </div>
            </div>
          </el-card>

          <el-card shadow="never" class="block">
            <h4 class="block-title">{{ t("compliance.detail.materialsTitle") }}</h4>
            <el-table :data="materialRows" row-key="rowKey" :row-class-name="materialRowClass">
              <el-table-column label="#" width="64">
                <template #default="{ row }">
                  <button v-if="row.hasHistory" type="button" class="idx-toggle" @click="toggleHistory(row.reqKey)">
                    {{ row.index }}<span class="chev">{{ expandedReqs.has(row.reqKey) ? "⌃" : "⌄" }}</span>
                  </button>
                  <em v-else-if="row.kind === 'history'" class="history-flag">{{ t("compliance.detail.historyTag") }}</em>
                  <span v-else>{{ row.index ?? "" }}</span>
                </template>
              </el-table-column>
              <el-table-column :label="t('compliance.detail.colMaterial')" min-width="260">
                <template #default="{ row }">
                  <template v-if="row.kind === 'history'">
                    <em class="history-name">{{ row.name }}{{ t("compliance.detail.historySuffix") }}</em>
                  </template>
                  <template v-else>
                    <strong>{{ row.name }}</strong>
                    <div v-if="row.description" class="muted small">{{ row.description }}</div>
                    <div v-else-if="row.material" class="muted small">
                      {{ localizeText(MaterialSourceLabel[row.material.source as MaterialSource]) }} · {{ row.material.file?.mime_type || "—" }}
                    </div>
                  </template>
                </template>
              </el-table-column>
              <el-table-column :label="t('compliance.detail.colFile')" min-width="180">
                <template #default="{ row }">
                  <a
                    v-if="(row.material ?? row.history)?.file"
                    class="file-link"
                    @click="openFilePreview((row.material ?? row.history)!.file!)"
                  >{{ (row.material ?? row.history)!.file!.original_name }}</a>
                  <span v-else class="muted">—</span>
                </template>
              </el-table-column>
              <el-table-column :label="t('compliance.detail.colStatus')" width="100">
                <template #default="{ row }">
                  <el-tag v-if="row.kind === 'history'" type="danger" size="small" effect="light">
                    {{ t("compliance.detail.rejectedTag") }}
                  </el-tag>
                  <el-tag v-else-if="row.material" :type="MATERIAL_TAG[row.material.status]" size="small">
                    {{ localizeText(ApplicationMaterialStatusLabel[row.material.status as ApplicationMaterialStatus]) }}
                  </el-tag>
                  <span v-else class="muted">—</span>
                </template>
              </el-table-column>
              <el-table-column :label="t('compliance.detail.colUploadedAt')" width="150">
                <template #default="{ row }">
                  {{ (row.material ?? row.history)?.uploaded_at ? formatDateTime((row.material ?? row.history)!.uploaded_at) : "—" }}
                </template>
              </el-table-column>
              <el-table-column :label="t('compliance.detail.colSize')" width="90">
                <template #default="{ row }">{{ sizeText((row.material ?? row.history)?.file?.size) }}</template>
              </el-table-column>
              <el-table-column v-if="pending" :label="t('compliance.detail.colVerdict')" width="100">
                <template #default="{ row }">
                  <el-button
                    v-if="row.material"
                    size="small"
                    :type="verdictOf(row.material.material_key)?.verdict === 'ACCEPTED' ? 'success' : 'default'"
                    @click="toggleAccept(row.material.material_key)"
                  >
                    {{ verdictOf(row.material.material_key)?.verdict === "ACCEPTED" ? t("compliance.detail.accepted") : t("compliance.detail.accept") }}
                  </el-button>
                </template>
              </el-table-column>
              <el-table-column :label="t('compliance.detail.colActions')" width="120" fixed="right">
                <template #default="{ row }">
                  <template v-if="(row.material ?? row.history)?.file">
                    <el-button size="small" link type="primary" @click="openFilePreview((row.material ?? row.history)!.file!)">{{ t("compliance.detail.preview") }}</el-button>
                    <el-button size="small" link @click="openFilePreview((row.material ?? row.history)!.file!, true)">{{ t("compliance.detail.download") }}</el-button>
                  </template>
                  <span v-else class="muted small">{{ t("compliance.detail.noFile") }}</span>
                </template>
              </el-table-column>
            </el-table>
          </el-card>

          <el-card v-if="pending" shadow="never" class="block actions-card">
            <div class="actions-row">
              <el-button type="success" :loading="submitting" @click="approve">{{ t("compliance.detail.approve") }}</el-button>
              <el-button type="warning" :loading="submitting" @click="openConditional">{{ t("compliance.detail.conditional") }}</el-button>
              <el-button type="danger" :loading="submitting" @click="openDecision(ReviewDecisionAction.REJECT)">{{ t("compliance.detail.reject") }}</el-button>
              <el-button :loading="submitting" @click="openDecision(ReviewDecisionAction.TERMINATE)">{{ t("compliance.detail.terminate") }}</el-button>
            </div>
          </el-card>

          <el-card v-else-if="reviewCase.decision" shadow="never" class="block">
            <h4 class="block-title">{{ t("compliance.detail.conclusionTitle") }}</h4>
            <p>
              <strong>{{ reviewCase.final_result ? localizeText(ReviewFinalResultLabel[reviewCase.final_result]) : "—" }}</strong>
              <span class="muted"> · {{ reviewCase.reviewer_name }} · {{ reviewCase.reviewed_at ? new Date(reviewCase.reviewed_at).toLocaleString() : "" }}</span>
            </p>
            <p v-if="reviewCase.decision.reason" class="decision-reason">{{ reviewCase.decision.reason }}</p>
            <div v-if="caseDeferral" class="deferral-summary">
              <h5>{{ t("compliance.detail.deferralTitle") }}</h5>
              <p>{{ t("compliance.detail.deferralDue") }}：<strong>{{ formatDateTime(caseDeferral.due_at) }}</strong></p>
              <p>{{ t("compliance.detail.deferralMissing") }}：{{ caseDeferral.missing_item_names.join("、") }}</p>
              <p v-if="caseDeferral.limit_amount">
                {{ t("compliance.detail.deferralLimit") }}：{{ caseDeferral.limit_currency }} {{ caseDeferral.limit_amount.toLocaleString("en-US") }}
              </p>
              <p v-if="caseDeferral.restrict_large_outflow">{{ t("compliance.detail.deferralRestrict") }}</p>
            </div>
          </el-card>
        </div>

        <aside class="detail-side">
          <el-card shadow="never">
            <h4 class="block-title">{{ t("compliance.detail.requirementTitle") }}</h4>
            <p class="requirement">{{ reviewCase.review_requirement || t("compliance.detail.requirementEmpty") }}</p>
          </el-card>
          <el-card v-if="reviewCase.note" shadow="never">
            <h4 class="block-title">{{ t("compliance.detail.traderNoteTitle") }}</h4>
            <p class="requirement">{{ reviewCase.note }}</p>
          </el-card>
          <el-card shadow="never">
            <h4 class="block-title">{{ t("compliance.detail.activityTitle") }}</h4>
            <p class="activity-sub">{{ t("compliance.detail.activitySub") }}</p>
            <div v-if="activities.length" class="activity-list">
              <div v-for="event in activities" :key="event.id" class="activity-item">
                <i></i>
                <div>
                  <strong>{{ event.title }}</strong>
                  <p>{{ event.detail }}</p>
                  <time>{{ event.operator_name || t("compliance.detail.system") }} · {{ formatRelative(event.created_at) }}</time>
                </div>
              </div>
            </div>
            <p v-else class="muted small">{{ t("compliance.detail.activityEmpty") }}</p>
          </el-card>
        </aside>
      </div>

      <el-dialog v-model="conditionalDialog.visible" :title="t('compliance.detail.condTitle')" width="560px" :close-on-click-modal="false">
        <p class="dialog-hint">{{ t("compliance.detail.condHint") }}</p>
        <el-form label-position="top">
          <el-form-item :label="t('compliance.detail.condDueLabel')" required>
            <div class="due-row">
              <el-date-picker
                v-model="conditionalDialog.due_at"
                type="datetime"
                :placeholder="t('compliance.detail.condDuePh')"
                style="flex: 1"
              />
              <el-button size="small" @click="setQuickDue(7)">+7{{ t("compliance.detail.condDays") }}</el-button>
              <el-button size="small" @click="setQuickDue(14)">+14{{ t("compliance.detail.condDays") }}</el-button>
              <el-button size="small" @click="setQuickDue(30)">+30{{ t("compliance.detail.condDays") }}</el-button>
            </div>
          </el-form-item>
          <el-form-item :label="t('compliance.detail.condMissingLabel')" required>
            <el-checkbox-group v-model="conditionalDialog.missing" class="missing-group">
              <el-checkbox v-for="item in deferralOptions" :key="item.item_id" :value="item.item_id">
                {{ item.name }}
              </el-checkbox>
            </el-checkbox-group>
            <p v-if="!deferralOptions.length" class="muted small">{{ t("compliance.detail.condNoOptions") }}</p>
          </el-form-item>
          <el-form-item :label="t('compliance.detail.condLimitLabel')">
            <div class="due-row">
              <el-input-number v-model="conditionalDialog.limit_amount" :min="0" :step="10000" style="flex: 1" :placeholder="t('compliance.detail.condLimitPh')" />
              <el-select v-model="conditionalDialog.limit_currency" style="width: 90px">
                <el-option v-for="c in LIMIT_CURRENCIES" :key="c" :value="c" :label="c" />
              </el-select>
            </div>
            <el-checkbox v-model="conditionalDialog.restrict">{{ t("compliance.detail.condRestrictLabel") }}</el-checkbox>
          </el-form-item>
          <el-form-item :label="t('compliance.detail.condNotesLabel')" required>
            <el-input
              v-model="conditionalDialog.notes"
              type="textarea"
              :rows="3"
              maxlength="500"
              :placeholder="t('compliance.detail.condNotesPh')"
            />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="conditionalDialog.visible = false">{{ t("compliance.detail.cancel") }}</el-button>
          <el-button type="warning" :loading="submitting" @click="confirmConditional">{{ t("compliance.detail.condSubmit") }}</el-button>
        </template>
      </el-dialog>

      <el-dialog v-model="decisionDialog.visible" :title="DIALOG_TITLE[decisionDialog.action]" width="500px">
        <p class="dialog-hint">{{ DIALOG_HINT[decisionDialog.action] }}</p>
        <template v-if="decisionDialog.action === 'REJECT' && reviewCase.materials_snapshot.length">
          <p class="dialog-label">{{ t("compliance.detail.returnLabel") }}</p>
          <el-select
            v-model="decisionDialog.returnKeys"
            multiple
            :placeholder="t('compliance.detail.returnPh')"
            style="width: 100%; margin-bottom: 12px"
          >
            <el-option
              v-for="material in reviewCase.materials_snapshot"
              :key="material.material_key"
              :value="material.material_key"
              :label="rejectMaterialLabel(material)"
            >
              <div class="return-option">
                <span>{{ material.file?.original_name || material.name }}</span>
                <small v-if="requirementNameOf(material)">{{ requirementNameOf(material) }}</small>
              </div>
            </el-option>
          </el-select>
        </template>
        <el-input
          v-model="decisionDialog.reason"
          type="textarea"
          :rows="4"
          maxlength="1000"
          show-word-limit
          :placeholder="decisionDialog.action === 'REJECT' ? t('compliance.detail.reasonPhReject') : t('compliance.detail.reasonPhTerminate')"
        />
        <template #footer>
          <el-button @click="decisionDialog.visible = false">{{ t("compliance.detail.cancel") }}</el-button>
          <el-button
            :type="decisionDialog.action === 'REJECT' ? 'danger' : 'primary'"
            :loading="submitting"
            @click="confirmDecision"
          >
            {{ DIALOG_TITLE[decisionDialog.action] }}
          </el-button>
        </template>
      </el-dialog>
    </template>
  </div>
</template>

<style scoped>
.page-header {
  margin-bottom: 16px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.eyebrow {
  color: var(--color-accent);
  font-size: 12px;
  letter-spacing: 0.12em;
  margin: 0 0 4px;
}

h1 {
  margin: 0 0 4px;
  font-size: 22px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.subtitle {
  color: var(--color-text-muted);
  margin: 0;
}

.detail-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 14px;
  align-items: start;
}

.detail-side {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.block {
  margin-bottom: 14px;
}

.block-title {
  margin: 0 0 10px;
}

.submission-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.submission-field {
  min-width: 0;
  background: #fff;
  padding: 12px 14px;
  border-right: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
}

.submission-field:nth-child(3n),
.submission-field.wide {
  border-right: none;
}

.submission-field:nth-child(n + 4):not(.wide) {
  border-bottom: none;
}

.submission-field.wide {
  grid-column: 1 / -1;
  border-top: 1px solid var(--color-border);
  border-bottom: none;
}

.submission-field span {
  display: block;
  margin-bottom: 6px;
  color: var(--color-text-muted);
  font-size: 12px;
}

.submission-field strong {
  display: block;
  min-height: 20px;
  color: var(--color-text-primary);
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.muted {
  color: var(--color-text-muted);
}

.small {
  font-size: 12px;
}

.actions-card {
  position: sticky;
  bottom: 0;
  /* el-table 的 sticky 固定列自带 z-index，结论条必须更高才能整体盖住表格 */
  z-index: 10;
  box-shadow: 0 -6px 16px rgba(31, 36, 48, 0.08);
}

.actions-row {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.decision-reason {
  background: var(--color-surface-alt);
  border-radius: 8px;
  padding: 10px;
  margin: 8px 0 0;
}

.requirement {
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.7;
  margin: 0;
}

.dialog-hint {
  color: var(--color-text-muted);
  font-size: 13px;
  margin: 0 0 10px;
}

.activity-sub {
  color: var(--color-text-muted);
  font-size: 12px;
  margin: -6px 0 10px;
}

.activity-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.activity-item {
  display: flex;
  gap: 10px;
}

.activity-item i {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-primary);
  margin-top: 5px;
}

.activity-item strong {
  font-size: 13px;
}

.activity-item p {
  margin: 2px 0;
  font-size: 12px;
  color: var(--color-text-secondary);
  word-break: break-all;
}

.activity-item time {
  font-size: 12px;
  color: var(--color-text-muted);
}

@media (max-width: 1100px) {
  .detail-layout {
    grid-template-columns: 1fr;
  }
}
.idx-toggle {
  border: none;
  background: transparent;
  cursor: pointer;
  font: inherit;
  color: var(--color-text-primary);
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.idx-toggle .chev {
  color: var(--color-text-muted);
  font-size: 12px;
}

.history-flag,
.history-name {
  color: var(--color-text-muted);
  font-style: italic;
}

.file-link {
  color: var(--el-color-primary);
  cursor: pointer;
  word-break: break-all;
}

.file-link:hover {
  text-decoration: underline;
}

:deep(.history-row) {
  background: var(--color-surface-alt);
}

:deep(.history-row td) {
  color: var(--color-text-muted);
}

.return-option {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.25;
}

.return-option span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.return-option small {
  color: var(--color-text-muted);
  font-size: 12px;
}
.due-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.missing-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  max-height: 180px;
  overflow-y: auto;
  width: 100%;
}

.deferral-summary {
  margin-top: 10px;
  border: 1px solid var(--color-warning-bg);
  background: var(--color-warning-bg);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
}

.deferral-summary h5 {
  margin: 0 0 6px;
  color: var(--color-warning);
}

.deferral-summary p {
  margin: 2px 0;
}
</style>
