import { i18n } from "@/i18n";

const t = (key: string, params?: Record<string, unknown>) =>
  params ? i18n.global.t(key, params) : i18n.global.t(key);

/** 相对时间展示，对齐原型的"刚刚 / 今天 09:12 / 昨天 / 08-21"（文案走语言包） */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 60_000) return t("common.time.justNow");
  if (diffMs < 3_600_000) return t("common.time.minutesAgo", { n: Math.floor(diffMs / 60_000) });
  const sameDay = date.toDateString() === now.toDateString();
  const hhmm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (sameDay) return t("common.time.todayAt", { time: hhmm });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return t("common.time.yesterdayAt", { time: hhmm });
  const md = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return date.getFullYear() === now.getFullYear() ? md : `${date.getFullYear()}-${md}`;
}

/** 纯日期 YYYY-MM-DD（本地时区） */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}
