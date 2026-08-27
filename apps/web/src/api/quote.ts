import type {
  BenchmarkSnapshotVO,
  BenchmarkStateVO,
  ChannelRateVO,
  FormulaReplaceApplyInput,
  FormulaReplaceMatchVO,
  FormulaReplacePreviewInput,
  QuoteConfigVO,
  QuoteGroupBoardVO,
  QuoteGroupDetailVO,
  QuoteGroupVO,
  QuoteRecordVO,
  QuoteVariablesVO,
  RecalculateResultVO,
  SaveBenchmarksInput,
  UpsertQuoteConfigInput,
} from "@bv/shared";
import { http } from "./http";

/* ---- 平台基准价 / 渠道汇率 ---- */

export async function fetchBenchmarks(): Promise<BenchmarkStateVO> {
  const { data } = await http.get<BenchmarkStateVO>("/quote/benchmarks");
  return data;
}

export async function saveBenchmarks(input: SaveBenchmarksInput): Promise<BenchmarkStateVO> {
  const { data } = await http.put<BenchmarkStateVO>("/quote/benchmarks", input);
  return data;
}

export async function fetchBenchmarkSnapshots(range: {
  from?: string;
  to?: string;
}): Promise<BenchmarkSnapshotVO[]> {
  const { data } = await http.get<BenchmarkSnapshotVO[]>("/quote/benchmark-snapshots", {
    params: range,
  });
  return data;
}

export async function fetchChannelRates(): Promise<ChannelRateVO[]> {
  const { data } = await http.get<ChannelRateVO[]>("/quote/channel-rates");
  return data;
}

/** 从 XE 行情源同步；未配置行情源时 synced=false，仅回读库中现值。
    真实同步成功后服务端会全量刷新引用渠道汇率的报价（refreshed 为刷新汇总）。 */
export async function syncChannelRates(): Promise<{
  synced: boolean;
  rates: ChannelRateVO[];
  refreshed?: { customers: number; items: number };
}> {
  const { data } = await http.post<{
    synced: boolean;
    rates: ChannelRateVO[];
    refreshed?: { customers: number; items: number };
  }>("/quote/channel-rates/sync");
  return data;
}

/* ---- 客户报价配置 ---- */

export async function fetchQuoteConfig(customerId: string): Promise<QuoteConfigVO> {
  const { data } = await http.get<QuoteConfigVO>(`/quote/configs/${customerId}`);
  return data;
}

export async function saveQuoteConfig(
  customerId: string,
  input: UpsertQuoteConfigInput,
): Promise<QuoteConfigVO> {
  const { data } = await http.put<QuoteConfigVO>(`/quote/configs/${customerId}`, input);
  return data;
}

export async function recalculateQuote(customerId: string): Promise<RecalculateResultVO> {
  const { data } = await http.post<RecalculateResultVO>(`/quote/configs/${customerId}/recalculate`);
  return data;
}

export async function fetchQuoteVariables(customerId: string): Promise<QuoteVariablesVO> {
  const { data } = await http.get<QuoteVariablesVO>(`/quote/variables/${customerId}`);
  return data;
}

/* ---- 批量调整公式 ---- */

export async function previewFormulaReplace(
  input: FormulaReplacePreviewInput,
): Promise<FormulaReplaceMatchVO[]> {
  const { data } = await http.post<FormulaReplaceMatchVO[]>("/quote/formula-replace/preview", input);
  return data;
}

export async function applyFormulaReplace(
  input: FormulaReplaceApplyInput,
): Promise<{ customers: number; items: number; errors: string[] }> {
  const { data } = await http.post<{ customers: number; items: number; errors: string[] }>(
    "/quote/formula-replace/apply",
    input,
  );
  return data;
}

/* ---- 往期报价 ---- */

export async function fetchQuoteRecords(query: {
  customer_id: string;
  from?: string;
  to?: string;
}): Promise<QuoteRecordVO[]> {
  const { data } = await http.get<QuoteRecordVO[]>("/quote/records", { params: query });
  return data;
}

/* ---- 报价组 ---- */

export async function fetchQuoteGroups(): Promise<QuoteGroupVO[]> {
  const { data } = await http.get<QuoteGroupVO[]>("/quote/groups");
  return data;
}

export async function createQuoteGroup(name: string): Promise<QuoteGroupVO> {
  const { data } = await http.post<QuoteGroupVO>("/quote/groups", { name });
  return data;
}

export async function fetchQuoteGroupDetail(id: string): Promise<QuoteGroupDetailVO> {
  const { data } = await http.get<QuoteGroupDetailVO>(`/quote/groups/${id}`);
  return data;
}

export async function fetchQuoteGroupBoard(id: string): Promise<QuoteGroupBoardVO> {
  const { data } = await http.get<QuoteGroupBoardVO>(`/quote/groups/${id}/board`);
  return data;
}

export async function renameQuoteGroup(id: string, name: string): Promise<QuoteGroupVO> {
  const { data } = await http.patch<QuoteGroupVO>(`/quote/groups/${id}`, { name });
  return data;
}

export async function deleteQuoteGroup(id: string): Promise<void> {
  await http.delete(`/quote/groups/${id}`);
}

export async function addQuoteGroupMembers(
  id: string,
  customerIds: string[],
): Promise<QuoteGroupDetailVO> {
  const { data } = await http.post<QuoteGroupDetailVO>(`/quote/groups/${id}/members`, {
    customer_ids: customerIds,
  });
  return data;
}

export async function removeQuoteGroupMember(id: string, customerId: string): Promise<void> {
  await http.delete(`/quote/groups/${id}/members/${customerId}`);
}

export async function recalculateQuoteGroup(
  id: string,
): Promise<{ customers: number; items: number; errors: string[] }> {
  const { data } = await http.post<{ customers: number; items: number; errors: string[] }>(
    `/quote/groups/${id}/recalculate`,
  );
  return data;
}

export async function downloadQuoteGroupCsv(id: string, filename: string): Promise<void> {
  const { data } = await http.get<Blob>(`/quote/groups/${id}/export`, { responseType: "blob" });
  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
