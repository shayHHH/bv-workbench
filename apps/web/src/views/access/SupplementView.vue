<script setup lang="ts">
import {
  AccessStatus,
  AccessStatusDesc,
  AccessStatusLabel,
  ReviewTypeLabel,
  type AccessApplicationVO,
} from "@bv/shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ACCESS_STATUS_TONE } from "@/components/statusTones";
import { localizeText } from "@/i18n";
import { useRouter } from "vue-router";
import { cancelApplication, fetchApplications, reopenApplication } from "@/api/access";
import { formatDate, formatRelative } from "@/utils/format";

const router = useRouter();
const { t } = useI18n();

const loading = ref(false);
const items = ref<AccessApplicationVO[]>([]);
const total = ref(0);
const summary = reactive({ all: 0, draft: 0, supplement: 0, pending: 0 });
const activeTab = ref<"ongoing" | "completed">("ongoing");

const ONGOING_STATUSES: AccessStatus[] = [
  AccessStatus.DRAFT,
  AccessStatus.PENDING_REVIEW,
  AccessStatus.SUPPLEMENT_REQUIRED,
  /* 延期补件（条件性放行/逾期受限）是待办，归进行中 */
  AccessStatus.APPROVED_CONDITIONAL,
  AccessStatus.DEFERRAL_OVERDUE,
];
const COMPLETED_STATUSES: AccessStatus[] = [
  AccessStatus.APPROVED,
  AccessStatus.REJECTED,
  AccessStatus.EXPIRED,
  AccessStatus.SUSPENDED,
  AccessStatus.CANCELLED,
];

const query = reactive({
  keyword: "",
  status: "" as "" | AccessStatus,
  range: null as [Date, Date] | null,
  page: 1,
  page_size: 10,
});

const tabStatuses = computed(() =>
  activeTab.value === "ongoing" ? ONGOING_STATUSES : COMPLETED_STATUSES,
);

const statusOptions = computed(() =>
  Object.entries(AccessStatusLabel).filter(([status]) =>
    tabStatuses.value.includes(status as AccessStatus),
  ),
);

function queryStatus(): string {
  return query.status || tabStatuses.value.join(",");
}

async function load() {
  loading.value = true;
  try {
    const [pageResult, all, draft, supplement, pending] = await Promise.all([
      fetchApplications({
        keyword: query.keyword || undefined,
        status: queryStatus(),
        updated_from: query.range?.[0]?.getTime(),
        updated_to: query.range ? query.range[1].getTime() + 86_399_999 : undefined,
        page: query.page,
        page_size: query.page_size,
      }),
      fetchApplications({ page: 1, page_size: 1 }),
      fetchApplications({ status: AccessStatus.DRAFT, page: 1, page_size: 1 }),
      fetchApplications({ status: AccessStatus.SUPPLEMENT_REQUIRED, page: 1, page_size: 1 }),
      fetchApplications({ status: AccessStatus.PENDING_REVIEW, page: 1, page_size: 1 }),
    ]);
    items.value = pageResult.items;
    total.value = pageResult.total;
    summary.all = all.total;
    summary.draft = draft.total;
    summary.supplement = supplement.total;
    summary.pending = pending.total;
  } finally {
    loading.value = false;
  }
}

function search() {
  query.page = 1;
  load();
}

function onTabChange() {
  if (query.status && !tabStatuses.value.includes(query.status)) query.status = "";
  query.page = 1;
  load();
}

const statusTagType = ACCESS_STATUS_TONE;

/** demo materialStatusFlow：状态 → 主/次操作 */
function primaryAction(row: AccessApplicationVO): { label: string; run: () => void } {
  switch (row.status) {
    case AccessStatus.DRAFT:
      return { label: t("access.track.continueSubmit"), run: () => router.push(`/access/materials/${row.id}`) };
    case AccessStatus.SUPPLEMENT_REQUIRED:
      return { label: t("access.track.handleSupplement"), run: () => router.push(`/access/documents/${row.id}/supplement`) };
    case AccessStatus.APPROVED_CONDITIONAL:
    case AccessStatus.DEFERRAL_OVERDUE:
      return { label: t("access.track.handleDeferral"), run: () => router.push(`/access/documents/${row.id}/supplement`) };
    case AccessStatus.REJECTED:
    case AccessStatus.EXPIRED:
    case AccessStatus.CANCELLED:
      return { label: t("access.track.resubmit"), run: () => reopen(row) };
    default:
      return { label: t("access.track.viewDetail"), run: () => router.push(`/access/documents/${row.id}`) };
  }
}

/** 延期补件倒计时：>7 天灰、≤7 天橙、≤3 天红、逾期深红 */
function deferralCountdown(row: AccessApplicationVO): { text: string; cls: string } | null {
  const deferral = row.deferral;
  if (!deferral) return null;
  const diff = new Date(deferral.due_at).getTime() - Date.now();
  if (row.status === "DEFERRAL_OVERDUE" || diff <= 0) {
    return { text: t("access.track.deferralOverdue"), cls: "overdue" };
  }
  const days = Math.ceil(diff / 86_400_000);
  const cls = days <= 1 ? "d1" : days <= 3 ? "d3" : days <= 7 ? "d7" : "far";
  return { text: t("access.track.deferralLeft", { days }), cls };
}

function initials(name: string): string {
  return /^[a-zA-Z]/.test(name) ? name.slice(0, 2).toUpperCase() : name.slice(0, 1);
}

/* el-table 插槽 row 无类型，统一经带类型的辅助函数取展示内容 */
const reviewTypeText = (row: AccessApplicationVO) =>
  row.review_type ? ` · ${localizeText(ReviewTypeLabel[row.review_type])}` : "";
const statusType = (row: AccessApplicationVO) => statusTagType[row.status];
const statusText = (row: AccessApplicationVO) => localizeText(AccessStatusLabel[row.status]);
const statusDesc = (row: AccessApplicationVO) => localizeText(AccessStatusDesc[row.status]);

async function reopen(row: AccessApplicationVO) {
  try {
    await ElMessageBox.confirm(
      t("access.track.reopenConfirm", { no: row.application_no }),
      t("access.track.reopenTitle"),
      { confirmButtonText: t("access.track.reopenOk"), cancelButtonText: t("access.common.cancel") },
    );
    const updated = await reopenApplication(row.id);
    ElMessage.success(t("access.track.reopened", { no: row.application_no }));
    router.push(`/access/materials/${updated.id}`);
  } catch {
    /* 取消或接口错误 */
  }
}

async function cancelRow(row: AccessApplicationVO) {
  try {
    const { value } = await ElMessageBox.prompt(
      t("access.track.cancelConfirm", { no: row.application_no }),
      t("access.track.cancelTitle"),
      {
        inputPlaceholder: t("access.track.cancelReasonPh"),
        confirmButtonText: t("access.track.cancelOk"),
        cancelButtonText: t("access.track.cancelBack"),
      },
    );
    await cancelApplication(row.id, value?.trim() || "交易员手动取消申请。");
    ElMessage.success(t("access.track.cancelled", { no: row.application_no }));
    load();
  } catch {
    /* 取消或接口错误 */
  }
}

onMounted(load);
</script>

<template>
  <div>
    <header class="page-header">
      <p class="eyebrow">REVIEW WORK ORDERS</p>
      <h1>{{ t("access.track.title") }}</h1>
      <p class="subtitle">{{ t("access.track.subtitle") }}</p>
    </header>

    <div class="summary">
      <div class="summary-card">
        <strong>{{ summary.all }}</strong><span>{{ t("access.track.sumAll") }}</span>
      </div>
      <div class="summary-card">
        <strong>{{ summary.draft }}</strong><span>{{ t("access.track.sumDraft") }}</span>
      </div>
      <div class="summary-card">
        <strong>{{ summary.supplement }}</strong><span>{{ t("access.track.sumSupplement") }}</span>
      </div>
      <div class="summary-card">
        <strong>{{ summary.pending }}</strong><span>{{ t("access.track.sumPending") }}</span>
      </div>
    </div>

    <el-card shadow="never">
      <el-tabs v-model="activeTab" class="track-tabs" @tab-change="onTabChange">
        <el-tab-pane :label="t('access.track.tabOngoing')" name="ongoing" />
        <el-tab-pane :label="t('access.track.tabCompleted')" name="completed" />
      </el-tabs>

      <div class="toolbar">
        <el-input
          v-model="query.keyword"
          class="keyword"
          :placeholder="t('access.track.searchPh')"
          clearable
          @keyup.enter="search"
          @clear="search"
        />
        <el-select v-model="query.status" class="filter" :placeholder="t('access.track.allStatus')" clearable @change="search">
          <el-option
            v-for="[value, label] in statusOptions"
            :key="value"
            :label="localizeText(label)"
            :value="value"
          />
        </el-select>
        <el-date-picker
          v-model="query.range"
          class="date-filter"
          type="daterange"
          unlink-panels
          :start-placeholder="t('access.track.updatedFrom')"
          :end-placeholder="t('access.track.updatedTo')"
          @change="search"
        />
        <span class="count">{{ t("access.track.countSummary", { total }) }}</span>
      </div>

      <el-table v-loading="loading" :data="items" row-key="id">
        <el-table-column :label="t('access.track.colCustomer')" min-width="210">
          <template #default="{ row }">
            <div class="cell-primary">
              <span class="avatar">{{ initials(row.customer_snapshot.name) }}</span>
              <span class="name-block">
                <strong>{{ row.customer_snapshot.name }}</strong>
                <small>
                  {{ row.customer_snapshot.customer_code || t("access.common.noCode") }} · {{ formatDate(row.created_at) }}
                </small>
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="t('access.common.scenarioChannel')" min-width="170">
          <template #default="{ row }">
            {{ row.scenario_name || t("access.track.noScenario") }}
            <div class="muted">{{ row.channel_name || "-" }}{{ reviewTypeText(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('access.common.currentStatus')" min-width="180">
          <template #default="{ row }">
            <el-tag :type="statusType(row)" effect="light">{{ statusText(row) }}</el-tag>
            <div class="muted">{{ statusDesc(row) }}</div>
            <div v-if="row.deferral && deferralCountdown(row)" class="deferral-card" :class="deferralCountdown(row)!.cls">
              <strong>{{ deferralCountdown(row)!.text }}</strong>
              <span>{{ t("access.track.deferralDue", { time: formatDate(row.deferral.due_at) }) }}</span>
              <span>{{ t("access.track.deferralMissing", { names: row.deferral.missing_item_names.join("、") }) }}</span>
              <span v-if="row.deferral.limit_amount">
                {{ t("access.track.deferralLimit", { limit: `${row.deferral.limit_currency} ${row.deferral.limit_amount.toLocaleString("en-US")}` }) }}
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="t('access.common.completeness')" min-width="100">
          <template #default="{ row }">
            {{ row.completeness.done }} / {{ row.completeness.total }}
            <div class="muted">{{ t("access.track.validMaterials") }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('access.common.lastUpdated')" min-width="100">
          <template #default="{ row }">
            <span class="muted">{{ formatRelative(row.updated_at) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('access.common.colActions')" min-width="170" align="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" plain @click="primaryAction(row).run()">
              {{ primaryAction(row).label }}
            </el-button>
            <el-button
              v-if="row.status === AccessStatus.SUPPLEMENT_REQUIRED"
              size="small"
              @click="cancelRow(row)"
            >
              {{ t("access.common.cancel") }}
            </el-button>
            <el-button
              v-else-if="[AccessStatus.REJECTED, AccessStatus.EXPIRED, AccessStatus.CANCELLED].includes(row.status)"
              size="small"
              @click="router.push(`/access/documents/${row.id}`)"
            >
              {{ t("access.track.record") }}
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :description="t('access.track.emptyText')" />
        </template>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.page_size"
          :total="total"
          layout="total, prev, pager, next, jumper"
          @current-change="load"
        />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.page-header {
  margin-bottom: 16px;
}

.eyebrow {
  color: var(--color-primary);
  font-size: 12px;
  letter-spacing: 0.12em;
  margin: 0 0 4px;
}

h1 {
  margin: 0 0 4px;
  font-size: 22px;
}

.subtitle {
  color: var(--color-text-muted);
  margin: 0;
}

.summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.summary-card {
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.summary-card strong {
  font-size: 22px;
}

.summary-card span {
  color: var(--color-text-muted);
  font-size: 13px;
}

.track-tabs {
  margin-bottom: 12px;
}

.track-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}

.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}

.keyword {
  width: 280px;
}

.filter {
  width: 150px;
}

.date-filter {
  width: 320px;
}

.count {
  margin-left: auto;
  color: var(--color-text-muted);
  font-size: 13px;
}

.cell-primary {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 50%;
  background: #eef1f6;
  color: #4a5261;
  font-weight: 700;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.name-block {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.name-block small {
  color: var(--color-text-muted);
}

.muted {
  color: var(--color-text-muted);
  font-size: 12px;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
.deferral-card {
  margin-top: 6px;
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-alt);
  color: var(--color-text-secondary);
}

.deferral-card.d7 {
  border-color: var(--color-warning-bg);
  background: var(--color-warning-bg);
}

.deferral-card.d3,
.deferral-card.d1 {
  border-color: var(--color-danger-bg);
  background: var(--color-danger-bg);
}

.deferral-card.d1 strong,
.deferral-card.d3 strong {
  color: var(--color-danger);
}

.deferral-card.overdue {
  border-color: var(--color-danger);
  background: var(--color-danger-bg);
}

.deferral-card.overdue strong {
  color: var(--color-danger);
}
</style>
