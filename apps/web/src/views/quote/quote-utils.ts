import {
  createItemAwareResolver,
  CustomerVO,
  evaluateFormula,
  type FormulaToken,
  FormulaEvalResult,
  type QuoteMonitorSettingsVO,
  QuoteItemVO,
  QuoteVariablesVO,
  type VariableOptionVO,
  VariableResolver,
  VariableSource,
  VariableSourceLabel,
} from "@bv/shared";
import { ElButton, ElMessageBox } from "element-plus";
import { h } from "vue";
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

/* ---------------- 报价陈旧监测（快速/批量报价复制拦截共用） ---------------- */

/** 一条陈旧变量提示 */
export interface StaleVariable {
  source: VariableSource;
  sourceLabel: string;
  label: string;
  hours: number;
  thresholdHours: number;
}

/** 一条超时报价项（结果时间跨度异常） */
export interface StaleResultItem {
  label: string;
  quotedAt: string | null;
  hours: number;
}

const HOUR_MS = 3_600_000;

function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? ms / HOUR_MS : null;
}

function thresholdOf(source: VariableSource, s: QuoteMonitorSettingsVO): number {
  switch (source) {
    case VariableSource.BENCHMARK:
      return s.benchmark_hours;
    case VariableSource.CHANNEL:
      return s.channel_hours;
    case VariableSource.BROKER_ITEM:
      return s.broker_hours;
    case VariableSource.QUOTE_ITEM:
      return s.quote_item_hours;
  }
}

/**
 * 检测选中报价项引用的变量是否陈旧（场景①）。
 * 遍历每项公式的 var token，按来源查其 updated_at：
 * BENCHMARK/CHANNEL/BROKER_ITEM 取变量快照时间；QUOTE_ITEM 取被引用本客户报价项的 last_quoted_at。
 * 同一变量只报一次，取最旧。
 */
export function detectStaleVariables(
  items: QuoteItemVO[],
  variables: QuoteVariablesVO | null,
  settings: QuoteMonitorSettingsVO,
): StaleVariable[] {
  const byCode: Record<string, VariableOptionVO> = {};
  for (const opt of [
    ...(variables?.benchmarks ?? []),
    ...(variables?.channels ?? []),
    ...(variables?.broker_items ?? []),
  ]) {
    byCode[`${opt.source}:${opt.code}`] = opt;
  }
  const itemById = new Map(items.map(item => [item.id, item]));
  const seen = new Set<string>();
  const result: StaleVariable[] = [];

  for (const item of items) {
    for (const token of item.formula as FormulaToken[]) {
      if (token.type !== "var") continue;
      const key = `${token.source}:${token.code}`;
      if (seen.has(key)) continue;

      let updatedAt: string | null = null;
      if (token.source === VariableSource.QUOTE_ITEM) {
        updatedAt = itemById.get(token.code)?.last_quoted_at ?? null;
      } else {
        updatedAt = byCode[key]?.updated_at ?? null;
      }
      // 无更新时间视为"从未更新"，一律提示（用极大龄期）
      const hours = hoursSince(updatedAt);
      const threshold = thresholdOf(token.source, settings);
      const age = hours === null ? Number.POSITIVE_INFINITY : hours;
      if (age > threshold) {
        seen.add(key);
        result.push({
          source: token.source,
          sourceLabel: VariableSourceLabel[token.source],
          label: token.label,
          hours: age,
          thresholdHours: threshold,
        });
      }
    }
  }
  return result;
}

/** 结果项最小结构（快速报价 QuoteItemVO 与批量看板 QuoteBoardItemVO 通用） */
export interface ResultLike {
  trade_type?: string;
  prefix?: string;
  last_quoted_at: string | null;
}

/** 检测选中报价项的结果生成时间是否超过 T5（场景②） */
export function detectStaleResults(
  items: ReadonlyArray<ResultLike>,
  settings: QuoteMonitorSettingsVO,
): StaleResultItem[] {
  const result: StaleResultItem[] = [];
  for (const item of items) {
    const hours = hoursSince(item.last_quoted_at);
    const age = hours === null ? Number.POSITIVE_INFINITY : hours;
    if (age > settings.result_hours) {
      result.push({
        label: item.trade_type || item.prefix || "报价项",
        quotedAt: item.last_quoted_at,
        hours: age,
      });
    }
  }
  return result;
}

/** 龄期文案：≥24h 显示天，否则小时；无限大显示"从未更新" */
export function formatAge(hours: number): string {
  if (!Number.isFinite(hours)) return "从未更新";
  if (hours >= 24) return `约 ${Math.floor(hours / 24)} 天`;
  if (hours >= 1) return `约 ${Math.floor(hours)} 小时`;
  return "不足 1 小时";
}

/**
 * 平台级变量陈旧检测（批量报价复制场景①的可行子集）。
 * 批量看板不含逐项公式 token，无法精确判定单项引用；此处对全平台共享的
 * 基准价整体（最近保存）与渠道汇率整体（最近更新）做时效校验。
 */
export function detectStalePlatformVariables(
  benchmarkSavedAt: string | null,
  channelUpdatedAt: string | null,
  settings: QuoteMonitorSettingsVO,
): StaleVariable[] {
  const out: StaleVariable[] = [];
  const check = (source: VariableSource, updatedAt: string | null, threshold: number) => {
    const hours = hoursSince(updatedAt);
    const age = hours === null ? Number.POSITIVE_INFINITY : hours;
    if (age > threshold) {
      out.push({
        source,
        sourceLabel: VariableSourceLabel[source],
        label: VariableSourceLabel[source],
        hours: age,
        thresholdHours: threshold,
      });
    }
  };
  check(VariableSource.BENCHMARK, benchmarkSavedAt, settings.benchmark_hours);
  check(VariableSource.CHANNEL, channelUpdatedAt, settings.channel_hours);
  return out;
}

/**
 * 三选一确认框（场景②：刷新并复制 / 仍要复制 / 取消）。
 * ElMessageBox 页脚只支持两个按钮，这里把三枚按钮渲染进消息体，程序化关闭。
 * 文案由调用方（各视图）传入以保持 i18n 归属。
 */
export function confirmThreeWay(opts: {
  title: string;
  lead: string;
  rows: string[];
  primaryText: string;
  secondaryText: string;
  cancelText: string;
}): Promise<"primary" | "secondary" | "cancel"> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (v: "primary" | "secondary" | "cancel") => {
      if (settled) return;
      settled = true;
      resolve(v);
      ElMessageBox.close();
    };
    void ElMessageBox({
      title: opts.title,
      showConfirmButton: false,
      showCancelButton: false,
      showClose: true,
      beforeClose: (_action, _instance, done) => {
        done();
        finish("cancel");
      },
      message: h("div", { class: "monitor-dialog" }, [
        h("p", { class: "monitor-lead" }, opts.lead),
        h(
          "div",
          { class: "monitor-list" },
          opts.rows.map(text => h("div", { class: "monitor-row" }, text)),
        ),
        h("div", { class: "monitor-actions" }, [
          h(ElButton, { onClick: () => finish("cancel") }, () => opts.cancelText),
          h(ElButton, { onClick: () => finish("secondary") }, () => opts.secondaryText),
          h(ElButton, { type: "primary", onClick: () => finish("primary") }, () => opts.primaryText),
        ]),
      ]),
    }).catch(() => finish("cancel"));
  });
}
