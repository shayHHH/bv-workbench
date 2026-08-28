import type {
  CreateDispatchInput,
  CreateOrderInput,
  InflowConfirmInput,
  OrderListStatsVO,
  OutflowExecuteInput,
  PageResult,
  PayoutOrderVO,
  QuoteCandidateVO,
  TradeOrderVO,
  TreasuryAccountVO,
  VaAccountVO,
} from "@bv/shared";
import { http } from "./http";

export interface OrderListQuery {
  keyword?: string;
  /** 逗号分隔状态列表 */
  status?: string;
  customer_id?: string;
  scope?: "mine";
  flag?: "exception" | "payment_rejected" | "dispatch_rejected" | "rejected";
  inflow_kind?: "fiat" | "chain";
  outflow_kind?: "fiat" | "chain";
  created_from?: number;
  created_to?: number;
  page?: number;
  page_size?: number;
}

export type OrderPage = PageResult<TradeOrderVO> & { stats: OrderListStatsVO };

export async function fetchOrders(query: OrderListQuery): Promise<OrderPage> {
  const { data } = await http.get<OrderPage>("/orders", { params: query });
  return data;
}

export async function fetchOrder(id: string): Promise<TradeOrderVO> {
  const { data } = await http.get<TradeOrderVO>(`/orders/${id}`);
  return data;
}

export async function fetchOrderDispatch(id: string): Promise<PayoutOrderVO | null> {
  const { data } = await http.get<PayoutOrderVO | null>(`/orders/${id}/dispatch`);
  return data;
}

export async function fetchDispatchContext(id: string): Promise<{
  va_accounts: VaAccountVO[];
  treasury: TreasuryAccountVO[];
}> {
  const { data } = await http.get(`/orders/${id}/dispatch-context`);
  return data;
}

export async function fetchQuoteCandidates(customerId: string): Promise<QuoteCandidateVO[]> {
  const { data } = await http.get<QuoteCandidateVO[]>("/orders/quote-candidates", {
    params: { customer_id: customerId },
  });
  return data;
}

export async function createOrder(input: CreateOrderInput): Promise<TradeOrderVO> {
  const { data } = await http.post<TradeOrderVO>("/orders", input);
  return data;
}

export async function cancelOrder(id: string, reason?: string): Promise<TradeOrderVO> {
  const { data } = await http.post<TradeOrderVO>(`/orders/${id}/cancel`, { reason });
  return data;
}

export async function riskStopOrder(id: string, reason?: string): Promise<TradeOrderVO> {
  const { data } = await http.post<TradeOrderVO>(`/orders/${id}/risk-stop`, { reason });
  return data;
}

export async function syncOrderKyc(id: string): Promise<TradeOrderVO> {
  const { data } = await http.post<TradeOrderVO>(`/orders/${id}/kyc-sync`);
  return data;
}

export async function walletDepositAddress(id: string, address: string): Promise<TradeOrderVO> {
  const { data } = await http.post<TradeOrderVO>(`/orders/${id}/wallet/deposit-address`, { address });
  return data;
}

export async function inflowConfirm(id: string, input: InflowConfirmInput): Promise<TradeOrderVO> {
  const { data } = await http.post<TradeOrderVO>(`/orders/${id}/inflow-confirm`, input);
  return data;
}

export async function createDispatch(id: string, input: CreateDispatchInput): Promise<TradeOrderVO> {
  const { data } = await http.post<TradeOrderVO>(`/orders/${id}/dispatch`, input);
  return data;
}

export async function approveDispatch(id: string): Promise<TradeOrderVO> {
  const { data } = await http.post<TradeOrderVO>(`/orders/${id}/dispatch/approve`);
  return data;
}

export async function returnDispatch(id: string, reason?: string): Promise<TradeOrderVO> {
  const { data } = await http.post<TradeOrderVO>(`/orders/${id}/dispatch/return`, { reason });
  return data;
}

export async function outflowExecute(id: string, input: OutflowExecuteInput): Promise<TradeOrderVO> {
  const { data } = await http.post<TradeOrderVO>(`/orders/${id}/outflow-execute`, input);
  return data;
}

export async function outflowReturn(id: string, reason?: string): Promise<TradeOrderVO> {
  const { data } = await http.post<TradeOrderVO>(`/orders/${id}/outflow-return`, { reason });
  return data;
}

export async function markException(
  id: string,
  input: { kind: string; reason: string; detail: string },
): Promise<TradeOrderVO> {
  const { data } = await http.post<TradeOrderVO>(`/orders/${id}/exception`, input);
  return data;
}

export async function resolveException(
  id: string,
  action: "restore" | "cancel" | "escalate",
  note?: string,
): Promise<TradeOrderVO> {
  const { data } = await http.post<TradeOrderVO>(`/orders/${id}/exception/resolve`, { action, note });
  return data;
}
