/**
 * 交易订单域共享定义。交互与状态机以 demo（bv-workbench-go/index.html + app.js）为准：
 * 主线 待KYC → 待客户入款 → 待出款排单 → 出款审核中 → 待出款执行 → 已完成（附加异常不打断主线）。
 * 资金形态由币种/收款方式推导：USDT→链上（钱包运营）、现金→现金交收、其余→银行（入款财务/出款出款员）。
 */

/* ---------------- 订单主线状态 ---------------- */

export const TradeOrderStatus = {
  PENDING_KYC: "PENDING_KYC",
  AWAITING_INFLOW: "AWAITING_INFLOW",
  AWAITING_DISPATCH: "AWAITING_DISPATCH",
  DISPATCH_REVIEW: "DISPATCH_REVIEW",
  AWAITING_PAYOUT: "AWAITING_PAYOUT",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;
export type TradeOrderStatus = (typeof TradeOrderStatus)[keyof typeof TradeOrderStatus];

export const TradeOrderStatusLabel: Record<TradeOrderStatus, string> = {
  PENDING_KYC: "待KYC",
  AWAITING_INFLOW: "待客户入款",
  AWAITING_DISPATCH: "待出款排单",
  DISPATCH_REVIEW: "出款审核中",
  AWAITING_PAYOUT: "待出款执行",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

/* ---------------- 出款排单状态 ---------------- */

export const DispatchStatus = {
  REVIEWING: "REVIEWING",
  AWAITING_PAYOUT: "AWAITING_PAYOUT",
  PAID: "PAID",
  VOID: "VOID",
} as const;
export type DispatchStatus = (typeof DispatchStatus)[keyof typeof DispatchStatus];

export const DispatchStatusLabel: Record<DispatchStatus, string> = {
  REVIEWING: "出款审核中",
  AWAITING_PAYOUT: "待出款",
  PAID: "已出款",
  VOID: "已作废",
};

export const DispatchChannel = {
  SGB: "SGB",
  SINO: "SINO",
} as const;
export type DispatchChannel = (typeof DispatchChannel)[keyof typeof DispatchChannel];

/* ---------------- 资金形态与责任角色 ---------------- */

export const FundingKind = {
  BANK: "BANK",
  CHAIN: "CHAIN",
  CASH: "CASH",
} as const;
export type FundingKind = (typeof FundingKind)[keyof typeof FundingKind];

export const FundingKindLabel: Record<FundingKind, string> = {
  BANK: "银行入账",
  CHAIN: "链上转账",
  CASH: "现金交收",
};

export type FundingSide = "inflow" | "outflow";

export interface OrderMoneyShape {
  trade_type: string;
  sell_currency: string;
  buy_currency: string;
  pay_method: string;
}

/** demo fundingKind：USDT→链上；入款现金方式/出款现金类交易→现金；其余银行 */
export function fundingKindOf(order: OrderMoneyShape, side: FundingSide): FundingKind {
  const currency = side === "inflow" ? order.sell_currency : order.buy_currency;
  if (currency === "USDT") return FundingKind.CHAIN;
  if (side === "inflow" && order.pay_method === "现金") return FundingKind.CASH;
  if (side === "outflow" && /现金/.test(order.trade_type || "")) return FundingKind.CASH;
  return FundingKind.BANK;
}

/** 责任角色代码：链上→钱包运营；入款→财务；出款→出款员 */
export function fundingOwnerRole(order: OrderMoneyShape, side: FundingSide): string {
  if (fundingKindOf(order, side) === FundingKind.CHAIN) return "WALLET";
  return side === "inflow" ? "FINANCE" : "PAYOUT";
}

export const FundingOwnerLabel: Record<string, string> = {
  WALLET: "钱包运营",
  FINANCE: "财务",
  PAYOUT: "出款员",
};

/* ---------------- 冻结 / 收益 ---------------- */

export const FreezeState = {
  FROZEN: "FROZEN",
  RELEASED: "RELEASED",
  CONSUMED: "CONSUMED",
} as const;
export type FreezeState = (typeof FreezeState)[keyof typeof FreezeState];

export const FreezeStateLabel: Record<FreezeState, string> = {
  FROZEN: "已冻结",
  RELEASED: "已释放",
  CONSUMED: "已消耗",
};

export interface OrderFreezeVO {
  account_key: string;
  account_name: string;
  currency: string;
  amount: number;
  state: FreezeState;
}

export interface OrderProfitVO {
  currency: string;
  spread: number;
  fee: number;
  channel_cost: number;
  commission: number;
  net: number;
}

/* ---------------- 订单 KYC 徽标（demo 表3：随准入申请状态映射） ---------------- */

export interface OrderKycBadge {
  label: string;
  tone: "success" | "info" | "warning" | "danger" | "neutral";
  ready: boolean;
}

/** access_applications 状态 → 订单 KYC 徽标 */
export const AccessToKycBadge: Record<string, OrderKycBadge> = {
  APPROVED: { label: "KYC已通过", tone: "success", ready: true },
  PENDING_REVIEW: { label: "合规审核中", tone: "info", ready: false },
  SUPPLEMENT_REQUIRED: { label: "KYC被驳回", tone: "warning", ready: false },
  EXPIRED: { label: "KYC已过期", tone: "warning", ready: false },
  SUSPENDED: { label: "KYC已暂停", tone: "neutral", ready: false },
  REJECTED: { label: "KYC被终止", tone: "danger", ready: false },
  CANCELLED: { label: "待KYC", tone: "neutral", ready: false },
  DRAFT: { label: "待KYC", tone: "neutral", ready: false },
};

export const KYC_BADGE_NONE: OrderKycBadge = { label: "待KYC", tone: "neutral", ready: false };

/* ---------------- 阶段推进条（demo 九段） ---------------- */

export const ORDER_STAGES = [
  "交易登记",
  "KYC材料",
  "KYC审核",
  "客户入款",
  "入款确认",
  "出款排单",
  "排单审核",
  "出款执行",
  "完成",
] as const;

const STAGE_INDEX: Partial<Record<TradeOrderStatus, number>> = {
  PENDING_KYC: 1,
  AWAITING_INFLOW: 3,
  AWAITING_DISPATCH: 5,
  DISPATCH_REVIEW: 6,
  AWAITING_PAYOUT: 7,
  COMPLETED: 9,
};

export function orderStageCurrent(status: TradeOrderStatus, kyc: OrderKycBadge): number {
  let current = STAGE_INDEX[status] ?? 1;
  if (status === TradeOrderStatus.PENDING_KYC) {
    current = kyc.ready ? 3 : kyc.label === "合规审核中" ? 2 : 1;
  }
  return current;
}

/* ---------------- 交易类型预设（demo） ---------------- */

export const TRADE_TYPE_PRESETS: Record<string, [string, string, string]> = {
  现金换U: ["HKD", "USDT", "7.8200"],
  U换现金: ["USDT", "HKD", "7.8000"],
  转账换U: ["USD", "USDT", "1.0020"],
  U换转账: ["USDT", "USD", "0.9980"],
  法币换法币: ["HKD", "USD", "7.8000"],
};

export const ORDER_CURRENCIES = ["HKD", "USD", "USDT", "CNY", "EUR", "SGD"] as const;

/* ---------------- VO ---------------- */

export interface OrderQuoteRefVO {
  quote_record_id: string | null;
  deal_rate: string;
  cost_rate: string | null;
  source: string;
  quoted_at: string | null;
  quoted_by: string | null;
  fee: string | null;
}

export interface OrderTimelineVO {
  at: string;
  title: string;
  detail: string;
  actor: string;
}

export interface OrderExceptionVO {
  kind: string;
  reason: string;
  detail: string;
  prev_status: TradeOrderStatus;
  escalated: boolean;
  since: string;
}

export interface OrderRejectMarkVO {
  reason: string;
  by: string;
  at: string;
}

export interface OrderWalletOpsVO {
  deposit_address: string | null;
  deposit_by: string | null;
  deposit_at: string | null;
  payout_address: string | null;
  kya_passed: boolean;
  kya_by: string | null;
  kya_at: string | null;
}

export interface FundingMarkVO {
  by: string;
  at: string;
  amount: number;
  currency: string;
  account: string | null;
  voucher: string | null;
  chain: string | null;
  hash: string | null;
  confirms: string | null;
  place: string | null;
  handler: string | null;
  token: string | null;
  method: string | null;
  note: string | null;
}

export interface TradeOrderVO {
  id: string;
  order_no: string;
  customer_id: string;
  customer_name: string;
  customer_code: string | null;
  person_name: string | null;
  business_type: string | null;
  trade_type: string;
  sell_currency: string;
  sell_amount: number;
  buy_currency: string;
  buy_amount: number;
  rate: string;
  pay_method: string;
  remark: string | null;
  quote: OrderQuoteRefVO | null;
  status: TradeOrderStatus;
  kyc: OrderKycBadge;
  handler_name: string | null;
  dispatch_id: string | null;
  wallet_ops: OrderWalletOpsVO | null;
  inflow_mark: FundingMarkVO | null;
  outflow_mark: FundingMarkVO | null;
  freeze: OrderFreezeVO | null;
  profit: OrderProfitVO | null;
  exception: OrderExceptionVO | null;
  payment_rejected: OrderRejectMarkVO | null;
  dispatch_rejected: OrderRejectMarkVO | null;
  receipt_ref: string | null;
  timeline: OrderTimelineVO[];
  created_at: string;
  updated_at: string;
}

export interface DispatchReceiptVO {
  file_name: string;
  reference: string | null;
  note: string | null;
  uploaded_by: string;
  uploaded_at: string;
  matched: boolean;
}

export interface PayoutOrderVO {
  id: string;
  dispatch_no: string;
  order_id: string;
  order_no: string;
  customer_name: string;
  customer_code: string | null;
  channel: DispatchChannel;
  currency: string;
  amount: number;
  order_title: string;
  final_text: string;
  payout_account: string;
  va_account: { virtual_account_number: string; iban: string; currency: string } | null;
  payee: string;
  payee_bank: string;
  status: DispatchStatus;
  submitted_by: string;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  paid_by: string | null;
  paid_at: string | null;
  receipt: DispatchReceiptVO | null;
}

export interface TreasuryAccountVO {
  key: string;
  group: string;
  name: string;
  currency: string;
  available: number;
  frozen: number;
}

export interface VaAccountVO {
  id: string;
  customer_id: string;
  label: string;
  virtual_account_number: string;
  iban: string;
  currency: string;
  bank: string;
}

export interface QuoteCandidateVO {
  quote_record_id: string;
  trade_type: string;
  prefix: string | null;
  result: string;
  quoted_at: string;
  operator_name: string | null;
}

/** 列表响应附带的统计（指标条 + 待办页签计数在前端算需要全量，改为服务端聚合） */
export interface OrderListStatsVO {
  active: number;
  by_status: Record<string, number>;
  exceptions: number;
  payment_rejected: number;
  dispatch_rejected: number;
  inflow_fiat: number;
  inflow_chain: number;
  outflow_fiat: number;
  outflow_chain: number;
  kya_pending: number;
}

/* ---------------- 输入 ---------------- */

export interface CreateOrderInput {
  customer_id: string;
  business_type?: string | null;
  trade_type: string;
  sell_currency: string;
  sell_amount: number;
  buy_currency: string;
  buy_amount: number;
  rate: string;
  pay_method: string;
  remark?: string | null;
  quote_record_id?: string | null;
}

export interface InflowConfirmInput {
  amount: number;
  account?: string | null;
  voucher?: string | null;
  chain?: string | null;
  hash?: string | null;
  confirms?: string | null;
  place?: string | null;
  handler?: string | null;
  token?: string | null;
  method?: string | null;
  note?: string | null;
}

export type OutflowExecuteInput = InflowConfirmInput;

export interface CreateDispatchInput {
  channel: DispatchChannel;
  text: string;
  va_account_id?: string | null;
}
