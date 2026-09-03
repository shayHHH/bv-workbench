<script setup lang="ts">
import {
  CustomerEventTypeLabel,
  type AuditEventVO,
  type CustomerEventType,
} from "@bv/shared";
import { onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { fetchAuditEvents } from "@/api/customer";
import { localizeText } from "@/i18n";
import { formatDateTime } from "@/utils/format";

const { t } = useI18n();

const list = ref<AuditEventVO[]>([]);
const loading = ref(false);
const query = reactive({
  keyword: "",
  event_type: "" as "" | CustomerEventType,
  page: 1,
  page_size: 20,
  total: 0,
});

async function load() {
  loading.value = true;
  try {
    const page = await fetchAuditEvents({
      keyword: query.keyword || undefined,
      event_type: query.event_type || undefined,
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
  Object.assign(query, { keyword: "", event_type: "", page: 1 });
  load();
}

const TYPE_TAG: Partial<Record<CustomerEventType, "success" | "warning" | "danger" | "info">> = {
  CREATED: "success",
  DELETED: "danger",
  ACCESS: "warning",
};

onMounted(load);
</script>

<template>
  <div>
    <header class="page-header">
      <p class="eyebrow">{{ t("compliance.audit.eyebrow") }}</p>
      <h1>{{ t("compliance.audit.title") }}</h1>
      <p class="subtitle">{{ t("compliance.audit.subtitle") }}</p>
    </header>

    <el-card shadow="never">
      <div class="filter-row">
        <el-input
          v-model="query.keyword"
          :placeholder="t('compliance.audit.searchPh')"
          clearable
          class="keyword"
          @keyup.enter="search"
          @clear="search"
        />
        <el-select
          v-model="query.event_type"
          clearable
          :placeholder="t('compliance.audit.allTypes')"
          class="type-select"
          @change="search"
        >
          <el-option
            v-for="(label, value) in CustomerEventTypeLabel"
            :key="value"
            :value="value"
            :label="localizeText(label)"
          />
        </el-select>
        <el-button @click="resetFilters">{{ t("compliance.audit.reset") }}</el-button>
        <span class="toolbar-count">{{ t("compliance.audit.count", { n: query.total }) }}</span>
      </div>

      <el-table v-loading="loading" :data="list">
        <el-table-column :label="t('compliance.audit.colTime')" width="170">
          <template #default="{ row }">
            <span class="muted">{{ formatDateTime(row.created_at) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('compliance.audit.colCustomer')" min-width="160">
          <template #default="{ row }">
            <strong>{{ row.customer_name }}</strong>
            <div class="muted small">{{ row.customer_code || t("customer.common.noCode") }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('compliance.audit.colAction')" min-width="150">
          <template #default="{ row }">
            <el-tag :type="TYPE_TAG[row.event_type as CustomerEventType] || 'info'" size="small" effect="plain">
              {{ localizeText(CustomerEventTypeLabel[row.event_type as CustomerEventType] || row.event_type) }}
            </el-tag>
            <span class="action-title">{{ row.title }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('compliance.audit.colDetail')" min-width="280">
          <template #default="{ row }">{{ row.detail }}</template>
        </el-table-column>
        <el-table-column :label="t('compliance.audit.colOperator')" width="120">
          <template #default="{ row }">{{ row.operator_name || t("compliance.audit.system") }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !list.length" :description="t('compliance.audit.empty')" />

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
  color: var(--color-accent);
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

.filter-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 4px 0 14px;
  flex-wrap: wrap;
}

.keyword {
  width: 260px;
}

.type-select {
  width: 160px;
}

.toolbar-count {
  margin-left: auto;
  color: var(--color-text-muted);
  font-size: 13px;
}

.muted {
  color: var(--color-text-muted);
}

.small {
  font-size: 12px;
}

.action-title {
  margin-left: 8px;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
</style>
