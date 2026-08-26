import { FormulaOperator, FormulaToken, VariableSource } from "@bv/shared";

/**
 * 批量调整公式用的文本 ⇄ token 工具。
 * 约束对齐原型：搜索/替换片段仅支持「平台基准价、渠道汇率变量 + 数字 + 运算符」；
 * 匹配在 token 级完成（数字按完整 token 比对，天然满足“完整数字匹配”）。
 */

export interface FormulaAlias {
  source: VariableSource;
  code: string;
  label: string;
}

/** Mongo 里存的 token 子文档（未用字段为 null）→ 结构化 token */
export function rawToToken(raw: Record<string, unknown>): FormulaToken {
  if (raw.type === "num") return { type: "num", value: String(raw.value ?? "") };
  if (raw.type === "op") return { type: "op", value: String(raw.value ?? "") as FormulaOperator };
  return {
    type: "var",
    source: raw.source as VariableSource,
    code: String(raw.code ?? ""),
    label: String(raw.label ?? ""),
  };
}

/** 归一化：去空白、全角→半角、常见繁体→简体、统一运算符、转小写 */
export function normalizeFormulaText(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/：/g, ":")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/價/g, "价")
    .replace(/報/g, "报")
    .replace(/幣/g, "币")
    .replace(/匯/g, "汇")
    .toLowerCase();
}

const OPERATORS = new Set<string>(["+", "-", "*", "/", "(", ")"]);

/**
 * 文本 → token。别名按归一化后长度降序做最长匹配；
 * 解析失败抛 Error（携带中文提示，调用方转为状态/异常）。
 */
export function parseFormulaText(text: string, aliases: FormulaAlias[]): FormulaToken[] {
  const source = normalizeFormulaText(text);
  if (!source) throw new Error("公式片段不能为空");
  const sorted = aliases
    .map(alias => ({ alias, keys: [normalizeFormulaText(alias.label), normalizeFormulaText(alias.code)] }))
    .flatMap(({ alias, keys }) => keys.filter(Boolean).map(key => ({ alias, key })))
    .sort((a, b) => b.key.length - a.key.length);

  const tokens: FormulaToken[] = [];
  let pos = 0;
  while (pos < source.length) {
    const char = source[pos];
    if (OPERATORS.has(char)) {
      tokens.push({ type: "op", value: char as FormulaOperator });
      pos += 1;
      continue;
    }
    const numMatch = /^\d+(?:\.\d+)?/.exec(source.slice(pos));
    if (numMatch) {
      tokens.push({ type: "num", value: numMatch[0] });
      pos += numMatch[0].length;
      continue;
    }
    const hit = sorted.find(({ key }) => source.startsWith(key, pos));
    if (!hit) {
      throw new Error("只支持平台基准价、渠道汇率变量、数字与 + - * / ( )");
    }
    tokens.push({
      type: "var",
      source: hit.alias.source,
      code: hit.alias.code,
      label: hit.alias.label,
    });
    pos += hit.key.length;
  }
  const last = tokens[tokens.length - 1];
  if (last && last.type === "op" && last.value !== ")") {
    throw new Error("公式片段末尾不能是运算符");
  }
  return tokens;
}

function tokenEquals(a: FormulaToken, b: FormulaToken): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "num" && b.type === "num") return Number(a.value) === Number(b.value);
  if (a.type === "op" && b.type === "op") return a.value === b.value;
  if (a.type === "var" && b.type === "var") return a.source === b.source && a.code === b.code;
  return false;
}

/** 在 haystack 中查找连续 token 子序列，返回起始下标（未命中 -1） */
export function findTokenSubsequence(haystack: FormulaToken[], needle: FormulaToken[]): number {
  if (!needle.length || needle.length > haystack.length) return -1;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (!tokenEquals(haystack[i + j], needle[j])) continue outer;
    }
    return i;
  }
  return -1;
}

/** 替换首个命中的子序列，返回新数组（未命中返回 null） */
export function replaceTokenSubsequence(
  haystack: FormulaToken[],
  needle: FormulaToken[],
  replacement: FormulaToken[],
): FormulaToken[] | null {
  const index = findTokenSubsequence(haystack, needle);
  if (index < 0) return null;
  return [...haystack.slice(0, index), ...replacement, ...haystack.slice(index + needle.length)];
}
