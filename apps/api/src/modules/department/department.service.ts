import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import {
  AccessStatus,
  ActiveHandoffVO,
  DonePeriod,
  DepartmentMemberVO,
  DepartmentOverviewVO,
  DispatchStatus,
  HandoffCandidateVO,
  LEAVE_PART_DEFAULT_TIMES,
  LeavePart,
  LeaveRecordVO,
  ReviewCaseStatus,
  TradeOrderStatus,
} from "@bv/shared";
import { Model, Types } from "mongoose";
import { JwtPayload } from "../../auth/auth.types";
import { AccessApplication, AccessApplicationDocument } from "../access/access-application.schema";
import { ReviewCase, ReviewCaseDocument } from "../access/review-case.schema";
import { ReviewAssignment, ReviewAssignmentDocument } from "../assignment/review-assignment.schema";
import { PayoutOrder, PayoutOrderDocument } from "../order/schemas/payout-order.schema";
import { TradeOrder, TradeOrderDocument } from "../order/schemas/trade-order.schema";
import { Role, RoleDocument } from "../user/role.schema";
import { User, UserDocument } from "../user/user.schema";
import { CreateLeaveDto, MarkHandoffDto } from "./dto/department.dto";
import { HandoffService, isoDate } from "./handoff.service";
import { LeaveRecord, LeaveRecordDocument } from "./leave-record.schema";

function dayRange(date = new Date()): { from: Date; to: Date } {
  const from = new Date(date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(date);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

/** 「已处理」统计窗（本地时区）：今日 / 本周（周一起） / 本月 / 本季 / 今年，至今日 24 点 */
function periodRange(period: DonePeriod): { from: Date; to: Date } {
  const { from, to } = dayRange();
  if (period === "week") from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
  else if (period === "month") from.setDate(1);
  else if (period === "quarter") from.setMonth(Math.floor(from.getMonth() / 3) * 3, 1);
  else if (period === "year") from.setMonth(0, 1);
  return { from, to };
}

const rowsById = (rows: Array<{ _id: Types.ObjectId; count: number }>) =>
  new Map(rows.map(row => [String(row._id), row.count]));
const rowsByName = (rows: Array<{ _id: string; count: number }>) =>
  new Map(rows.map(row => [row._id, row.count]));

/**
 * 部门管理（运营经理）：员工名单来自系统用户，任务统计从各业务集合实时聚合；
 * 请假记录手工登记落库。SLA/到期时间目前无数据来源，不做超时统计。
 */
@Injectable()
export class DepartmentService {
  constructor(
    @InjectModel(LeaveRecord.name) private readonly leaveModel: Model<LeaveRecordDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @InjectModel(TradeOrder.name) private readonly orderModel: Model<TradeOrderDocument>,
    @InjectModel(PayoutOrder.name) private readonly payoutModel: Model<PayoutOrderDocument>,
    @InjectModel(AccessApplication.name)
    private readonly accessModel: Model<AccessApplicationDocument>,
    @InjectModel(ReviewCase.name) private readonly reviewCaseModel: Model<ReviewCaseDocument>,
    @InjectModel(ReviewAssignment.name)
    private readonly assignmentModel: Model<ReviewAssignmentDocument>,
    private readonly handoffService: HandoffService,
  ) {}

  async overview(start?: string, end?: string, donePeriod: DonePeriod = "today"): Promise<DepartmentOverviewVO> {
    const today = isoDate();
    const rangeStart = start ?? today;
    const rangeEnd = end ?? today;
    const { from: todayFrom, to: todayTo } = dayRange();

    const [roles, users] = await Promise.all([
      this.roleModel.find({ is_deleted: false }).lean(),
      this.userModel
        .find({ is_deleted: false, user_status: "ACTIVE" })
        .sort({ created_at: 1 })
        .lean(),
    ]);
    const roleById = new Map(roles.map(role => [String(role._id), role]));
    const members = users.filter(user => roleById.get(String(user.role_id))?.role_code !== "ADMIN");

    const [
      orderPending,
      orderDoneToday,
      accessPending,
      casePendingByType,
      caseDoneToday,
      payoutDoneToday,
      payoutQueueCount,
      dispatchReviewCount,
      assignments,
      leaves,
    ] = await Promise.all([
      // 名下进行中订单
      this.orderModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            is_deleted: false,
            status: { $nin: [TradeOrderStatus.COMPLETED, TradeOrderStatus.CANCELLED] },
            owner_user_id: { $ne: null },
          },
        },
        { $group: { _id: "$owner_user_id", count: { $sum: 1 } } },
      ]),
      // 今日完成订单（按最后更新时间近似完成时间）
      this.orderModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            is_deleted: false,
            status: TradeOrderStatus.COMPLETED,
            updated_at: { $gte: todayFrom, $lte: todayTo },
            owner_user_id: { $ne: null },
          },
        },
        { $group: { _id: "$owner_user_id", count: { $sum: 1 } } },
      ]),
      // 名下待动作的准入申请（草稿 / 被驳回）
      this.accessModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            is_deleted: false,
            status: { $in: [AccessStatus.DRAFT, AccessStatus.SUPPLEMENT_REQUIRED] },
            owner_user_id: { $ne: null },
          },
        },
        { $group: { _id: "$owner_user_id", count: { $sum: 1 } } },
      ]),
      // 待合规审核案件按提交模式（FX/USDT）分组，结合审核分配摊到合规官
      this.reviewCaseModel.aggregate<{ _id: string | null; count: number }>([
        { $match: { is_deleted: false, status: ReviewCaseStatus.PENDING } },
        { $group: { _id: "$review_type", count: { $sum: 1 } } },
      ]),
      // 今日出具合规结论
      this.reviewCaseModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            is_deleted: false,
            reviewer_id: { $ne: null },
            reviewed_at: { $gte: todayFrom, $lte: todayTo },
          },
        },
        { $group: { _id: "$reviewer_id", count: { $sum: 1 } } },
      ]),
      // 今日出款执行 / 出款审核（按登记人姓名归属）
      this.payoutModel.aggregate<{ _id: string; count: number }>([
        {
          $match: { is_deleted: false, paid_by: { $ne: null }, paid_at: { $gte: todayFrom, $lte: todayTo } },
        },
        { $group: { _id: "$paid_by", count: { $sum: 1 } } },
      ]),
      this.payoutModel.countDocuments({ is_deleted: false, status: DispatchStatus.AWAITING_PAYOUT }),
      this.payoutModel.countDocuments({ is_deleted: false, status: DispatchStatus.REVIEWING }),
      this.assignmentModel.find({ is_deleted: false }).lean(),
      this.leaveModel
        .find({ is_deleted: false, start_date: { $lte: rangeEnd }, end_date: { $gte: rangeStart } })
        .sort({ created_at: -1 })
        .lean(),
    ]);

    const payoutReviewDoneToday = await this.payoutModel.aggregate<{ _id: string; count: number }>([
      {
        $match: { is_deleted: false, reviewed_by: { $ne: null }, reviewed_at: { $gte: todayFrom, $lte: todayTo } },
      },
      { $group: { _id: "$reviewed_by", count: { $sum: 1 } } },
    ]);

    const { from: periodFrom, to: periodTo } = periodRange(donePeriod);
    const periodStats = donePeriod === "today" ? null : await this.doneStats(periodFrom, periodTo);

    const byId = (rows: Array<{ _id: Types.ObjectId; count: number }>) =>
      new Map(rows.map(row => [String(row._id), row.count]));
    const byName = (rows: Array<{ _id: string; count: number }>) =>
      new Map(rows.map(row => [row._id, row.count]));
    const orderPendingMap = byId(orderPending);
    const orderDoneMap = byId(orderDoneToday);
    const accessPendingMap = byId(accessPending);
    const caseDoneMap = byId(caseDoneToday);
    const paidDoneMap = byName(payoutDoneToday);
    const reviewDoneMap = byName(payoutReviewDoneToday);
    const assignmentByType = new Map(
      assignments.map(doc => [doc.review_type as string, doc.assignee_user_ids.map(String)]),
    );

    /** 合规官待办：分配到本人的类型计入；未配置/空分配 = 全体合规可办（对齐 canDecide 兜底） */
    const compliancePending = (userId: string) =>
      casePendingByType.reduce((sum, row) => {
        const assignees = row._id ? assignmentByType.get(row._id) : undefined;
        if (!assignees?.length || assignees.includes(userId)) return sum + row.count;
        return sum;
      }, 0);

    const memberVOs: DepartmentMemberVO[] = members.map(user => {
      const id = String(user._id);
      const role = roleById.get(String(user.role_id));
      const roleCode = role?.role_code ?? "";
      let pending = (orderPendingMap.get(id) ?? 0) + (accessPendingMap.get(id) ?? 0);
      if (roleCode === "COMPLIANCE") pending += compliancePending(id);
      // 出款/审核队列不分派到人，按共享队列摊给对应岗位
      if (roleCode === "PAYOUT") pending += payoutQueueCount;
      if (roleCode === "OPS") pending += dispatchReviewCount;
      const todayDone =
        (orderDoneMap.get(id) ?? 0) +
        (caseDoneMap.get(id) ?? 0) +
        (paidDoneMap.get(user.display_name) ?? 0) +
        (reviewDoneMap.get(user.display_name) ?? 0);
      const periodDone = periodStats
        ? (periodStats.orders.get(id) ?? 0) +
          (periodStats.cases.get(id) ?? 0) +
          (periodStats.paid.get(user.display_name) ?? 0) +
          (periodStats.reviewed.get(user.display_name) ?? 0)
        : todayDone;
      return {
        user_id: id,
        username: user.username,
        display_name: user.display_name,
        title: user.title ?? null,
        role_code: roleCode,
        role_name: role?.role_name ?? roleCode,
        today_done: todayDone,
        period_done: periodDone,
        pending,
        last_login_at: user.last_login_at ? user.last_login_at.toISOString() : null,
      };
    });
    const memberIds = new Set(memberVOs.map(member => member.user_id));
    const visibleLeaves = leaves.filter(doc => memberIds.has(String(doc.user_id)));

    return { members: memberVOs, leaves: visibleLeaves.map(doc => this.toLeaveVO(doc)) };
  }

  /** 指定时间窗内的「已处理」四路聚合：完成订单 / 合规结论 / 出款执行 / 排单审核 */
  private async doneStats(from: Date, to: Date) {
    const [orders, cases, paid, reviewed] = await Promise.all([
      this.orderModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            is_deleted: false,
            status: TradeOrderStatus.COMPLETED,
            updated_at: { $gte: from, $lte: to },
            owner_user_id: { $ne: null },
          },
        },
        { $group: { _id: "$owner_user_id", count: { $sum: 1 } } },
      ]),
      this.reviewCaseModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: { is_deleted: false, reviewer_id: { $ne: null }, reviewed_at: { $gte: from, $lte: to } },
        },
        { $group: { _id: "$reviewer_id", count: { $sum: 1 } } },
      ]),
      this.payoutModel.aggregate<{ _id: string; count: number }>([
        { $match: { is_deleted: false, paid_by: { $ne: null }, paid_at: { $gte: from, $lte: to } } },
        { $group: { _id: "$paid_by", count: { $sum: 1 } } },
      ]),
      this.payoutModel.aggregate<{ _id: string; count: number }>([
        { $match: { is_deleted: false, reviewed_by: { $ne: null }, reviewed_at: { $gte: from, $lte: to } } },
        { $group: { _id: "$reviewed_by", count: { $sum: 1 } } },
      ]),
    ]);
    return { orders: rowsById(orders), cases: rowsById(cases), paid: rowsByName(paid), reviewed: rowsByName(reviewed) };
  }

  async createLeave(dto: CreateLeaveDto, operator: JwtPayload): Promise<LeaveRecordVO> {
    const user = await this.userModel.findOne({ _id: dto.user_id, is_deleted: false }).lean();
    if (!user) throw new NotFoundException("员工不存在");
    const role = await this.roleModel.findOne({ _id: user.role_id }).lean();
    if (dto.end_date < dto.start_date) throw new BadRequestException("结束日期不能早于开始日期");

    const defaults = LEAVE_PART_DEFAULT_TIMES[dto.part];
    const startTime = dto.part === LeavePart.FULL_DAY ? defaults.start : (dto.start_time ?? defaults.start);
    const endTime = dto.part === LeavePart.FULL_DAY ? defaults.end : (dto.end_time ?? defaults.end);

    const today = isoDate().replace(/-/g, "").slice(2);
    const { from, to } = dayRange();
    const seq = (await this.leaveModel.countDocuments({ created_at: { $gte: from, $lte: to } })) + 1;

    const doc = await this.leaveModel.create({
      leave_no: `LV-${today}-${String(seq).padStart(3, "0")}`,
      user_id: new Types.ObjectId(dto.user_id),
      user_name: user.display_name,
      role_name: role?.role_name ?? "",
      leave_type: dto.leave_type,
      part: dto.part,
      start_date: dto.start_date,
      end_date: dto.end_date,
      start_time: startTime,
      end_time: endTime,
      note: dto.note?.trim() || null,
      source: "手工登记",
      handoff: dto.handoff ?? false,
      registered_by: operator.display_name,
      created_by: new Types.ObjectId(operator.sub),
      updated_by: new Types.ObjectId(operator.sub),
    });
    return this.toLeaveVO(doc.toObject());
  }

  /**
   * 指定接手人（经理从系统全部启用账号里自选，不做岗位推荐）。
   * 落库接手人 id 与被代班岗位后，接手人在请假区间内即获得该岗位的待办与操作权限。
   */
  async markHandoff(id: string, dto: MarkHandoffDto, operator: JwtPayload): Promise<LeaveRecordVO> {
    const doc = await this.leaveModel.findOne({ _id: id, is_deleted: false });
    if (!doc) throw new NotFoundException("请假记录不存在");
    if (String(doc.user_id) === dto.target_user_id)
      throw new BadRequestException("接手人不能是请假人本人");
    const target = await this.userModel
      .findOne({ _id: dto.target_user_id, is_deleted: false, user_status: "ACTIVE" })
      .lean();
    if (!target) throw new NotFoundException("接手人不存在或已停用");
    /* 代班岗位取请假人「当前」角色，而不是登记时的 role_name 快照（角色可能已调整） */
    const absentee = await this.userModel.findOne({ _id: doc.user_id, is_deleted: false }).lean();
    const absenteeRole = absentee
      ? await this.roleModel.findOne({ _id: absentee.role_id }).lean()
      : null;

    doc.handoff_done = true;
    doc.handoff_target = target.display_name;
    doc.handoff_user_id = new Types.ObjectId(String(target._id));
    doc.handoff_role_code = absenteeRole?.role_code ?? null;
    doc.handoff_at = new Date();
    doc.set("updated_by", new Types.ObjectId(operator.sub));
    await doc.save();
    return this.toLeaveVO(doc.toObject());
  }

  /** 撤销交接：接手人的代班权限立即失效，记录回到「待交接」 */
  async revokeHandoff(id: string, operator: JwtPayload): Promise<LeaveRecordVO> {
    const doc = await this.leaveModel.findOne({ _id: id, is_deleted: false });
    if (!doc) throw new NotFoundException("请假记录不存在");
    doc.handoff_done = false;
    doc.handoff_target = null;
    doc.handoff_user_id = null;
    doc.handoff_role_code = null;
    doc.handoff_at = null;
    doc.set("updated_by", new Types.ObjectId(operator.sub));
    await doc.save();
    return this.toLeaveVO(doc.toObject());
  }

  /** 接手人候选：系统全部启用账号（含 Admin），今日请假的只做标注不过滤 */
  async handoffCandidates(): Promise<HandoffCandidateVO[]> {
    const today = isoDate();
    const [roles, users, leaves] = await Promise.all([
      this.roleModel.find({ is_deleted: false }).lean(),
      this.userModel
        .find({ is_deleted: false, user_status: "ACTIVE" })
        .sort({ created_at: 1 })
        .lean(),
      this.leaveModel
        .find({ is_deleted: false, start_date: { $lte: today }, end_date: { $gte: today } })
        .select({ user_id: 1 })
        .lean(),
    ]);
    const roleById = new Map(roles.map(role => [String(role._id), role]));
    const onLeave = new Set(leaves.map(leave => String(leave.user_id)));
    return users.map(user => {
      const role = roleById.get(String(user.role_id));
      return {
        user_id: String(user._id),
        username: user.username,
        display_name: user.display_name,
        title: user.title ?? null,
        role_code: role?.role_code ?? "",
        role_name: role?.role_name ?? role?.role_code ?? "",
        on_leave_today: onLeave.has(String(user._id)),
      };
    });
  }

  /** 当前登录用户今日生效中的代班（工作台提示条） */
  myHandoffs(operator: JwtPayload): Promise<ActiveHandoffVO[]> {
    return this.handoffService.activeHandoffs(operator.sub);
  }

  /** 取消登记：软删除，员工恢复「在岗」 */
  async cancelLeave(id: string, operator: JwtPayload): Promise<void> {
    const doc = await this.leaveModel.findOne({ _id: id, is_deleted: false });
    if (!doc) throw new NotFoundException("请假记录不存在");
    doc.set("is_deleted", true);
    doc.set("deleted_by", new Types.ObjectId(operator.sub));
    doc.set("deleted_at", new Date());
    await doc.save();
  }

  private toLeaveVO(doc: LeaveRecord & { _id: Types.ObjectId; created_at?: Date }): LeaveRecordVO {
    return {
      id: String(doc._id),
      leave_no: doc.leave_no,
      user_id: String(doc.user_id),
      user_name: doc.user_name,
      role_name: doc.role_name,
      leave_type: doc.leave_type,
      part: doc.part,
      start_date: doc.start_date,
      end_date: doc.end_date,
      start_time: doc.start_time,
      end_time: doc.end_time,
      note: doc.note ?? null,
      source: doc.source,
      handoff: doc.handoff,
      handoff_done: doc.handoff_done,
      handoff_target: doc.handoff_target ?? null,
      handoff_user_id: doc.handoff_user_id ? String(doc.handoff_user_id) : null,
      handoff_role_code: doc.handoff_role_code ?? null,
      handoff_at: doc.handoff_at ? doc.handoff_at.toISOString() : null,
      registered_by: doc.registered_by,
      registered_at: doc.created_at ? doc.created_at.toISOString() : new Date().toISOString(),
    };
  }
}
