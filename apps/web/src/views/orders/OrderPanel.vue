<script setup lang="ts">
import {
  DispatchStatus,
  FundingKind,
  FundingKindLabel,
  FundingOwnerLabel,
  fundingKindOf,
  fundingOwnerRole,
  isOrderEditable,
  ORDER_STAGES,
  orderStageCurrent,
  TradeOrderStatus,
  TradeOrderStatusLabel,
  type FileRef,
  type FundingSide,
  type PayoutOrderVO,
  type TradeOrderVO,
} from "@bv/shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { Close, CopyDocument, Download, EditPen, FullScreen, View } from "@element-plus/icons-vue";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
import { useRouter } from "vue-router";
import { openFilePreview } from "@/api/access";
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
} from "@/api/order";
import { useAuthStore } from "@/stores/auth";
import { formatDateTime } from "@/utils/format";

const props = defineProps<{ orderId: string }>();
const emit = defineEmits<{
  close: [];
  changed: [order: TradeOrderVO];
  funding: [order: TradeOrderVO, side: FundingSide];
  dispatch: [order: TradeOrderVO];
  edit: [order: TradeOrderVO];
}>();

const { t } = useI18n();
const router = useRouter();
const auth = useAuthStore();
const role = computed(() => auth.roleCode);

const order = ref<TradeOrderVO | null>(null);
const dispatch = ref<PayoutOrderVO | null>(null);
const loading = ref(false);
const tab = ref<"payment" | "payout" | "execution" | "activity">("payment");
const dispatchTextVisible = ref(false);

type FieldValue = string | FileRef;

function voucherLabel(voucher: FileRef | string | null | undefined): string {
  if (!voucher) return "";
  return typeof voucher === "string" ? voucher : voucher.original_name;
}

function isFileRef(value: unknown): value is FileRef {
  return !!value && typeof value === "object" && "storage_key" in value && "original_name" in value;
}

async function openVoucherFile(file: FileRef, download = false): Promise<void> {
  try {
    await openFilePreview(file, download);
  } catch {
    /* 具体错误信息由 http 拦截器提示 */
  }
}

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
  return localizeText(FundingOwnerLabel[fundingOwnerRole(order.value, side)] ?? "");
}

function kindOf(side: FundingSide): FundingKind {
  return order.value ? fundingKindOf(order.value, side) : FundingKind.BANK;
}

const statusHint = computed(() => {
  const o = order.value;
  if (!o) return "";
  const map: Record<string, string> = {
    PENDING_KYC: t("orders.panel.hint.pendingKyc"),
    AWAITING_INFLOW: t("orders.panel.hint.awaitingInflow", {
      method: kindOf("inflow") === FundingKind.CHAIN ? t("orders.panel.hint.inflowMethodChain") : o.pay_method === "现金" ? t("orders.panel.hint.inflowMethodCash") : t("orders.panel.hint.inflowMethodTt"),
      owner: ownerLabel("inflow"),
    }),
    AWAITING_DISPATCH: t("orders.panel.hint.awaitingDispatch"),
    DISPATCH_REVIEW: t("orders.panel.hint.dispatchReview"),
    AWAITING_PAYOUT: t("orders.panel.hint.awaitingPayout", { owner: ownerLabel("outflow") }),
    COMPLETED: t("orders.panel.hint.completed"),
    CANCELLED: t("orders.panel.hint.cancelled"),
  };
  return map[o.status] ?? "";
});

const stageCurrent = computed(() => (order.value ? orderStageCurrent(order.value.status, order.value.kyc) : 1));

/** 资金卡状态码：模板据此比较/取色，展示文案走 orders.panel.state.* */
type FundingStateCode =
  | "idle"
  | "awaitConfirm"
  | "awaitDispatch"
  | "awaitReview"
  | "awaitExecution"
  | "arrived"
  | "archived"
  | "exception";

interface FundingInfo {
  kind: FundingKind;
  kindLabel: string;
  ownerRole: string;
  ownerLabel: string;
  state: FundingStateCode;
  mark: TradeOrderVO["inflow_mark"];
}

function fundingState(side: FundingSide): FundingInfo {
  const o = order.value!;
  const kind = kindOf(side);
  const ownerRole = fundingOwnerRole(o, side);
  const mark = side === "inflow" ? o.inflow_mark : o.outflow_mark;
  let state: FundingStateCode = "idle";
  if (side === "inflow") {
    if (o.status === TradeOrderStatus.PENDING_KYC) state = "idle";
    else if (o.status === TradeOrderStatus.AWAITING_INFLOW) state = "awaitConfirm";
    else if (o.status === TradeOrderStatus.CANCELLED) state = mark ? "arrived" : "idle";
    else state = "arrived";
    if (o.exception?.reason === "金额不符" && o.status === TradeOrderStatus.AWAITING_INFLOW) state = "exception";
  } else {
    if (o.status === TradeOrderStatus.AWAITING_DISPATCH) state = "awaitDispatch";
    else if (o.status === TradeOrderStatus.DISPATCH_REVIEW) state = "awaitReview";
    else if (o.status === TradeOrderStatus.AWAITING_PAYOUT) state = "awaitExecution";
    else if (o.status === TradeOrderStatus.COMPLETED) state = mark ? "archived" : "idle";
    if (o.dispatch_rejected && o.status === TradeOrderStatus.AWAITING_DISPATCH) state = "exception";
  }
  return {
    kind,
    kindLabel: localizeText(FundingKindLabel[kind]),
    ownerRole,
    ownerLabel: localizeText(FundingOwnerLabel[ownerRole] ?? ownerRole),
    state,
    mark,
  };
}

const STATE_TONE: Record<FundingStateCode, "primary" | "success" | "warning" | "info" | "danger"> = {
  idle: "info",
  awaitConfirm: "warning",
  awaitDispatch: "primary",
  awaitReview: "info",
  awaitExecution: "warning",
  arrived: "success",
  archived: "success",
  exception: "danger",
};

/** 资金卡字段（按形态与登记内容展示） */
function markFields(info: FundingInfo, side: FundingSide): Array<[string, FieldValue]> {
  const o = order.value!;
  const mark = info.mark;
  const expected = side === "inflow" ? o.sell_amount : o.buy_amount;
  const currency = side === "inflow" ? o.sell_currency : o.buy_currency;
  const rows: Array<[string, FieldValue]> = [
    [side === "inflow" ? t("orders.panel.fields.expectedRecv") : t("orders.panel.fields.expectedPay"), fmtMoney(currency, expected)],
  ];
  /* 实收/实付上屏：登记后展示实际金额，与应收/应付不符时标注差额（审计 1.1.2） */
  if (mark) {
    const diff = mark.amount - expected;
    rows.push([
      side === "inflow" ? t("orders.panel.fields.actualRecv") : t("orders.panel.fields.actualPay"),
      fmtMoney(mark.currency || currency, mark.amount) +
        (diff !== 0
          ? t("orders.panel.fields.diff", {
              label: side === "inflow" ? t("orders.common.receivable") : t("orders.common.payable"),
              diff: `${diff > 0 ? "+" : ""}${diff.toLocaleString("en-US")}`,
            })
          : ""),
    ]);
    if (mark.method) rows.push([t("orders.common.method"), mark.method]);
    rows.push([t("orders.panel.fields.registrar"), `${mark.by} · ${formatDateTime(mark.at)}`]);
  }
  if (info.kind === FundingKind.CHAIN) {
    if (side === "inflow") rows.push([t("orders.panel.fields.companyDepositAddr"), o.wallet_ops?.deposit_address || t("orders.panel.fields.awaitingWalletOps")]);
    if (mark?.hash) rows.push([t("orders.panel.fields.txHash"), t("orders.panel.fields.hashDetail", { hash: mark.hash.slice(0, 18), chain: mark.chain || "TRC20", confirms: mark.confirms || "-" })]);
  }
  if (info.kind === FundingKind.BANK && mark?.account) rows.push([t("orders.panel.fields.account"), mark.account]);
  if (info.kind === FundingKind.CASH && mark?.place) rows.push([t("orders.common.settlePlace"), mark.place + (mark.handler ? ` · ${mark.handler}` : "")]);
  if (mark?.voucher) rows.push([t("orders.panel.fields.voucher"), mark.voucher]);
  if (mark?.note) rows.push([t("orders.common.note"), mark.note]);
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
    /* 异常未解除前只给异常处理动作，不再叠加正常状态的审核/排单操作 —— 需先解除/取消/升级 */
    blocks.push({
      tone: "danger",
      text: t("orders.panel.actions.exceptionText", { reason: o.exception.reason }),
      buttons: [
        { label: t("orders.panel.actions.resolveException"), run: () => resolveExc("restore") },
        { label: t("orders.common.cancelOrder"), run: () => resolveExc("cancel") },
        ...(o.exception.escalated ? [] : [{ label: t("orders.panel.actions.escalateCompliance"), run: () => resolveExc("escalate") }]),
      ],
    });
    return blocks;
  }
  if (isTrader.value) {
    if (o.status === TradeOrderStatus.PENDING_KYC) {
      blocks.push({
        tone: "warning",
        text: t("orders.panel.actions.pendingKycText", { kyc: localizeText(o.kyc.label) }),
        buttons: [
          {
            label: t("orders.panel.actions.gotoMaterials"),
            primary: true,
            /* 带上客户与准入业务类型，材料上传页回显，免去重新选一遍。
               自定义业务类型没有 scenario_id，改传名称，材料上传页据此不展示材料清单 */
            run: () =>
              router.push({
                path: "/access/materials",
                query: {
                  customer_id: o.customer_id,
                  ...(o.business_scenario_id
                    ? { scenario_id: o.business_scenario_id }
                    : o.business_type
                      ? { custom_business_type: o.business_type }
                      : {}),
                },
              }),
          },
          { label: t("orders.panel.actions.syncKyc"), run: doKycSync },
          { label: t("orders.common.cancelOrder"), run: () => doCancel(false) },
        ],
      });
    }
    if (o.status === TradeOrderStatus.AWAITING_INFLOW) {
      blocks.push({
        tone: "info",
        text: t("orders.panel.actions.awaitingInflowText", {
          method: inflowInfo.kind === FundingKind.CHAIN ? t("orders.panel.actions.methodChain") : inflowInfo.kind === FundingKind.CASH ? t("orders.panel.actions.methodCash") : t("orders.panel.actions.methodBank"),
          amount: fmtMoney(o.sell_currency, o.sell_amount),
          owner: inflowInfo.ownerLabel,
        }),
        buttons: [{ label: t("orders.common.cancelOrder"), run: () => doCancel(false) }],
      });
    }
    if (o.status === TradeOrderStatus.AWAITING_DISPATCH) {
      blocks.push({
        tone: "mint",
        text: t("orders.panel.actions.awaitingDispatchText"),
        buttons: [
          { label: t("orders.common.startDispatch"), primary: true, run: () => emit("dispatch", o) },
          { label: t("orders.common.cancelOrder"), run: () => doCancel(false) },
        ],
      });
    }
  }
  if (o.status === TradeOrderStatus.AWAITING_INFLOW && role.value === inflowInfo.ownerRole) {
    blocks.push({
      tone: "warning",
      text: t("orders.panel.actions.inflowOwnerText", { kind: inflowInfo.kindLabel }),
      buttons: [
        {
          label: inflowInfo.kind === FundingKind.CHAIN ? t("orders.common.markChainInflow") : inflowInfo.kind === FundingKind.CASH ? t("orders.common.confirmCashSettle") : t("orders.common.registerFiatInflow"),
          primary: true,
          run: () => emit("funding", o, "inflow"),
        },
        { label: t("orders.panel.actions.inflowException"), run: doInflowException },
      ],
    });
  }
  if (o.status === TradeOrderStatus.AWAITING_PAYOUT && role.value === outflowInfo.ownerRole) {
    blocks.push({
      tone: "mint",
      text:
        outflowInfo.kind === FundingKind.CHAIN
          ? t("orders.panel.actions.outflowChainText", { amount: fmtMoney(o.buy_currency, o.buy_amount) })
          : t("orders.panel.actions.outflowText", { action: outflowInfo.kind === FundingKind.CASH ? t("orders.panel.actions.outflowActionCash") : t("orders.panel.actions.outflowActionBank") }),
      buttons: [
        {
          label: outflowInfo.kind === FundingKind.CHAIN ? t("orders.common.registerChainTransfer") : outflowInfo.kind === FundingKind.CASH ? t("orders.common.registerCashDelivery") : t("orders.common.payoutRegister"),
          primary: true,
          run: () => emit("funding", o, "outflow"),
        },
        { label: t("orders.panel.actions.outflowReturn"), run: doOutflowReturn },
        ...(dispatch.value ? [{ label: t("orders.panel.actions.viewDispatchText"), run: () => (tab.value = "payout") }] : []),
      ],
    });
  }
  if (role.value === "WALLET" && inflowInfo.kind === FundingKind.CHAIN && !o.wallet_ops?.deposit_address && o.status === TradeOrderStatus.AWAITING_INFLOW) {
    blocks.push({
      tone: "info",
      text: t("orders.panel.actions.depositText"),
      buttons: [{ label: t("orders.panel.actions.depositButton"), primary: true, run: doDepositAddress }],
    });
  }
  if (role.value === "OPS" && o.status === TradeOrderStatus.AWAITING_PAYOUT) {
    blocks.push({
      tone: "info",
      text: t("orders.panel.actions.riskText"),
      buttons: [{ label: t("orders.panel.actions.riskStop"), run: () => doCancel(true) }],
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
      t("orders.panel.dialogs.cancelBody", {
        customer: o.customer_name,
        sell: fmtMoney(o.sell_currency, o.sell_amount),
        buy: fmtMoney(o.buy_currency, o.buy_amount),
        extra: `${o.freeze?.state === "FROZEN" ? t("orders.panel.dialogs.frozenReleaseNote") : ""}${riskStop ? t("orders.panel.dialogs.stopTail") : t("orders.panel.dialogs.cancelTail")}`,
      }),
      riskStop ? t("orders.panel.dialogs.riskStopTitle", { orderNo: o.order_no }) : t("orders.panel.dialogs.cancelTitle", { orderNo: o.order_no }),
      { inputPlaceholder: riskStop ? t("orders.panel.dialogs.stopReason") : t("orders.panel.dialogs.cancelReason"), confirmButtonText: riskStop ? t("orders.panel.dialogs.confirmStop") : t("orders.panel.dialogs.confirmCancel"), cancelButtonText: t("orders.common.back") },
    );
    const updated = riskStop ? await riskStopOrder(o.id, value?.trim() || undefined) : await cancelOrder(o.id, value?.trim() || undefined);
    ElMessage.success(riskStop ? t("orders.panel.dialogs.stopped") : t("orders.panel.dialogs.orderCancelled"));
    applyUpdate(updated);
  } catch { /* 取消 */ }
}

async function doKycSync() {
  try {
    const updated = await syncOrderKyc(order.value!.id);
    ElMessage.success(t("orders.panel.dialogs.kycSynced", { orderNo: updated.order_no }));
    applyUpdate(updated);
  } catch { /* 拦截器提示 */ }
}

async function doDepositAddress() {
  const o = order.value!;
  try {
    const { value } = await ElMessageBox.prompt(
      t("orders.panel.dialogs.depositPromptBody", { customer: o.customer_name, amount: fmtMoney(o.sell_currency, o.sell_amount) }),
      t("orders.panel.dialogs.depositPromptTitle", { orderNo: o.order_no }),
      { inputPlaceholder: t("orders.panel.dialogs.depositPlaceholder"), confirmButtonText: t("orders.panel.dialogs.confirmProvide"), cancelButtonText: t("orders.common.cancel") },
    );
    if (!value?.trim()) return;
    applyUpdate(await walletDepositAddress(o.id, value.trim()));
    ElMessage.success(t("orders.panel.dialogs.depositDone"));
  } catch { /* 取消 */ }
}

async function doOutflowReturn() {
  const o = order.value!;
  try {
    const { value } = await ElMessageBox.prompt(
      t("orders.panel.dialogs.outflowReturnBody"),
      t("orders.panel.dialogs.outflowReturnTitle", { orderNo: o.order_no }),
      { inputPlaceholder: t("orders.panel.dialogs.exceptionReason"), confirmButtonText: t("orders.panel.dialogs.confirmReturn"), cancelButtonText: t("orders.common.back") },
    );
    applyUpdate(await outflowReturn(o.id, value?.trim() || undefined));
    ElMessage.success(t("orders.panel.dialogs.returned"));
  } catch { /* 取消 */ }
}

async function doInflowException() {
  const o = order.value!;
  try {
    const { value } = await ElMessageBox.prompt(
      t("orders.panel.dialogs.inflowExcBody", { customer: o.customer_name, amount: fmtMoney(o.sell_currency, o.sell_amount) }),
      t("orders.panel.dialogs.inflowExcTitle", { orderNo: o.order_no }),
      { inputPlaceholder: t("orders.panel.dialogs.inflowExcPlaceholder"), confirmButtonText: t("orders.panel.dialogs.confirmMark"), cancelButtonText: t("orders.common.cancel") },
    );
    applyUpdate(await markException(o.id, { kind: "业务异常", reason: "金额不符", detail: value?.trim() || "入款金额与应收不符" }));
    ElMessage.success(t("orders.panel.dialogs.inflowExcMarked"));
  } catch { /* 取消 */ }
}

async function resolveExc(action: "restore" | "cancel" | "escalate") {
  const o = order.value!;
  try {
    let note: string | undefined;
    if (action !== "escalate") {
      const { value } = await ElMessageBox.prompt(
        action === "restore" ? t("orders.panel.dialogs.resolveRestoreBody") : t("orders.panel.dialogs.resolveCancelBody"),
        action === "restore" ? t("orders.panel.dialogs.resolveRestoreTitle", { orderNo: o.order_no }) : t("orders.panel.dialogs.cancelTitle", { orderNo: o.order_no }),
        { inputPlaceholder: action === "restore" ? t("orders.panel.dialogs.resolveNotePlaceholder") : t("orders.panel.dialogs.cancelReason"), confirmButtonText: action === "restore" ? t("orders.panel.dialogs.confirmResolve") : t("orders.panel.dialogs.confirmCancel"), cancelButtonText: t("orders.common.back") },
      );
      note = value?.trim() || undefined;
    }
    applyUpdate(await resolveException(o.id, action, note));
    ElMessage.success(action === "restore" ? t("orders.panel.dialogs.resolved") : action === "cancel" ? t("orders.panel.dialogs.orderCancelled") : t("orders.panel.dialogs.escalated"));
  } catch { /* 取消 */ }
}

async function doDispatchApprove() {
  const o = order.value!;
  try {
    await ElMessageBox.confirm(t("orders.panel.dialogs.approveBody", { dispatchNo: dispatch.value?.dispatch_no, amount: fmtMoney(o.buy_currency, o.buy_amount) }), t("orders.panel.dialogs.approveTitle"), { confirmButtonText: t("orders.common.approve"), cancelButtonText: t("orders.common.cancel") });
    applyUpdate(await approveDispatch(o.id));
    ElMessage.success(t("orders.panel.dialogs.approved"));
  } catch { /* 取消 */ }
}

async function doDispatchReturn() {
  const o = order.value!;
  try {
    const { value } = await ElMessageBox.prompt(
      t("orders.panel.dialogs.returnDispatchBody", { customer: o.customer_name, amount: fmtMoney(o.buy_currency, o.buy_amount) }),
      t("orders.panel.dialogs.returnDispatchTitle", { dispatchNo: dispatch.value?.dispatch_no }),
      { inputPlaceholder: t("orders.panel.dialogs.rejectReason"), confirmButtonText: t("orders.panel.dialogs.confirmReject"), cancelButtonText: t("orders.common.back") },
    );
    applyUpdate(await returnDispatch(o.id, value?.trim() || undefined));
    ElMessage.success(t("orders.panel.dialogs.dispatchReturned"));
  } catch { /* 取消 */ }
}

async function copyPanelDispatchText() {
  const text = dispatch.value?.final_text?.trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement("textarea");
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }
  ElMessage.success(t("orders.panel.dispatchTextCopied"));
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
          <div class="topline-actions">
            <!-- 排单进入审核前，初级/高级交易员可改单要素 -->
            <el-button
              v-if="isTrader && isOrderEditable(order)"
              :icon="EditPen"
              text
              type="primary"
              size="small"
              @click="emit('edit', order)"
            >
              {{ t("orders.edit.action") }}
            </el-button>
            <el-button :icon="Close" text @click="emit('close')" />
          </div>
        </div>
        <div class="title-row">
          <h2>{{ order.customer_name }}（{{ order.customer_code || t("orders.common.noCode") }}）</h2>
          <el-tag :type="STATUS_TAG[order.status]" effect="dark" size="small">
            {{ localizeText(TradeOrderStatusLabel[order.status]) }}
          </el-tag>
          <el-tag v-if="order.dispatch_rejected" type="danger" size="small" effect="light">{{ t("orders.common.dispatchRejectedFlag") }}</el-tag>
        </div>
        <p class="hint">
          <time>{{ t("orders.common.createdAt", { time: formatDateTime(order.created_at) }) }}{{ order.handler_name ? ` · ${order.handler_name}` : "" }}</time>
        </p>

        <div class="trade-hero">
          <div class="hero-row">
            <div class="hero-cell">
              <span>{{ t("orders.panel.bizType") }}</span>
              <strong :class="{ 'biz-unset': !order.business_type }">
                {{ order.business_type || t("orders.panel.bizUnset") }}
              </strong>
            </div>
            <div class="hero-cell">
              <span>{{ t("orders.common.kycStatus") }}</span>
              <strong :class="`kyc-text-${order.kyc.tone}`">{{ localizeText(order.kyc.label) }}</strong>
            </div>
          </div>
          <div class="hero-legs">
            <div><span>{{ t("orders.common.customerSell") }}</span><strong>{{ fmtMoney(order.sell_currency, order.sell_amount) }}</strong></div>
            <i>→</i>
            <div><span>{{ t("orders.common.customerBuy") }}</span><strong>{{ fmtMoney(order.buy_currency, order.buy_amount) }}</strong></div>
            <div class="hero-rate">
              <span>{{ t("orders.common.execRate") }}</span>
              <strong class="mono">{{ order.rate }}</strong>
              <em>{{ localizeText(order.pay_method) }}</em>
            </div>
          </div>
          <div class="hero-remark"><span>{{ t("orders.common.remark") }}</span><p :class="{ empty: !order.remark }">{{ order.remark || t("orders.panel.remarkEmpty") }}</p></div>
          <!-- 建单时关联的报价快照：让各角色都能看到交易员依据的报价（审计 1.2.7） -->
          <div v-if="order.quote" class="hero-quote">
            <span>{{ t("orders.panel.quoteLinked") }}</span>
            <code class="mono">{{ order.quote.deal_rate }}</code>
            <em>{{ localizeText(order.quote.source) }}</em>
            <em v-if="order.quote.quoted_by">{{ order.quote.quoted_by }}{{ order.quote.quoted_at ? ` · ${formatDateTime(order.quote.quoted_at)}` : "" }}</em>
            <em v-if="Number(order.quote.deal_rate) !== Number(order.rate)" class="quote-mismatch">
              {{ t("orders.panel.quoteMismatch", { rate: order.rate }) }}
            </em>
          </div>
        </div>

        <div v-if="order.status === 'CANCELLED'" class="stage-cancelled">
          <el-tag type="danger" size="small">{{ t("orders.panel.cancelledTag") }}</el-tag>
          <span>{{ t("orders.panel.cancelledNote") }}</span>
        </div>
        <div v-else class="stage-bar">
          <div
            v-for="(stage, index) in ORDER_STAGES"
            :key="stage"
            class="stage"
            :class="{ done: index < stageCurrent, active: index === stageCurrent }"
          >
            <i>{{ index < stageCurrent ? "✓" : index + 1 }}</i>
            <span>{{ localizeText(stage) }}</span>
          </div>
        </div>
      </header>

      <el-tabs v-model="tab" class="panel-tabs">
        <el-tab-pane :label="t('orders.panel.tabs.payment')" name="payment" />
        <el-tab-pane :label="t('orders.common.dispatch')" name="payout" />
        <el-tab-pane :label="t('orders.panel.tabs.execution')" name="execution" />
        <el-tab-pane :label="t('orders.panel.tabs.activity', { count: order.timeline.length })" name="activity" />
      </el-tabs>

      <div class="panel-body">
        <!-- 收款 -->
        <template v-if="tab === 'payment'">
          <el-alert v-if="!order.kyc.ready && !['COMPLETED', 'CANCELLED'].includes(order.status)" type="warning" :closable="false" class="mb">
            {{ t("orders.panel.kycNotReadyAlert", { kyc: localizeText(order.kyc.label) }) }}
          </el-alert>
          <section class="funding-card" :class="{ done: fundingState('inflow').state === 'arrived', error: fundingState('inflow').state === 'exception' }">
            <header>
              <div><strong>{{ t("orders.panel.customerInflow") }}</strong><em>{{ fundingState("inflow").kindLabel }}</em></div>
              <el-tag :type="STATE_TONE[fundingState('inflow').state]" size="small">{{ t(`orders.panel.state.${fundingState("inflow").state}`) }}</el-tag>
            </header>
            <p class="owner">{{ t("orders.panel.owner") }}<strong>{{ fundingState("inflow").ownerLabel }}</strong><template v-if="order.inflow_mark"> · {{ t("orders.panel.markedBy", { by: order.inflow_mark.by, at: formatDateTime(order.inflow_mark.at) }) }}</template></p>
            <dl>
              <div v-for="[label, value] in markFields(fundingState('inflow'), 'inflow')" :key="label">
                <dt>{{ label }}</dt>
                <dd>
                  <span v-if="!isFileRef(value)">{{ value }}</span>
                  <span v-else class="file-ref">
                    <span class="file-name">{{ value.original_name }}</span>
                    <el-button size="small" link type="primary" :icon="View" @click="openVoucherFile(value)">
                      {{ t("orders.panel.filePreview") }}
                    </el-button>
                    <el-button size="small" link :icon="Download" @click="openVoucherFile(value, true)">
                      {{ t("orders.panel.fileDownload") }}
                    </el-button>
                  </span>
                </dd>
              </div>
            </dl>
          </section>
        </template>

        <!-- 出款排单 -->
        <template v-if="tab === 'payout'">
          <el-alert v-if="order.dispatch_rejected" type="error" :closable="false" class="mb">
            {{ t("orders.panel.rejectedAlert", { reason: order.dispatch_rejected.reason, by: order.dispatch_rejected.by, at: formatDateTime(order.dispatch_rejected.at) }) }}
          </el-alert>
          <section class="block">
            <div class="block-title">
              <h4>{{ t("orders.common.dispatch") }}</h4>
              <el-button
                v-if="dispatch?.final_text"
                :icon="FullScreen"
                link
                type="primary"
                @click="dispatchTextVisible = true"
              >
                {{ t("orders.panel.expandDispatchText") }}
              </el-button>
            </div>
            <template v-if="dispatch">
              <div class="dispatch-head">
                <strong class="mono">{{ dispatch.dispatch_no }}</strong>
                <el-tag size="small">{{ t("orders.panel.channelTag", { channel: dispatch.channel }) }}</el-tag>
                <small>{{ t("orders.panel.submittedMeta", { by: dispatch.submitted_by, at: formatDateTime(dispatch.submitted_at) }) }}</small>
              </div>
              <div class="dispatch-text-wrap">
                <el-button
                  class="dispatch-copy"
                  :icon="CopyDocument"
                  circle
                  text
                  :title="t('orders.panel.copyDispatchText')"
                  @click="copyPanelDispatchText"
                />
                <pre class="dispatch-text">{{ dispatch.final_text }}</pre>
              </div>
            </template>
            <p v-else-if="order.status === 'AWAITING_DISPATCH'" class="empty-inline">
              {{ isTrader ? t("orders.panel.dispatchEmptyTrader") : t("orders.panel.dispatchEmptyWait") }}
            </p>
            <p v-else class="empty-inline">{{ t("orders.panel.dispatchEmptyBefore") }}</p>
          </section>
          <section class="block">
            <h4>{{ t("orders.panel.reviewTitle") }}</h4>
            <template v-if="dispatch && order.status === 'DISPATCH_REVIEW'">
              <div class="review-row">
                <div>
                  <strong>{{ fmtMoney(dispatch.currency, dispatch.amount) }}</strong>
                  <small>{{ t("orders.panel.reviewMeta", { channel: dispatch.channel, payee: dispatch.payee }) }}</small>
                </div>
                <div v-if="role === 'OPS' && !order.exception" class="review-actions">
                  <el-button size="small" type="primary" @click="doDispatchApprove">{{ t("orders.common.approve") }}</el-button>
                  <el-button size="small" @click="doDispatchReturn">{{ t("orders.common.reject") }}</el-button>
                </div>
                <small v-else class="muted">{{ t("orders.panel.waitReviewer") }}</small>
              </div>
            </template>
            <p v-else-if="dispatch?.reviewed_at" class="empty-inline">{{ t("orders.panel.reviewedAt", { by: dispatch.reviewed_by, at: formatDateTime(dispatch.reviewed_at) }) }}</p>
            <p v-else class="empty-inline">{{ t("orders.panel.reviewEmpty") }}</p>
          </section>
          <section class="block">
            <h4>{{ t("orders.panel.inventoryTitle") }}</h4>
            <dl v-if="order.freeze">
              <div><dt>{{ t("orders.panel.freezeAccount") }}</dt><dd>{{ order.freeze.account_name }}</dd></div>
              <div><dt>{{ t("orders.panel.freezeAmount") }}</dt><dd>{{ fmtMoney(order.freeze.currency, order.freeze.amount) }}</dd></div>
              <div><dt>{{ t("orders.panel.freezeState") }}</dt><dd>{{ t(`orders.panel.freezeStates.${order.freeze.state}`) }}</dd></div>
            </dl>
            <p v-else class="empty-inline">{{ t("orders.panel.freezeEmpty") }}</p>
          </section>
        </template>

        <!-- 出款 -->
        <template v-if="tab === 'execution'">
          <section class="funding-card" :class="{ done: fundingState('outflow').state === 'archived', error: fundingState('outflow').state === 'exception' }">
            <header>
              <div><strong>{{ t("orders.panel.platformOutflow") }}</strong><em>{{ fundingState("outflow").kindLabel }}</em></div>
              <el-tag :type="STATE_TONE[fundingState('outflow').state]" size="small">{{ t(`orders.panel.state.${fundingState("outflow").state}`) }}</el-tag>
            </header>
            <p class="owner">{{ t("orders.panel.owner") }}<strong>{{ fundingState("outflow").ownerLabel }}</strong><template v-if="order.outflow_mark"> · {{ t("orders.panel.executedBy", { by: order.outflow_mark.by, at: formatDateTime(order.outflow_mark.at) }) }}</template></p>
            <dl>
              <div v-for="[label, value] in markFields(fundingState('outflow'), 'outflow')" :key="label">
                <dt>{{ label }}</dt>
                <dd>
                  <span v-if="!isFileRef(value)">{{ value }}</span>
                  <span v-else class="file-ref">
                    <span class="file-name">{{ value.original_name }}</span>
                    <el-button size="small" link type="primary" :icon="View" @click="openVoucherFile(value)">
                      {{ t("orders.panel.filePreview") }}
                    </el-button>
                    <el-button size="small" link :icon="Download" @click="openVoucherFile(value, true)">
                      {{ t("orders.panel.fileDownload") }}
                    </el-button>
                  </span>
                </dd>
              </div>
            </dl>
          </section>
          <section class="block">
            <h4>{{ t("orders.panel.executionTitle") }}</h4>
            <div v-if="dispatch?.receipt" class="receipt-line">
              <span>{{ t("orders.panel.receipt") }}</span>
              <template v-if="dispatch.receipt.file">
                <span class="file-name">{{ dispatch.receipt.file.original_name }}</span>
                <el-button size="small" link type="primary" :icon="View" @click="openVoucherFile(dispatch.receipt.file)">
                  {{ t("orders.panel.filePreview") }}
                </el-button>
                <el-button size="small" link :icon="Download" @click="openVoucherFile(dispatch.receipt.file, true)">
                  {{ t("orders.panel.fileDownload") }}
                </el-button>
              </template>
              <template v-else>{{ dispatch.receipt.file_name }}</template>
              <small>{{ [dispatch.receipt.reference, dispatch.paid_by, dispatch.paid_at ? formatDateTime(dispatch.paid_at) : ""].filter(Boolean).join(" · ") }}</small>
            </div>
            <p v-else-if="order.status === 'AWAITING_PAYOUT'" class="empty-inline">{{ t("orders.panel.waitOwnerExecute", { owner: fundingState("outflow").ownerLabel }) }}</p>
            <p v-else class="empty-inline">{{ t("orders.panel.executeAfterReview") }}</p>
          </section>
          <section v-if="order.profit" class="block">
            <h4>{{ t("orders.panel.profitTitle") }} <small class="estimate-tag">{{ t("orders.panel.profitEstimate") }}</small></h4>
            <div class="profit">
              <div><span>{{ t("orders.panel.profitSpread") }}</span><b>{{ fmtMoney(order.profit.currency, order.profit.spread) }}</b></div>
              <div><span>{{ t("orders.panel.profitFee") }}</span><b>{{ fmtMoney(order.profit.currency, order.profit.fee) }}</b></div>
              <div class="cost"><span>{{ t("orders.panel.profitChannelCost") }}</span><b>− {{ fmtMoney(order.profit.currency, order.profit.channel_cost) }}</b></div>
              <div class="cost"><span>{{ t("orders.panel.profitCommission") }}</span><b>− {{ fmtMoney(order.profit.currency, order.profit.commission) }}</b></div>
              <div class="net"><span>{{ t("orders.panel.profitNet") }}</span><strong>{{ fmtMoney(order.profit.currency, order.profit.net) }}</strong></div>
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
    <el-dialog
      v-model="dispatchTextVisible"
      :title="t('orders.panel.dispatchTextTitle')"
      width="760px"
      append-to-body
    >
      <div class="dispatch-text-wrap">
        <el-button
          class="dispatch-copy"
          :icon="CopyDocument"
          circle
          text
          :title="t('orders.panel.copyDispatchText')"
          @click="copyPanelDispatchText"
        />
        <pre class="dispatch-text dispatch-text-large">{{ dispatch?.final_text }}</pre>
      </div>
    </el-dialog>
  </el-drawer>
</template>

<style scoped>
.panel {
  min-height: 100%;
}

:deep(.el-drawer__body) {
  overflow-y: auto;
}

.panel-head {
  padding-bottom: 4px;
}

.topline {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.topline-actions {
  display: flex;
  align-items: center;
  gap: 2px;
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

.biz-unset {
  color: #909399;
  font-weight: 400;
}

.estimate-tag {
  color: #e6a23c;
  font-weight: 400;
  font-size: 11px;
  margin-left: 6px;
}

.hero-quote {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #e4e7ed;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.hero-quote > span {
  color: #909399;
}

.hero-quote code {
  font-weight: 700;
  color: #d9531e;
}

.hero-quote em {
  color: #909399;
  font-style: normal;
}

.hero-quote .quote-mismatch {
  color: #e6a23c;
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

.file-ref,
.receipt-line {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

.file-name {
  color: #303133;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.receipt-line {
  color: #606266;
  font-size: 13px;
}

.receipt-line > span {
  color: #909399;
}

.receipt-line small {
  color: #909399;
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

.block-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.block-title h4 {
  margin: 0;
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

.dispatch-text-wrap {
  position: relative;
}

.dispatch-copy {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
  color: #d7dce6;
  background: rgba(255, 255, 255, 0.08);
}

.dispatch-copy:hover {
  color: #f4f7fb;
  background: rgba(255, 255, 255, 0.16);
}

.dispatch-text {
  background: #1f2430;
  color: #d7dce6;
  border-radius: 8px;
  padding: 10px 44px 10px 12px;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  margin: 0;
  max-height: 220px;
  overflow: auto;
}

.dispatch-text-large {
  max-height: 65vh;
  font-size: 13px;
  margin: 0;
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
