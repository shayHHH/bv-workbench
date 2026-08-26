/**
 * 合规审核分配（admin「审核分配」板块）。
 * 按审核类型（找换 FX / U相关 USDT）指定负责的合规账号：
 * 负责人以外的合规官"能看不能办"，admin 可随时改派（顶班）；
 * 某类型暂未配置负责人时兜底为全体合规可办，避免审核卡死。
 */
import type { ReviewType } from "./access.js";

export interface AssignmentUserVO {
  id: string;
  username: string;
  display_name: string;
  title: string | null;
  /** 账号是否可用（停用账号仍显示但标记，提示 admin 改派） */
  is_active: boolean;
}

export interface ReviewAssignmentVO {
  review_type: ReviewType;
  assignees: AssignmentUserVO[];
  updated_at: string | null;
  updated_by_name: string | null;
}

export interface ReviewAssignmentBoardVO {
  assignments: ReviewAssignmentVO[];
  /** 可选的合规账号池（COMPLIANCE 角色、未删除） */
  compliance_users: AssignmentUserVO[];
}

export interface SaveReviewAssignmentInput {
  assignee_user_ids: string[];
}
