<script setup lang="ts">
import {
  ReviewAuditTypeLabel,
  ReviewFinalResultLabel,
  ReviewTypeLabel,
  type ReviewAuditType,
  type ReviewCaseVO,
  type ReviewFinalResult,
  type ReviewType,
} from "@bv/shared";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { fetchReviewCases } from "@/api/access";
import { localizeText } from "@/i18n";
import { formatDateTime } from "@/utils/format";

const { t } = useI18n();
const router = useRouter();
const tab = ref<"PENDING" | "PROCESSED">("PENDING");
const list = ref<ReviewCaseVO[]>([]);
const loading = ref(false);
const query = reactive({
  keyword: "",
  audit_type: "" as "" | ReviewAuditType,
  review_type: "" as "" | ReviewType,
  final_result: "" as "" | ReviewFinalResult,
  decision_action: "" as "" | "APPROVE" | "REJECT" | "TERMINATE",
  range: null as [Date, Date] | null,
  sort_by: "submitted_at" as "submitted_at" | "reviewed_at",
  sort_order: "desc" as "asc" | "desc",
  page: 1,
  page_size: 10,
  total: 0,
});

/** demo 已处理工具栏「我的结论」筛选项 */
const DECISION_OPTIONS = computed(() => [
  { value: "APPROVE", label: t("compliance.queue.decision.APPROVE") },
  { value: "REJECT", label: t("compliance.queue.decision.REJECT") },
  { value: "TERMINATE", label: t("compliance.queue.decision.TERMINATE") },
]);

async function load() {
  loading.value = true;
  try {
    const page = await fetchReviewCases({
      status: tab.value,
      keyword: query.keyword || undefined,
      audit_type: query.audit_type || undefined,
      review_type: query.review_type || undefined,
      final_result: tab.value === "PROCESSED" && query.final_result ? query.final_result : undefined,
      decision_action:
        tab.value === "PROCESSED" && query.decision_action ? query.decision_action : undefined,
      submitted_from: query.range?.[0]?.getTime(),
      submitted_to: query.range ? query.range[1].getTime() + 86_399_999 : undefined,
      sort_by: query.sort_by,
      sort_order: query.sort_order,
      page: query.page,
      page_size: query.page_size,
    });
    list.value = page.items;
    query.total = page.total;
  } finally {
    loading.value = false;
  }
}

function search() {
  query.page = 1;
  load();
}

function resetFilters() {
  Object.assign(query, {
    keyword: "", audit_type: "", review_type: "", final_result: "", decision_action: "",
    range: null, sort_by: tab.value === "PENDING" ? "submitted_at" : "reviewed_at", sort_order: "desc", page: 1,
  });
  load();
}

/** el-table sortable="custom" → 服务端排序 */
function onSortChange({ prop, order }: { prop: string; order: "ascending" | "descending" | null }) {
  if (prop === "submitted_at" || prop === "reviewed_at") query.sort_by = prop;
  query.sort_order = order === "ascending" ? "asc" : "desc";
  query.page = 1;
  load();
}

function openDetail(row: ReviewCaseVO) {
  router.push(`/compliance/review/${row.id}`);
}

/** demo 已处理表格的"我的结论"（decision.action → 展示文案） */
function myConclusion(row: ReviewCaseVO): string {
  const action = row.decision?.action;
  return action ? t(`compliance.queue.decision.${action}`) : "--";
}

const FINAL_TAG: Record<string, "success" | "warning" | "info"> = {
  APPROVED: "success",
  UNRESOLVED: "warning",
  TERMINATED: "info",
};

const finalText = (row: ReviewCaseVO) =>
  row.final_result ? localizeText(ReviewFinalResultLabel[row.final_result]) : "--";

watch(tab, () => {
  query.page = 1;
  query.sort_by = tab.value === "PENDING" ? "submitted_at" : "reviewed_at";
  query.sort_order = "desc";
  load();
});

onMounted(load);
</script>

<template>
  <div>
    <header class="page-header">
      <p class="eyebrow">{{ t("compliance.queue.eyebrow") }}</p>
      <h1>{{ t("compliance.queue.title") }}</h1>
      <p class="subtitle">{{ t("compliance.queue.subtitle") }}</p>
    </header>

    <el-card shadow="never">
      <el-tabs v-model="tab">
        <el-tab-pane :label="t('compliance.queue.tabPending')" name="PENDING" />
        <el-tab-pane :label="t('compliance.queue.tabProcessed')" name="PROCESSED" />
      </el-tabs>

      <div class="filter-row">
        <el-input
          v-model="query.keyword"
          :placeholder="t('compliance.queue.searchPh')"
          clearable
          class="keyword"
          @keyup.enter="search"
          @clear="search"
        />
        <el-button type="primary" @click="search">{{ t("compliance.queue.searchBtn") }}</el-button>
        <span class="filter-spacer"></span>
        <el-select
          v-if="tab === 'PENDING'"
          v-model="query.audit_type"
          clearable
          :placeholder="t('compliance.queue.allAuditType')"
          class="type-select"
          @change="search"
        >
          <el-option v-for="(label, value) in ReviewAuditTypeLabel" :key="value" :value="value" :label="localizeText(label)" />
        </el-select>
        <el-select v-model="query.review_type" clearable :placeholder="t('compliance.queue.allReviewType')" class="type-select" @change="search">
          <el-option v-for="(label, value) in ReviewTypeLabel" :key="value" :value="value" :label="localizeText(label)" />
        </el-select>
        <el-select
          v-if="tab === 'PROCESSED'"
          v-model="query.decision_action"
          clearable
          :placeholder="t('compliance.queue.allDecision')"
          class="type-select"
          @change="search"
        >
          <el-option v-for="opt in DECISION_OPTIONS" :key="opt.value" :value="opt.value" :label="opt.label" />
        </el-select>
        <el-select
          v-if="tab === 'PROCESSED'"
          v-model="query.final_result"
          clearable
          :placeholder="t('compliance.queue.allFinal')"
          class="type-select"
          @change="search"
        >
          <el-option v-for="(label, value) in ReviewFinalResultLabel" :key="value" :value="value" :label="localizeText(label)" />
        </el-select>
        <el-date-picker
          v-if="tab === 'PENDING'"
          v-model="query.range"
          type="daterange"
          :start-placeholder="t('compliance.queue.submittedFrom')"
          :end-placeholder="t('compliance.queue.submittedTo')"
          @change="search"
        />
        <el-button @click="resetFilters">{{ t("compliance.queue.reset") }}</el-button>
      </div>

      <!-- 待处理：表格（参考运营交易系统合规初审列表） -->
      <template v-if="tab === 'PENDING'">
        <el-table v-loading="loading" :data="list" :default-sort="{ prop: 'submitted_at', order: 'descending' }" @sort-change="onSortChange">
          <el-table-column :label="t('compliance.queue.colCustomerName')" min-width="160">
            <template #default="{ row }"><strong>{{ row.customer_name }}</strong></template>
          </el-table-column>
          <el-table-column :label="t('compliance.queue.colCustomerCode')" width="110">
            <template #default="{ row }">{{ row.customer_code || t("customer.common.noCode") }}</template>
          </el-table-column>
          <el-table-column :label="t('compliance.queue.colAuditType')" width="110">
            <template #default="{ row }">
              <el-tag :type="row.audit_type === 'RESUBMIT' ? 'warning' : 'primary'" size="small" effect="light">
                {{ localizeText(ReviewAuditTypeLabel[row.audit_type as ReviewAuditType]) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="t('compliance.queue.colReviewType')" width="100">
            <template #default="{ row }">{{ row.review_type ? localizeText(ReviewTypeLabel[row.review_type as ReviewType]) : "--" }}</template>
          </el-table-column>
          <el-table-column :label="t('compliance.queue.colStatus')" width="110">
            <template #default>
              <span class="status-dot"><i></i>{{ t("compliance.queue.statusPending") }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="submitted_at" :label="t('compliance.queue.colSubmittedTime')" width="180" sortable="custom">
            <template #default="{ row }">{{ formatDateTime(row.submitted_at) }}</template>
          </el-table-column>
          <el-table-column :label="t('compliance.queue.colActions')" width="100" align="right">
            <template #default="{ row }">
              <el-button size="small" type="primary" link @click="openDetail(row)">{{ t("compliance.queue.goReview") }}</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loading && !list.length" :description="t('compliance.queue.emptyPending')" />
      </template>

      <!-- 已处理：表格（demo 7 列口径） -->
      <template v-else>
        <el-table v-loading="loading" :data="list" :default-sort="{ prop: 'reviewed_at', order: 'descending' }" @sort-change="onSortChange">
          <el-table-column :label="t('compliance.queue.colCustomerName')" min-width="140">
            <template #default="{ row }"><strong>{{ row.customer_name }}</strong></template>
          </el-table-column>
          <el-table-column :label="t('compliance.queue.colCustomerCode')" width="100">
            <template #default="{ row }">{{ row.customer_code || t("customer.common.noCode") }}</template>
          </el-table-column>
          <el-table-column :label="t('compliance.queue.colMyConclusion')" width="100">
            <template #default="{ row }">{{ myConclusion(row) }}</template>
          </el-table-column>
          <el-table-column prop="reviewed_at" :label="t('compliance.queue.colReviewedAt')" width="175" sortable="custom">
            <template #default="{ row }">{{ row.reviewed_at ? formatDateTime(row.reviewed_at) : "--" }}</template>
          </el-table-column>
          <el-table-column :label="t('compliance.queue.colFinal')" width="110">
            <template #default="{ row }">
              <el-tag v-if="row.final_result" :type="FINAL_TAG[row.final_result] || 'info'" size="small" effect="light">
                {{ finalText(row) }}
              </el-tag>
              <span v-else class="muted">--</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('compliance.queue.colFinalizedAt')" width="160">
            <template #default="{ row }">
              {{ row.final_result && row.final_result !== "UNRESOLVED" && row.reviewed_at ? formatDateTime(row.reviewed_at) : "--" }}
            </template>
          </el-table-column>
          <el-table-column :label="t('compliance.queue.colActions')" width="90" align="right">
            <template #default="{ row }">
              <el-button size="small" type="primary" link @click="openDetail(row)">{{ t("compliance.queue.detail") }}</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loading && !list.length" :description="t('compliance.queue.emptyProcessed')" />
      </template>

      <div class="pager">
        <el-pagination
          v-model:current-page="query.page"
          layout="prev, pager, next, jumper, total"
          :total="query.total"
          :page-size="query.page_size"
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
  color: #ff7a00;
  font-size: 12px;
  letter-spacing: 0.12em;
  margin: 0 0 4px;
}

h1 {
  margin: 0 0 4px;
  font-size: 22px;
}

.subtitle {
  color: #909399;
  margin: 0;
}

.filter-row {
  display: flex;
  gap: 10px;
  margin: 4px 0 14px;
  flex-wrap: wrap;
}

.keyword {
  width: 240px;
}

.type-select {
  width: 140px;
}

.filter-spacer {
  flex: 1;
}

.status-dot {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #67c23a;
}

.status-dot i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #67c23a;
}

.muted {
  color: #c0c4cc;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
</style>
