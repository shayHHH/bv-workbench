<script setup lang="ts">
import {
  ApplicationMaterialStatus,
  ApplicationMaterialStatusLabel,
  MaterialSourceLabel,
  type MaterialSource,
  ReviewAuditTypeLabel,
  ReviewDecisionAction,
  ReviewFinalResultLabel,
  RiskLevelLabel,
  type ReviewCaseVO,
  type ReviewMaterialVerdict,
  type RiskLevel,
} from "@bv/shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft } from "@element-plus/icons-vue";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { decideReviewCase, fetchReviewCase, openFilePreview } from "@/api/access";

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
  } finally {
    loading.value = false;
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
    `确认通过 ${reviewCase.value?.customer_name} 的准入审核？全部材料将标记为已通过。`,
    "审核通过",
    { type: "success", confirmButtonText: "通过", cancelButtonText: "取消" },
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
    ElMessage.warning("请填写审核说明");
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
    ElMessage.success("结论已出具");
  } finally {
    submitting.value = false;
  }
}

const DIALOG_TITLE: Record<string, string> = {
  REJECT: "驳回",
  TERMINATE: "终止审核",
};

const DIALOG_HINT: Record<string, string> = {
  REJECT: "退回交易员，补充材料后重新提交。提交后案件转「待补件」，交易员在「审核跟踪」处理补件，工单以「驳回重审」再次进入队列。",
  TERMINATE: "明确拒绝本次业务准入。提交后申请转「审核拒绝」，交易员需重新发起新申请。",
};

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

const riskLabel = computed(() => {
  const risk = reviewCase.value?.risk_level;
  return risk ? (RiskLevelLabel[risk as RiskLevel] ?? risk) : "未评估";
});

onMounted(load);
</script>

<template>
  <div v-loading="loading">
    <template v-if="reviewCase">
      <header class="page-header">
        <div>
          <p class="eyebrow">COMPLIANCE REVIEW</p>
          <h1>
            {{ reviewCase.customer_name }}
            <el-tag :type="reviewCase.audit_type === 'RESUBMIT' ? 'warning' : 'info'" size="small">
              {{ ReviewAuditTypeLabel[reviewCase.audit_type] }}
            </el-tag>
            <el-tag v-if="reviewCase.final_result" :type="FINAL_TAG[reviewCase.final_result]" size="small">
              {{ ReviewFinalResultLabel[reviewCase.final_result] }}
            </el-tag>
          </h1>
          <p class="subtitle">
            工单 {{ reviewCase.case_no }} · 申请 {{ reviewCase.application_no }}
            <span v-if="reviewCase.customer_code"> · 客户编号 {{ reviewCase.customer_code }}</span>
          </p>
        </div>
        <el-button :icon="ArrowLeft" @click="router.push('/compliance/review')">返回审核队列</el-button>
      </header>

      <div class="detail-layout">
        <div class="detail-main">
          <el-card shadow="never" class="block">
            <el-descriptions :column="4" border>
              <el-descriptions-item label="客户编号">{{ reviewCase.customer_code || "—" }}</el-descriptions-item>
              <el-descriptions-item label="审核类型">{{ ReviewAuditTypeLabel[reviewCase.audit_type] }}</el-descriptions-item>
              <el-descriptions-item label="风险等级">{{ riskLabel }}</el-descriptions-item>
              <el-descriptions-item label="材料完整度">
                {{ reviewCase.completeness.done }} / {{ reviewCase.completeness.total }}
              </el-descriptions-item>
              <el-descriptions-item label="业务类型">{{ reviewCase.scenario_name || "—" }}</el-descriptions-item>
              <el-descriptions-item label="渠道">{{ reviewCase.channel_name || reviewCase.channel_code || "—" }}</el-descriptions-item>
              <el-descriptions-item label="提交人">{{ reviewCase.submitted_by_name || "—" }}</el-descriptions-item>
              <el-descriptions-item label="提交时间">{{ new Date(reviewCase.submitted_at).toLocaleString() }}</el-descriptions-item>
            </el-descriptions>
          </el-card>

          <el-card shadow="never" class="block">
            <h4 class="block-title">提交信息</h4>
            <el-descriptions :column="2" border>
              <el-descriptions-item label="客户中文姓名">{{ reviewCase.form_snapshot.customer_cn_name || "—" }}</el-descriptions-item>
              <el-descriptions-item label="客户英文姓名">{{ reviewCase.form_snapshot.customer_en_name || "—" }}</el-descriptions-item>
              <el-descriptions-item label="业务说明 / 风险备注" :span="2">
                {{ reviewCase.form_snapshot.business_note || "—" }}
              </el-descriptions-item>
            </el-descriptions>
          </el-card>

          <el-card shadow="never" class="block">
            <h4 class="block-title">材料列表（提交时快照）</h4>
            <el-table :data="reviewCase.materials_snapshot">
              <el-table-column label="材料" min-width="200">
                <template #default="{ row }">
                  <strong>{{ row.name }}</strong>
                  <div class="muted small">
                    {{ MaterialSourceLabel[row.source as MaterialSource] }}
                    <template v-if="row.file"> · {{ row.file.mime_type }}</template>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="100">
                <template #default="{ row }">
                  <el-tag :type="MATERIAL_TAG[row.status]" size="small">
                    {{ ApplicationMaterialStatusLabel[row.status as ApplicationMaterialStatus] }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column v-if="pending" label="本次判定" width="110">
                <template #default="{ row }">
                  <el-button
                    size="small"
                    :type="verdictOf(row.material_key)?.verdict === 'ACCEPTED' ? 'success' : 'default'"
                    @click="toggleAccept(row.material_key)"
                  >
                    {{ verdictOf(row.material_key)?.verdict === "ACCEPTED" ? "已通过" : "通过" }}
                  </el-button>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="130" fixed="right">
                <template #default="{ row }">
                  <template v-if="row.file">
                    <el-button size="small" link type="primary" @click="openFilePreview(row.file)">预览</el-button>
                    <el-button size="small" link @click="openFilePreview(row.file, true)">下载</el-button>
                  </template>
                  <span v-else class="muted small">无文件</span>
                </template>
              </el-table-column>
            </el-table>
          </el-card>

          <el-card v-if="pending" shadow="never" class="block actions-card">
            <div class="actions-row">
              <el-button type="success" :loading="submitting" @click="approve">审核通过</el-button>
              <el-button type="danger" :loading="submitting" @click="openDecision(ReviewDecisionAction.REJECT)">驳回</el-button>
              <el-button :loading="submitting" @click="openDecision(ReviewDecisionAction.TERMINATE)">终止</el-button>
            </div>
          </el-card>

          <el-card v-else-if="reviewCase.decision" shadow="never" class="block">
            <h4 class="block-title">审核结论</h4>
            <p>
              <strong>{{ reviewCase.final_result ? ReviewFinalResultLabel[reviewCase.final_result] : "—" }}</strong>
              <span class="muted"> · {{ reviewCase.reviewer_name }} · {{ reviewCase.reviewed_at ? new Date(reviewCase.reviewed_at).toLocaleString() : "" }}</span>
            </p>
            <p v-if="reviewCase.decision.reason" class="decision-reason">{{ reviewCase.decision.reason }}</p>
          </el-card>
        </div>

        <aside class="detail-side">
          <el-card shadow="never">
            <h4 class="block-title">人工审核要求</h4>
            <p class="requirement">{{ reviewCase.review_requirement || "该业务类型未配置审核要求说明。" }}</p>
          </el-card>
          <el-card v-if="reviewCase.note" shadow="never">
            <h4 class="block-title">交易员说明</h4>
            <p class="requirement">{{ reviewCase.note }}</p>
          </el-card>
        </aside>
      </div>

      <el-dialog v-model="decisionDialog.visible" :title="DIALOG_TITLE[decisionDialog.action]" width="500px">
        <p class="dialog-hint">{{ DIALOG_HINT[decisionDialog.action] }}</p>
        <template v-if="decisionDialog.action === 'REJECT' && reviewCase.materials_snapshot.length">
          <p class="dialog-label">选择需要退回的材料项</p>
          <el-select
            v-model="decisionDialog.returnKeys"
            multiple
            placeholder="可多选；勾选的材料会标记为「被退回」，交易员补充后重新提交"
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
          :placeholder="decisionDialog.action === 'REJECT' ? '必填：驳回原因与整改要求，将展示给交易员' : '必填：终止原因，将展示给交易员'"
        />
        <template #footer>
          <el-button @click="decisionDialog.visible = false">取消</el-button>
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

@media (max-width: 1100px) {
  .detail-layout {
    grid-template-columns: 1fr;
  }
}
</style>
