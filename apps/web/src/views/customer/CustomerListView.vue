<script setup lang="ts">
import {
  CustomerKind,
  CustomerKindLabel,
  CustomerStatus,
  CustomerStatusLabel,
  CustomerSubTypeLabel,
  RegionLabel,
  type CustomerVO,
} from "@bv/shared";
import { Plus, Refresh, Search } from "@element-plus/icons-vue";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
import { useRoute } from "vue-router";
import { fetchCustomers } from "@/api/customer";
import { useAuthStore } from "@/stores/auth";
import { formatRelative } from "@/utils/format";
import CustomerCreateDialog from "./CustomerCreateDialog.vue";
import CustomerDetailDrawer from "./CustomerDetailDrawer.vue";
import CustomerEditDialog from "./CustomerEditDialog.vue";

const { t } = useI18n();
const route = useRoute();
const auth = useAuthStore();

const loading = ref(false);
const items = ref<CustomerVO[]>([]);
const total = ref(0);
const totalAll = ref(0);
const createVisible = ref(false);
const editVisible = ref(false);
const editTarget = ref<CustomerVO | null>(null);
const drawerVisible = ref(false);
const drawerTarget = ref<CustomerVO | null>(null);
const expanded = ref(new Set<string>());

const query = reactive({
  keyword: (route.query.kw as string) || "",
  customer_status: "" as "" | CustomerStatus,
  customer_kind: "" as "" | CustomerKind,
  page: 1,
  page_size: 8,
});

const canManage = computed(() => ["AGENT", "OPS", "ADMIN"].includes(auth.roleCode));

async function load() {
  loading.value = true;
  try {
    const result = await fetchCustomers({
      keyword: query.keyword || undefined,
      customer_status: query.customer_status || undefined,
      customer_kind: query.customer_kind || undefined,
      page: query.page,
      page_size: query.page_size,
    });
    items.value = result.items;
    total.value = result.total;
    totalAll.value = result.total_all;
    // 关键词命中下级客户时自动展开对应中介
    if (query.keyword) {
      for (const item of result.items) {
        if (item.sub_customers?.some(sub => `${sub.name}${sub.customer_code || ""}`.includes(query.keyword))) {
          expanded.value.add(item.id);
        }
      }
    }
  } finally {
    loading.value = false;
  }
}

function search() {
  query.page = 1;
  load();
}

function resetFilters() {
  query.keyword = "";
  query.customer_status = "";
  query.customer_kind = "";
  query.page = 1;
  load();
}

/* 主行 + 已展开中介的下级行拍平成一张表 */
interface TableRow {
  rowType: "main" | "sub";
  c: CustomerVO;
  parent?: CustomerVO;
}

const rows = computed<TableRow[]>(() =>
  items.value.flatMap(item => [
    { rowType: "main" as const, c: item },
    ...(expanded.value.has(item.id)
      ? (item.sub_customers ?? []).map(sub => ({ rowType: "sub" as const, c: sub, parent: item }))
      : []),
  ]),
);

function toggleExpand(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id);
  else expanded.value.add(id);
  expanded.value = new Set(expanded.value);
}

function initials(row: TableRow): string {
  const name = row.c.name;
  if (row.rowType === "sub") return name.slice(-1);
  return /^[a-zA-Z]/.test(name) ? name.slice(0, 2).toUpperCase() : name.slice(0, 1);
}

const statusTagType: Record<CustomerStatus, "primary" | "success" | "warning" | "info"> = {
  NEW: "primary",
  ACTIVE: "success",
  DORMANT: "warning",
  SUSPENDED: "info",
};

/* el-table 插槽 row 无类型，统一经带类型的辅助函数取展示内容 */
const kindText = (row: TableRow) => localizeText(CustomerKindLabel[row.c.customer_kind]);
const subjectTypeText = (row: TableRow) => (row.c.sub_type ? localizeText(CustomerSubTypeLabel[row.c.sub_type]) : "—");
const regionText = (row: TableRow) => {
  const region = row.c.region ?? row.parent?.region ?? null;
  return region ? localizeText(RegionLabel[region]) : t("customer.list.regionEmpty");
};
const statusText = (row: TableRow) => localizeText(CustomerStatusLabel[row.c.customer_status]);
const statusType = (row: TableRow) => statusTagType[row.c.customer_status];
const updatedText = (row: TableRow) => formatRelative(row.c.updated_at);
const isIntermediary = (row: TableRow) =>
  row.rowType === "main" && row.c.customer_kind === CustomerKind.INTERMEDIARY;

function openEdit(row: TableRow) {
  editTarget.value = row.c;
  editVisible.value = true;
}

function openDrawer(row: TableRow) {
  drawerTarget.value = row.c;
  drawerVisible.value = true;
}

function onDrawerEdit(customer: CustomerVO) {
  drawerVisible.value = false;
  editTarget.value = customer;
  editVisible.value = true;
}

function onChanged() {
  createVisible.value = false;
  editVisible.value = false;
  load();
}

watch(
  () => route.query.kw,
  kw => {
    query.keyword = (kw as string) || "";
    search();
  },
);

onMounted(load);
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <p class="eyebrow">CLIENT MASTER</p>
        <h1>{{ t("customer.list.title") }}</h1>
        <p class="subtitle">{{ t("customer.list.subtitle") }}</p>
      </div>
      <el-button v-if="canManage" type="primary" :icon="Plus" @click="createVisible = true">
        {{ t("customer.list.create") }}
      </el-button>
    </header>

    <el-card shadow="never">
      <div class="toolbar">
        <el-input
          v-model="query.keyword"
          class="keyword"
          :placeholder="t('customer.list.searchPh')"
          clearable
          :prefix-icon="Search"
          @keyup.enter="search"
          @clear="search"
        />
        <el-select v-model="query.customer_status" class="filter" :placeholder="t('customer.list.allStatus')" clearable @change="search">
          <el-option v-for="(label, value) in CustomerStatusLabel" :key="value" :label="label" :value="value" />
        </el-select>
        <el-select v-model="query.customer_kind" class="filter" :placeholder="t('customer.list.allKind')" clearable @change="search">
          <el-option v-for="(label, value) in CustomerKindLabel" :key="value" :label="label" :value="value" />
        </el-select>
        <el-button :icon="Refresh" @click="resetFilters">{{ t("customer.list.reset") }}</el-button>
        <span class="count">{{ t("customer.list.countSummary", { total, totalAll }) }}</span>
      </div>

      <el-table
        v-loading="loading"
        :data="rows"
        :row-key="(row: TableRow) => `${row.rowType}-${row.c.id}`"
        :row-class-name="({ row }: { row: TableRow }) => (row.rowType === 'sub' ? 'sub-row' : '')"
      >
        <el-table-column :label="t('customer.list.colCustomer')" min-width="220">
          <template #default="{ row }">
            <div class="cell-primary" :class="{ sub: row.rowType === 'sub' }">
              <button
                v-if="isIntermediary(row)"
                class="expander"
                :class="{ open: expanded.has(row.c.id) }"
                type="button"
                @click.stop="toggleExpand(row.c.id)"
              >
                ›
              </button>
              <span v-else class="expander-placeholder" :class="{ connector: row.rowType === 'sub' }" />
              <span class="avatar" :class="{ company: isIntermediary(row), 'avatar-sub': row.rowType === 'sub' }">
                {{ initials(row) }}
              </span>
              <span class="name-block">
                <button class="name-link" type="button" @click.stop="openDrawer(row)">
                  {{ row.c.name }}
                </button>
                <small>{{ row.c.customer_code || t("customer.common.noCode") }}</small>
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="t('customer.list.colCustomerType')" min-width="120">
          <template #default="{ row }">
            {{ kindText(row) }}
            <div class="muted">{{ regionText(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('customer.list.colSubjectType')" min-width="110">
          <template #default="{ row }">
            {{ subjectTypeText(row) }}
          </template>
        </el-table-column>
        <el-table-column :label="t('customer.common.currentStatus')" min-width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row)" effect="light">{{ statusText(row) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('customer.common.lastUpdated')" min-width="100">
          <template #default="{ row }"><span class="muted">{{ updatedText(row) }}</span></template>
        </el-table-column>
        <el-table-column v-if="canManage" :label="t('customer.list.colActions')" min-width="100" align="right">
          <template #default="{ row }">
            <el-button size="small" @click.stop="openEdit(row)">{{ t("customer.common.editInfo") }}</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :description="t('customer.list.emptyText')">
            <el-button @click="resetFilters">{{ t("customer.list.clearFilters") }}</el-button>
          </el-empty>
        </template>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.page_size"
          :total="total"
          layout="total, prev, pager, next, sizes, jumper"
          :page-sizes="[8, 20, 50]"
          @current-change="load"
          @size-change="search"
        />
      </div>
    </el-card>

    <CustomerCreateDialog v-model="createVisible" @created="onChanged" />
    <CustomerEditDialog v-model="editVisible" :customer="editTarget" @updated="onChanged" />
    <CustomerDetailDrawer
      v-model="drawerVisible"
      :customer="drawerTarget"
      @edit="onDrawerEdit"
      @changed="load"
    />
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
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

.expander {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: #909399;
  font-size: 16px;
  line-height: 1;
  transition: transform 0.15s;
}

.expander.open {
  transform: rotate(90deg);
  color: #ff7a00;
}

.expander-placeholder {
  width: 20px;
  flex: none;
}

.expander-placeholder.connector {
  position: relative;
  margin-left: 14px;
}

.expander-placeholder.connector::before {
  content: "";
  position: absolute;
  left: 8px;
  top: -18px;
  bottom: 50%;
  width: 14px;
  border-left: 1px solid #dcdfe6;
  border-bottom: 1px solid #dcdfe6;
  border-bottom-left-radius: 6px;
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

.avatar.company {
  border-radius: 9px;
  background: #fff3e6;
  color: #ff7a00;
}

.avatar.avatar-sub {
  width: 28px;
  height: 28px;
  font-size: 12px;
}

.name-block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.name-block small {
  color: #909399;
}

.name-link {
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  font-weight: 600;
  color: #303133;
  cursor: pointer;
  text-align: left;
}

.name-link:hover {
  color: #ff7a00;
  text-decoration: underline;
}

.muted {
  color: #909399;
  font-size: 12px;
}

.sub-type {
  color: #c2660a;
  font-weight: 600;
  font-size: 12px;
}

:deep(.sub-row) {
  background: #fafbfc;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
