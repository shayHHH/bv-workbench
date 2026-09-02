/**
 * 移动端订单展示元数据：三个移动角色（WALLET/OPS/MANAGER）的待办页签、
 * 状态色与列表 CTA 文案。口径对齐桌面 TradeOrdersView 的 TODO_DEFS / rowCta。
 */
import {
  FundingKind,
  fundingKindOf,
  TradeOrderStatus,
  type OrderListStatsVO,
  type TradeOrderVO,
} from "@bv/shared";
import type { OrderListQuery } from "@/api/order";

export const ACTIVE_STATUSES =
  "PENDING_KYC,AWAITING_INFLOW,AWAITING_DISPATCH,DISPATCH_REVIEW,AWAITING_PAYOUT";

export interface MobileTodoTab {
  /** i18n key（orders.list.tabs.*） */
  labelKey: string;
  params: Partial<OrderListQuery>;
  count: (s: OrderListStatsVO) => number;
}

const sumStatus = (s: OrderListStatsVO, ...statuses: string[]) =>
  statuses.reduce((n, status) => n + (s.by_status[status] ?? 0), 0);
const allCount = (s: OrderListStatsVO) => s.all;

export const MOBILE_TODO_TABS: Record<string, MobileTodoTab[]> = {
  WALLET: [
    { labelKey: "orders.list.tabs.chainInflowPending", params: { status: "AWAITING_INFLOW", inflow_kind: "chain" }, count: s => s.inflow_chain },
    { labelKey: "orders.list.tabs.chainOutflowPending", params: { status: "AWAITING_PAYOUT", outflow_kind: "chain" }, count: s => s.outflow_chain },
    { labelKey: "orders.list.tabs.all", params: {}, count: allCount },
  ],
  OPS: [
    { labelKey: "orders.list.tabs.pendingReview", params: { status: "DISPATCH_REVIEW" }, count: s => sumStatus(s, "DISPATCH_REVIEW") },
    { labelKey: "orders.list.tabs.awaitingDispatch", params: { status: "AWAITING_DISPATCH" }, count: s => sumStatus(s, "AWAITING_DISPATCH") },
    { labelKey: "orders.list.tabs.exception", params: { flag: "exception" }, count: s => s.exceptions },
    { labelKey: "orders.list.tabs.all", params: {}, count: allCount },
  ],
  MANAGER: [
    { labelKey: "orders.list.tabs.active", params: { status: ACTIVE_STATUSES }, count: s => s.active },
    { labelKey: "orders.list.tabs.exception", params: { flag: "exception" }, count: s => s.exceptions },
    { labelKey: "orders.list.tabs.completed", params: { status: "COMPLETED" }, count: s => sumStatus(s, "COMPLETED") },
    { labelKey: "orders.list.tabs.all", params: {}, count: allCount },
  ],
};

/** 状态徽标配色（与桌面 el-tag type 对应的移动端色板） */
export const STATUS_TONE: Record<string, { color: string; bg: string }> = {
  PENDING_KYC: { color: "#909399", bg: "#f0f2f5" },
  AWAITING_INFLOW: { color: "#b88230", bg: "#fdf3e3" },
  AWAITING_DISPATCH: { color: "#d9531e", bg: "#ffefe3" },
  DISPATCH_REVIEW: { color: "#3d6fb4", bg: "#e9f1fb" },
  AWAITING_PAYOUT: { color: "#b88230", bg: "#fdf3e3" },
  COMPLETED: { color: "#3e8e52", bg: "#e7f6ec" },
  CANCELLED: { color: "#909399", bg: "#f0f2f5" },
};

export const KYC_TONE: Record<string, { color: string; bg: string }> = {
  success: { color: "#3e8e52", bg: "#e7f6ec" },
  info: { color: "#3d6fb4", bg: "#e9f1fb" },
  warning: { color: "#b88230", bg: "#fdf3e3" },
  danger: { color: "#c45656", bg: "#fbebeb" },
  neutral: { color: "#909399", bg: "#f0f2f5" },
};

/** 列表卡片 CTA 文案 key（orders.list.cta.* / orders.common.*），口径对齐桌面 rowCta */
export function rowCtaKey(order: TradeOrderVO, role: string): string {
  if (role === "OPS") {
    if (order.exception) return "orders.list.cta.handleException";
    if (order.status === TradeOrderStatus.DISPATCH_REVIEW) return "orders.list.cta.startReview";
    if (order.status === TradeOrderStatus.AWAITING_DISPATCH) return "orders.common.dispatch";
  }
  if (role === "WALLET") {
    if (order.status === TradeOrderStatus.AWAITING_INFLOW && fundingKindOf(order, "inflow") === FundingKind.CHAIN)
      return order.wallet_ops?.deposit_address ? "orders.list.cta.registerInflow" : "orders.list.cta.provideDepositAddress";
    if (order.status === TradeOrderStatus.AWAITING_PAYOUT && fundingKindOf(order, "outflow") === FundingKind.CHAIN)
      return "orders.common.registerChainTransfer";
  }
  return "orders.list.cta.view";
}

export const fmtMoney = (currency: string, amount: number) =>
  `${currency} ${amount.toLocaleString("en-US")}`;
