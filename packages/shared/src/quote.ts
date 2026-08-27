/**
 * 报价域共享定义 + 公式引擎。
 * 公式不再以 HTML 存储（原型缺陷），统一为结构化 token 数组；
 * 求值器为自研递归下降解析（不使用 Function/eval），前端实时预览与后端落库共用同一实现。
 * 数值以字符串进出（后端持久化 Decimal128），求值过程使用 JS number，
 * 精度受双精度浮点限制（最高 8 位小数的报价场景下可接受，规范 §5.2 的存储约束仍由 Decimal128 满足）。
 */

/** 舍入模式（原型 "45" | "up" | "down"） */
export const RoundMode = {
  HALF_UP: "HALF_UP",
  UP: "UP",
  DOWN: "DOWN",
} as const;
export type RoundMode = (typeof RoundMode)[keyof typeof RoundMode];

export const RoundModeLabel: Record<RoundMode, string> = {
  HALF_UP: "四舍五入",
  UP: "向上",
  DOWN: "向下",
};

/** 公式变量来源 */
export const VariableSource = {
  /** 平台基准价（code = 基准价项 code） */
  BENCHMARK: "BENCHMARK",
  /** 渠道即时汇率（code = 渠道汇率 code） */
  CHANNEL: "CHANNEL",
  /** 绑定中介的报价项结果（code = 中介报价配置项 id） */
  BROKER_ITEM: "BROKER_ITEM",
  /** 本客户已报价结果（code = 本客户报价配置项 id） */
  QUOTE_ITEM: "QUOTE_ITEM",
} as const;
export type VariableSource = (typeof VariableSource)[keyof typeof VariableSource];

export type FormulaOperator = "+" | "-" | "*" | "/" | "(" | ")";
export const FORMULA_OPERATORS: FormulaOperator[] = ["+", "-", "*", "/", "(", ")"];

export type FormulaToken =
  | { type: "num"; value: string }
  | { type: "op"; value: FormulaOperator }
  | { type: "var"; source: VariableSource; code: string; label: string };

/** 报价项配置 */
export interface QuoteItemVO {
  id: string;
  trade_type: string;
  prefix: string;
  suffix: string;
  formula: FormulaToken[];
  /** 中介加点 / BV 加点：目前仅记录展示，不参与计算（对齐原型，见 docs/db/quotes.md） */
  broker_point: string;
  bv_point: string;
  digits: number;
  round_mode: RoundMode;
  /** 是否勾选进对客报价文本 */
  output_checked: boolean;
  last_result: string | null;
  last_quoted_at: string | null;
}

export interface QuoteTextConfigVO {
  opening: string;
  ending: string;
  include_quote_time: boolean;
}

export interface QuoteConfigVO {
  id: string;
  customer_id: string;
  items: QuoteItemVO[];
  text: QuoteTextConfigVO;
  common_notes: string[];
  updated_at: string | null;
}

export interface QuoteItemInput {
  /** 已存在的项传 id，新增项省略 */
  id?: string;
  trade_type: string;
  prefix: string;
  suffix: string;
  formula: FormulaToken[];
  broker_point?: string;
  bv_point?: string;
  digits: number;
  round_mode: RoundMode;
  output_checked?: boolean;
}

export interface UpsertQuoteConfigInput {
  items: QuoteItemInput[];
  text?: QuoteTextConfigVO;
  common_notes?: string[];
}

/** 平台基准价 */
export interface BenchmarkItemVO {
  id: string;
  code: string;
  label: string;
  value: string;
  sort: number;
}

/** 基准价/渠道汇率变动后全量自动刷新的汇总 */
export interface QuoteRefreshSummary {
  customers: number;
  items: number;
}

export interface BenchmarkStateVO {
  items: BenchmarkItemVO[];
  saved_at: string | null;
  operator_name: string | null;
  /** 保存基准价后自动重算的范围（仅保存接口返回） */
  refreshed?: QuoteRefreshSummary;
}

export interface SaveBenchmarksInput {
  items: { id?: string; code?: string; label: string; value: string }[];
}

export interface BenchmarkSnapshotVO {
  id: string;
  saved_at: string;
  operator_name: string;
  prices: { label: string; value: string }[];
}

/** 渠道即时汇率 */
export interface ChannelRateVO {
  id: string;
  code: string;
  label: string;
  value: string;
  sort: number;
  updated_at: string | null;
}

/** 报价组 */
export interface QuoteGroupVO {
  id: string;
  name: string;
  customer_count: number;
}

export interface QuoteGroupMemberVO {
  customer_id: string;
  name: string;
  customer_code: string | null;
  broker_label: string | null;
}

export interface QuoteGroupDetailVO {
  id: string;
  name: string;
  members: QuoteGroupMemberVO[];
}

/** 批量报价看板（组内成员及其报价项现值，一次接口取全） */
export interface QuoteBoardItemVO {
  id: string;
  trade_type: string;
  prefix: string;
  suffix: string;
  formula_text: string;
  result: string | null;
  last_quoted_at: string | null;
  output_checked: boolean;
}

export interface QuoteGroupBoardMemberVO {
  customer_id: string;
  name: string;
  customer_code: string | null;
  broker_label: string | null;
  last_quoted_at: string | null;
  items: QuoteBoardItemVO[];
}

export interface QuoteGroupBoardVO {
  id: string;
  name: string;
  members: QuoteGroupBoardMemberVO[];
}

/** 重算结果：更新后的配置 + 逐项错误 */
export interface RecalculateResultVO {
  config: QuoteConfigVO;
  errors: { item_id: string; error: string }[];
}

/** 报价历史记录（每次计算、每个报价项一条） */
export interface QuoteRecordVO {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_code: string | null;
  broker_label: string | null;
  trade_type: string;
  prefix: string;
  suffix: string;
  formula_text: string;
  formula_calc: string;
  variables: { label: string; value: string }[];
  result: string;
  broker_point: string;
  bv_point: string;
  digits: number;
  round_mode: RoundMode;
  quoted_at: string;
  operator_name: string;
}

/** 变量选择器 / 客户端求值用的变量取值 */
export interface VariableOptionVO {
  source: VariableSource;
  code: string;
  label: string;
  value: string | null;
}

export interface QuoteVariablesVO {
  benchmarks: VariableOptionVO[];
  channels: VariableOptionVO[];
  /** 该客户绑定中介的报价项结果；未绑定中介为空数组 */
  broker_items: VariableOptionVO[];
}

/** 批量调整公式 */
export interface FormulaReplacePreviewInput {
  search: string;
  replace: string;
  customer_keyword?: string;
}

export const FormulaReplaceStatus = {
  OK: "OK",
  NEED_REPLACE: "NEED_REPLACE",
  INVALID: "INVALID",
} as const;
export type FormulaReplaceStatus =
  (typeof FormulaReplaceStatus)[keyof typeof FormulaReplaceStatus];

export interface FormulaReplaceMatchVO {
  customer_id: string;
  customer_name: string;
  customer_code: string | null;
  item_id: string;
  trade_type: string;
  prefix: string;
  current_formula: string;
  next_formula: string | null;
  current_result: string | null;
  next_result: string | null;
  status: FormulaReplaceStatus;
  error: string | null;
}

export interface FormulaReplaceApplyInput {
  search: string;
  replace: string;
  targets: { customer_id: string; item_id: string }[];
}

export const QUOTE_NOTES_MAX = 8;
export const QUOTE_DIGITS_MAX = 8;

/* ------------------------------------------------------------------ */
/* 公式引擎                                                            */
/* ------------------------------------------------------------------ */

export interface FormulaEvalResult {
  ok: boolean;
  /** 舍入后的结果字符串（ok 时有值） */
  value: string | null;
  /** 舍入前的原始数值 */
  raw: number | null;
  error: string | null;
}

export type VariableResolver = (token: Extract<FormulaToken, { type: "var" }>) => number | null;

/** token 数组 → 展示文本（变量渲染为 label） */
export function formulaToText(tokens: FormulaToken[]): string {
  return tokens
    .map(t => (t.type === "var" ? t.label : t.value))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** token 数组 → 变量代入数值后的算式文本（formulaCalc） */
export function formulaToCalcText(tokens: FormulaToken[], resolve: VariableResolver): string {
  return tokens
    .map(t => {
      if (t.type !== "var") return t.value;
      const v = resolve(t);
      return v === null ? `?${t.label}?` : formatVariableValue(v);
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 校验数字字面量 */
export function isNumericLiteral(text: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(text);
}

/**
 * 求值：递归下降解析 + - * / 与括号（不使用 eval/Function）。
 * 变量取值失败、语法错误、非法结果均返回 ok:false 与中文错误信息。
 */
export function evaluateFormula(
  tokens: FormulaToken[],
  resolve: VariableResolver,
  digits: number,
  roundMode: RoundMode,
): FormulaEvalResult {
  if (!tokens.length) return fail("公式不能为空");

  /* 先把 token 展开成数值/运算符序列 */
  const seq: (number | FormulaOperator)[] = [];
  for (const token of tokens) {
    if (token.type === "op") {
      seq.push(token.value);
    } else if (token.type === "num") {
      if (!isNumericLiteral(token.value)) return fail(`数字 "${token.value}" 不合法`);
      seq.push(Number(token.value));
    } else {
      const value = resolve(token);
      if (value === null || !Number.isFinite(value)) {
        return fail(`变量「${token.label}」暂无取值`);
      }
      seq.push(value);
    }
  }

  let pos = 0;
  const peek = () => seq[pos];
  const next = () => seq[pos++];

  function parseExpression(): number {
    let left = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = next();
      const right = parseFactor();
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }

  function parseFactor(): number {
    const token = peek();
    if (token === "(") {
      next();
      const inner = parseExpression();
      if (peek() !== ")") throw new Error("括号不匹配");
      next();
      return inner;
    }
    /* 一元正负号 */
    if (token === "+" || token === "-") {
      next();
      return token === "-" ? -parseFactor() : parseFactor();
    }
    if (typeof token !== "number") throw new Error("公式不完整");
    next();
    return token;
  }

  let raw: number;
  try {
    raw = parseExpression();
    if (pos !== seq.length) throw new Error("公式语法不正确");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "公式语法不正确");
  }
  if (!Number.isFinite(raw)) return fail("计算结果非法");

  return { ok: true, raw, value: applyRounding(raw, digits, roundMode), error: null };
}

function fail(error: string): FormulaEvalResult {
  return { ok: false, value: null, raw: null, error };
}

/** 按保留位数与舍入模式得到结果字符串 */
export function applyRounding(value: number, digits: number, mode: RoundMode): string {
  const d = Math.min(Math.max(Math.trunc(digits) || 0, 0), QUOTE_DIGITS_MAX);
  const scale = 10 ** d;
  /* 1e-9 相对量级修正，规避二进制浮点导致的 2.0000000001 向上取整 */
  const epsilon = Math.abs(value) * 1e-12 + 1e-12;
  let scaled: number;
  if (mode === RoundMode.UP) scaled = Math.ceil(value * scale - epsilon * scale);
  else if (mode === RoundMode.DOWN) scaled = Math.floor(value * scale + epsilon * scale);
  else scaled = Math.round(value * scale);
  return (scaled / scale).toFixed(d);
}

/** 变量数值展示格式（对齐原型 formatRateValue） */
export function formatVariableValue(value: number): string {
  const abs = Math.abs(value);
  let text: string;
  if (abs >= 1000) text = value.toFixed(2);
  else if (abs < 0.001) text = value.toFixed(7);
  else text = value.toFixed(value >= 10 ? 4 : 7);
  return text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/**
 * 构造带循环引用保护的变量解析器。
 * QUOTE_ITEM / BROKER_ITEM 变量引用其它报价项，递归求值其公式；
 * 环路时返回 null（上层报「变量暂无取值」）。
 */
export function createItemAwareResolver(options: {
  /** BENCHMARK/CHANNEL 变量：code -> 数值 */
  lookup: (source: VariableSource, code: string) => number | null;
  /** QUOTE_ITEM 变量：item id -> 该项（本客户内） */
  getOwnItem: (id: string) => QuoteItemVO | null;
  /** BROKER_ITEM 变量：item id -> 中介报价项已计算结果 */
  getBrokerItemResult: (id: string) => number | null;
}): VariableResolver {
  const stack = new Set<string>();
  const resolver: VariableResolver = token => {
    if (token.source === VariableSource.QUOTE_ITEM) {
      const item = options.getOwnItem(token.code);
      if (!item) return null;
      if (stack.has(token.code)) return null; // 循环引用
      stack.add(token.code);
      const result = evaluateFormula(item.formula, resolver, item.digits, item.round_mode);
      stack.delete(token.code);
      return result.ok ? Number(result.value) : null;
    }
    if (token.source === VariableSource.BROKER_ITEM) {
      return options.getBrokerItemResult(token.code);
    }
    return options.lookup(token.source, token.code);
  };
  return resolver;
}
