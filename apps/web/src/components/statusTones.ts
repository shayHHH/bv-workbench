/**
 * 全站「状态 → 标签色」总表（前端统一化）：同一状态全站同一颜色。
 * 页面不要再各自维护 tag 色 map，一律从这里取；新增枚举值时只改此处。
 */
import type {
  AccessStatus,
  ApplicationMaterialStatus,
  CustomerStatus,
  DispatchStatus,
  ReviewAuditType,
  ReviewFinalResult,
  TradeOrderStatus,
} from "@bv/shared";

export type TagTone = "primary" | "success" | "warning" | "danger" | "info";

/** 准入申请状态 */
export const ACCESS_STATUS_TONE: Record<AccessStatus, TagTone> = {
  DRAFT: "info",
  PENDING_REVIEW: "primary",
  SUPPLEMENT_REQUIRED: "warning",
  REJECTED: "danger",
  APPROVED: "success",
  APPROVED_CONDITIONAL: "warning",
  DEFERRAL_OVERDUE: "danger",
  EXPIRED: "info",
  SUSPENDED: "info",
  CANCELLED: "info",
};

/** 交易订单主线状态 */
export const ORDER_STATUS_TONE: Record<TradeOrderStatus, TagTone> = {
  PENDING_KYC: "info",
  AWAITING_INFLOW: "warning",
  AWAITING_DISPATCH: "primary",
  DISPATCH_REVIEW: "info",
  AWAITING_PAYOUT: "warning",
  COMPLETED: "success",
  CANCELLED: "info",
};

/** 客户主档状态 */
export const CUSTOMER_STATUS_TONE: Record<CustomerStatus, TagTone> = {
  NEW: "primary",
  ACTIVE: "success",
  DORMANT: "warning",
  SUSPENDED: "info",
};

/** 合规工单最终结论 */
export const REVIEW_FINAL_TONE: Record<ReviewFinalResult, TagTone> = {
  APPROVED: "success",
  APPROVED_CONDITIONAL: "warning",
  UNRESOLVED: "warning",
  TERMINATED: "info",
};

/** 合规工单审核类型 */
export const REVIEW_AUDIT_TONE: Record<ReviewAuditType, TagTone> = {
  NEW: "primary",
  RESUBMIT: "warning",
  DEFERRAL_REVIEW: "success",
};

/** 申请材料状态 */
export const MATERIAL_STATUS_TONE: Record<ApplicationMaterialStatus, TagTone> = {
  PENDING: "info",
  ACCEPTED: "success",
  RETURNED: "danger",
};

/** 出款排单状态 */
export const DISPATCH_STATUS_TONE: Record<DispatchStatus, TagTone> = {
  REVIEWING: "info",
  AWAITING_PAYOUT: "warning",
  PAID: "success",
  VOID: "info",
};
