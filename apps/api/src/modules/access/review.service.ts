import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import {
  AccessStatus,
  ApplicationMaterialStatus,
  CustomerEventType,
  PageResult,
  ReviewCaseStatus,
  ReviewCaseVO,
  ReviewDecisionAction,
  ReviewFinalResult,
  ReviewStatsVO,
  ReviewMaterialHistoryVO,
  ReviewRequirementVO,
} from "@bv/shared";
import { Model, PipelineStage, Types } from "mongoose";
import { JwtPayload } from "../../auth/auth.types";
import { AssignmentService } from "../assignment/assignment.service";
import { KycScenario, KycScenarioDocument } from "../kyc/kyc-scenario.schema";
import { CustomerService } from "../customer/customer.service";
import { OrderService } from "../order/order.service";
import { AccessApplication, AccessApplicationDocument } from "./access-application.schema";
import { ReviewCase, ReviewCaseDocument } from "./review-case.schema";
import { QueryReviewDto, ReviewDecisionDto } from "./dto/access.dto";

/**
 * 合规结论 → 申请状态（demo 语义）：
 * 驳回 → 被驳回（退回交易员补充后重新提交）；终止 → 审核拒绝（需重新发起新申请）。
 */
const ACTION_TO_STATUS: Record<ReviewDecisionAction, AccessStatus> = {
  APPROVE: AccessStatus.APPROVED,
  REJECT: AccessStatus.SUPPLEMENT_REQUIRED,
  TERMINATE: AccessStatus.REJECTED,
};

const ACTION_TO_FINAL: Record<ReviewDecisionAction, ReviewFinalResult> = {
  APPROVE: ReviewFinalResult.APPROVED,
  REJECT: ReviewFinalResult.UNRESOLVED,
  TERMINATE: ReviewFinalResult.TERMINATED,
};

/** demo 工单 history 文案口径 */
const ACTION_LABEL: Record<ReviewDecisionAction, string> = {
  APPROVE: "合规审核通过",
  REJECT: "合规审核驳回，等待交易员补充后重新提交",
  TERMINATE: "合规审核终止，需重新发起新申请",
};

@Injectable()
export class ReviewService {
  constructor(
    @InjectModel(ReviewCase.name)
    private readonly caseModel: Model<ReviewCaseDocument>,
    @InjectModel(AccessApplication.name)
    private readonly applicationModel: Model<AccessApplicationDocument>,
    @InjectModel(KycScenario.name)
    private readonly scenarioModel: Model<KycScenarioDocument>,
    private readonly customerService: CustomerService,
    private readonly assignmentService: AssignmentService,
    private readonly orderService: OrderService,
  ) {}

  async list(query: QueryReviewDto): Promise<PageResult<ReviewCaseVO>> {
    const page = query.page || 1;
    const pageSize = Math.min(query.page_size || 10, 50);
    const filter: Record<string, unknown> = { is_deleted: false };
    if (query.status) filter.status = query.status;
    if (query.audit_type) filter.audit_type = query.audit_type;
    if (query.review_type) filter.review_type = query.review_type;
    if (query.final_result) filter.final_result = query.final_result;
    if (query.decision_action) filter["decision.action"] = query.decision_action;
    if (query.keyword) {
      const pattern = new RegExp(escapeRegExp(query.keyword.trim()), "i");
      filter.$or = [
        { customer_name: pattern },
        { customer_code: pattern },
        { case_no: pattern },
        { application_no: pattern },
      ];
    }
    if (query.submitted_from || query.submitted_to) {
      filter.submitted_at = {
        ...(query.submitted_from ? { $gte: new Date(query.submitted_from) } : {}),
        ...(query.submitted_to ? { $lte: new Date(query.submitted_to) } : {}),
      };
    }
    const sortField = query.sort_by ?? "submitted_at";
    const sortDirection = query.sort_order === "asc" ? 1 : -1;
    const shouldDedupeByApplication = query.status === ReviewCaseStatus.PROCESSED;
    const [items, total] = shouldDedupeByApplication
      ? await this.listLatestProcessedCases(filter, sortField, sortDirection, page, pageSize)
      : await Promise.all([
          this.caseModel
            .find(filter)
            .sort({ [sortField]: sortDirection })
            .skip((page - 1) * pageSize)
            .limit(pageSize)
            .lean(),
          this.caseModel.countDocuments(filter),
        ]);
    const vos = items.map(toVO);
    await this.fillCustomerSnapshotFallbacks(vos);
    return { items: vos, total, page, page_size: pageSize };
  }

  private async listLatestProcessedCases(
    filter: Record<string, unknown>,
    sortField: "submitted_at" | "reviewed_at",
    sortDirection: 1 | -1,
    page: number,
    pageSize: number,
  ) {
    const pipeline: PipelineStage[] = [
      { $match: filter },
      { $sort: { reviewed_at: -1, submitted_at: -1, _id: -1 } },
      { $group: { _id: "$application_id", doc: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$doc" } },
      {
        $facet: {
          items: [
            { $sort: { [sortField]: sortDirection, _id: sortDirection } },
            { $skip: (page - 1) * pageSize },
            { $limit: pageSize },
          ],
          total: [{ $count: "count" }],
        },
      },
    ];
    const [result] = await this.caseModel.aggregate<{
      items: Array<ReviewCase & { _id: Types.ObjectId; created_at?: Date; updated_at?: Date }>;
      total: Array<{ count: number }>;
    }>(pipeline);
    return [result?.items ?? [], result?.total[0]?.count ?? 0] as const;
  }

  /** 合规官工作台指标（demo 合规 dashboard 指标条），「今日」按服务器本地日界 */
  async stats(): Promise<ReviewStatsVO> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const pendingFilter = { is_deleted: false, status: ReviewCaseStatus.PENDING };
    const [pendingTotal, pendingResubmit, approvedToday, rejectedToday, oldestPending] =
      await Promise.all([
        this.caseModel.countDocuments(pendingFilter),
        this.caseModel.countDocuments({ ...pendingFilter, audit_type: "RESUBMIT" }),
        this.caseModel.countDocuments({
          is_deleted: false,
          "decision.action": ReviewDecisionAction.APPROVE,
          reviewed_at: { $gte: todayStart },
        }),
        this.caseModel.countDocuments({
          is_deleted: false,
          "decision.action": ReviewDecisionAction.REJECT,
          reviewed_at: { $gte: todayStart },
        }),
        this.caseModel
          .findOne(pendingFilter)
          .sort({ submitted_at: 1 })
          .select("submitted_at")
          .lean(),
      ]);
    return {
      pending_total: pendingTotal,
      pending_resubmit: pendingResubmit,
      approved_today: approvedToday,
      rejected_today: rejectedToday,
      oldest_pending_submitted_at: oldestPending?.submitted_at
        ? oldestPending.submitted_at.toISOString()
        : null,
    };
  }

  async getById(id: string): Promise<ReviewCaseVO> {
    const doc = await this.findOrFail(id);
    const vo = toVO(doc.toObject());
    const [requirements, history, application] = await Promise.all([
      this.requirementsOf(doc),
      this.materialHistoryOf(doc),
      vo.customer_kind && vo.customer_sub_type
        ? Promise.resolve(null)
        : this.applicationModel
          .findOne({ _id: doc.application_id, is_deleted: false })
          .select("customer_snapshot")
          .lean(),
    ]);
    vo.customer_kind = vo.customer_kind ?? application?.customer_snapshot?.customer_kind ?? null;
    vo.customer_sub_type = vo.customer_sub_type ?? application?.customer_snapshot?.customer_sub_type ?? null;
    vo.requirements = requirements;
    vo.material_history = history;
    return vo;
  }

  private async fillCustomerSnapshotFallbacks(items: ReviewCaseVO[]): Promise<void> {
    const missing = items.filter(item => !item.customer_kind || !item.customer_sub_type);
    if (!missing.length) return;
    const ids = [...new Set(missing.map(item => item.application_id))].map(id => new Types.ObjectId(id));
    const applications = await this.applicationModel
      .find({ _id: { $in: ids }, is_deleted: false })
      .select("customer_snapshot")
      .lean();
    const byId = new Map(applications.map(app => [String(app._id), app.customer_snapshot]));
    for (const item of missing) {
      const snapshot = byId.get(item.application_id);
      item.customer_kind = item.customer_kind ?? snapshot?.customer_kind ?? null;
      item.customer_sub_type = item.customer_sub_type ?? snapshot?.customer_sub_type ?? null;
    }
  }

  /** 本渠道适用的材料清单项（按申请的 scenario_id + 工单渠道解析；场景被删则返回空） */
  private async requirementsOf(caseDoc: ReviewCaseDocument): Promise<ReviewRequirementVO[]> {
    const application = await this.applicationModel
      .findOne({ _id: caseDoc.application_id })
      .select("scenario_id")
      .lean();
    if (!application?.scenario_id) return [];
    const scenario = await this.scenarioModel
      .findOne({ _id: application.scenario_id, is_deleted: false })
      .lean();
    const channel = scenario?.channels?.find(
      ch => ch.channel_code === caseDoc.channel_code || ch.channel_name === caseDoc.channel_name,
    );
    if (!channel) return [];
    return channel.sections.flatMap(section =>
      section.items.map(item => ({
        item_id: item.item_id,
        name: item.item_name,
        description: item.item_description ?? null,
        required: item.required !== false,
      })),
    );
  }

  /** 同一申请此前审核轮次中被驳回的材料版本（驳回重审工单展开可见） */
  private async materialHistoryOf(caseDoc: ReviewCaseDocument): Promise<ReviewMaterialHistoryVO[]> {
    const priorCases = await this.caseModel
      .find({
        is_deleted: false,
        application_id: caseDoc.application_id,
        _id: { $ne: caseDoc._id },
        submitted_at: { $lt: caseDoc.submitted_at },
      })
      .sort({ submitted_at: -1 })
      .lean();
    const history: ReviewMaterialHistoryVO[] = [];
    for (const prior of priorCases) {
      const returnedKeys = new Set(
        (prior.material_verdicts ?? [])
          .filter(v => v.verdict === "RETURNED")
          .map(v => v.material_key),
      );
      for (const material of prior.materials_snapshot ?? []) {
        if (!returnedKeys.has(material.material_key)) continue;
        history.push({
          case_no: prior.case_no,
          reviewed_at: prior.reviewed_at ? prior.reviewed_at.toISOString() : null,
          requirement_item_id: material.requirement_item_id ?? null,
          material_key: material.material_key,
          name: material.name,
          file: material.file ?? null,
          uploaded_at: material.uploaded_at ? new Date(material.uploaded_at).toISOString() : "",
        });
      }
    }
    return history;
  }

  /** 出具结论：更新工单 + 联动申请状态与材料判定（PRD §4.9） */
  async decide(id: string, dto: ReviewDecisionDto, operator: JwtPayload): Promise<ReviewCaseVO> {
    const caseDoc = await this.findOrFail(id);
    if (caseDoc.status !== ReviewCaseStatus.PENDING) {
      throw new ConflictException("该工单已处理，不能重复出具结论");
    }
    /* 审核分配（admin 配置）：指派专人的审核类型仅负责人可出结论；未配置兜底全员，ADMIN 始终可办 */
    if (!(await this.assignmentService.canDecide((caseDoc.review_type as never) ?? null, operator))) {
      throw new ForbiddenException("该类型审核已指派专人处理，你当前只可查看");
    }
    const needReason = dto.action !== ReviewDecisionAction.APPROVE;
    if (needReason && !dto.reason?.trim()) {
      throw new BadRequestException("请填写审核意见/原因");
    }

    const application = await this.applicationModel.findOne({
      _id: caseDoc.application_id,
      is_deleted: false,
    });
    if (!application) throw new NotFoundException("关联的准入申请不存在");
    if (application.status !== AccessStatus.PENDING_REVIEW) {
      throw new ConflictException(`申请当前状态（${application.status}）与工单不一致，请刷新`);
    }

    const verdicts = dto.material_verdicts ?? [];
    const snapshotKeys = new Set(caseDoc.materials_snapshot.map(m => m.material_key));
    for (const verdict of verdicts) {
      if (!snapshotKeys.has(verdict.material_key)) {
        throw new BadRequestException(`材料判定引用了不存在的材料：${verdict.material_key}`);
      }
    }
    const now = new Date();
    const verdictMap = new Map(verdicts.map(v => [v.material_key, v]));
    const applyVerdicts = (materials: typeof application.materials) =>
      materials.map(material => {
        const verdict = verdictMap.get(material.material_key);
        if (dto.action === ReviewDecisionAction.APPROVE) {
          return { ...material, status: ApplicationMaterialStatus.ACCEPTED, return_reason: null };
        }
        if (!verdict) return material;
        return {
          ...material,
          status: verdict.verdict as ApplicationMaterialStatus,
          return_reason:
            verdict.verdict === ApplicationMaterialStatus.RETURNED
              ? verdict.reason ?? dto.reason ?? null
              : null,
        };
      });

    application.materials = applyVerdicts(application.materials);
    caseDoc.materials_snapshot = applyVerdicts(caseDoc.materials_snapshot);

    const rejectedItemIds = [
      ...new Set(
        application.materials
          .filter(m => m.status === ApplicationMaterialStatus.RETURNED && m.requirement_item_id)
          .map(m => m.requirement_item_id as string),
      ),
    ];

    caseDoc.status = ReviewCaseStatus.PROCESSED;
    caseDoc.final_result = ACTION_TO_FINAL[dto.action];
    caseDoc.decision = {
      action: dto.action,
      reason: dto.reason?.trim() || null,
      rejected_item_ids: rejectedItemIds,
    };
    caseDoc.material_verdicts = verdicts.map(v => ({
      material_key: v.material_key,
      verdict: v.verdict as ApplicationMaterialStatus,
      reason: v.reason ?? null,
    }));
    caseDoc.reviewer_id = new Types.ObjectId(operator.sub);
    caseDoc.reviewer_name = operator.display_name;
    caseDoc.reviewed_at = now;
    caseDoc.set("updated_by", new Types.ObjectId(operator.sub));
    await caseDoc.save();

    const fromStatus = application.status;
    application.status = ACTION_TO_STATUS[dto.action];
    application.latest_review = {
      case_id: String(caseDoc._id),
      action: dto.action,
      reason: caseDoc.decision.reason,
      rejected_item_ids: rejectedItemIds,
      reviewed_at: now,
      reviewer_name: operator.display_name,
    };
    // timeline 为 Mixed 数组，原地 push 不触发 Mongoose 变更检测，必须整组赋值
    application.timeline = [
      ...application.timeline,
      {
        at: now,
        by_name: operator.display_name,
        action: ACTION_LABEL[dto.action],
        from_status: fromStatus,
        to_status: application.status,
        note: caseDoc.decision.reason,
      },
    ];
    application.set("updated_by", new Types.ObjectId(operator.sub));
    await application.save();

    const eventTitle =
      dto.action === ReviewDecisionAction.APPROVE
        ? "准入审核通过"
        : dto.action === ReviewDecisionAction.REJECT
          ? "准入审核驳回"
          : "准入审核终止";
    await this.customerService.recordEvent(
      application.customer_id,
      CustomerEventType.ACCESS,
      eventTitle,
      `${application.scenario_name ?? "-"} · ${application.channel_name ?? "-"} · 申请 ${application.application_no}${caseDoc.decision?.reason ? `：${caseDoc.decision.reason}` : ""}`,
      operator,
    );

    // 准入通过后自动推进该客户就绪的待KYC交易订单（demo advanceOrdersAfterKyc）
    if (dto.action === ReviewDecisionAction.APPROVE) {
      await this.orderService.advanceAfterKyc(application.customer_id, "客户准入审核通过");
    }

    return toVO(caseDoc.toObject());
  }

  private async findOrFail(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException("审核工单不存在");
    const doc = await this.caseModel.findOne({ _id: id, is_deleted: false });
    if (!doc) throw new NotFoundException("审核工单不存在");
    return doc;
  }
}

function toVO(
  doc: ReviewCase & { _id: Types.ObjectId; created_at?: Date; updated_at?: Date },
): ReviewCaseVO {
  return {
    id: String(doc._id),
    case_no: doc.case_no,
    application_id: String(doc.application_id),
    application_no: doc.application_no,
    customer_id: String(doc.customer_id),
    customer_name: doc.customer_name,
    customer_code: doc.customer_code,
    customer_kind: doc.customer_kind ?? null,
    customer_sub_type: doc.customer_sub_type ?? null,
    scenario_name: doc.scenario_name,
    channel_code: doc.channel_code,
    channel_name: doc.channel_name,
    review_type: (doc.review_type as ReviewCaseVO["review_type"]) ?? null,
    audit_type: doc.audit_type,
    status: doc.status,
    final_result: doc.final_result,
    risk_level: doc.risk_level,
    completeness: doc.completeness,
    note: doc.note,
    form_snapshot: doc.form_snapshot,
    materials_snapshot: doc.materials_snapshot,
    review_requirement: doc.review_requirement,
    decision: doc.decision,
    material_verdicts: doc.material_verdicts,
    submitted_by_name: doc.submitted_by_name,
    submitted_at: doc.submitted_at.toISOString(),
    reviewer_name: doc.reviewer_name,
    reviewed_at: doc.reviewed_at ? doc.reviewed_at.toISOString() : null,
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
