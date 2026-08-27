/**
 * 用户与角色域共享定义（admin 用户管理）。
 * 角色 role_code 为稳定英文代码；展示名走 role_name / 前端映射。
 */

/** 账号状态 */
export const UserStatus = {
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const UserStatusLabel: Record<UserStatus, string> = {
  ACTIVE: "启用",
  DISABLED: "停用",
};

/** 系统内置角色（沿用原型的演示角色划分；可由 admin 追加自定义角色） */
export const BUILTIN_ROLES: ReadonlyArray<{ code: string; name: string; description: string }> = [
  { code: "ADMIN", name: "Admin", description: "系统管理员：管理登录账号、角色与系统规则" },
  { code: "AGENT", name: "初级交易员", description: "创建订单、跟进 KYC、客户入款与出款排单" },
  { code: "OPS", name: "高级交易员", description: "复核付款、出款排单与异常处理" },
  { code: "PAYOUT", name: "出款员", description: "处理出款队列和凭证匹配" },
  { code: "COMPLIANCE", name: "合规官", description: "处理已提交合规的案件并出具结论" },
  { code: "MANAGER", name: "运营经理", description: "交易总览、资金管理、对账与异常监控" },
  { code: "FINANCE", name: "财务", description: "账务流水、库存管理、对账与佣金" },
  { code: "WALLET", name: "钱包运营", description: "收 U 地址、KYA、链上出入款登记" },
];

/**
 * 承担合规官职责的角色（2026-08-27 用户确认：风控专员＝合规官）。
 * COMPLIANCE 为内置角色；RISK_OFFICER 为 admin 在「用户管理」创建的自定义角色（真实名单在用）。
 * 审核队列/KYC 配置/审计日志等合规官功能面统一以此判定，勿在各处散写角色字符串。
 */
export const COMPLIANCE_DUTY_ROLES = ["COMPLIANCE", "RISK_OFFICER"] as const;

export interface RoleVO {
  id: string;
  role_code: string;
  role_name: string;
  description: string | null;
  is_builtin: boolean;
  user_count: number;
  created_at: string;
}

export interface UserVO {
  id: string;
  username: string;
  display_name: string;
  title: string | null;
  role: { id: string; code: string; name: string } | null;
  user_status: UserStatus;
  last_login_at: string | null;
  created_at: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface LoginResult {
  token: string;
  user: UserVO;
}

export interface CreateUserInput {
  username: string;
  password: string;
  display_name: string;
  title?: string | null;
  role_id: string;
}

export interface UpdateUserInput {
  /** 登录名；修改后原用户名立即失效，下次登录使用新用户名 */
  username?: string;
  display_name?: string;
  title?: string | null;
  role_id?: string;
  user_status?: UserStatus;
}

export interface CreateRoleInput {
  role_code: string;
  role_name: string;
  description?: string | null;
}
