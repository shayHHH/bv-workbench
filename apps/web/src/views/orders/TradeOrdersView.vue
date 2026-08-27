<script setup lang="ts">
import {
  FundingKind,
  fundingKindOf,
  TradeOrderStatus,
  TradeOrderStatusLabel,
  type FundingSide,
  type OrderListStatsVO,
  type TradeOrderVO,
} from "@bv/shared";
import { Plus } from "@element-plus/icons-vue";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { fetchOrders, type OrderListQuery } from "@/api/order";
import { useAuthStore } from "@/stores/auth";
import { formatRelative } from "@/utils/format";
import DispatchDialog from "./DispatchDialog.vue";
import FundingDialog from "./FundingDialog.vue";
import OrderCreateDialog from "./OrderCreateDialog.vue";
import OrderPanel from "./OrderPanel.vue";

const auth = useAuthStore();
const role = computed(() => auth.roleCode);

const loading = ref(false);
const items = ref<TradeOrderVO[]>([]);
const total = ref(0);
const stats = ref<OrderListStatsVO | null>(null);
const query = reactive({ keyword: "", status: "", page: 1, page_size: 10 });
const activeTodo = ref("");

const ACTIVE_STATUSES = "PENDING_KYC,AWAITING_INFLOW,AWAITING_DISPATCH,DISPATCH_REVIEW,AWAITING_PAYOUT";

interface TodoTab {
  label: string;
  params: Partial<OrderListQuery>;
  count: (s: OrderListStatsVO) => number;
}

const sumStatus = (s: OrderListStatsVO, ...statuses: string[]) =>
  statuses.reduce((n, status) => n + (s.by_status[status] ?? 0), 0);
const allCount = (s: OrderListStatsVO) => Object.values(s.by_status).reduce((a, b) => a + b, 0);

const TODO_DEFS: Record<string, TodoTab[]> = {
  AGENT: [
    { label: "我的交易", params: {}, count: allCount },
    { label: "待 KYC", params: { status: "PENDING_KYC" }, count: s => sumStatus(s, "PENDING_KYC") },
    { label: "待客户入款", params: { status: "AWAITING_INFLOW" }, count: s => sumStatus(s, "AWAITING_INFLOW") },
    { label: "待出款排单", params: { status: "AWAITING_DISPATCH" }, count: s => sumStatus(s, "AWAITING_DISPATCH") },
    { label: "被退回", params: { flag: "rejected" }, count: s => s.payment_rejected + s.dispatch_rejected },
  ],
  OPS: [
    { label: "待审核", params: { status: "DISPATCH_REVIEW" }, count: s => sumStatus(s, "DISPATCH_REVIEW") },
    { label: "已审核", params: { status: "AWAITING_PAYOUT,COMPLETED" }, count: s => sumStatus(s, "AWAITING_PAYOUT", "COMPLETED") },
    { label: "附加异常", params: { flag: "exception" }, count: s => s.exceptions },
    { label: "全部订单", params: {}, count: allCount },
  ],
  FINANCE: [
    { label: "待法币入款登记", params: { status: "AWAITING_INFLOW", inflow_kind: "fiat" }, count: s => s.inflow_fiat },
    { label: "已登记", params: { status: "AWAITING_DISPATCH,DISPATCH_REVIEW,AWAITING_PAYOUT,COMPLETED" }, count: s => sumStatus(s, "AWAITING_DISPATCH", "DISPATCH_REVIEW", "AWAITING_PAYOUT", "COMPLETED") },
    { label: "全部订单", params: {}, count: allCount },
  ],
  WALLET: [
    { label: "待链上入款登记", params: { status: "AWAITING_INFLOW", inflow_kind: "chain" }, count: s => s.inflow_chain },
    { label: "待地址 KYA", params: { kya_pending: "1" }, count: s => s.kya_pending },
    { label: "待链上出款", params: { status: "AWAITING_PAYOUT", outflow_kind: "chain" }, count: s => s.outflow_chain },
    { label: "全部订单", params: {}, count: allCount },
  ],
  PAYOUT: [
    { label: "待银行出款", params: { status: "AWAITING_PAYOUT", outflow_kind: "fiat" }, count: s => s.outflow_fiat },
    { label: "已完成", params: { status: "COMPLETED" }, count: s => sumStatus(s, "COMPLETED") },
    { label: "全部订单", params: {}, count: allCount },
  ],
  MANAGER: [
    { label: "全部订单", params: {}, count: allCount },
    { label: "进行中", params: { status: ACTIVE_STATUSES }, count: s => s.active },
    { label: "附加异常", params: { flag: "exception" }, count: s => s.exceptions },
    { label: "已完成", params: { status: "COMPLETED" }, count: s => sumStatus(s, "COMPLETED") },
  ],
};

const todoTabs = computed(() => TODO_DEFS[role.value] ?? TODO_DEFS.MANAGER);

const SUBTITLES: Record<string, string> = {
  AGENT: "订单主线：待KYC → 待客户入款 → 待出款排单 → 出款审核 → 出款执行 → 完成，报价作为前置信息随单留档。",
  OPS: "复核出款排单与异常处理；风险事件可退回或终止。",
  FINANCE: "法币入款登记即确认，订单直接进入待出款排单。",
  MANAGER: "全量订单总览，跟踪状态分布与异常。",
  PAYOUT: "排单审核通过后执行银行出款并登记，登记即完成。",
  WALLET: "收 U 地址、地址 KYA、链上入款与出款登记都在订单里完成。",
  ADMIN: "全量订单总览，跟踪状态分布与异常。",
};

async function load() {
  loading.value = true;
  try {
    const tabDef = todoTabs.value.find(tab => tab.label === activeTodo.value) ?? todoTabs.value[0];
    const page = await fetchOrders({
      keyword: query.keyword || undefined,
      status: query.status || tabDef.params.status,
      flag: tabDef.params.flag,
      inflow_kind: tabDef.params.inflow_kind,
      outflow_kind: tabDef.params.outflow_kind,
      kya_pending: tabDef.params.kya_pending,
      page: query.page,
      page_size: query.page_size,
    });
    items.value = page.items;
    total.value = page.total;
    stats.value = page.stats;
  } finally {
    loading.value = false;
  }
}

function switchTodo(label: string) {
  activeTodo.value = label;
  query.page = 1;
  query.status = "";
  load();
}

function search() {
  query.page = 1;
  load();
}

/* ---- 行展示 ---- */

const STATUS_TAG: Record<string, "primary" | "success" | "warning" | "info" | "danger"> = {
  PENDING_KYC: "info",
  AWAITING_INFLOW: "warning",
  AWAITING_DISPATCH: "primary",
  DISPATCH_REVIEW: "info",
  AWAITING_PAYOUT: "warning",
  COMPLETED: "success",
  CANCELLED: "info",
};

const KYC_TAG: Record<string, "primary" | "success" | "warning" | "info" | "danger"> = {
  success: "success",
  info: "primary",
  warning: "warning",
  danger: "danger",
  neutral: "info",
};

/** demo orderCardCta：行按钮文案按 状态 × 角色 矩阵；点击一律打开详情 */
function rowCta(order: TradeOrderVO): string {
  const r = role.value;
  if (r === "AGENT" || r === "OPS") {
    if (r === "AGENT" && order.status === TradeOrderStatus.PENDING_KYC) return "材料上传";
    if (order.status === TradeOrderStatus.AWAITING_DISPATCH) return "出款排单";
  }
  if (r === "OPS") {
    if (order.status === TradeOrderStatus.DISPATCH_REVIEW) return "开始审核";
    if (order.exception) return "处理异常";
  }
  if (r === "FINANCE" && order.status === TradeOrderStatus.AWAITING_INFLOW && fundingKindOf(order, "inflow") !== FundingKind.CHAIN) return "登记入款";
  if (r === "WALLET") {
    if (order.status === TradeOrderStatus.AWAITING_INFLOW && fundingKindOf(order, "inflow") === FundingKind.CHAIN)
      return order.wallet_ops?.deposit_address ? "登记入款" : "提供收U地址";
    if (fundingKindOf(order, "outflow") === FundingKind.CHAIN && !order.wallet_ops?.kya_passed && ["AWAITING_INFLOW", "AWAITING_DISPATCH"].includes(order.status)) return "地址KYA登记";
    if (order.status === TradeOrderStatus.AWAITING_PAYOUT && fundingKindOf(order, "outflow") === FundingKind.CHAIN) return "登记链上转账";
  }
  if (r === "PAYOUT" && order.status === TradeOrderStatus.AWAITING_PAYOUT && fundingKindOf(order, "outflow") !== FundingKind.CHAIN) return "出款登记";
  return "查看";
}

const fmtMoney = (currency: string, amount: number) => `${currency} ${amount.toLocaleString("en-US")}`;

/* ---- 详情与弹窗 ---- */

const panelOrderId = ref("");
const createVisible = ref(false);
const fundingVisible = ref(false);
const fundingSide = ref<FundingSide>("inflow");
const fundingOrder = ref<TradeOrderVO | null>(null);
const dispatchVisible = ref(false);
const dispatchOrder = ref<TradeOrderVO | null>(null);
const panelRef = ref<InstanceType<typeof OrderPanel>>();

function openPanel(order: TradeOrderVO) {
  panelOrderId.value = order.id;
}

function onCreated(order: TradeOrderVO) {
  load();
  panelOrderId.value = order.id;
}

function openFunding(order: TradeOrderVO, side: FundingSide) {
  fundingOrder.value = order;
  fundingSide.value = side;
  fundingVisible.value = true;
}

function openDispatch(order: TradeOrderVO) {
  dispatchOrder.value = order;
  dispatchVisible.value = true;
}

function onActionDone() {
  load();
  panelRef.value?.reload();
}

const route = useRoute();

onMounted(() => {
  activeTodo.value = "";
  const kw = typeof route.query.kw === "string" ? route.query.kw.trim() : "";
  if (kw) query.keyword = kw;
  load();
});
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <p class="eyebrow">TRADE ORDERS</p>
        <h1>{{ role === "MANAGER" ? "交易订单总览" : role === "WALLET" ? "钱包任务" : "交易订单" }}</h1>
        <p class="subtitle">{{ SUBTITLES[role] ?? SUBTITLES.MANAGER }}</p>
      </div>
      <el-button v-if="role === 'AGENT' || role === 'OPS'" type="primary" :icon="Plus" @click="createVisible = true">
        新建订单
      </el-button>
    </header>

    <div v-if="stats" class="metric-strip">
      <div class="metric"><strong>{{ stats.active }}</strong><span>进行中订单</span><small>未完成/未取消</small></div>
      <div class="metric"><strong>{{ stats.by_status.PENDING_KYC ?? 0 }}</strong><span>待KYC</span><small>等待业务准入</small></div>
      <div class="metric"><strong>{{ stats.by_status.AWAITING_INFLOW ?? 0 }}</strong><span>待客户入款</span><small>等待入款登记</small></div>
      <div class="metric">
        <strong>{{ (stats.by_status.AWAITING_DISPATCH ?? 0) + (stats.by_status.DISPATCH_REVIEW ?? 0) + (stats.by_status.AWAITING_PAYOUT ?? 0) }}</strong>
        <span>资金执行阶段</span><small>排单 / 审核 / 执行</small>
      </div>
      <div class="metric"><strong>{{ stats.exceptions }}</strong><span>附加异常</span><small>不打断主线状态</small></div>
    </div>

    <el-card shadow="never">
      <div class="todo-tabs">
        <button
          v-for="tab in todoTabs"
          :key="tab.label"
          type="button"
          :class="{ active: (activeTodo || todoTabs[0].label) === tab.label }"
          @click="switchTodo(tab.label)"
        >
          {{ tab.label }}<em v-if="stats">{{ tab.count(stats) }}</em>
        </button>
      </div>

      <div class="toolbar">
        <el-input
          v-model="query.keyword"
          class="keyword"
          placeholder="搜索客户 / 类型 / 订单号"
          clearable
          @keyup.enter="search"
          @clear="search"
        />
        <el-select v-model="query.status" class="status-filter" clearable placeholder="全部状态" @change="search">
          <el-option v-for="(label, value) in TradeOrderStatusLabel" :key="value" :value="value" :label="label" />
        </el-select>
        <span class="count">{{ total }} 笔订单 · 点击任意行展开详情</span>
      </div>

      <el-table v-loading="loading" :data="items" row-key="id" @row-click="openPanel">
        <el-table-column label="订单编号" width="165">
          <template #default="{ row }">
            <strong class="mono">{{ row.order_no }}</strong>
            <div class="muted">创建 {{ formatRelative(row.created_at) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="客户主体" min-width="150">
          <template #default="{ row }">
            <strong>{{ row.customer_name }}</strong>
            <div class="muted">ID: {{ row.customer_code || "无编号" }}</div>
          </template>
        </el-table-column>
        <el-table-column label="KYC 状态" width="105">
          <template #default="{ row }">
            <el-tag :type="KYC_TAG[row.kyc.tone]" size="small" effect="light">{{ row.kyc.label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.trade_type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="交易对 / 金额" min-width="200">
          <template #default="{ row }">
            <div class="pair">
              <b>{{ fmtMoney(row.sell_currency, row.sell_amount) }}</b>
              <i>→</i>
              <b class="buy">{{ fmtMoney(row.buy_currency, row.buy_amount) }}</b>
            </div>
            <div class="muted">{{ row.pay_method }} · {{ row.handler_name }} · {{ formatRelative(row.updated_at) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="执行汇率" width="90">
          <template #default="{ row }"><span class="mono">{{ row.rate }}</span></template>
        </el-table-column>
        <el-table-column label="当前状态" min-width="130">
          <template #default="{ row }">
            <el-tag :type="STATUS_TAG[row.status]" size="small">{{ TradeOrderStatusLabel[row.status as TradeOrderStatus] }}</el-tag>
            <div v-if="row.exception" class="flag">{{ row.exception.kind }} · {{ row.exception.reason }}</div>
            <div v-if="row.dispatch_rejected" class="flag">出款审核驳回</div>
            <div v-if="row.payment_rejected" class="flag">付款被驳回</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" align="right">
          <template #default="{ row }">
            <el-button size="small" :type="rowCta(row) === '查看' ? 'default' : 'primary'" plain @click.stop="openPanel(row)">
              {{ rowCta(row) }} →
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !items.length" description="没有匹配的订单，调整筛选条件或创建新订单" />

      <div class="pager">
        <el-pagination
          v-model:current-page="query.page"
          layout="prev, pager, next, jumper, total"
          :total="total"
          :page-size="query.page_size"
          @current-change="load"
        />
      </div>
    </el-card>

    <OrderPanel
      v-if="panelOrderId"
      ref="panelRef"
      :order-id="panelOrderId"
      @close="panelOrderId = ''"
      @changed="load"
      @funding="openFunding"
      @dispatch="openDispatch"
    />
    <OrderCreateDialog v-model="createVisible" @created="onCreated" />
    <FundingDialog v-model="fundingVisible" :order="fundingOrder" :side="fundingSide" @done="onActionDone" />
    <DispatchDialog v-model="dispatchVisible" :order="dispatchOrder" @done="onActionDone" />
  </div>
</template>

<style scoped>
.page-header {
  margin-bottom: 16px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
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

.metric-strip {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}

.metric {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 12px 14px;
}

.metric strong {
  font-size: 20px;
  display: block;
}

.metric span {
  color: #303133;
  font-size: 13px;
}

.metric small {
  display: block;
  color: #909399;
  font-size: 11px;
}

.todo-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.todo-tabs button {
  border: 1px solid #e4e7ed;
  background: #fff;
  border-radius: 999px;
  padding: 5px 14px;
  cursor: pointer;
  font-size: 13px;
  color: #606266;
}

.todo-tabs button.active {
  background: #ff7a00;
  border-color: #ff7a00;
  color: #fff;
}

.todo-tabs em {
  font-style: normal;
  margin-left: 6px;
  opacity: 0.8;
}

.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}

.keyword {
  width: 260px;
}

.status-filter {
  width: 150px;
}

.count {
  color: #909399;
  font-size: 12px;
  margin-left: auto;
}

.mono {
  font-family: ui-monospace, monospace;
}

.muted {
  color: #909399;
  font-size: 12px;
}

.pair {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pair i {
  color: #ff7a00;
  font-style: normal;
}

.pair .buy {
  color: #2e7d32;
}

.flag {
  color: #f56c6c;
  font-size: 11px;
  margin-top: 2px;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}

:deep(.el-table__row) {
  cursor: pointer;
}
</style>
