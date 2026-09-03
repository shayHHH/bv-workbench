/**
 * 业务准入域共享定义（KYC 材料清单配置 / 准入申请 / 合规审核工单）。
 * 交互与结构以 demo（bv-workbench-go/index.html + app.js）为准，PRD §4.7-4.10 仅作背景；
 * 持久化只存稳定英文代码，中文展示走 *Label 映射（规范 §5.2）。
 */

/* ---------------- KYC 材料清单配置（demo 四层：业务类型 → 渠道 → 材料模块 → 材料项） ---------------- */

/** 材料项类型 */
export const KycItemType = {
  FILE: "FILE",
  TEXT: "TEXT",
  BANK_ACCOUNT: "BANK_ACCOUNT",
} as const;
export type KycItemType = (typeof KycItemType)[keyof typeof KycItemType];

export const KycItemTypeLabel: Record<KycItemType, string> = {
  FILE: "文件",
  TEXT: "文本",
  BANK_ACCOUNT: "银行账户",
};

/** 配置状态：保存后为草稿，发布后才被材料上传页引用 */
export const KycScenarioStatus = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
} as const;
export type KycScenarioStatus = (typeof KycScenarioStatus)[keyof typeof KycScenarioStatus];

export const KycScenarioStatusLabel: Record<KycScenarioStatus, string> = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
};

/** 材料有效期要求（demo：无 / 1 个月内 / 3 个月内） */
export const KycItemValidity = {
  NONE: "NONE",
  ONE_MONTH: "ONE_MONTH",
  THREE_MONTHS: "THREE_MONTHS",
} as const;
export type KycItemValidity = (typeof KycItemValidity)[keyof typeof KycItemValidity];

export const KycItemValidityLabel: Record<KycItemValidity, string> = {
  NONE: "无有效期限制",
  ONE_MONTH: "需 1 个月内有效",
  THREE_MONTHS: "需 3 个月内有效",
};

/** 渠道标识颜色（demo 渠道 Matrix 主题色） */
export const KycChannelTheme = {
  RED: "red",
  BLUE: "blue",
  TEAL: "teal",
  AMBER: "amber",
} as const;
export type KycChannelTheme = (typeof KycChannelTheme)[keyof typeof KycChannelTheme];

export const KycChannelThemeLabel: Record<KycChannelTheme, string> = {
  red: "红色",
  blue: "蓝色",
  teal: "青绿色",
  amber: "琥珀色",
};

/** 渠道限制条目（demo：银行禁令 / 特殊证明要求） */
export const KycRestrictionType = {
  BANK_BAN: "bank_ban",
  SPECIAL_PROOF: "special_proof",
} as const;
export type KycRestrictionType = (typeof KycRestrictionType)[keyof typeof KycRestrictionType];

export interface KycRestriction {
  type: KycRestrictionType;
  content: string;
}

export interface KycItem {
  /** 场景内稳定 ID（提交后材料关联、退回指定都引用它） */
  item_id: string;
  item_name: string;
  /** 补充要求（demo 的 subRequirement） */
  item_description: string | null;
  item_type: KycItemType;
  required: boolean;
  validity: KycItemValidity;
}

export interface KycSection {
  section_name: string;
  items: KycItem[];
}

/** 渠道：demo 口径下每个渠道持有独立的材料模块清单 */
export interface KycChannel {
  channel_code: string;
  channel_name: string;
  theme: KycChannelTheme;
  restrictions: KycRestriction[];
  sections: KycSection[];
}

export interface KycScenarioVO {
  id: string;
  scenario_code: string;
  scenario_name: string;
  /** 业务流程与约束说明（材料上传页"业务审核要点"、审核详情"人工审核要求"引用） */
  process_description: string | null;
  status: KycScenarioStatus;
  is_builtin: boolean;
  channels: KycChannel[];
  published_at: string | null;
  updated_at: string;
}

export interface SaveKycScenarioInput {
  scenario_code: string;
  scenario_name: string;
  process_description?: string | null;
  channels: KycChannel[];
}

/* ---------------- 准入申请（客户 × 业务类型 × 渠道，PRD §5.2 状态机） ---------------- */

export const AccessStatus = {
  DRAFT: "DRAFT",
  PENDING_REVIEW: "PENDING_REVIEW",
  SUPPLEMENT_REQUIRED: "SUPPLEMENT_REQUIRED",
  REJECTED: "REJECTED",
  APPROVED: "APPROVED",
  /** 条件性放行：核心材料无误、辅助材料延期补件（带截止时间与临时限制） */
  APPROVED_CONDITIONAL: "APPROVED_CONDITIONAL",
  /** 延期补件逾期：超过截止时间仍未补齐，业务受限直至合规复核 */
  DEFERRAL_OVERDUE: "DEFERRAL_OVERDUE",
  EXPIRED: "EXPIRED",
  SUSPENDED: "SUSPENDED",
  CANCELLED: "CANCELLED",
} as const;
export type AccessStatus = (typeof AccessStatus)[keyof typeof AccessStatus];

/**
 * demo 八态与结论语义：合规「驳回」→ 被驳回（补件回路）；合规「终止」→ 审核拒绝（可重新发起）；
 * 已过期/已暂停沿用 demo：仅展示，无自动引擎。
 */
export const AccessStatusLabel: Record<AccessStatus, string> = {
  DRAFT: "草稿",
  PENDING_REVIEW: "待审核",
  SUPPLEMENT_REQUIRED: "被驳回",
  REJECTED: "审核拒绝",
  APPROVED: "审核通过",
  APPROVED_CONDITIONAL: "附条件通过",
  DEFERRAL_OVERDUE: "逾期受限",
  EXPIRED: "已过期",
  SUSPENDED: "已暂停",
  CANCELLED: "已取消",
};

/** demo 工单列表的状态说明文案（materialStatusFlow.desc） */
export const AccessStatusDesc: Record<AccessStatus, string> = {
  DRAFT: "草稿已保存，还未提交审核",
  PENDING_REVIEW: "材料已提交，等待合规官审核",
  SUPPLEMENT_REQUIRED: "审核被驳回，需补充/修改材料后重新上传",
  REJECTED: "合规明确拒绝该业务准入",
  APPROVED: "合规审核已通过",
  APPROVED_CONDITIONAL: "条件性放行，需在截止时间前补齐缺失材料",
  DEFERRAL_OVERDUE: "延期补件已逾期，业务受限，补齐材料并经合规复核后恢复",
  EXPIRED: "曾经通过，有效期过期，需重新提交",
  SUSPENDED: "风控或人工暂停该业务准入",
  CANCELLED: "申请已取消或作废",
};

/** 提交模式（demo 底部提交坞三选一中的两个合规通道；材料库归档不生成工单） */
export const ReviewType = {
  FX: "FX",
  USDT: "USDT",
} as const;
export type ReviewType = (typeof ReviewType)[keyof typeof ReviewType];

export const ReviewTypeLabel: Record<ReviewType, string> = {
  FX: "找换",
  USDT: "U相关",
};

/** 材料来源（PRD §6.2） */
export const MaterialSource = {
  LOCAL_UPLOAD: "LOCAL_UPLOAD",
  LIBRARY: "LIBRARY",
  SYSTEM: "SYSTEM",
} as const;
export type MaterialSource = (typeof MaterialSource)[keyof typeof MaterialSource];

export const MaterialSourceLabel: Record<MaterialSource, string> = {
  LOCAL_UPLOAD: "本地上传",
  LIBRARY: "材料库复用",
  SYSTEM: "系统生成",
};

/** 申请内单份材料的审核状态 */
export const ApplicationMaterialStatus = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  RETURNED: "RETURNED",
} as const;
export type ApplicationMaterialStatus =
  (typeof ApplicationMaterialStatus)[keyof typeof ApplicationMaterialStatus];

export const ApplicationMaterialStatusLabel: Record<ApplicationMaterialStatus, string> = {
  PENDING: "待检查",
  ACCEPTED: "已通过",
  RETURNED: "被退回",
};

/** 上传文件引用（对象存储 key + 原始元数据；预览走 /api/files 鉴权流） */
export interface FileRef {
  storage_key: string;
  original_name: string;
  mime_type: string;
  size: number;
}

export interface ApplicationMaterialVO {
  /** 申请内唯一 key（前端生成 uuid），审核退回按它定位 */
  material_key: string;
  /** 关联的 KYC 材料项 item_id；未关联为 null */
  requirement_item_id: string | null;
  name: string;
  source: MaterialSource;
  file: FileRef | null;
  /** 来源为材料库复用时指向 customer_materials */
  library_material_id: string | null;
  status: ApplicationMaterialStatus;
  return_reason: string | null;
  uploaded_at: string;
}

export interface ApplicationFormVO {
  customer_cn_name: string | null;
  customer_en_name: string | null;
  business_note: string | null;
}

/** 申请时间线条目（规范 §4.5：每步有操作人/动作/前后状态） */
export interface AccessTimelineVO {
  at: string;
  by_name: string | null;
  action: string;
  from_status: AccessStatus | null;
  to_status: AccessStatus;
  note: string | null;
}

export interface AccessCompletenessVO {
  done: number;
  total: number;
}

export interface AccessApplicationVO {
  id: string;
  application_no: string;
  customer_id: string;
  /** 提交时客户快照（规范 §4.5，审核还原当时输入） */
  customer_snapshot: {
    name: string;
    customer_code: string | null;
    customer_kind: string;
    customer_sub_type: string | null;
  };
  scenario_id: string | null;
  scenario_code: string | null;
  scenario_name: string | null;
  channel_code: string | null;
  channel_name: string | null;
  /** 提交模式（找换/U相关）；草稿期为空，提交时写入 */
  review_type: ReviewType | null;
  form: ApplicationFormVO;
  materials: ApplicationMaterialVO[];
  status: AccessStatus;
  /** 必填材料完整度（按所选渠道适用项计算） */
  completeness: AccessCompletenessVO;
  owner_name: string | null;
  /** 最近一次合规结论摘要（补件处理页展示驳回原因） */
  latest_review: {
    case_id: string;
    action: ReviewDecisionAction;
    reason: string | null;
    rejected_item_ids: string[];
    reviewed_at: string;
    reviewer_name: string | null;
  } | null;
  timeline: AccessTimelineVO[];
  /** 条件性放行的延期补件设置（无则 null） */
  deferral: AccessDeferralVO | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateApplicationInput {
  customer_id: string;
}

export interface SubmitApplicationInput {
  /** 提交模式：找换 / U相关（demo 底部提交坞选择） */
  review_type: ReviewType;
}

export interface SaveApplicationDraftInput {
  scenario_id?: string | null;
  channel_code?: string | null;
  form?: Partial<ApplicationFormVO>;
  materials?: Array<{
    material_key: string;
    requirement_item_id?: string | null;
    name: string;
    source: MaterialSource;
    file?: FileRef | null;
    library_material_id?: string | null;
  }>;
}

/* ---------------- 客户材料库 ---------------- */

export interface CustomerMaterialVO {
  id: string;
  customer_id: string;
  name: string;
  /** 归档时关联的材料项名称（展示用途） */
  category: string | null;
  file: FileRef;
  version: number;
  uploader_name: string | null;
  created_at: string;
}

export interface ArchiveMaterialsInput {
  items: Array<{ name: string; category?: string | null; file: FileRef }>;
}

/* ---------------- 合规审核工单（PRD §4.8/4.9/6.4；追加型，每次提交新增一条） ---------------- */

export const ReviewAuditType = {
  NEW: "NEW",
  RESUBMIT: "RESUBMIT",
  /** 条件性放行后的延期补件重提 */
  DEFERRAL_REVIEW: "DEFERRAL_REVIEW",
} as const;
export type ReviewAuditType = (typeof ReviewAuditType)[keyof typeof ReviewAuditType];

export const ReviewAuditTypeLabel: Record<ReviewAuditType, string> = {
  NEW: "新提交",
  RESUBMIT: "驳回重审",
  DEFERRAL_REVIEW: "补件复核",
};

export const ReviewCaseStatus = {
  PENDING: "PENDING",
  PROCESSED: "PROCESSED",
} as const;
export type ReviewCaseStatus = (typeof ReviewCaseStatus)[keyof typeof ReviewCaseStatus];

export const ReviewCaseStatusLabel: Record<ReviewCaseStatus, string> = {
  PENDING: "待审核",
  PROCESSED: "已处理",
};

export const ReviewFinalResult = {
  APPROVED: "APPROVED",
  APPROVED_CONDITIONAL: "APPROVED_CONDITIONAL",
  UNRESOLVED: "UNRESOLVED",
  TERMINATED: "TERMINATED",
} as const;
export type ReviewFinalResult = (typeof ReviewFinalResult)[keyof typeof ReviewFinalResult];

export const ReviewFinalResultLabel: Record<ReviewFinalResult, string> = {
  APPROVED: "审核通过",
  APPROVED_CONDITIONAL: "附条件通过",
  UNRESOLVED: "未完结",
  TERMINATED: "审核终止",
};

/**
 * 合规结论动作。PRD §5.2 原有"要求补件"与"驳回"两条路径，§8 待确认问题
 * 2026-08-26 用户拍板：只保留驳回（驳回可退回指定材料，交易员修改后重新提交）。
 */
export const ReviewDecisionAction = {
  APPROVE: "APPROVE",
  /** 条件性放行：材料无误但暂不完整，限制条件放行 + 延期补件闭环 */
  CONDITIONAL: "CONDITIONAL",
  REJECT: "REJECT",
  TERMINATE: "TERMINATE",
} as const;
export type ReviewDecisionAction =
  (typeof ReviewDecisionAction)[keyof typeof ReviewDecisionAction];

export const ReviewDecisionActionLabel: Record<ReviewDecisionAction, string> = {
  APPROVE: "通过",
  CONDITIONAL: "条件性放行",
  REJECT: "退回补件",
  TERMINATE: "拒绝",
};

/** 历史数据中可能存在的已废弃动作代码 → 展示文案兜底 */
export const LEGACY_DECISION_ACTION_LABEL: Record<string, string> = {
  REQUEST_SUPPLEMENT: "要求补件（已废弃）",
};

/** 延期补件设置（条件性放行落库；申请与工单 decision 各存一份快照） */
export interface AccessDeferralVO {
  /** 补件截止时间 ISO */
  due_at: string;
  missing_item_ids: string[];
  missing_item_names: string[];
  /** 临时交易限额（仅提示，不硬阻断） */
  limit_amount: number | null;
  limit_currency: string | null;
  /** 限制大额提现/提币卡点 */
  restrict_large_outflow: boolean;
  /** 合规备注（审计痕迹） */
  notes: string;
  decided_by: string | null;
  decided_at: string;
  /** 已发送的催办档位（"7d"/"3d"/"1d"） */
  reminded: string[];
  overdue_at: string | null;
}

export interface ReviewDeferralInput {
  /** ISO 字符串或毫秒时间戳 */
  due_at: string | number;
  missing_item_ids: string[];
  limit_amount?: number | null;
  limit_currency?: string | null;
  restrict_large_outflow?: boolean;
}

export interface ReviewMaterialVerdict {
  material_key: string;
  verdict: ApplicationMaterialStatus;
  reason: string | null;
}

export interface ReviewCaseVO {
  id: string;
  case_no: string;
  application_id: string;
  application_no: string;
  customer_id: string;
  customer_name: string;
  customer_code: string | null;
  /** 发起申请时的客户管理客户类型快照 */
  customer_kind: string | null;
  /** 发起申请时的主体类型快照 */
  customer_sub_type: string | null;
  scenario_name: string | null;
  channel_code: string | null;
  channel_name: string | null;
  review_type: ReviewType | null;
  audit_type: ReviewAuditType;
  status: ReviewCaseStatus;
  final_result: ReviewFinalResult | null;
  risk_level: string | null;
  completeness: AccessCompletenessVO;
  /** 交易员提交说明（业务说明快照） */
  note: string | null;
  /** 提交当时的表单与材料快照（规范 §4.5：不可依赖之后被修改的主表） */
  form_snapshot: ApplicationFormVO;
  materials_snapshot: ApplicationMaterialVO[];
  /** 场景审核要求快照（人工审核要求卡片） */
  review_requirement: string | null;
  decision: {
    action: ReviewDecisionAction;
    reason: string | null;
    rejected_item_ids: string[];
    /** 条件性放行的延期设置快照 */
    deferral?: AccessDeferralVO | null;
  } | null;
  material_verdicts: ReviewMaterialVerdict[];
  submitted_by_name: string | null;
  submitted_at: string;
  reviewer_name: string | null;
  reviewed_at: string | null;
  /** 详情接口附带：渠道材料清单要求 + 驳回历史版本（列表不返回） */
  requirements?: ReviewRequirementVO[];
  material_history?: ReviewMaterialHistoryVO[];
}

/** 审核详情：本渠道适用的材料清单项（含未提交项，编号展示） */
export interface ReviewRequirementVO {
  item_id: string;
  name: string;
  description: string | null;
  required: boolean;
}

/** 审核详情：此前审核轮次中被驳回的历史材料版本 */
export interface ReviewMaterialHistoryVO {
  case_no: string;
  reviewed_at: string | null;
  requirement_item_id: string | null;
  material_key: string;
  name: string;
  file: FileRef | null;
  uploaded_at: string;
}

/** 合规官工作台指标（demo 合规 dashboard 指标条的真实数据口径） */
export interface ReviewStatsVO {
  /** 待合规审核工单数 */
  pending_total: number;
  /** 待处理中审核类型为「驳回重审」的工单数 */
  pending_resubmit: number;
  /** 今日出具「审核通过」结论数 */
  approved_today: number;
  /** 今日出具「驳回」结论数 */
  rejected_today: number;
  /** 等待最久的待处理工单提交时间（ISO；无待处理时为 null） */
  oldest_pending_submitted_at: string | null;
}

export interface ReviewDecisionInput {
  action: ReviewDecisionAction;
  /** 非 APPROVE 必填（CONDITIONAL 时即合规备注） */
  reason?: string | null;
  /** 要求补件/驳回时指定需重传的材料 */
  material_verdicts?: ReviewMaterialVerdict[];
  /** action=CONDITIONAL 时必填 */
  deferral?: ReviewDeferralInput | null;
}

/* ---------------- 上传约束（前后端共用） ---------------- */

export const UPLOAD_ACCEPT_MIMES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const UPLOAD_ACCEPT_EXTS = [".jpg", ".jpeg", ".png", ".pdf", ".doc", ".docx"] as const;

export const UPLOAD_MAX_SIZE = 20 * 1024 * 1024;
