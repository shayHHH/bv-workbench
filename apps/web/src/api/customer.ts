import type {
  AuditEventQuery,
  AuditEventVO,
  CreateCustomerInput,
  CustomerEventVO,
  CustomerKind,
  CustomerStatus,
  CustomerVO,
  PageResult,
  UpdateCustomerInput,
} from "@bv/shared";
import { http } from "./http";

export interface CustomerListQuery {
  keyword?: string;
  customer_status?: CustomerStatus;
  customer_kind?: CustomerKind;
  page?: number;
  page_size?: number;
}

export type CustomerPage = PageResult<CustomerVO> & { total_all: number };

export async function fetchCustomers(query: CustomerListQuery): Promise<CustomerPage> {
  const { data } = await http.get<CustomerPage>("/customers", { params: query });
  return data;
}

export async function fetchNextCustomerCode(): Promise<string> {
  const { data } = await http.get<{ customer_code: string }>("/customers/next-code");
  return data.customer_code;
}

export async function createCustomer(input: CreateCustomerInput): Promise<CustomerVO> {
  const { data } = await http.post<CustomerVO>("/customers", input);
  return data;
}

export async function fetchCustomer(id: string): Promise<CustomerVO> {
  const { data } = await http.get<CustomerVO>(`/customers/${id}`);
  return data;
}

export async function fetchCustomerEvents(id: string): Promise<CustomerEventVO[]> {
  const { data } = await http.get<CustomerEventVO[]>(`/customers/${id}/events`);
  return data;
}

/** 审计日志（合规官/管理员）：跨客户的档案事件流水 */
export async function fetchAuditEvents(query: AuditEventQuery): Promise<PageResult<AuditEventVO>> {
  const { data } = await http.get<PageResult<AuditEventVO>>("/audit/events", { params: query });
  return data;
}

export async function updateCustomer(id: string, input: UpdateCustomerInput): Promise<CustomerVO> {
  const { data } = await http.patch<CustomerVO>(`/customers/${id}`, input);
  return data;
}

export async function deleteCustomer(id: string): Promise<void> {
  await http.delete(`/customers/${id}`);
}
