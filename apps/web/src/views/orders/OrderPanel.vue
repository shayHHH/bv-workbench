<script setup lang="ts">
import {
  DispatchStatus,
  FundingKind,
  FundingKindLabel,
  FundingOwnerLabel,
  fundingKindOf,
  fundingOwnerRole,
  ORDER_STAGES,
  orderStageCurrent,
  TradeOrderStatus,
  TradeOrderStatusLabel,
  type FundingSide,
  type PayoutOrderVO,
  type TradeOrderVO,
} from "@bv/shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { Close } from "@element-plus/icons-vue";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  approveDispatch,
  cancelOrder,
  fetchOrder,
  fetchOrderDispatch,
  markException,
  outflowReturn,
  resolveException,
  returnDispatch,
  riskStopOrder,
  syncOrderKyc,
  walletDepositAddress,
  walletKya,
} from "@/api/order";
import { useAuthStore } from "@/stores/auth";
import { formatDateTime } from "@/utils/format";

const props = defineProps<{ orderId: string }>();
const emit = defineEmits<{
  close: [];
  changed: [order: TradeOrderVO];
  funding: [order: TradeOrderVO, side: FundingSide];
  dispatch: [order: TradeOrderVO];
}>();

const router = useRouter();
const auth = useAuthStore();
const role = computed(() => auth.roleCode);

const order = ref<TradeOrderVO | null>(null);
const dispatch = ref<PayoutOrderVO | null>(null);
const loading = ref(false);
const tab = ref<"payment" | "payout" | "execution" | "activity">("payment");

async function load() {
  loading.value = true;
  try {
    order.value = await fetchOrder(props.orderId);
    dispatch.value = order.value.dispatch_id ? await fetchOrderDispatch(props.orderId) : null;
  } finally {
    loading.value = false;
  }
}

watch(() => props.orderId, load, { immediate: true });

function applyUpdate(updated: TradeOrderVO) {
  order.value = updated;
  emit("changed", updated);
  load();
}

defineExpose({ reload: load });

/* ---------------- 展示推导 ---------------- */

const fmtMoney = (currency: string, amount: number) => `${currency} ${amount.toLocaleString("en-US")}`;

const STATUS_TAG: Record<string, "primary" | "success" | "warning" | "info" | "danger"> = {
  PENDING_KYC: "info",
  AWAITING_INFLOW: "warning",
  AWAITING_DISPATCH: "primary",
  DISPATCH_REVIEW: "info",
  AWAITING_PAYOUT: "warning",
  COMPLETED: "success",
  CANCELLED: "info",
};

function ownerLabel(side: FundingSide): string {
  if (!order.value) return "";
  return FundingOwnerLabel[fundingOwnerRole(order.value, side)] ?? "";
}

function kindOf(side: FundingSide): FundingKind {
  return order.value ? fundingKindOf(order.value, side) : FundingKind.BANK;
}

const statusHint = computed(() => {
  const o = order.value;
  if (!o) return "";
  const map: Record<string, string> = {
    PENDING_KYC: "等待本单业务准入通过；准入审核通过后自动进入待客户入款",
    AWAITING_INFLOW: `可以交易，等待客户${kindOf("inflow") === FundingKind.CHAIN ? "转 U" : o.pay_method === "现金" ? "交现金" : "TT 付款"}；${ownerLabel("inflow")}登记入款后进入待出款排单`,
    AWAITING_DISPATCH: "客户入款已确认、资金已冻结，等待交易员发起出款排单",
    DISPATCH_REVIEW: "出款排单已提交，等待高级交易员审核",
    AWAITING_PAYOUT: `排单已通过，等待${ownerLabel("outflow")}执行出款`,
    COMPLETED: "订单已完成闭环",
    CANCELLED: "订单已终止，重新交易需创建新订单",
  };
  return map[o.status] ?? "";
});

const stageCurrent = computed(() => (order.value ? orderStageCurrent(order.value.status, order.value.kyc) : 1));

interface FundingInfo {
  kind: FundingKind;
  kindLabel: string;
  ownerRole: string;
  ownerLabel: string;
  state: string;
  mark: TradeOrderVO["inflow_mark"];
}

function fundingState(side: FundingSide): FundingInfo {
  const o = order.value!;
  const kind = kindOf(side);
  const ownerRole = fundingOwnerRole(o, side);
  const mark = side === "inflow" ? o.inflow_mark : o.outflow_mark;
  let state = "待发起";
  if (side === "inflow") {
    if (o.status === TradeOrderStatus.PENDING_KYC) state = "待发起";
    else if (o.status === TradeOrderStatus.AWAITING_INFLOW) state = "待到账确认";
    else if (o.status === TradeOrderStatus.CANCELLED) state = mark ? "已到账" : "待发起";
    else state = "已到账";
    if (o.exception?.reason === "金额不符" && o.status === TradeOrderStatus.AWAITING_INFLOW) state = "异常";
  } else {
    if (o.status === TradeOrderStatus.AWAITING_DISPATCH) state = "待排单";
    else if (o.status === TradeOrderStatus.DISPATCH_REVIEW) state = "待审核";
    else if (o.status === TradeOrderStatus.AWAITING_PAYOUT) state = "待执行";
    else if (o.status === TradeOrderStatus.COMPLETED) state = mark ? "已归档" : "待发起";
    if (o.dispatch_rejected && o.status === TradeOrderStatus.AWAITING_DISPATCH) state = "异常";
  }
  return {
    kind,
    kindLabel: FundingKindLabel[kind],
    ownerRole,
    ownerLabel: FundingOwnerLabel[ownerRole] ?? ownerRole,
    state,
    mark,
  };
}

const STATE_TONE: Record<string, "primary" | "success" | "warning" | "info" | "danger"> = {
  待发起: "info",
  待到账确认: "warning",
  待排单: "primary",
  待审核: "info",
  待执行: "warning",
  已到账: "success",
  已归档: "success",
  异常: "danger",
};

/** 资金卡字段（按形态与登记内容展示） */
function markFields(info: FundingInfo, side: FundingSide): Array<[string, string]> {
  const o = order.value!;
  const mark = info.mark;
  const amountLabel = side === "inflow" ? fmtMoney(o.sell_currency, o.sell_amount) : fmtMoney(o.buy_currency, o.buy_amount);
  const rows: Array<[string, string]> = [[side === "inflow" ? "应收金额" : "应付金额", amountLabel]];
  if (info.kind === FundingKind.CHAIN) {
    if (side === "inflow") rows.push(["公司收 U 地址", o.wallet_ops?.deposit_address || "待钱包运营提供"]);
    else rows.push(["客户收 U 地址", o.wallet_ops?.payout_address || "待登记"], ["地址 KYA", o.wallet_ops?.kya_passed ? `通过（${o.wallet_ops.kya_by} · ${o.wallet_ops.kya_at ? formatDateTime(o.wallet_ops.kya_at) : ""}）` : "未通过"]);
    if (mark?.hash) rows.push(["交易哈希", `${mark.hash.slice(0, 18)}…（${mark.chain || "TRC20"} · ${mark.confirms || "-"} 次确认）`]);
  }
  if (info.kind === FundingKind.BANK && mark?.account) rows.push(["账户", mark.account]);
  if (info.kind === FundingKind.CASH && mark?.place) rows.push(["交收地点", mark.place + (mark.handler ? ` · ${mark.handler}` : "")]);
  if (mark?.voucher) rows.push(["凭证", mark.voucher]);
  if (mark?.note) rows.push(["说明", mark.note]);
  return rows;
}

/* ---------------- 动作 ---------------- */

interface ActionButton {
  label: string;
  primary?: boolean;
  run: () => void;
}
interface ActionBlock {
  tone: "danger" | "warning" | "info" | "mint";
  text: string;
  buttons: ActionButton[];
}

const isTrader = computed(() => ["AGENT", "OPS"].includes(role.value));

const actionBlocks = computed<ActionBlock[]>(() => {
  const o = order.value;
  if (!o) return [];
  const blocks: ActionBlock[] = [];
  const inflowInfo = fundingState("inflow");
  const outflowInfo = fundingState("outflow");

  if (role.value === "OPS" && o.exception) {
    blocks.push({
      tone: "danger",
      text: `附加异常：${o.exception.reason}。解除或取消后主线继续推进。`,
      buttons: [
        { label: "解除异常", run: () => resolveExc("restore") },
        { label: "取消订单", run: () => resolveExc("cancel") },
        ...(o.exception.escalated ? [] : [{ label: "升级合规", run: () => resolveExc("escalate") }]),
      ],
    });
  }
  if (isTrader.value) {
    if (o.status === TradeOrderStatus.PENDING_KYC) {
      blocks.push({
        tone: "warning",
        text: `等待本单业务准入通过（当前「${o.kyc.label}」）。上传材料并提交合规审核，通过后订单自动进入待客户入款。`,
        buttons: [
          { label: "前往材料上传", primary: true, run: () => router.push("/access/materials") },
          { label: "同步 KYC 结果", run: doKycSync },
          { label: "取消订单", run: () => doCancel(false) },
        ],
      });
    }
    if (o.status === TradeOrderStatus.AWAITING_INFLOW) {
      blocks.push({
        tone: "info",
        text: `等待客户${inflowInfo.kind === FundingKind.CHAIN ? "转入 USDT" : inflowInfo.kind === FundingKind.CASH ? "交付现金" : "银行转账"} ${fmtMoney(o.sell_currency, o.sell_amount)}；到账后由${inflowInfo.ownerLabel}登记入款并直接推进。`,
        buttons: [{ label: "取消订单", run: () => doCancel(false) }],
      });
    }
    if (o.status === TradeOrderStatus.AWAITING_DISPATCH) {
      blocks.push({
        tone: "mint",
        text: "入款已确认、资金已冻结，可发起出款排单。",
        buttons: [
          { label: "发起出款排单", primary: true, run: () => emit("dispatch", o) },
          { label: "取消订单", run: () => doCancel(false) },
        ],
      });
    }
  }
  if (o.status === TradeOrderStatus.AWAITING_INFLOW && role.value === inflowInfo.ownerRole) {
    blocks.push({
      tone: "warning",
      text: `客户入款待你登记（${inflowInfo.kindLabel}），登记即确认，订单进入待出款排单。`,
      buttons: [
        {
          label: inflowInfo.kind === FundingKind.CHAIN ? "标记链上入款到账" : inflowInfo.kind === FundingKind.CASH ? "确认现金交收" : "登记法币入账",
          primary: true,
          run: () => emit("funding", o, "inflow"),
        },
        { label: "入款异常", run: doInflowException },
      ],
    });
  }
  if (o.status === TradeOrderStatus.AWAITING_PAYOUT && role.value === outflowInfo.ownerRole) {
    blocks.push({
      tone: "mint",
      text:
        outflowInfo.kind === FundingKind.CHAIN
          ? `排单审核已通过，可向客户地址转出 ${fmtMoney(o.buy_currency, o.buy_amount)}，并登记交易哈希。`
          : `排单审核已通过，可执行${outflowInfo.kind === FundingKind.CASH ? "现金交付" : "银行出款"}并归档凭证，登记后订单完成。`,
      buttons: [
        {
          label: outflowInfo.kind === FundingKind.CHAIN ? "登记链上转账" : outflowInfo.kind === FundingKind.CASH ? "登记现金交付" : "出款登记",
          primary: true,
          run: () => emit("funding", o, "outflow"),
        },
        { label: "执行异常退回", run: doOutflowReturn },
        ...(dispatch.value ? [{ label: "查看排单文案", run: () => (tab.value = "payout") }] : []),
      ],
    });
  }
  if (role.value === "WALLET" && outflowInfo.kind === FundingKind.CHAIN && !o.wallet_ops?.kya_passed && ([TradeOrderStatus.AWAITING_INFLOW, TradeOrderStatus.AWAITING_DISPATCH, TradeOrderStatus.AWAITING_PAYOUT] as TradeOrderStatus[]).includes(o.status)) {
    blocks.push({
      tone: "warning",
      text: "客户收 U 地址尚未通过 KYA，链上出款前必须完成登记。",
      buttons: [{ label: "登记客户地址并 KYA", primary: true, run: doKya }],
    });
  }
  if (role.value === "WALLET" && inflowInfo.kind === FundingKind.CHAIN && !o.wallet_ops?.deposit_address && o.status === TradeOrderStatus.AWAITING_INFLOW) {
    blocks.push({
      tone: "info",
      text: "客户等待公司收 U 地址，提供后可通知客户转入。",
      buttons: [{ label: "提供公司收 U 地址", primary: true, run: doDepositAddress }],
    });
  }
  if (role.value === "OPS" && o.status === TradeOrderStatus.AWAITING_PAYOUT) {
    blocks.push({
      tone: "info",
      text: "执行前如出现风险事件，可终止本单并作废排单。",
      buttons: [{ label: "风险终止", run: () => doCancel(true) }],
    });
  }
  if (["OPS", "FINANCE", "WALLET"].includes(role.value) && !o.exception && !([TradeOrderStatus.COMPLETED, TradeOrderStatus.CANCELLED] as TradeOrderStatus[]).includes(o.status) && role.value !== inflowInfo.ownerRole) {
    // 非资金责任人的运营侧也可标记异常（demo 高级交易员标记金额不符）
  }
  if (!blocks.length) blocks.push({ tone: "info", text: statusHint.value, buttons: [] });
  return blocks;
});

async function doCancel(riskStop: boolean) {
  const o = order.value!;
  try {
    const { value } = await ElMessageBox.prompt(
      `${o.customer_name} · ${fmtMoney(o.sell_currency, o.sell_amount)} → ${fmtMoney(o.buy_currency, o.buy_amount)}。${o.freeze?.state === "FROZEN" ? "已冻结资金将释放；" : ""}${riskStop ? "终止" : "取消"}后重新交易需创建新订单。`,
      riskStop ? `风险终止订单 ${o.order_no}？` : `取消订单 ${o.order_no}？`,
      { inputPlaceholder: riskStop ? "终止原因" : "取消原因", confirmButtonText: riskStop ? "确认终止" : "确认取消", cancelButtonText: "返回" },
    );
    const updated = riskStop ? await riskStopOrder(o.id, value?.trim() || undefined) : await cancelOrder(o.id, value?.trim() || undefined);
    ElMessage.success(riskStop ? "订单已风险终止" : "订单已取消");
    applyUpdate(updated);
  } catch { /* 取消 */ }
}

async function doKycSync() {
  try {
    const updated = await syncOrderKyc(order.value!.id);
    ElMessage.success(`KYC 已通过，${updated.order_no} 进入待客户入款`);
    applyUpdate(updated);
  } catch { /* 拦截器提示 */ }
}

async function doDepositAddress() {
  const o = order.value!;
  try {
    const { value } = await ElMessageBox.prompt(
      `${o.customer_name} · 应收 ${fmtMoney(o.sell_currency, o.sell_amount)}。地址将同步给交易员转交客户。`,
      `提供公司收 U 地址 · ${o.order_no}`,
      { inputPlaceholder: "收 U 地址（TRC20）", confirmButtonText: "确认提供", cancelButtonText: "取消" },
    );
    if (!value?.trim()) return;
    applyUpdate(await walletDepositAddress(o.id, value.trim()));
    ElMessage.success("收 U 地址已提供");
  } catch { /* 取消 */ }
}

async function doKya() {
  const o = order.value!;
  try {
    const { value } = await ElMessageBox.prompt(
      `${o.customer_name} · 应付 ${fmtMoney(o.buy_currency, o.buy_amount)}。KYA 通过后才能执行链上出款。`,
      `登记客户收 U 地址并做 KYA · ${o.order_no}`,
      { inputValue: o.wallet_ops?.payout_address || "", inputPlaceholder: "客户收 U 地址", confirmButtonText: "KYA 通过", cancelButtonText: "取消" },
    );
    if (!value?.trim()) return;
    applyUpdate(await walletKya(o.id, value.trim()));
    ElMessage.success("地址 KYA 已通过");
  } catch { /* 取消 */ }
}

async function doOutflowReturn() {
  const o = order.value!;
  try {
    const { value } = await ElMessageBox.prompt(
      "执行前发现账户错误、地址 KYA 失败或通道不可用时，订单退回待出款排单重新准备。",
      `执行异常退回 ${o.order_no}？`,
      { inputPlaceholder: "异常原因", confirmButtonText: "确认退回", cancelButtonText: "返回" },
    );
    applyUpdate(await outflowReturn(o.id, value?.trim() || undefined));
    ElMessage.success("已退回待出款排单");
  } catch { /* 取消 */ }
}

async function doInflowException() {
  const o = order.value!;
  try {
    const { value } = await ElMessageBox.prompt(
      `${o.customer_name} · 应收 ${fmtMoney(o.sell_currency, o.sell_amount)}。订单将转入异常处理。`,
      `标记入款异常 · ${o.order_no}`,
      { inputPlaceholder: "异常说明（如：实际到账金额与应收不符）", confirmButtonText: "确认标记", cancelButtonText: "取消" },
    );
    applyUpdate(await markException(o.id, { kind: "业务异常", reason: "金额不符", detail: value?.trim() || "入款金额与应收不符" }));
    ElMessage.success("已标记入款异常");
  } catch { /* 取消 */ }
}

async function resolveExc(action: "restore" | "cancel" | "escalate") {
  const o = order.value!;
  try {
    let note: string | undefined;
    if (action !== "escalate") {
      const { value } = await ElMessageBox.prompt(
        action === "restore" ? `异常解除后订单继续按主线状态推进。` : "订单将标记已取消，已冻结资金将释放。",
        action === "restore" ? `解除订单 ${o.order_no} 的异常？` : `取消订单 ${o.order_no}？`,
        { inputPlaceholder: action === "restore" ? "处理说明" : "取消原因", confirmButtonText: action === "restore" ? "确认解除" : "确认取消", cancelButtonText: "返回" },
      );
      note = value?.trim() || undefined;
    }
    applyUpdate(await resolveException(o.id, action, note));
    ElMessage.success(action === "restore" ? "异常已解除" : action === "cancel" ? "订单已取消" : "已升级合规");
  } catch { /* 取消 */ }
}

async function doDispatchApprove() {
  const o = order.value!;
  try {
    await ElMessageBox.confirm(`${dispatch.value?.dispatch_no} · ${fmtMoney(o.buy_currency, o.buy_amount)}。通过后转入待出款执行。`, "排单审核通过？", { confirmButtonText: "审核通过", cancelButtonText: "取消" });
    applyUpdate(await approveDispatch(o.id));
    ElMessage.success("出款审核通过");
  } catch { /* 取消 */ }
}

async function doDispatchReturn() {
  const o = order.value!;
  try {
    const { value } = await ElMessageBox.prompt(
      `${o.customer_name} · ${fmtMoney(o.buy_currency, o.buy_amount)}。驳回后订单回到待出款排单，交易员重新提交后再次进入审核。`,
      `驳回排单 ${dispatch.value?.dispatch_no}？`,
      { inputPlaceholder: "驳回原因", confirmButtonText: "确认驳回", cancelButtonText: "返回" },
    );
    applyUpdate(await returnDispatch(o.id, value?.trim() || undefined));
    ElMessage.success("排单已驳回");
  } catch { /* 取消 */ }
}
</script>

<template>
  <el-drawer
    :model-value="true"
    :with-header="false"
    size="620px"
    :destroy-on-close="false"
    @close="emit('close')"
  >
    <div v-if="order" v-loading="loading" class="panel">
      <header class="panel-head">
        <div class="topline">
          <span class="eyebrow">TRADE ORDER · {{ order.trade_type }} · {{ order.order_no }}</span>
          <el-button :icon="Close" text @click="emit('close')" />
        </div>
        <div class="title-row">
          <h2>{{ order.customer_name }}（{{ order.customer_code || "无编号" }}）</h2>
          <el-tag :type="STATUS_TAG[order.status]" effect="dark" size="small">
            {{ TradeOrderStatusLabel[order.status] }}
          </el-tag>
          <el-tag v-if="order.exception" type="danger" size="small" effect="light">
            {{ order.exception.kind }} · {{ order.exception.reason }}
          </el-tag>
          <el-tag v-if="order.dispatch_rejected" type="danger" size="small" effect="light">出款审核驳回</el-tag>
        </div>
        <p class="hint">{{ statusHint }}<time>创建 {{ formatDateTime(order.created_at) }}</time></p>

        <div class="trade-hero">
          <div class="hero-row">
            <div class="hero-cell"><span>业务类型</span><strong>{{ order.business_type || "—" }}</strong></div>
            <div class="hero-cell">
              <span>KYC 状态</span>
              <strong :class="`kyc-text-${order.kyc.tone}`">{{ order.kyc.label }}</strong>
            </div>
          </div>
          <div class="hero-legs">
            <div><span>客户卖出</span><strong>{{ fmtMoney(order.sell_currency, order.sell_amount) }}</strong></div>
            <i>→</i>
            <div><span>客户买入</span><strong>{{ fmtMoney(order.buy_currency, order.buy_amount) }}</strong></div>
            <div class="hero-rate">
              <span>执行汇率</span>
              <strong class="mono">{{ order.rate }}</strong>
              <em>{{ order.pay_method }}</em>
            </div>
          </div>
          <div class="hero-remark"><span>备注说明</span><p :class="{ empty: !order.remark }">{{ order.remark || "创建订单时未填写说明" }}</p></div>
        </div>

        <div v-if="order.status === 'CANCELLED'" class="stage-cancelled">
          <el-tag type="danger" size="small">已取消</el-tag>
          <span>订单已取消，未走完主线流程；历史操作见「活动」。</span>
        </div>
        <div v-else class="stage-bar">
          <div
            v-for="(stage, index) in ORDER_STAGES"
            :key="stage"
            class="stage"
            :class="{ done: index < stageCurrent, active: index === stageCurrent }"
          >
            <i>{{ index < stageCurrent ? "✓" : index + 1 }}</i>
            <span>{{ stage }}</span>
          </div>
        </div>
      </header>

      <el-tabs v-model="tab" class="panel-tabs">
        <el-tab-pane label="收款" name="payment" />
        <el-tab-pane label="出款排单" name="payout" />
        <el-tab-pane label="出款" name="execution" />
        <el-tab-pane :label="`活动（${order.timeline.length}）`" name="activity" />
      </el-tabs>

      <div class="panel-body">
        <!-- 收款 -->
        <template v-if="tab === 'payment'">
          <el-alert v-if="!order.kyc.ready && !['COMPLETED', 'CANCELLED'].includes(order.status)" type="warning" :closable="false" class="mb">
            当前客户 KYC 未通过（{{ order.kyc.label }}），可继续跟进交易意向，但不能确认到账。
          </el-alert>
          <el-alert v-if="order.exception" type="error" :closable="false" class="mb">
            附加异常：{{ order.exception.kind }} · {{ order.exception.reason }} — {{ order.exception.detail }}{{ order.exception.escalated ? "（已升级合规）" : "" }}
          </el-alert>
          <section class="funding-card" :class="{ done: ['已到账'].includes(fundingState('inflow').state), error: fundingState('inflow').state === '异常' }">
            <header>
              <div><strong>客户入款</strong><em>{{ fundingState("inflow").kindLabel }}</em></div>
              <el-tag :type="STATE_TONE[fundingState('inflow').state]" size="small">{{ fundingState("inflow").state }}</el-tag>
            </header>
            <p class="owner">责任人：<strong>{{ fundingState("inflow").ownerLabel }}</strong><template v-if="order.inflow_mark"> · 已由 {{ order.inflow_mark.by }} 于 {{ formatDateTime(order.inflow_mark.at) }} 标记</template></p>
            <dl>
              <div v-for="[label, value] in markFields(fundingState('inflow'), 'inflow')" :key="label"><dt>{{ label }}</dt><dd>{{ value }}</dd></div>
            </dl>
          </section>
        </template>

        <!-- 出款排单 -->
        <template v-if="tab === 'payout'">
          <el-alert v-if="order.dispatch_rejected" type="error" :closable="false" class="mb">
            出款审核驳回：{{ order.dispatch_rejected.reason }}（{{ order.dispatch_rejected.by }} · {{ formatDateTime(order.dispatch_rejected.at) }}），请重新发起排单。
          </el-alert>
          <section class="block">
            <h4>出款排单</h4>
            <template v-if="dispatch">
              <div class="dispatch-head">
                <strong class="mono">{{ dispatch.dispatch_no }}</strong>
                <el-tag size="small">{{ dispatch.channel }} 通道</el-tag>
                <small>{{ dispatch.submitted_by }} · {{ formatDateTime(dispatch.submitted_at) }} 提交</small>
              </div>
              <pre class="dispatch-text">{{ dispatch.final_text }}</pre>
            </template>
            <p v-else-if="order.status === 'AWAITING_DISPATCH'" class="empty-inline">
              {{ isTrader ? "入款已确认，可在下方发起出款排单。" : "等待交易员在订单内发起排单。" }}
            </p>
            <p v-else class="empty-inline">收款确认后进入排单环节。</p>
          </section>
          <section class="block">
            <h4>出款审核</h4>
            <template v-if="dispatch && order.status === 'DISPATCH_REVIEW'">
              <div class="review-row">
                <div>
                  <strong>{{ fmtMoney(dispatch.currency, dispatch.amount) }}</strong>
                  <small>{{ dispatch.channel }} 通道 · 收款 {{ dispatch.payee }}</small>
                </div>
                <div v-if="role === 'OPS'" class="review-actions">
                  <el-button size="small" type="primary" @click="doDispatchApprove">审核通过</el-button>
                  <el-button size="small" @click="doDispatchReturn">驳回</el-button>
                </div>
                <small v-else class="muted">等待高级交易员给出 审核通过 / 驳回 结论</small>
              </div>
            </template>
            <p v-else-if="dispatch?.reviewed_at" class="empty-inline">✓ 审核通过 · {{ dispatch.reviewed_by }} · {{ formatDateTime(dispatch.reviewed_at) }}</p>
            <p v-else class="empty-inline">排单提交后进入出款审核。</p>
          </section>
          <section class="block">
            <h4>库存影响</h4>
            <dl v-if="order.freeze">
              <div><dt>冻结账户</dt><dd>{{ order.freeze.account_name }}</dd></div>
              <div><dt>冻结金额</dt><dd>{{ fmtMoney(order.freeze.currency, order.freeze.amount) }}</dd></div>
              <div><dt>冻结状态</dt><dd>{{ { FROZEN: "已冻结", RELEASED: "已释放", CONSUMED: "已消耗" }[order.freeze.state] }}</dd></div>
            </dl>
            <p v-else class="empty-inline">收款确认后自动冻结应付资金。</p>
          </section>
        </template>

        <!-- 出款 -->
        <template v-if="tab === 'execution'">
          <section class="funding-card" :class="{ done: fundingState('outflow').state === '已归档', error: fundingState('outflow').state === '异常' }">
            <header>
              <div><strong>平台出款</strong><em>{{ fundingState("outflow").kindLabel }}</em></div>
              <el-tag :type="STATE_TONE[fundingState('outflow').state]" size="small">{{ fundingState("outflow").state }}</el-tag>
            </header>
            <p class="owner">责任人：<strong>{{ fundingState("outflow").ownerLabel }}</strong><template v-if="order.outflow_mark"> · 已由 {{ order.outflow_mark.by }} 于 {{ formatDateTime(order.outflow_mark.at) }} 执行</template></p>
            <dl>
              <div v-for="[label, value] in markFields(fundingState('outflow'), 'outflow')" :key="label"><dt>{{ label }}</dt><dd>{{ value }}</dd></div>
            </dl>
          </section>
          <section class="block">
            <h4>出款执行</h4>
            <p v-if="dispatch?.receipt" class="empty-inline">
              回单 {{ dispatch.receipt.file_name }}{{ dispatch.receipt.reference ? ` · ${dispatch.receipt.reference}` : "" }} · {{ dispatch.paid_by }} · {{ dispatch.paid_at ? formatDateTime(dispatch.paid_at) : "" }}
            </p>
            <p v-else-if="order.status === 'AWAITING_PAYOUT'" class="empty-inline">等待{{ fundingState("outflow").ownerLabel }}执行出款。</p>
            <p v-else class="empty-inline">出款审核通过后由责任人执行。</p>
          </section>
          <section v-if="order.profit" class="block">
            <h4>佣金与收益</h4>
            <div class="profit">
              <div><span>汇差收益</span><b>{{ fmtMoney(order.profit.currency, order.profit.spread) }}</b></div>
              <div><span>手续费</span><b>{{ fmtMoney(order.profit.currency, order.profit.fee) }}</b></div>
              <div class="cost"><span>渠道成本</span><b>− {{ fmtMoney(order.profit.currency, order.profit.channel_cost) }}</b></div>
              <div class="cost"><span>交易员佣金</span><b>− {{ fmtMoney(order.profit.currency, order.profit.commission) }}</b></div>
              <div class="net"><span>净收益</span><strong>{{ fmtMoney(order.profit.currency, order.profit.net) }}</strong></div>
            </div>
          </section>
        </template>

        <!-- 活动 -->
        <el-timeline v-if="tab === 'activity'" class="activity">
          <el-timeline-item v-for="(entry, index) in order.timeline" :key="index" :timestamp="`${formatDateTime(entry.at)} · ${entry.actor}`">
            <strong>{{ entry.title }}</strong>
            <p class="activity-detail">{{ entry.detail }}</p>
          </el-timeline-item>
        </el-timeline>
      </div>

      <footer class="panel-actions">
        <div v-for="(block, index) in actionBlocks" :key="index" class="action-block" :class="block.tone">
          <p>{{ block.text }}</p>
          <div v-if="block.buttons.length" class="action-buttons">
            <el-button
              v-for="button in block.buttons"
              :key="button.label"
              size="small"
              :type="button.primary ? 'primary' : 'default'"
              @click="button.run()"
            >
              {{ button.label }}
            </el-button>
          </div>
        </div>
      </footer>
    </div>
  </el-drawer>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.panel-head {
  padding-bottom: 4px;
}

.topline {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.eyebrow {
  color: #ff7a00;
  font-size: 11px;
  letter-spacing: 0.1em;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.title-row h2 {
  margin: 0;
  font-size: 18px;
}

.hint {
  color: #909399;
  font-size: 12px;
  margin: 6px 0 12px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.trade-hero {
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 12px 14px;
  background: #fafbfc;
}

.hero-row {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 10px;
}

.hero-cell span {
  display: block;
  color: #909399;
  font-size: 11px;
}

.hero-cell em {
  color: #909399;
  font-style: normal;
  font-size: 11px;
  margin-left: 6px;
}

/* KYC 状态为纯文字展示，按语气着色 */
.kyc-text-success {
  color: #67c23a;
}

.kyc-text-warning {
  color: #e6a23c;
}

.kyc-text-danger {
  color: #f56c6c;
}

.hero-legs {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed #e4e7ed;
}

.hero-legs span {
  display: block;
  color: #909399;
  font-size: 11px;
}

.hero-legs strong {
  font-size: 15px;
}

.hero-legs i {
  color: #ff7a00;
  font-style: normal;
}

/* 执行汇率与货币对同行展示，靠右对齐 */
.hero-rate {
  margin-left: auto;
  text-align: right;
}

.hero-rate span {
  display: block;
  color: #909399;
  font-size: 11px;
}

.hero-rate strong {
  font-size: 15px;
}

.hero-rate em {
  color: #909399;
  font-style: normal;
  font-size: 11px;
  margin-left: 6px;
}

.hero-remark {
  margin-top: 10px;
  font-size: 12px;
}

.hero-remark span {
  color: #909399;
  margin-right: 8px;
}

.hero-remark p {
  display: inline;
  margin: 0;
}

.hero-remark p.empty {
  color: #c0c4cc;
}

.stage-cancelled {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 12px 0 4px;
  color: #909399;
  font-size: 12px;
}

.stage-bar {
  display: flex;
  justify-content: space-between;
  margin: 14px 0 4px;
}

.stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  flex: 1;
  position: relative;
}

/* 节点间连接线：从上一个圆心连到当前圆心，构成完整流程条 */
.stage + .stage::before {
  content: "";
  position: absolute;
  top: 9px;
  right: calc(50% + 14px);
  width: calc(100% - 28px);
  height: 2px;
  border-radius: 1px;
  background: #e4e7ed;
}

/* 已完成/进行中节点的入线着色，体现推进进度 */
.stage + .stage.done::before,
.stage + .stage.active::before {
  background: #a8dcb5;
}

.stage i {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #f0f2f5;
  color: #909399;
  font-size: 11px;
  font-style: normal;
  display: grid;
  place-items: center;
  position: relative;
  z-index: 1;
}

.stage.done i {
  background: #e7f6ec;
  color: #67c23a;
}

.stage.active i {
  background: #ff7a00;
  color: #fff;
}

.stage span {
  font-size: 10px;
  color: #909399;
  white-space: nowrap;
}

.stage.active span {
  color: #303133;
  font-weight: 600;
}

.panel-tabs {
  margin-top: 4px;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 8px;
}

.mb {
  margin-bottom: 10px;
}

.funding-card {
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 12px;
}

.funding-card.done {
  border-color: #d1edda;
  background: #f6fef9;
}

.funding-card.error {
  border-color: #fde2e2;
  background: #fef6f6;
}

.funding-card header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.funding-card header em {
  font-style: normal;
  color: #909399;
  font-size: 12px;
  margin-left: 8px;
}

.owner {
  color: #909399;
  font-size: 12px;
  margin: 6px 0 8px;
}

dl {
  margin: 0;
  display: grid;
  gap: 4px;
}

dl div {
  display: flex;
  gap: 10px;
  font-size: 13px;
}

dt {
  color: #909399;
  min-width: 90px;
}

dd {
  margin: 0;
  word-break: break-all;
}

.block {
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 12px;
}

.block h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #606266;
}

.dispatch-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.dispatch-head small {
  color: #909399;
}

.dispatch-text {
  background: #1f2430;
  color: #d7dce6;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  margin: 0;
  max-height: 220px;
  overflow: auto;
}

.review-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.review-row small {
  display: block;
  color: #909399;
}

.empty-inline {
  color: #909399;
  font-size: 13px;
  margin: 0;
}

.muted {
  color: #909399;
}

.mono {
  font-family: ui-monospace, monospace;
}

.profit div {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 3px 0;
}

.profit .cost b {
  color: #f56c6c;
}

.profit .net {
  border-top: 1px dashed #e4e7ed;
  margin-top: 6px;
  padding-top: 8px;
}

.activity {
  padding: 6px 4px 0 4px;
}

.activity-detail {
  color: #606266;
  font-size: 12px;
  margin: 2px 0 0;
}

.panel-actions {
  border-top: 1px solid #ebeef5;
  padding-top: 10px;
}

.action-block {
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 8px;
  font-size: 13px;
}

.action-block p {
  margin: 0 0 8px;
}

.action-block.info {
  background: #f4f6f8;
}

.action-block.warning {
  background: #fdf6ec;
}

.action-block.danger {
  background: #fef0f0;
}

.action-block.mint {
  background: #f0f9eb;
}

.action-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
