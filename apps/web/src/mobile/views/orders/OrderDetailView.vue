<script setup lang="ts">
/**
 * 移动端订单详情：只读信息 + 角色/状态驱动的操作卡片（口径对齐桌面 OrderPanel.actionBlocks）。
 * MANAGER 恒为只读；WALLET/OPS 的操作通过底部弹层（FundingSheet/DispatchSheet/PromptSheet）完成。
 */
import {
  FundingKind,
  FundingKindLabel,
  fundingKindOf,
  FundingOwnerLabel,
  fundingOwnerRole,
  TradeOrderStatus,
  type FundingSide,
  type PayoutOrderVO,
  type TradeOrderVO,
} from "@bv/shared";
import { Loading as VanLoading, showConfirmDialog, showSuccessToast } from "vant";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { localizeText } from "@/i18n";
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
import DispatchSheet from "../../components/DispatchSheet.vue";
import FundingSheet from "../../components/FundingSheet.vue";
import OrderCard from "../../components/OrderCard.vue";
import { fmtMoney, KYC_TONE, STATUS_TONE } from "../../orderMeta";
import PromptSheet from "../../components/PromptSheet.vue";

const route = useRoute();
const auth = useAuthStore();
const { t } = useI18n();

const role = computed(() => auth.roleCode);
const orderId = computed(() => route.params.id as string);

const loading = ref(true);
const loadFailed = ref(false);
const order = ref<TradeOrderVO | null>(null);
const dispatch = ref<PayoutOrderVO | null>(null);

const promptRef = ref<InstanceType<typeof PromptSheet>>();
const fundingVisible = ref(false);
const fundingSide = ref<FundingSide>("inflow");
const dispatchVisible = ref(false);

async function load() {
  loading.value = true;
  loadFailed.value = false;
  try {
    order.value = await fetchOrder(orderId.value);
    dispatch.value = await fetchOrderDispatch(orderId.value);
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
}

function applyUpdate(updated: TradeOrderVO) {
  order.value = updated;
  fetchOrderDispatch(orderId.value).then(d => (dispatch.value = d));
}

onMounted(load);

const tone = (status: string) => STATUS_TONE[status] ?? STATUS_TONE.PENDING_KYC;
const kycTone = (toneKey: string) => KYC_TONE[toneKey] ?? KYC_TONE.neutral;

function openFunding(side: FundingSide) {
  fundingSide.value = side;
  fundingVisible.value = true;
}

async function promptAndRun(
  options: { title: string; message?: string; placeholder?: string; required?: boolean; confirmText?: string },
  run: (value: string | null) => Promise<void>,
) {
  const value = await promptRef.value?.open(options);
  if (value === null || value === undefined) return;
  await run(value);
}

async function doDepositAddress() {
  const o = order.value!;
  await promptAndRun(
    {
      title: t("orders.panel.dialogs.depositPromptTitle", { orderNo: o.order_no }),
      message: t("orders.panel.dialogs.depositPromptBody", { customer: o.customer_name, amount: fmtMoney(o.sell_currency, o.sell_amount) }),
      placeholder: t("orders.panel.dialogs.depositPlaceholder"),
      required: true,
      confirmText: t("orders.panel.dialogs.confirmProvide"),
    },
    async value => {
      applyUpdate(await walletDepositAddress(o.id, value!.trim()));
      showSuccessToast(t("orders.panel.dialogs.depositDone"));
    },
  );
}

async function doInflowException() {
  const o = order.value!;
  await promptAndRun(
    {
      title: t("orders.panel.dialogs.inflowExcTitle", { orderNo: o.order_no }),
      message: t("orders.panel.dialogs.inflowExcBody", { customer: o.customer_name, amount: fmtMoney(o.sell_currency, o.sell_amount) }),
      placeholder: t("orders.panel.dialogs.inflowExcPlaceholder"),
      confirmText: t("orders.panel.dialogs.confirmMark"),
    },
    async value => {
      applyUpdate(await markException(o.id, { kind: "业务异常", reason: "金额不符", detail: value?.trim() || "入款金额与应收不符" }));
      showSuccessToast(t("orders.panel.dialogs.inflowExcMarked"));
    },
  );
}

async function doOutflowReturn() {
  const o = order.value!;
  await promptAndRun(
    {
      title: t("orders.panel.dialogs.outflowReturnTitle", { orderNo: o.order_no }),
      message: t("orders.panel.dialogs.outflowReturnBody"),
      placeholder: t("orders.panel.dialogs.exceptionReason"),
      confirmText: t("orders.panel.dialogs.confirmReturn"),
    },
    async value => {
      applyUpdate(await outflowReturn(o.id, value?.trim() || undefined));
      showSuccessToast(t("orders.panel.dialogs.returned"));
    },
  );
}

async function doCancel(riskStop: boolean) {
  const o = order.value!;
  await promptAndRun(
    {
      title: riskStop ? t("orders.panel.dialogs.riskStopTitle", { orderNo: o.order_no }) : t("orders.panel.dialogs.cancelTitle", { orderNo: o.order_no }),
      message: t("orders.panel.dialogs.cancelBody", {
        customer: o.customer_name,
        sell: fmtMoney(o.sell_currency, o.sell_amount),
        buy: fmtMoney(o.buy_currency, o.buy_amount),
        extra: `${o.freeze?.state === "FROZEN" ? t("orders.panel.dialogs.frozenReleaseNote") : ""}${riskStop ? t("orders.panel.dialogs.stopTail") : t("orders.panel.dialogs.cancelTail")}`,
      }),
      placeholder: riskStop ? t("orders.panel.dialogs.stopReason") : t("orders.panel.dialogs.cancelReason"),
      confirmText: riskStop ? t("orders.panel.dialogs.confirmStop") : t("orders.panel.dialogs.confirmCancel"),
    },
    async value => {
      const updated = riskStop ? await riskStopOrder(o.id, value?.trim() || undefined) : await cancelOrder(o.id, value?.trim() || undefined);
      showSuccessToast(riskStop ? t("orders.panel.dialogs.stopped") : t("orders.panel.dialogs.orderCancelled"));
      applyUpdate(updated);
    },
  );
}

async function doKycSync() {
  const updated = await syncOrderKyc(order.value!.id);
  showSuccessToast(t("orders.panel.dialogs.kycSynced", { orderNo: updated.order_no }));
  applyUpdate(updated);
}

async function resolveExc(action: "restore" | "cancel" | "escalate") {
  const o = order.value!;
  if (action === "escalate") {
    await showConfirmDialog({ title: t("mobile.detail.confirmEscalateTitle"), message: t("mobile.detail.confirmEscalateBody") });
    applyUpdate(await resolveException(o.id, "escalate"));
    showSuccessToast(t("orders.panel.dialogs.escalated"));
    return;
  }
  await promptAndRun(
    {
      title: action === "restore" ? t("orders.panel.dialogs.resolveRestoreTitle", { orderNo: o.order_no }) : t("orders.panel.dialogs.cancelTitle", { orderNo: o.order_no }),
      message: action === "restore" ? t("orders.panel.dialogs.resolveRestoreBody") : t("orders.panel.dialogs.resolveCancelBody"),
      placeholder: action === "restore" ? t("orders.panel.dialogs.resolveNotePlaceholder") : t("orders.panel.dialogs.cancelReason"),
      confirmText: action === "restore" ? t("orders.panel.dialogs.confirmResolve") : t("orders.panel.dialogs.confirmCancel"),
    },
    async value => {
      applyUpdate(await resolveException(o.id, action, value?.trim() || undefined));
      showSuccessToast(action === "restore" ? t("orders.panel.dialogs.resolved") : t("orders.panel.dialogs.orderCancelled"));
    },
  );
}

async function doDispatchApprove() {
  const o = order.value!;
  await showConfirmDialog({
    title: t("mobile.detail.confirmApproveTitle"),
    message: t("mobile.detail.confirmApproveBody", { dispatchNo: dispatch.value?.dispatch_no, amount: fmtMoney(o.buy_currency, o.buy_amount) }),
  });
  applyUpdate(await approveDispatch(o.id));
  showSuccessToast(t("orders.panel.dialogs.approved"));
}

async function doDispatchReturn() {
  const o = order.value!;
  await promptAndRun(
    {
      title: t("orders.panel.dialogs.returnDispatchTitle", { dispatchNo: dispatch.value?.dispatch_no }),
      message: t("orders.panel.dialogs.returnDispatchBody", { customer: o.customer_name, amount: fmtMoney(o.buy_currency, o.buy_amount) }),
      placeholder: t("orders.panel.dialogs.rejectReason"),
      confirmText: t("orders.panel.dialogs.confirmReject"),
    },
    async value => {
      applyUpdate(await returnDispatch(o.id, value?.trim() || undefined));
      showSuccessToast(t("orders.panel.dialogs.dispatchReturned"));
    },
  );
}

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

const actionBlocks = computed<ActionBlock[]>(() => {
  const o = order.value;
  if (!o || role.value === "MANAGER") return [];
  const blocks: ActionBlock[] = [];
  const inflowKind = fundingKindOf(o, "inflow");
  const outflowKind = fundingKindOf(o, "outflow");
  const inflowOwner = fundingOwnerRole(o, "inflow");
  const outflowOwner = fundingOwnerRole(o, "outflow");

  if (role.value === "OPS" && o.exception) {
    /* 异常未解除前只给异常处理动作，不再叠加正常状态的审核/排单操作 —— 需先解除/取消/升级 */
    blocks.push({
      tone: "danger",
      text: t("orders.panel.actions.exceptionText", { reason: o.exception.reason }),
      buttons: [
        { label: t("orders.panel.actions.resolveException"), primary: true, run: () => resolveExc("restore") },
        { label: t("orders.common.cancelOrder"), run: () => resolveExc("cancel") },
        ...(o.exception.escalated ? [] : [{ label: t("orders.panel.actions.escalateCompliance"), run: () => resolveExc("escalate") }]),
      ],
    });
    return blocks;
  }

  if (role.value === "OPS") {
    if (o.status === TradeOrderStatus.PENDING_KYC) {
      blocks.push({
        tone: "warning",
        text: t("orders.panel.actions.pendingKycText", { kyc: localizeText(o.kyc.label) }),
        buttons: [
          { label: t("orders.panel.actions.syncKyc"), primary: true, run: doKycSync },
          { label: t("orders.common.cancelOrder"), run: () => doCancel(false) },
        ],
      });
    }
    if (o.status === TradeOrderStatus.AWAITING_INFLOW) {
      blocks.push({
        tone: "info",
        text: t("orders.panel.actions.awaitingInflowText", {
          method: inflowKind === FundingKind.CHAIN ? t("orders.panel.actions.methodChain") : inflowKind === FundingKind.CASH ? t("orders.panel.actions.methodCash") : t("orders.panel.actions.methodBank"),
          amount: fmtMoney(o.sell_currency, o.sell_amount),
          owner: localizeText(FundingOwnerLabel[inflowOwner] ?? inflowOwner),
        }),
        buttons: [{ label: t("orders.common.cancelOrder"), run: () => doCancel(false) }],
      });
    }
    if (o.status === TradeOrderStatus.AWAITING_DISPATCH) {
      blocks.push({
        tone: "mint",
        text: t("orders.panel.actions.awaitingDispatchText"),
        buttons: [
          { label: t("orders.common.startDispatch"), primary: true, run: () => (dispatchVisible.value = true) },
          { label: t("orders.common.cancelOrder"), run: () => doCancel(false) },
        ],
      });
    }
    if (o.status === TradeOrderStatus.DISPATCH_REVIEW && dispatch.value) {
      blocks.push({
        tone: "mint",
        text: t("orders.panel.waitReviewer"),
        buttons: [
          { label: t("orders.common.approve"), primary: true, run: doDispatchApprove },
          { label: t("orders.common.reject"), run: doDispatchReturn },
        ],
      });
    }
    if (o.status === TradeOrderStatus.AWAITING_PAYOUT) {
      blocks.push({
        tone: "info",
        text: t("orders.panel.actions.riskText"),
        buttons: [{ label: t("orders.panel.actions.riskStop"), run: () => doCancel(true) }],
      });
    }
  }

  if (role.value === "WALLET") {
    if (inflowKind === FundingKind.CHAIN && !o.wallet_ops?.deposit_address && o.status === TradeOrderStatus.AWAITING_INFLOW) {
      blocks.push({
        tone: "info",
        text: t("orders.panel.actions.depositText"),
        buttons: [{ label: t("orders.panel.actions.depositButton"), primary: true, run: doDepositAddress }],
      });
    }
    if (o.status === TradeOrderStatus.AWAITING_INFLOW && inflowOwner === role.value) {
      blocks.push({
        tone: "warning",
        text: t("orders.panel.actions.inflowOwnerText", { kind: localizeText(FundingKindLabel[inflowKind]) }),
        buttons: [
          { label: t("orders.common.markChainInflow"), primary: true, run: () => openFunding("inflow") },
          { label: t("orders.panel.actions.inflowException"), run: doInflowException },
        ],
      });
    }
    if (o.status === TradeOrderStatus.AWAITING_PAYOUT && outflowOwner === role.value) {
      blocks.push({
        tone: "mint",
        text: t("orders.panel.actions.outflowChainText", { amount: fmtMoney(o.buy_currency, o.buy_amount) }),
        buttons: [
          { label: t("orders.common.registerChainTransfer"), primary: true, run: () => openFunding("outflow") },
          { label: t("orders.panel.actions.outflowReturn"), run: doOutflowReturn },
        ],
      });
    }
  }

  return blocks;
});

interface FundingRow {
  label: string;
  value: string;
}

function fundingRows(side: FundingSide): FundingRow[] {
  const o = order.value!;
  const kind = fundingKindOf(o, side);
  const mark = side === "inflow" ? o.inflow_mark : o.outflow_mark;
  const expected = side === "inflow" ? o.sell_amount : o.buy_amount;
  const currency = side === "inflow" ? o.sell_currency : o.buy_currency;
  const rows: FundingRow[] = [
    { label: side === "inflow" ? t("orders.panel.fields.expectedRecv") : t("orders.panel.fields.expectedPay"), value: fmtMoney(currency, expected) },
  ];
  if (kind === FundingKind.CHAIN && side === "inflow") {
    rows.push({ label: t("orders.panel.fields.companyDepositAddr"), value: o.wallet_ops?.deposit_address || t("orders.panel.fields.awaitingWalletOps") });
  }
  if (mark) {
    rows.push({ label: side === "inflow" ? t("orders.panel.fields.actualRecv") : t("orders.panel.fields.actualPay"), value: fmtMoney(mark.currency || currency, mark.amount) });
    if (mark.hash) rows.push({ label: t("orders.panel.fields.txHash"), value: t("orders.panel.fields.hashDetail", { hash: mark.hash.slice(0, 18), chain: mark.chain || "TRC20", confirms: mark.confirms || "-" }) });
    if (mark.account) rows.push({ label: t("orders.panel.fields.account"), value: mark.account });
    if (mark.place) rows.push({ label: t("orders.common.settlePlace"), value: mark.place + (mark.handler ? ` · ${mark.handler}` : "") });
    if (mark.note) rows.push({ label: t("orders.common.note"), value: mark.note });
    rows.push({ label: t("orders.panel.fields.registrar"), value: `${mark.by} · ${formatDateTime(mark.at)}` });
  }
  return rows;
}
</script>

<template>
  <div class="detail-view">
    <div v-if="loading" class="state"><van-loading size="22" /></div>
    <p v-else-if="loadFailed || !order" class="state" @click="load">{{ t("mobile.detail.loadFailed") }}</p>

    <template v-else>
      <OrderCard :order="order" :role="role" @open="() => {}" />

      <section v-if="role === 'MANAGER'" class="readonly-hint">{{ t("mobile.detail.readonlyHint") }}</section>

      <section v-for="(block, index) in actionBlocks" :key="index" class="action-card" :class="block.tone">
        <p>{{ block.text }}</p>
        <div class="buttons">
          <button
            v-for="btn in block.buttons"
            :key="btn.label"
            type="button"
            :class="{ primary: btn.primary }"
            @click="btn.run"
          >
            {{ btn.label }}
          </button>
        </div>
      </section>

      <section class="info-card">
        <header>{{ t("mobile.detail.inflow") }}</header>
        <dl>
          <div v-for="row in fundingRows('inflow')" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </div>
        </dl>
      </section>

      <section class="info-card">
        <header>{{ t("mobile.detail.outflow") }}</header>
        <dl>
          <div v-for="row in fundingRows('outflow')" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </div>
        </dl>
      </section>

      <section v-if="dispatch" class="info-card">
        <header>{{ t("mobile.detail.dispatchTitle") }}</header>
        <dl>
          <div><dt>{{ t("mobile.detail.dispatchNo") }}</dt><dd class="mono">{{ dispatch.dispatch_no }}</dd></div>
          <div><dt>{{ t("orders.dispatch.payableAmount") }}</dt><dd>{{ fmtMoney(dispatch.currency, dispatch.amount) }}</dd></div>
          <div><dt>{{ t("orders.dispatch.channel") }}</dt><dd>{{ dispatch.channel }}</dd></div>
          <div><dt>{{ t("mobile.detail.payee") }}</dt><dd>{{ dispatch.payee }}</dd></div>
          <div><dt>{{ t("mobile.detail.submittedBy") }}</dt><dd>{{ dispatch.submitted_by }} · {{ formatDateTime(dispatch.submitted_at) }}</dd></div>
        </dl>
      </section>

      <section v-if="order.freeze" class="info-card">
        <header>{{ t("orders.panel.inventoryTitle") }}</header>
        <dl>
          <div><dt>{{ t("orders.panel.freezeAccount") }}</dt><dd>{{ order.freeze.account_name }}</dd></div>
          <div><dt>{{ t("orders.panel.freezeAmount") }}</dt><dd>{{ fmtMoney(order.freeze.currency, order.freeze.amount) }}</dd></div>
          <div><dt>{{ t("orders.panel.freezeState") }}</dt><dd>{{ t(`orders.panel.freezeStates.${order.freeze.state}`) }}</dd></div>
        </dl>
      </section>

      <section v-if="order.profit" class="info-card">
        <header>{{ t("orders.panel.profitTitle") }} · {{ t("orders.panel.profitEstimate") }}</header>
        <dl>
          <div><dt>{{ t("orders.panel.profitSpread") }}</dt><dd>{{ fmtMoney(order.profit.currency, order.profit.spread) }}</dd></div>
          <div><dt>{{ t("orders.panel.profitFee") }}</dt><dd>{{ fmtMoney(order.profit.currency, order.profit.fee) }}</dd></div>
          <div><dt>{{ t("orders.panel.profitChannelCost") }}</dt><dd>− {{ fmtMoney(order.profit.currency, order.profit.channel_cost) }}</dd></div>
          <div><dt>{{ t("orders.panel.profitCommission") }}</dt><dd>− {{ fmtMoney(order.profit.currency, order.profit.commission) }}</dd></div>
          <div><dt><strong>{{ t("orders.panel.profitNet") }}</strong></dt><dd><strong>{{ fmtMoney(order.profit.currency, order.profit.net) }}</strong></dd></div>
        </dl>
      </section>

      <section v-if="order.timeline?.length" class="info-card">
        <header>{{ t("mobile.detail.timeline") }}</header>
        <ul class="timeline">
          <li v-for="(step, index) in order.timeline" :key="index">
            <strong>{{ step.title }}</strong>
            <span>{{ step.detail }}</span>
            <small>{{ step.actor }} · {{ formatDateTime(step.at) }}</small>
          </li>
        </ul>
      </section>

      <FundingSheet v-model="fundingVisible" :order="order" :side="fundingSide" @done="applyUpdate" />
      <DispatchSheet v-model="dispatchVisible" :order="order" @done="applyUpdate" />
      <PromptSheet ref="promptRef" />
    </template>
  </div>
</template>

<style scoped>
.detail-view {
  padding: 10px 12px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.state {
  padding: 40px;
  text-align: center;
  color: var(--color-text-muted);
}

.readonly-hint {
  background: #eef1f5;
  color: var(--color-text-secondary);
  font-size: 12px;
  border-radius: 8px;
  padding: 8px 12px;
}

.action-card {
  border-radius: 12px;
  padding: 12px 14px;
  background: #eef6ff;
}

.action-card.warning {
  background: #fdf3e3;
}

.action-card.mint {
  background: #e7f6ec;
}

.action-card.danger {
  background: #fbebeb;
}

.action-card p {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--color-text-primary);
  line-height: 1.6;
}

.buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.buttons button {
  flex: 1;
  min-width: 100px;
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 8px;
  padding: 9px 10px;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.buttons button.primary {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: #fff;
}

.info-card {
  background: #fff;
  border-radius: 12px;
  padding: 12px 14px;
}

.info-card header {
  font-size: 13px;
  color: var(--color-text-muted);
  margin-bottom: 8px;
}

.info-card dl {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.info-card dl div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}

.info-card dt {
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.info-card dd {
  margin: 0;
  text-align: right;
  word-break: break-all;
}

.mono {
  font-family: ui-monospace, monospace;
}

.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.timeline li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-left: 2px solid var(--color-primary);
  padding-left: 10px;
}

.timeline strong {
  font-size: 13px;
}

.timeline span {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.timeline small {
  font-size: 11px;
  color: var(--color-text-muted);
}
</style>
