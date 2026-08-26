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
import { onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { fetchReviewCases } from "@/api/access";
import { formatDateTime, formatRelative } from "@/utils/format";

const router = useRouter();
const tab = ref<"PENDING" | "PROCESSED">("PENDING");
const list = ref<ReviewCaseVO[]>([]);
const loading = ref(false);
const query = reactive({
  keyword: "",
  audit_type: "" as "" | ReviewAuditType,
  review_type: "" as "" | ReviewType,
  final_result: "" as "" | ReviewFinalResult,
  range: null as [Date, Date] | null,
  page: 1,
  page_size: 10,
  total: 0,
});

async function load() {
  loading.value = true;
  try {
    const page = await fetchReviewCases({
      status: tab.value,
      keyword: query.keyword || undefined,
      audit_type: query.audit_type || undefined,
      review_type: query.review_type || undefined,
      final_result: tab.value === "PROCESSED" && query.final_result ? query.final_result : undefined,
      submitted_from: query.range?.[0]?.getTime(),
      submitted_to: query.range ? query.range[1].getTime() + 86_399_999 : undefined,
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
  Object.assign(query, { keyword: "", audit_type: "", review_type: "", final_result: "", range: null, page: 1 });
  load();
}

function openDetail(row: ReviewCaseVO) {
  router.push(`/compliance/review/${row.id}`);
}

function viewCustomer(row: ReviewCaseVO) {
  router.push({ path: "/customers", query: { kw: row.customer_code || row.customer_name } });
}

/** demo 已处理表格的"我的结论"（decision.action → 展示文案） */
function myConclusion(row: ReviewCaseVO): string {
  switch (row.decision?.action) {
    case "APPROVE":
      return "审核通过";
    case "REJECT":
      return "审核驳回";
    case "TERMINATE":
      return "审核终止";
    default:
      return "--";
  }
}

const FINAL_TAG: Record<string, "success" | "warning" | "info"> = {
  APPROVED: "success",
  UNRESOLVED: "warning",
  TERMINATED: "info",
};

const finalText = (row: ReviewCaseVO) =>
  row.final_result ? ReviewFinalResultLabel[row.final_result] : "--";

watch(tab, () => {
  query.page = 1;
  load();
});

onMounted(load);
</script>

<template>
  <div>
    <header class="page-header">
      <p class="eyebrow">COMPLIANCE QUEUE</p>
      <h1>审核队列</h1>
      <p class="subtitle">交易员提交的合规审核工单进入待处理审核，审核通过或驳回后进入已处理审核。</p>
    </header>

    <el-card shadow="never">
      <el-tabs v-model="tab">
        <el-tab-pane label="待处理审核" name="PENDING" />
        <el-tab-pane label="已处理审核" name="PROCESSED" />
      </el-tabs>

      <div class="filter-row">
        <el-input
          v-model="query.keyword"
          placeholder="客户名称 / 编号 / 工单号"
          clearable
          class="keyword"
          @keyup.enter="search"
          @clear="search"
        />
        <el-select
          v-if="tab === 'PENDING'"
          v-model="query.audit_type"
          clearable
          placeholder="全部审核类型"
          class="type-select"
          @change="search"
        >
          <el-option v-for="(label, value) in ReviewAuditTypeLabel" :key="value" :value="value" :label="label" />
        </el-select>
        <el-select v-model="query.review_type" clearable placeholder="全部提交模式" class="type-select" @change="search">
          <el-option v-for="(label, value) in ReviewTypeLabel" :key="value" :value="value" :label="label" />
        </el-select>
        <el-select
          v-if="tab === 'PROCESSED'"
          v-model="query.final_result"
          clearable
          placeholder="全部最终结论"
          class="type-select"
          @change="search"
        >
          <el-option v-for="(label, value) in ReviewFinalResultLabel" :key="value" :value="value" :label="label" />
        </el-select>
        <el-date-picker
          v-if="tab === 'PENDING'"
          v-model="query.range"
          type="daterange"
          start-placeholder="提交开始"
          end-placeholder="提交结束"
          @change="search"
        />
        <el-button @click="resetFilters">重置</el-button>
      </div>

      <!-- 待处理：请求卡片列表（demo 口径） -->
      <div v-if="tab === 'PENDING'" v-loading="loading" class="card-list">
        <article v-for="row in list" :key="row.id" class="request-card">
          <div class="card-main">
            <div class="card-title">
              <strong>{{ row.customer_name }}</strong>
              <el-tag :type="row.audit_type === 'RESUBMIT' ? 'warning' : 'info'" size="small" effect="plain">
                {{ ReviewAuditTypeLabel[row.audit_type] }}
              </el-tag>
              <el-tag v-if="row.review_type" size="small" effect="plain">
                {{ ReviewTypeLabel[row.review_type] }}
              </el-tag>
              <el-tag type="warning" size="small" effect="light">待审核</el-tag>
            </div>
            <small class="card-sub">
              {{ row.customer_code || "无编号" }} · {{ row.scenario_name || "未选业务类型" }}
              {{ row.channel_name ? ` · ${row.channel_name}` : "" }}
              · 材料 {{ row.completeness.done }}/{{ row.completeness.total }}
              · 提交 {{ formatRelative(row.submitted_at) }}{{ row.submitted_by_name ? `（${row.submitted_by_name}）` : "" }}
            </small>
          </div>
          <div class="card-actions">
            <el-button type="primary" size="small" @click="openDetail(row)">前往审核 →</el-button>
            <el-button size="small" @click="viewCustomer(row)">客户详情</el-button>
          </div>
        </article>
        <el-empty
          v-if="!loading && !list.length"
          description="暂无待处理审核工单，交易员提交合规后，工单会以请求卡出现在这里"
        />
      </div>

      <!-- 已处理：表格（demo 7 列口径） -->
      <template v-else>
        <el-table v-loading="loading" :data="list">
          <el-table-column label="客户名称" min-width="140">
            <template #default="{ row }"><strong>{{ row.customer_name }}</strong></template>
          </el-table-column>
          <el-table-column label="客户编号" width="100">
            <template #default="{ row }">{{ row.customer_code || "无编号" }}</template>
          </el-table-column>
          <el-table-column label="我的结论" width="100">
            <template #default="{ row }">{{ myConclusion(row) }}</template>
          </el-table-column>
          <el-table-column label="我的审核时间" width="160">
            <template #default="{ row }">{{ row.reviewed_at ? formatDateTime(row.reviewed_at) : "--" }}</template>
          </el-table-column>
          <el-table-column label="最终结论" width="110">
            <template #default="{ row }">
              <el-tag :type="FINAL_TAG[row.final_result ?? ''] || 'info'" size="small" effect="light">
                {{ finalText(row) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="完结时间" width="160">
            <template #default="{ row }">
              {{ row.final_result && row.final_result !== "UNRESOLVED" && row.reviewed_at ? formatDateTime(row.reviewed_at) : "--" }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90" align="right">
            <template #default="{ row }">
              <el-button size="small" type="primary" link @click="openDetail(row)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loading && !list.length" description="暂无已处理审核工单" />
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

.card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 120px;
}

.request-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 14px 16px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.card-sub {
  color: #909399;
}

.card-actions {
  flex: none;
  display: flex;
  gap: 8px;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
</style>
