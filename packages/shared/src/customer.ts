/**
 * 客户域共享定义。
 * 按《BV MongoDB 表结构与设计规范》§5.2：持久化只存稳定英文代码，
 * 中文展示文案由前端通过 *Label 映射转换。
 */

/** 客户类型 */
export const CustomerKind = {
  DIRECT: "DIRECT",
  INTERMEDIARY: "INTERMEDIARY",
  SUB_CUSTOMER: "SUB_CUSTOMER",
} as const;
export type CustomerKind = (typeof CustomerKind)[keyof typeof CustomerKind];

export const CustomerKindLabel: Record<CustomerKind, string> = {
  DIRECT: "直客",
  INTERMEDIARY: "中介",
  SUB_CUSTOMER: "中介下级客户",
};

/** 客户生命周期状态（对齐原型：新客户/活跃/沉睡/暂停合作；准入审核后续用独立的 audit_status） */
export const CustomerStatus = {
  NEW: "NEW",
  ACTIVE: "ACTIVE",
  DORMANT: "DORMANT",
  SUSPENDED: "SUSPENDED",
} as const;
export type CustomerStatus = (typeof CustomerStatus)[keyof typeof CustomerStatus];

export const CustomerStatusLabel: Record<CustomerStatus, string> = {
  NEW: "新客户",
  ACTIVE: "活跃",
  DORMANT: "沉睡",
  SUSPENDED: "暂停合作",
};

/** 风险等级 */
export const RiskLevel = {
  PENDING: "PENDING",
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
} as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

export const RiskLevelLabel: Record<RiskLevel, string> = {
  PENDING: "待评估",
  LOW: "低风险",
  MEDIUM: "中风险",
  HIGH: "高风险",
};

/** 地区 */
export const Region = {
  HK: "HK",
  CN_MAINLAND: "CN_MAINLAND",
  SG: "SG",
  OTHER: "OTHER",
} as const;
export type Region = (typeof Region)[keyof typeof Region];

export const RegionLabel: Record<Region, string> = {
  HK: "中国香港",
  CN_MAINLAND: "中国大陆",
  SG: "新加坡",
  OTHER: "其他",
};

/** 中介下级客户主体类型 */
export const CustomerSubType = {
  PERSONAL: "PERSONAL",
  CORPORATE: "CORPORATE",
} as const;
export type CustomerSubType = (typeof CustomerSubType)[keyof typeof CustomerSubType];

export const CustomerSubTypeLabel: Record<CustomerSubType, string> = {
  PERSONAL: "个人 individual",
  CORPORATE: "企业 operation",
};

/** 客户编号规则：20001-29999 的五位数字（沿用现有 BV 业务约定） */
export const CUSTOMER_CODE_MIN = 20001;
export const CUSTOMER_CODE_MAX = 29999;

export function isValidCustomerCode(code: string): boolean {
  if (!/^\d{5}$/.test(code)) return false;
  const value = Number(code);
  return value >= CUSTOMER_CODE_MIN && value <= CUSTOMER_CODE_MAX;
}

/** API 对外的客户视图对象（ObjectId 已序列化为字符串，实体不直接外泄） */
export interface CustomerVO {
  id: string;
  customer_code: string | null;
  name: string;
  customer_kind: CustomerKind;
  parent_id: string | null;
  parent_name: string | null;
  sub_type: CustomerSubType | null;
  region: Region | null;
  agent_name: string | null;
  follow_trader: string | null;
  phone: string | null;
  remark: string | null;
  customer_status: CustomerStatus;
  risk_level: RiskLevel;
  created_at: string;
  updated_at: string;
  /** 列表接口为中介行内联返回的下级客户 */
  sub_customers?: CustomerVO[];
}

/** 客户档案事件类型（审计时间线，规范 §4.6 追加型日志） */
export const CustomerEventType = {
  CREATED: "CREATED",
  PROFILE_UPDATED: "PROFILE_UPDATED",
  STATUS_CHANGED: "STATUS_CHANGED",
  RISK_CHANGED: "RISK_CHANGED",
  KIND_CHANGED: "KIND_CHANGED",
  DELETED: "DELETED",
  /** 业务准入相关事件（提交合规/审核结论），由准入模块写入 */
  ACCESS: "ACCESS",
} as const;
export type CustomerEventType = (typeof CustomerEventType)[keyof typeof CustomerEventType];

export interface CustomerEventVO {
  id: string;
  event_type: CustomerEventType;
  title: string;
  detail: string;
  operator_name: string | null;
  created_at: string;
}

/** 编辑客户请求体（含类型变更：直客⇄中介⇄中介下级） */
export interface UpdateCustomerInput {
  /** 仅写入变更事件的备注（如暂停合作原因），不落客户主档 */
  change_note?: string | null;
  name?: string;
  customer_code?: string | null;
  customer_kind?: CustomerKind;
  parent_id?: string | null;
  sub_type?: CustomerSubType | null;
  region?: Region | null;
  agent_name?: string | null;
  follow_trader?: string | null;
  phone?: string | null;
  remark?: string | null;
  customer_status?: CustomerStatus;
  risk_level?: RiskLevel;
}

/** 新建客户请求体 */
export interface CreateCustomerInput {
  name: string;
  customer_kind: CustomerKind;
  /** 直客/中介必填；中介下级客户可为空（不生成编号） */
  customer_code?: string | null;
  /** customer_kind 为 SUB_CUSTOMER 时必填 */
  parent_id?: string | null;
  sub_type?: CustomerSubType | null;
  region?: Region | null;
  agent_name?: string | null;
  follow_trader?: string | null;
  phone?: string | null;
  remark?: string | null;
}
