import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import {
  AssignmentUserVO,
  ReviewAssignmentBoardVO,
  ReviewAssignmentVO,
  ReviewType,
  UserStatus,
} from "@bv/shared";
import { Model, Types } from "mongoose";
import { JwtPayload } from "../../auth/auth.types";
import { Role, RoleDocument } from "../user/role.schema";
import { User, UserDocument } from "../user/user.schema";
import { ReviewAssignment, ReviewAssignmentDocument } from "./review-assignment.schema";

@Injectable()
export class AssignmentService {
  constructor(
    @InjectModel(ReviewAssignment.name)
    private readonly assignmentModel: Model<ReviewAssignmentDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name)
    private readonly roleModel: Model<RoleDocument>,
  ) {}

  /** 分配总览：两种审核类型的负责人 + 可选合规账号池 */
  async board(): Promise<ReviewAssignmentBoardVO> {
    const [docs, complianceUsers] = await Promise.all([
      this.assignmentModel.find({ is_deleted: false }).lean(),
      this.listComplianceUsers(),
    ]);
    const userMap = new Map(complianceUsers.map(user => [user.id, user]));
    // 负责人可能已被停用/删除或角色被改；仍展示并标记，提示 admin 改派
    const missingIds = docs
      .flatMap(doc => doc.assignee_user_ids.map(String))
      .filter(id => !userMap.has(id));
    if (missingIds.length) {
      const missing = await this.userModel
        .find({ _id: { $in: missingIds } })
        .lean();
      for (const user of missing) {
        userMap.set(String(user._id), {
          id: String(user._id),
          username: user.username,
          display_name: user.display_name,
          title: user.title ?? null,
          is_active: false,
        });
      }
    }
    const assignments: ReviewAssignmentVO[] = Object.values(ReviewType).map(reviewType => {
      const doc = docs.find(item => item.review_type === reviewType);
      return {
        review_type: reviewType,
        assignees: (doc?.assignee_user_ids ?? [])
          .map(id => userMap.get(String(id)))
          .filter((user): user is AssignmentUserVO => Boolean(user)),
        updated_at: doc?.updated_at ? doc.updated_at.toISOString() : null,
        updated_by_name: doc?.updated_by_name ?? null,
      };
    });
    return { assignments, compliance_users: complianceUsers };
  }

  /** 保存某审核类型的负责人（空数组 = 取消配置，兜底全体合规可办） */
  async save(
    reviewType: ReviewType,
    assigneeUserIds: string[],
    operator: JwtPayload,
  ): Promise<ReviewAssignmentBoardVO> {
    const uniqueIds = [...new Set(assigneeUserIds)];
    if (uniqueIds.some(id => !Types.ObjectId.isValid(id))) {
      throw new BadRequestException("负责人 ID 不合法");
    }
    if (uniqueIds.length) {
      const eligible = await this.listComplianceUsers();
      const eligibleIds = new Set(eligible.filter(user => user.is_active).map(user => user.id));
      const invalid = uniqueIds.filter(id => !eligibleIds.has(id));
      if (invalid.length) {
        throw new BadRequestException("负责人必须是启用状态的合规官账号");
      }
    }
    await this.assignmentModel.updateOne(
      { review_type: reviewType },
      {
        $set: {
          assignee_user_ids: uniqueIds.map(id => new Types.ObjectId(id)),
          updated_by_name: operator.display_name,
          updated_by: new Types.ObjectId(operator.sub),
          is_deleted: false,
        },
        $setOnInsert: {
          review_type: reviewType,
          created_by: new Types.ObjectId(operator.sub),
          deleted_by: null,
          deleted_at: null,
        },
      },
      { upsert: true },
    );
    return this.board();
  }

  /**
   * 供审核模块调用：该合规账号是否可对此审核类型出具结论。
   * 规则（用户 2026-08-26 确认）：配置了负责人 → 仅负责人可办（其余合规能看不能办）；
   * 未配置 → 全体合规可办（兜底，避免审核卡死）。ADMIN 始终可办（改派通道）。
   */
  async canDecide(reviewType: ReviewType | null, operator: JwtPayload): Promise<boolean> {
    if (operator.role_code === "ADMIN") return true;
    if (!reviewType) return true;
    const doc = await this.assignmentModel
      .findOne({ review_type: reviewType, is_deleted: false })
      .lean();
    if (!doc?.assignee_user_ids?.length) return true;
    return doc.assignee_user_ids.some(id => String(id) === operator.sub);
  }

  /** 供审核队列展示：某类型的负责人 ID 列表（空 = 未配置） */
  async assigneeIds(reviewType: ReviewType): Promise<string[]> {
    const doc = await this.assignmentModel
      .findOne({ review_type: reviewType, is_deleted: false })
      .lean();
    return (doc?.assignee_user_ids ?? []).map(String);
  }

  private async listComplianceUsers(): Promise<AssignmentUserVO[]> {
    const role = await this.roleModel.findOne({ role_code: "COMPLIANCE", is_deleted: false }).lean();
    if (!role) return [];
    const users = await this.userModel
      .find({ role_id: role._id, is_deleted: false })
      .sort({ created_at: 1 })
      .lean();
    return users.map(user => ({
      id: String(user._id),
      username: user.username,
      display_name: user.display_name,
      title: user.title ?? null,
      is_active: user.user_status === UserStatus.ACTIVE,
    }));
  }
}
