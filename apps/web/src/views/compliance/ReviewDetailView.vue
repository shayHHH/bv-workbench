<script setup lang="ts">
import {
  ApplicationMaterialStatus,
  ApplicationMaterialStatusLabel,
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

const MATERIAL_TAG: Record<string, string> = {
  PENDING: "info",
  ACCEPTED: "success",
  RETURNED: "danger",
};

const FINAL_TAG: Record<string, string> = {
  APPROVED: "success",
  UNRESOLVED: "warning",
  TERMINATED: "info",
};

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
            <el-descriptions :column="4" border>
              <el-descriptions-item :label="t('compliance.detail.scenario')">{{ reviewCase.scenario_name || "—" }}</el-descriptions-item>
              <el-descriptions-item :label="t('compliance.detail.channel')">{{ reviewCase.channel_name || reviewCase.channel_code || "—" }}</el-descriptions-item>
              <el-descriptions-item :label="t('compliance.detail.submittedBy')">{{ reviewCase.submitted_by_name || "—" }}</el-descriptions-item>
              <el-descriptions-item :label="t('compliance.detail.submittedAt')">{{ new Date(reviewCase.submitted_at).toLocaleString() }}</el-descriptions-item>
              <el-descriptions-item :label="t('compliance.detail.completeness')">
                {{ reviewCase.completeness.done }} / {{ reviewCase.completeness.total }}
              </el-descriptions-item>
              <el-descriptions-item :label="t('compliance.detail.cnName')">{{ reviewCase.form_snapshot.customer_cn_name || "—" }}</el-descriptions-item>
              <el-descriptions-item :label="t('compliance.detail.enName')" :span="2">{{ reviewCase.form_snapshot.customer_en_name || "—" }}</el-descriptions-item>
              <el-descriptions-item :label="t('compliance.detail.businessNote')" :span="4">
                {{ reviewCase.form_snapshot.business_note || "—" }}
              </el-descriptions-item>
            </el-descriptions>
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
              :label="material.name"
            />
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
  color: #ff7a00;
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
  color: #909399;
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

.muted {
  color: #909399;
}

.small {
  font-size: 12px;
}

.actions-card {
  position: sticky;
  bottom: 0;
}

.actions-row {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.decision-reason {
  background: #f5f6f8;
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
  color: #909399;
  font-size: 13px;
  margin: 0 0 10px;
}

.activity-sub {
  color: #909399;
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
  background: #ff7a00;
  margin-top: 5px;
}

.activity-item strong {
  font-size: 13px;
}

.activity-item p {
  margin: 2px 0;
  font-size: 12px;
  color: #606266;
  word-break: break-all;
}

.activity-item time {
  font-size: 12px;
  color: #909399;
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
  color: #303133;
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.idx-toggle .chev {
  color: #909399;
  font-size: 12px;
}

.history-flag,
.history-name {
  color: #909399;
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
  background: #fafafa;
}

:deep(.history-row td) {
  color: #909399;
}
</style>
