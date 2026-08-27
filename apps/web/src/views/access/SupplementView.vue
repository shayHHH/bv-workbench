<script setup lang="ts">
import {
  AccessStatus,
  AccessStatusDesc,
  AccessStatusLabel,
  ReviewTypeLabel,
  type AccessApplicationVO,
} from "@bv/shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { cancelApplication, fetchApplications, reopenApplication } from "@/api/access";
import { formatDate, formatRelative } from "@/utils/format";

const router = useRouter();

const loading = ref(false);
const items = ref<AccessApplicationVO[]>([]);
const total = ref(0);
const summary = reactive({ all: 0, draft: 0, supplement: 0, pending: 0 });

const query = reactive({
  keyword: "",
  status: "" as "" | AccessStatus,
  page: 1,
  page_size: 10,
});

async function load() {
  loading.value = true;
  try {
    const [pageResult, all, draft, supplement, pending] = await Promise.all([
      fetchApplications({
        keyword: query.keyword || undefined,
        status: query.status || undefined,
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

const statusTagType: Record<AccessStatus, "primary" | "success" | "warning" | "info" | "danger"> = {
  DRAFT: "info",
  PENDING_REVIEW: "primary",
  SUPPLEMENT_REQUIRED: "warning",
  REJECTED: "danger",
  APPROVED: "success",
  EXPIRED: "info",
  SUSPENDED: "info",
  CANCELLED: "info",
};

/** demo materialStatusFlow：状态 → 主/次操作 */
function primaryAction(row: AccessApplicationVO): { label: string; run: () => void } {
  switch (row.status) {
    case AccessStatus.DRAFT:
      return { label: "继续提交", run: () => router.push(`/access/materials/${row.id}`) };
    case AccessStatus.SUPPLEMENT_REQUIRED:
      return { label: "处理补件", run: () => router.push(`/access/documents/${row.id}/supplement`) };
    case AccessStatus.REJECTED:
    case AccessStatus.EXPIRED:
    case AccessStatus.CANCELLED:
      return { label: "⟳ 重新提交", run: () => reopen(row) };
    default:
      return { label: "查看详情", run: () => router.push(`/access/documents/${row.id}`) };
  }
}

function initials(name: string): string {
  return /^[a-zA-Z]/.test(name) ? name.slice(0, 2).toUpperCase() : name.slice(0, 1);
}

/* el-table 插槽 row 无类型，统一经带类型的辅助函数取展示内容 */
const reviewTypeText = (row: AccessApplicationVO) =>
  row.review_type ? ` · ${ReviewTypeLabel[row.review_type]}` : "";
const statusType = (row: AccessApplicationVO) => statusTagType[row.status];
const statusText = (row: AccessApplicationVO) => AccessStatusLabel[row.status];
const statusDesc = (row: AccessApplicationVO) => AccessStatusDesc[row.status];

async function reopen(row: AccessApplicationVO) {
  try {
    await ElMessageBox.confirm(
      `重新发起 ${row.application_no}？工单将回到草稿，继续完善材料后重新提交合规。`,
      "重新提交",
      { confirmButtonText: "重新发起", cancelButtonText: "取消" },
    );
    const updated = await reopenApplication(row.id);
    ElMessage.success(`${row.application_no} 已重新发起`);
    router.push(`/access/materials/${updated.id}`);
  } catch {
    /* 取消或接口错误 */
  }
}

async function cancelRow(row: AccessApplicationVO) {
  try {
    const { value } = await ElMessageBox.prompt(
      `取消工单 ${row.application_no}？长时间未补件或客户放弃时可取消申请；取消后进入已取消，可重新发起新申请。`,
      "取消工单",
      {
        inputPlaceholder: "取消原因（如：客户放弃本次申请）",
        confirmButtonText: "确认取消",
        cancelButtonText: "返回",
      },
    );
    await cancelApplication(row.id, value?.trim() || "交易员手动取消申请。");
    ElMessage.success(`工单已取消：${row.application_no} 已作废，可重新发起申请`);
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
      <h1>审核跟踪</h1>
      <p class="subtitle">查看已提交的客户审核工单、材料草稿与补件状态，按状态推进后续处理。</p>
    </header>

    <div class="summary">
      <div class="summary-card">
        <strong>{{ summary.all }}</strong><span>进行中与历史工单</span>
      </div>
      <div class="summary-card">
        <strong>{{ summary.draft }}</strong><span>草稿待提交</span>
      </div>
      <div class="summary-card">
        <strong>{{ summary.supplement }}</strong><span>待处理补件</span>
      </div>
      <div class="summary-card">
        <strong>{{ summary.pending }}</strong><span>待合规审核</span>
      </div>
    </div>

    <el-card shadow="never">
      <div class="toolbar">
        <el-input
          v-model="query.keyword"
          class="keyword"
          placeholder="搜索工单号、客户名称或编号"
          clearable
          @keyup.enter="search"
          @clear="search"
        />
        <el-select v-model="query.status" class="filter" placeholder="全部状态" clearable @change="search">
          <el-option
            v-for="(label, value) in AccessStatusLabel"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
        <span class="count">{{ total }} 个工单</span>
      </div>

      <el-table v-loading="loading" :data="items" row-key="id">
        <el-table-column label="客户" min-width="210">
          <template #default="{ row }">
            <div class="cell-primary">
              <span class="avatar">{{ initials(row.customer_snapshot.name) }}</span>
              <span class="name-block">
                <strong>{{ row.customer_snapshot.name }}</strong>
                <small>
                  {{ row.customer_snapshot.customer_code || "无编号" }} · {{ formatDate(row.created_at) }}
                </small>
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="业务类型 / 渠道" min-width="170">
          <template #default="{ row }">
            {{ row.scenario_name || "未选业务类型" }}
            <div class="muted">{{ row.channel_name || "-" }}{{ reviewTypeText(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="当前状态" min-width="180">
          <template #default="{ row }">
            <el-tag :type="statusType(row)" effect="light">{{ statusText(row) }}</el-tag>
            <div class="muted">{{ statusDesc(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="材料完整度" min-width="100">
          <template #default="{ row }">
            {{ row.completeness.done }} / {{ row.completeness.total }}
            <div class="muted">当前有效材料</div>
          </template>
        </el-table-column>
        <el-table-column label="最后更新" min-width="100">
          <template #default="{ row }">
            <span class="muted">{{ formatRelative(row.updated_at) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="170" align="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" plain @click="primaryAction(row).run()">
              {{ primaryAction(row).label }}
            </el-button>
            <el-button
              v-if="row.status === AccessStatus.SUPPLEMENT_REQUIRED"
              size="small"
              @click="cancelRow(row)"
            >
              取消
            </el-button>
            <el-button
              v-else-if="[AccessStatus.REJECTED, AccessStatus.EXPIRED, AccessStatus.CANCELLED].includes(row.status)"
              size="small"
              @click="router.push(`/access/documents/${row.id}`)"
            >
              记录
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无审核工单，在「材料上传」提交合规后会出现在这里" />
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

.summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.summary-card {
  background: #fff;
  border: 1px solid #ebeef5;
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
  color: #909399;
  font-size: 13px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.keyword {
  width: 280px;
}

.filter {
  width: 150px;
}

.count {
  margin-left: auto;
  color: #909399;
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
  color: #909399;
}

.muted {
  color: #909399;
  font-size: 12px;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
