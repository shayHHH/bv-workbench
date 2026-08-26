<script setup lang="ts">
import {
  AccessStatus,
  AccessStatusLabel,
  ApplicationMaterialStatus,
  LEGACY_DECISION_ACTION_LABEL,
  ReviewDecisionActionLabel,
  type AccessApplicationVO,
  type ReviewDecisionAction,
} from "@bv/shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { cancelApplication, fetchApplications } from "@/api/access";

const router = useRouter();
const list = ref<AccessApplicationVO[]>([]);
const loading = ref(false);
const query = reactive({ keyword: "", page: 1, page_size: 8, total: 0 });

async function load() {
  loading.value = true;
  try {
    const page = await fetchApplications({
      status: `${AccessStatus.SUPPLEMENT_REQUIRED},${AccessStatus.REJECTED}`,
      keyword: query.keyword || undefined,
      page: query.page,
      page_size: query.page_size,
    });
    list.value = page.items;
    query.total = page.total;
  } finally {
    loading.value = false;
  }
}

function returnedNames(row: AccessApplicationVO) {
  return row.materials
    .filter(m => m.status === ApplicationMaterialStatus.RETURNED)
    .map(m => m.name);
}

function actionLabel(row: AccessApplicationVO) {
  const action = row.latest_review?.action as string | undefined;
  if (!action) return "—";
  return (
    ReviewDecisionActionLabel[action as ReviewDecisionAction] ??
    LEGACY_DECISION_ACTION_LABEL[action] ??
    action
  );
}

function goSupplement(row: AccessApplicationVO) {
  router.push(`/access/materials/${row.id}`);
}

async function cancelRow(row: AccessApplicationVO) {
  await ElMessageBox.confirm(
    `确定取消申请 ${row.application_no}（${row.customer_snapshot.name}）？客户放弃补件时使用。`,
    "取消申请",
    { type: "warning", confirmButtonText: "取消申请", cancelButtonText: "再想想" },
  );
  await cancelApplication(row.id, "客户放弃补件，交易员取消");
  ElMessage.success("申请已取消");
  load();
}

onMounted(load);
</script>

<template>
  <div>
    <header class="page-header">
      <p class="eyebrow">BUSINESS ACCESS</p>
      <h1>补件处理</h1>
      <p class="subtitle">合规驳回的申请在此跟进：按驳回意见补充或替换材料后重新提交审核。</p>
    </header>

    <el-card shadow="never">
      <div class="filter-row">
        <el-input
          v-model="query.keyword"
          placeholder="搜索申请单号 / 客户名称 / 编号"
          clearable
          class="keyword"
          @keyup.enter="(query.page = 1), load()"
          @clear="(query.page = 1), load()"
        />
        <el-button @click="load">刷新</el-button>
      </div>

      <el-table v-loading="loading" :data="list">
        <el-table-column prop="application_no" label="申请单号" width="170" />
        <el-table-column label="客户" min-width="140">
          <template #default="{ row }">
            <strong>{{ row.customer_snapshot.name }}</strong>
            <span v-if="row.customer_snapshot.customer_code" class="muted">
              · {{ row.customer_snapshot.customer_code }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="业务类型 / 渠道" min-width="130">
          <template #default="{ row }">
            {{ row.scenario_name || "—" }}<span v-if="row.channel_code" class="muted"> · {{ row.channel_code }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag type="danger" size="small">{{ AccessStatusLabel[row.status as AccessStatus] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="合规结论" min-width="220">
          <template #default="{ row }">
            <div v-if="row.latest_review">
              <strong>{{ actionLabel(row) }}</strong>
              <span class="muted"> · {{ row.latest_review.reviewer_name }} · {{ new Date(row.latest_review.reviewed_at).toLocaleString() }}</span>
              <p class="reason">{{ row.latest_review.reason }}</p>
              <p v-if="returnedNames(row).length" class="returned">
                被退回：{{ returnedNames(row).join("、") }}
              </p>
            </div>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="goSupplement(row)">去补件</el-button>
            <el-button size="small" type="danger" link @click="cancelRow(row)">取消申请</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !list.length" description="当前没有待补件或被驳回的申请" />

      <div class="pager">
        <el-pagination
          v-model:current-page="query.page"
          layout="prev, pager, next, total"
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
  margin-bottom: 14px;
}

.keyword {
  width: 280px;
}

.muted {
  color: #909399;
}

.reason {
  margin: 4px 0 0;
  font-size: 13px;
}

.returned {
  margin: 2px 0 0;
  font-size: 12px;
  color: #f56c6c;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
</style>
