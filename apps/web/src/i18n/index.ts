import * as OpenCC from "opencc-js";
import { createI18n } from "vue-i18n";
import zhCN from "./locales/zh-CN";

/**
 * 国际化：默认简体中文，顶栏可切换繁体。
 * 繁体语言包由 opencc-js 在启动时从简体自动派生（避免两份文案漂移）；
 * 个别需要台/港习惯用语而非逐字转换的词条在 TW_OVERRIDES 覆盖。
 * 初始语言：localStorage 记忆 > 浏览器/系统语言（zh-TW/zh-HK/zh-Hant 判为繁体）。
 */
export type AppLocale = "zh-CN" | "zh-TW";

const STORAGE_KEY = "bv-locale";

/** key 为语言包扁平路径（点号分隔），值为繁体覆盖文案 */
const TW_OVERRIDES: Record<string, string> = {
  "quote.quick.copySuccess": "報價文本已成功複製到剪貼簿",
};

const openccConvert = OpenCC.Converter({ from: "cn", to: "tw" });
/* OpenCC 的 tw 标准偏好「臺」，本业务的繁体习惯（对齐原型）用「台」 */
const toTraditional = (text: string) => openccConvert(text).replace(/臺/g, "台");

function convertMessages(node: unknown, path: string): unknown {
  if (typeof node === "string") return TW_OVERRIDES[path] ?? toTraditional(node);
  if (Array.isArray(node)) return node.map((item, i) => convertMessages(item, `${path}[${i}]`));
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([key, value]) => [
        key,
        convertMessages(value, path ? `${path}.${key}` : key),
      ]),
    );
  }
  return node;
}

const zhTW = convertMessages(zhCN, "") as typeof zhCN;

function detectLocale(): AppLocale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "zh-CN" || saved === "zh-TW") return saved;
  } catch {
    /* localStorage 不可用时走语言探测 */
  }
  const lang = navigator.language || "";
  if (/^zh\b/i.test(lang) && /(TW|HK|MO|Hant)/i.test(lang)) return "zh-TW";
  return "zh-CN";
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: "zh-CN",
  messages: { "zh-CN": zhCN, "zh-TW": zhTW },
});

/**
 * 简体原文 → 当前语言展示文本。
 * 用于不适合抽 key 的场景：router meta.title、@bv/shared 的 *Label 枚举映射等
 * "多处定义的简体常量"，繁体下经 opencc 转换（含「臺→台」回替），简体下原样返回。
 * 在模板/computed 中调用会因读取 locale ref 而自动响应语言切换。
 * 注意：仅用于系统文案常量，禁止对用户数据（客户名等）调用。
 */
export function localizeText(text: string): string {
  return i18n.global.locale.value === "zh-TW" ? toTraditional(text) : text;
}

export function setLocale(locale: AppLocale): void {
  i18n.global.locale.value = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* 忽略隐私模式下的写入失败 */
  }
  document.documentElement.setAttribute("lang", locale);
}
