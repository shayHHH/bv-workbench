import {
  createItemAwareResolver,
  CustomerVO,
  evaluateFormula,
  FormulaEvalResult,
  QuoteItemVO,
  QuoteVariablesVO,
  VariableResolver,
  VariableSource,
} from "@bv/shared";
import { fetchCustomers } from "@/api/customer";

/** 报价页客户选项（来自客户主档，中介行内联的下级客户拍平） */
export interface QuoteCustomerOption {
  id: string;
  name: string;
  customer_code: string | null;
  /** 「中介名 - 中介编号」；直客/中介本身为 null */
  broker_label: string | null;
  remark: string | null;
}

export function customerDisplayLabel(option: {
  name: string;
  customer_code: string | null;
}): string {
  return option.customer_code ? `${option.name} (${option.customer_code})` : option.name;
}

/**
 * 全量客户（含中介下级）。当前业务量单页可取全；客户量超过 100 时需要
 * 后端提供专用的轻量列表接口（见 docs/db/quotes.md 演进预留）。
 */
export async function fetchAllQuoteCustomers(): Promise<QuoteCustomerOption[]> {
  const page = await fetchCustomers({ page: 1, page_size: 100 });
  const options: QuoteCustomerOption[] = [];
  const push = (customer: CustomerVO, brokerLabel: string | null) => {
    options.push({
      id: customer.id,
      name: customer.name,
      customer_code: customer.customer_code,
      broker_label: brokerLabel,
      remark: customer.remark,
    });
  };
  for (const customer of page.items) {
    push(customer, null);
    for (const sub of customer.sub_customers ?? []) {
      push(sub, `${customer.name} - ${customer.customer_code ?? "-"}`);
    }
  }
  return options;
}

/** 客户模糊匹配（对齐原型：名称/编号包含 + 顺序子序列） */
export function matchCustomers(
  options: QuoteCustomerOption[],
  query: string,
  limit: number,
): QuoteCustomerOption[] {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, "");
  if (!normalized) return options.slice(0, limit);
  const scored = options
    .map(option => {
      const label = customerDisplayLabel(option).toLowerCase().replace(/\s+/g, "");
      const code = option.customer_code ?? "";
      let score = -1;
      if (label.includes(normalized) || code.includes(normalized)) {
        score = label.startsWith(normalized) || code.startsWith(normalized) ? 0 : 1;
      } else if (isSubsequence(normalized, label)) {
        score = 2;
      }
      return { option, score };
    })
    .filter(entry => entry.score >= 0)
    .sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map(entry => entry.option);
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const char of haystack) {
    if (char === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return false;
}

/** 前端实时求值：与后端共用 @bv/shared 求值器，仅变量取值来自已拉取的快照 */
export function buildClientResolver(
  variables: QuoteVariablesVO | null,
  items: () => QuoteItemVO[],
): VariableResolver {
  const numberMaps: Record<string, Map<string, number>> = {
    [VariableSource.BENCHMARK]: toNumberMap(variables?.benchmarks ?? []),
    [VariableSource.CHANNEL]: toNumberMap(variables?.channels ?? []),
  };
  const brokerMap = toNumberMap(variables?.broker_items ?? []);
  return createItemAwareResolver({
    lookup: (source, code) => numberMaps[source]?.get(code) ?? null,
    getOwnItem: id => items().find(item => item.id === id) ?? null,
    getBrokerItemResult: id => brokerMap.get(id) ?? null,
  });
}

function toNumberMap(options: { code: string; value: string | null }[]): Map<string, number> {
  return new Map(
    options
      .filter(option => option.value !== null && option.value !== "")
      .map(option => [option.code, Number(option.value)]),
  );
}

export function evalItem(item: QuoteItemVO, resolver: VariableResolver): FormulaEvalResult {
  return evaluateFormula(item.formula, resolver, item.digits, item.round_mode);
}

/** 原型风格时间：YYYY/MM/DD HH:mm:ss */
export function formatQuoteTime(iso: string | Date | null | undefined): string {
  if (!iso) return "-";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${p(date.getMonth() + 1)}/${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/** 本地日界（东八区使用者本机时区）→ ISO 区间，供按日过滤历史 */
export function localDayRange(dateText: string): { from: string; to: string } {
  const start = new Date(`${dateText}T00:00:00`);
  const end = new Date(`${dateText}T23:59:59.999`);
  return { from: start.toISOString(), to: end.toISOString() };
}
