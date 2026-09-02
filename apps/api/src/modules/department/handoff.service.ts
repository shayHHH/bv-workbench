import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ActiveHandoffVO } from "@bv/shared";
import { Model, Types } from "mongoose";
import { Role, RoleDocument } from "../user/role.schema";
import { LeaveRecord, LeaveRecordDocument } from "./leave-record.schema";

/** 本地日期 YYYY-MM-DD（请假区间按天字符串比对的统一口径） */
export function isoDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 业务交接产生的「代班授权」（2026-09-02 用户确认）：
 * 经理把某条请假记录交接给系统任一启用账号后，接手人在请假起止区间内临时获得
 * 请假人的岗位角色——工作台待办按此并入队列，后端 RolesGuard 也按此放行。
 * 区间结束或经理撤销交接后自动失效，不写任何持久化的角色变更。
 */
@Injectable()
export class HandoffService {
  constructor(
    @InjectModel(LeaveRecord.name) private readonly leaveModel: Model<LeaveRecordDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
  ) {}

  /** 某人今日生效中的代班岗位代码（去重）；无代班时返回空数组 */
  async activeRoleCodes(userId?: string): Promise<string[]> {
    const docs = await this.activeLeaves(userId);
    return [...new Set(docs.map(doc => doc.handoff_role_code).filter((code): code is string => !!code))];
  }

  /** 某人今日代班覆盖的请假人 id（按人分配的任务据此放行，如合规审核分配） */
  async activeCoveredUserIds(userId?: string): Promise<string[]> {
    const docs = await this.activeLeaves(userId);
    return [...new Set(docs.map(doc => String(doc.user_id)))];
  }

  /** 某人今日生效中的代班明细（工作台代班提示条） */
  async activeHandoffs(userId?: string): Promise<ActiveHandoffVO[]> {
    const docs = await this.activeLeaves(userId);
    if (!docs.length) return [];
    const codes = [...new Set(docs.map(doc => doc.handoff_role_code).filter(Boolean))];
    const roles = await this.roleModel.find({ role_code: { $in: codes }, is_deleted: false }).lean();
    const roleName = new Map(roles.map(role => [role.role_code, role.role_name]));
    return docs.map(doc => ({
      leave_id: String(doc._id),
      leave_no: doc.leave_no,
      from_user_id: String(doc.user_id),
      from_user_name: doc.user_name,
      role_code: doc.handoff_role_code ?? "",
      role_name: roleName.get(doc.handoff_role_code ?? "") ?? doc.role_name,
      leave_type: doc.leave_type,
      start_date: doc.start_date,
      end_date: doc.end_date,
    }));
  }

  private async activeLeaves(userId?: string) {
    if (!userId || !Types.ObjectId.isValid(userId)) return [];
    const today = isoDate();
    return this.leaveModel
      .find({
        is_deleted: false,
        handoff_done: true,
        handoff_user_id: new Types.ObjectId(userId),
        start_date: { $lte: today },
        end_date: { $gte: today },
      })
      .sort({ handoff_at: -1 })
      .lean();
  }
}
