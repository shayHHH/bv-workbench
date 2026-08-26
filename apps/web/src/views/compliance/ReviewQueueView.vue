<script setup lang="ts">
import {
  ReviewAuditTypeLabel,
  ReviewFinalResultLabel,
  type ReviewAuditType,
  type ReviewCaseVO,
  type ReviewFinalResult,
} from "@bv/shared";
import { onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { fetchReviewCases } from "@/api/access";

const router = useRouter();
const tab = ref<"PENDING" | "PROCESSED">("PENDING");
const list = ref<ReviewCaseVO[]>([]);
const loading = ref(false);
const query = reactive({
  keyword: "",
  audit_type: "" as "" | ReviewAuditType,
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

function resetFilters() {
  query.keyword = "";
  query.audit_type = "";
  query.range = null;
  query.page = 1;
  load();
}

function openDetail(row: ReviewCaseVO) {
  router.push(`/compliance/review/${row.id}`);
}

const FINAL_TAG: Record<string, string> = {
  APPROVED: "success",
  UNRESOLVED: "warning",
  TERMINATED: "info",
};

watch(tab, () => {
  query.page = 1;
  load();
});

onMounted(load);
</script>

<template>
  <div>
    <header class="page-header">
      <p class="eyebrow">COMPLIANCE REVIEW</p>
      <h1>合规审核队列</h1>
      <p class="subtitle">交易员提交的准入材料在此审核；驳回或要求补件后交易员侧会出现补件待办。</p>
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
          @keyup.enter="(query.page = 1), load()"
          @clear="(query.page = 1), load()"
        />
        <el-select v-model="query.audit_type" clearable placeholder="审核类型" class="type-select" @change="(query.page = 1), load()">
          <el-option
            v-for="(label, value) in ReviewAuditTypeLabel"
            :key="value"
            :value="value"
            :label="label"
          />
        </el-select>
        <el-date-picker
          v-model="query.range"
          type="daterange"
          start-placeholder="提交开始"
          end-placeholder="提交结束"
          @change="(query.page = 1), load()"
        />
        <el-button @click="resetFilters">重置</el-button>
      </div>

      <el-table v-loading="loading" :data="list">
        <el-table-column prop="case_no" label="工单号" width="150" />
        <el-table-column label="客户" min-width="150">
          <template #default="{ row }">
            <strong>{{ row.customer_name }}</strong>
            <span v-if="row.customer_code" class="muted"> · {{ row.customer_code }}</span>
          </template>
        </el-table-column>
        <el-table-column label="业务类型 / 渠道" min-width="130">
          <template #default="{ row }">
            {{ row.scenario_name || "—" }}<span v-if="row.channel_code" class="muted"> · {{ row.channel_code }}</span>
          </template>
        </el-table-column>
        <el-table-column label="审核类型" width="100">
          <template #default="{ row }">
            <el-tag :type="row.audit_type === 'RESUBMIT' ? 'warning' : 'info'" size="small">
              {{ ReviewAuditTypeLabel[row.audit_type as ReviewAuditType] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="材料完整度" width="100">
          <template #default="{ row }">{{ row.completeness.done }} / {{ row.completeness.total }}</template>
        </el-table-column>
        <el-table-column label="提交时间" width="160">
          <template #default="{ row }">{{ new Date(row.submitted_at).toLocaleString() }}</template>
        </el-table-column>
        <template v-if="tab === 'PROCESSED'">
          <el-table-column label="最终结论" width="110">
            <template #default="{ row }">
              <el-tag :type="FINAL_TAG[row.final_result] || 'info'" size="small">
                {{ row.final_result ? ReviewFinalResultLabel[row.final_result as ReviewFinalResult] : "—" }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="审核人 / 时间" width="180">
            <template #default="{ row }">
              {{ row.reviewer_name || "—" }}
              <span v-if="row.reviewed_at" class="muted"> · {{ new Date(row.reviewed_at).toLocaleString() }}</span>
            </template>
          </el-table-column>
        </template>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openDetail(row)">
              {{ tab === "PENDING" ? "前往审核" : "详情" }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !list.length" :description="tab === 'PENDING' ? '暂无待处理审核' : '暂无已处理审核'" />

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
  width: 130px;
}

.muted {
  color: #909399;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
</style>
