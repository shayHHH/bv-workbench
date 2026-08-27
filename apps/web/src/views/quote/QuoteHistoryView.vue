<script setup lang="ts">
/**
 * 往期报价：平台基准价快照（按日）+ 客户报价 7 日矩阵（真实按日查询，
 * 原型中矩阵历史列是硬编码占位，迁移后接 quote_records）。
 */
import { Refresh, Search } from "@element-plus/icons-vue";
import type { BenchmarkSnapshotVO, QuoteRecordVO } from "@bv/shared";
import { RoundModeLabel } from "@bv/shared";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { fetchBenchmarkSnapshots, fetchQuoteRecords } from "@/api/quote";
import {
  customerDisplayLabel,
  fetchAllQuoteCustomers,
  formatQuoteTime,
  localDayRange,
  matchCustomers,
  type QuoteCustomerOption,
} from "./quote-utils";

const { t } = useI18n();

const activeTab = ref<"platform" | "customer">("platform");

/* ---------- 平台基准价 ---------- */
function todayText(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const snapshotDate = ref(todayText());
const snapshots = ref<BenchmarkSnapshotVO[]>([]);
const snapshotLoading = ref(false);

async function loadSnapshots() {
  snapshotLoading.value = true;
  try {
    const range = snapshotDate.value ? localDayRange(snapshotDate.value) : {};
    snapshots.value = await fetchBenchmarkSnapshots(range);
  } finally {
    snapshotLoading.value = false;
  }
}

function resetSnapshots() {
  snapshotDate.value = todayText();
  void loadSnapshots();
}

/* ---------- 客户报价 ---------- */
const customers = ref<QuoteCustomerOption[]>([]);
const query = ref("");
const dropdownOpen = ref(false);
const highlight = ref(0);
const selected = ref<QuoteCustomerOption | null>(null);
const records = ref<QuoteRecordVO[]>([]);
const recordsLoading = ref(false);
const searchBoxRef = ref<HTMLElement>();

const matches = computed(() => matchCustomers(customers.value, query.value, 12));

function handleSearchKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    dropdownOpen.value = true;
    const count = matches.value.length;
    if (!count) return;
    highlight.value = (highlight.value + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
  } else if (event.key === "Enter") {
    const target = matches.value[highlight.value] ?? matches.value[0];
    if (target) void selectCustomer(target);
  } else if (event.key === "Escape") {
    dropdownOpen.value = false;
  }
}

/* 近 7 日（含今日） */
const days = computed(() => {
  const list: { key: string; label: string; isToday: boolean }[] = [];
  const weekdays = t("quote.history.weekdays");
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const p = (n: number) => String(n).padStart(2, "0");
    const key = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
    const md = `${p(date.getMonth() + 1)}-${p(date.getDate())}`;
    const label =
      offset === 0
        ? `${md} (${t("quote.history.today")})`
        : offset === 1
          ? `${md} (${t("quote.history.yesterday")})`
          : `${md} (${weekdays[date.getDay()] ?? ""})`;
    list.push({ key, label, isToday: offset === 0 });
  }
  return list;
});

const rangeText = computed(() => `${days.value[0]?.key} ${t("quote.history.rangeTo")} ${days.value[6]?.key}`);

/** trade_type 行 × 日期列 → 该日最新记录 */
const matrix = computed(() => {
  const rows = new Map<string, Map<string, QuoteRecordVO>>();
  for (const record of records.value) {
    const type = record.trade_type || record.prefix || "-";
    const dayKey = record.quoted_at.slice(0, 10);
    const local = new Date(record.quoted_at);
    const p = (n: number) => String(n).padStart(2, "0");
    const localKey = `${local.getFullYear()}-${p(local.getMonth() + 1)}-${p(local.getDate())}`;
    void dayKey;
    if (!rows.has(type)) rows.set(type, new Map());
    const byDay = rows.get(type)!;
    const existing = byDay.get(localKey);
    if (!existing || existing.quoted_at < record.quoted_at) byDay.set(localKey, record);
  }
  return rows;
});

async function loadRecords() {
  const customer = selected.value;
  if (!customer) return;
  recordsLoading.value = true;
  try {
    const from = localDayRange(days.value[0].key).from;
    const to = localDayRange(days.value[6].key).to;
    records.value = await fetchQuoteRecords({ customer_id: customer.id, from, to });
  } finally {
    recordsLoading.value = false;
  }
}

async function selectCustomer(option: QuoteCustomerOption) {
  selected.value = option;
  query.value = customerDisplayLabel(option);
  dropdownOpen.value = false;
  await loadRecords();
}

function handleDocumentClick(event: MouseEvent) {
  if (!searchBoxRef.value?.contains(event.target as Node)) dropdownOpen.value = false;
}

/* ---------- 明细抽屉 ---------- */
const drawerVisible = ref(false);
const detail = ref<QuoteRecordVO | null>(null);

function openDetail(record: QuoteRecordVO) {
  detail.value = record;
  drawerVisible.value = true;
}

onMounted(async () => {
  document.addEventListener("click", handleDocumentClick);
  await loadSnapshots();
  customers.value = await fetchAllQuoteCustomers();
  if (customers.value.length) await selectCustomer(customers.value[0]);
});
</script>

<template>
  <div>
    <header class="page-header">
      <p class="eyebrow">{{ t("quote.common.eyebrow") }}</p>
      <h1>{{ t("quote.history.title") }}</h1>
      <p class="subtitle">{{ t("quote.history.subtitle") }}</p>
    </header>

    <el-card shadow="never">
      <el-tabs v-model="activeTab">
        <!-- 平台基准价 -->
        <el-tab-pane :label="t('quote.history.tabPlatform')" name="platform">
          <div class="filter-row">
            <span>{{ t("quote.history.dateLabel") }}</span>
            <el-date-picker
              v-model="snapshotDate"
              type="date"
              value-format="YYYY-MM-DD"
              :clearable="false"
            />
            <el-button type="primary" plain :icon="Search" @click="loadSnapshots">
              {{ t("quote.history.search") }}
            </el-button>
            <el-button @click="resetSnapshots">{{ t("quote.history.reset") }}</el-button>
            <span class="count-text">
              {{ t("quote.history.recordCount", { n: snapshots.length }) }}
            </span>
          </div>

          <div v-loading="snapshotLoading" class="snapshot-list">
            <el-empty
              v-if="!snapshots.length"
              :description="t('quote.history.emptyHistory')"
              :image-size="72"
            />
            <article v-for="snapshot in snapshots" :key="snapshot.id" class="snapshot-card">
              <h3>{{ t("quote.history.snapshotTitle", { time: formatQuoteTime(snapshot.saved_at) }) }}</h3>
              <el-table :data="snapshot.prices" size="small">
                <el-table-column :label="t('quote.history.colType')" prop="label" min-width="180" />
                <el-table-column :label="t('quote.history.colPrice')" min-width="140">
                  <template #default="{ row }">
                    <code class="mono">{{ row.value }}</code>
                  </template>
                </el-table-column>
                <el-table-column :label="t('quote.history.colOperator')" min-width="120">
                  <template #default>{{ snapshot.operator_name }}</template>
                </el-table-column>
              </el-table>
            </article>
          </div>
        </el-tab-pane>

        <!-- 客户报价 -->
        <el-tab-pane :label="t('quote.history.tabCustomer')" name="customer">
          <div class="filter-row">
            <span>{{ t("quote.history.searchCustomer") }}</span>
            <div ref="searchBoxRef" class="search-box">
              <el-input
                v-model="query"
                :placeholder="t('quote.common.customerPlaceholder')"
                @focus="dropdownOpen = true"
                @input="dropdownOpen = true; highlight = 0"
                @keydown="handleSearchKeydown"
              />
              <div v-if="dropdownOpen" class="dropdown">
                <button
                  v-for="(option, index) in matches"
                  :key="option.id"
                  type="button"
                  class="dropdown-item"
                  :class="{ active: index === highlight }"
                  @mouseenter="highlight = index"
                  @click="selectCustomer(option)"
                >
                  <strong>{{ customerDisplayLabel(option) }}</strong>
                  <span>{{ option.broker_label ?? t("quote.common.direct") }}</span>
                </button>
                <div v-if="!matches.length" class="dropdown-empty">
                  {{ t("quote.common.noMatchedCustomer") }}
                </div>
              </div>
            </div>
            <span>{{ t("quote.history.dateRange") }}</span>
            <strong class="range-text">{{ rangeText }}</strong>
            <el-button class="refresh-btn" type="primary" :icon="Refresh" @click="loadRecords">
              {{ t("quote.history.refreshData") }}
            </el-button>
          </div>

          <el-table
            v-loading="recordsLoading"
            :data="[...matrix.keys()].map(type => ({ type }))"
            size="small"
            class="matrix-table"
          >
            <el-table-column :label="t('quote.history.colTradeType')" min-width="160" fixed>
              <template #default="{ row }">
                <strong>{{ row.type }}</strong>
              </template>
            </el-table-column>
            <el-table-column
              v-for="day in days"
              :key="day.key"
              :min-width="110"
              align="center"
            >
              <template #header>
                <span :class="{ 'today-col': day.isToday }">{{ day.label }}</span>
              </template>
              <template #default="{ row }">
                <button
                  v-if="matrix.get(row.type)?.get(day.key)"
                  type="button"
                  class="quote-cell"
                  :class="{ highlight: day.isToday }"
                  @click="openDetail(matrix.get(row.type)!.get(day.key)!)"
                >
                  {{ matrix.get(row.type)!.get(day.key)!.result }}
                </button>
                <span v-else class="empty-cell">-</span>
              </template>
            </el-table-column>
            <template #empty>
              <span>{{ t("quote.history.emptyCustomerHistory") }}</span>
            </template>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 报价明细抽屉 -->
    <el-drawer
      v-model="drawerVisible"
      :title="detail ? t('quote.history.detailTitle', { type: detail.trade_type || detail.prefix }) : ''"
      size="420px"
    >
      <template v-if="detail">
        <div class="detail-result">
          <span>{{ detail.prefix }} {{ detail.suffix }}</span>
          <strong class="mono">{{ detail.result }}</strong>
          <small>{{ t("quote.history.finalQuote") }}</small>
        </div>

        <h4>{{ t("quote.history.baseInfo") }}</h4>
        <div class="detail-grid">
          <div><span>{{ t("quote.history.customer") }}</span><strong>{{ detail.customer_name }}{{ detail.customer_code ? ` (${detail.customer_code})` : "" }}</strong></div>
          <div><span>{{ t("quote.history.broker") }}</span><strong>{{ detail.broker_label ?? "-" }}</strong></div>
          <div><span>{{ t("quote.history.quotedAt") }}</span><strong>{{ formatQuoteTime(detail.quoted_at) }}</strong></div>
          <div><span>{{ t("quote.history.operator") }}</span><strong>{{ detail.operator_name }}</strong></div>
          <div><span>{{ t("quote.history.tradeType") }}</span><strong>{{ detail.trade_type || "-" }}</strong></div>
          <div><span>{{ t("quote.history.prefixDesc") }}</span><strong>{{ detail.prefix || "-" }}</strong></div>
        </div>

        <h4>{{ t("quote.history.formulaSection") }}</h4>
        <div class="formula-block mono">
          <p>{{ t("quote.history.formulaLabel") }}{{ detail.formula_text }}</p>
          <p>{{ t("quote.history.calcLabel") }}{{ detail.formula_calc }} = {{ detail.result }}</p>
        </div>

        <h4>{{ t("quote.history.variableSection") }}</h4>
        <div class="variable-rows">
          <div v-for="(variable, index) in detail.variables" :key="index">
            <span>{{ variable.label }}</span>
            <code class="mono">{{ variable.value }}</code>
          </div>
        </div>

        <h4>{{ t("quote.history.pointSection") }}</h4>
        <div class="detail-grid">
          <div><span>{{ t("quote.history.brokerPoint") }}</span><strong>{{ detail.broker_point }}</strong></div>
          <div><span>{{ t("quote.history.bvPoint") }}</span><strong>{{ detail.bv_point }}</strong></div>
          <div><span>{{ t("quote.history.digits") }}</span><strong>{{ detail.digits }}</strong></div>
          <div><span>{{ t("quote.history.roundModeLabel") }}</span><strong>{{ t(`quote.roundMode.${detail.round_mode}`) || RoundModeLabel[detail.round_mode] }}</strong></div>
        </div>
      </template>
    </el-drawer>
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
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
  font-size: 13px;
  color: #606266;
}

.count-text {
  margin-left: auto;
  color: #909399;
}

.count-text :deep(strong) {
  color: #d9531e;
}

.snapshot-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 120px;
}

.snapshot-card h3 {
  font-size: 14px;
  margin: 0 0 8px;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.search-box {
  position: relative;
  width: 260px;
}

.dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 30;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
}

.dropdown-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
}

.dropdown-item:hover,
.dropdown-item.active {
  background: #fff4ed;
}

.dropdown-item span {
  color: #909399;
  font-size: 12px;
}

.dropdown-empty {
  padding: 12px;
  color: #909399;
  font-size: 13px;
  text-align: center;
}

.range-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
}

.refresh-btn {
  margin-left: auto;
}

.today-col {
  color: #d9531e;
  font-weight: 700;
}

.quote-cell {
  border: 1px solid #ebeef5;
  background: #fafafa;
  border-radius: 6px;
  padding: 3px 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  cursor: pointer;
}

.quote-cell:hover {
  border-color: #f6b895;
}

.quote-cell.highlight {
  background: #fff4ed;
  border-color: #f6b895;
  color: #d9531e;
  font-weight: 600;
}

.empty-cell {
  color: #c0c4cc;
}

.detail-result {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  background: #fff4ed;
  border: 1px solid #f6b895;
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 16px;
}

.detail-result strong {
  font-size: 24px;
  color: #d9531e;
}

.detail-result small {
  color: #909399;
}

h4 {
  margin: 18px 0 8px;
  font-size: 13px;
  color: #303133;
}

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
}

.detail-grid span {
  display: block;
  color: #909399;
  font-size: 12px;
}

.detail-grid strong {
  font-size: 13px;
}

.formula-block {
  background: #fafafa;
  border: 1px dashed #e4e7ed;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12px;
}

.formula-block p {
  margin: 2px 0;
  word-break: break-all;
}

.variable-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.variable-rows > div {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  border-bottom: 1px dashed #f0f2f5;
  padding-bottom: 4px;
}

.variable-rows span {
  color: #606266;
}
</style>
