<script setup lang="ts">
import {
  AccessStatus,
  AccessStatusLabel,
  type AccessApplicationVO,
  type CustomerVO,
} from "@bv/shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus } from "@element-plus/icons-vue";
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { cancelApplication, createApplication, fetchApplications } from "@/api/access";
import { fetchCustomers } from "@/api/customer";
import CustomerCreateDialog from "@/views/customer/CustomerCreateDialog.vue";

const router = useRouter();

/* ---- 发起新申请 ---- */
const customerOptions = ref<CustomerVO[]>([]);
const customerLoading = ref(false);
const selectedCustomerId = ref("");
const creating = ref(false);
const createCustomerVisible = ref(false);

async function searchCustomers(keyword: string) {
  customerLoading.value = true;
  try {
    const page = await fetchCustomers({ keyword: keyword || undefined, page: 1, page_size: 20 });
    // 中介行内联返回下级客户，拍平供选择
    customerOptions.value = page.items.flatMap(item => [item, ...(item.sub_customers ?? [])]);
  } finally {
    customerLoading.value = false;
  }
}

async function startApplication() {
  if (!selectedCustomerId.value) {
    ElMessage.warning("请先选择客户");
    return;
  }
  creating.value = true;
  try {
    const application = await createApplication(selectedCustomerId.value);
    router.push(`/access/materials/${application.id}`);
  } finally {
    creating.value = false;
  }
}

function onCustomerCreated(customer: CustomerVO) {
  customerOptions.value = [customer, ...customerOptions.value];
  selectedCustomerId.value = customer.id;
}

/* ---- 申请列表 ---- */
const list = ref<AccessApplicationVO[]>([]);
const loading = ref(false);
const query = reactive({ keyword: "", status: "", page: 1, page_size: 8, total: 0 });

const STATUS_TAG: Record<string, string> = {
  DRAFT: "info",
  PENDING_REVIEW: "warning",
  SUPPLEMENT_REQUIRED: "danger",
  REJECTED: "danger",
  APPROVED: "success",
  CANCELLED: "info",
  EXPIRED: "warning",
  SUSPENDED: "warning",
};

async function load() {
  loading.value = true;
  try {
    const page = await fetchApplications({
      keyword: query.keyword || undefined,
      status: query.status || undefined,
      page: query.page,
      page_size: query.page_size,
    });
    list.value = page.items;
    query.total = page.total;
  } finally {
    loading.value = false;
  }
}

function openApplication(row: AccessApplicationVO) {
  router.push(`/access/materials/${row.id}`);
}

async function cancelRow(row: AccessApplicationVO) {
  await ElMessageBox.confirm(
    `确定取消申请 ${row.application_no}（${row.customer_snapshot.name}）？`,
    "取消申请",
    { type: "warning", confirmButtonText: "取消申请", cancelButtonText: "再想想" },
  );
  await cancelApplication(row.id);
  ElMessage.success("申请已取消");
  load();
}

const editable = (row: AccessApplicationVO) =>
  row.status === AccessStatus.DRAFT ||
  row.status === AccessStatus.SUPPLEMENT_REQUIRED ||
  row.status === AccessStatus.REJECTED;

onMounted(() => {
  searchCustomers("");
  load();
});
</script>

<template>
  <div>
    <header class="page-header">
      <p class="eyebrow">BUSINESS ACCESS</p>
      <h1>材料上传</h1>
      <p class="subtitle">为客户发起业务准入申报，按 KYC 清单上传材料并提交合规审核。</p>
    </header>

    <el-card shadow="never" class="start-card">
      <div class="start-row">
        <el-select
          v-model="selectedCustomerId"
          filterable
          remote
          clearable
          :remote-method="searchCustomers"
          :loading="customerLoading"
          placeholder="输入客户名称 / 编号搜索"
          class="customer-select"
        >
          <el-option
            v-for="customer in customerOptions"
            :key="customer.id"
            :value="customer.id"
            :label="customer.customer_code ? `${customer.name}（${customer.customer_code}）` : customer.name"
          />
        </el-select>
        <el-button @click="createCustomerVisible = true">新建客户</el-button>
        <el-button type="primary" :icon="Plus" :loading="creating" @click="startApplication">
          发起申报
        </el-button>
      </div>
    </el-card>

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
        <el-select
          v-model="query.status"
          clearable
          placeholder="全部状态"
          class="status-select"
          @change="(query.page = 1), load()"
        >
          <el-option
            v-for="(label, value) in AccessStatusLabel"
            :key="value"
            :value="value"
            :label="label"
          />
        </el-select>
        <el-button @click="load">刷新</el-button>
      </div>

      <el-table v-loading="loading" :data="list">
        <el-table-column prop="application_no" label="申请单号" width="170" />
        <el-table-column label="客户" min-width="160">
          <template #default="{ row }">
            <strong>{{ row.customer_snapshot.name }}</strong>
            <span v-if="row.customer_snapshot.customer_code" class="muted">
              · {{ row.customer_snapshot.customer_code }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="业务类型 / 渠道" min-width="150">
          <template #default="{ row }">
            <span v-if="row.scenario_name">{{ row.scenario_name }}<span v-if="row.channel_code" class="muted"> · {{ row.channel_code }}</span></span>
            <span v-else class="muted">未选择</span>
          </template>
        </el-table-column>
        <el-table-column label="材料完整度" width="110">
          <template #default="{ row }">
            <span v-if="row.completeness.total">{{ row.completeness.done }} / {{ row.completeness.total }}</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="STATUS_TAG[row.status] || 'info'" size="small">
              {{ AccessStatusLabel[row.status as AccessStatus] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="owner_name" label="负责人" width="90" />
        <el-table-column label="更新时间" width="160">
          <template #default="{ row }">{{ new Date(row.updated_at).toLocaleString() }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openApplication(row)">
              {{ editable(row) ? "继续填写" : "查看" }}
            </el-button>
            <el-button v-if="editable(row)" size="small" type="danger" link @click="cancelRow(row)">
              取消
            </el-button>
          </template>
        </el-table-column>
      </el-table>

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

    <CustomerCreateDialog v-model="createCustomerVisible" @created="onCustomerCreated" />
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

.start-card {
  margin-bottom: 14px;
}

.start-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.customer-select {
  width: 320px;
}

.filter-row {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}

.keyword {
  width: 280px;
}

.status-select {
  width: 150px;
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
