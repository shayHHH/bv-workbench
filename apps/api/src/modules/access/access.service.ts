import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectConnection, InjectModel } from "@nestjs/mongoose";
import {
  AccessApplicationVO,
  AccessCompletenessVO,
  AccessStatus,
  ApplicationMaterialStatus,
  ApplicationMaterialVO,
  CustomerEventType,
  CustomerMaterialVO,
  KycChannel,
  MaterialSource,
  PageResult,
  ReviewAuditType,
  ReviewCaseStatus,
  ReviewDecisionAction,
  ReviewType,
  ReviewTypeLabel,
} from "@bv/shared";
import { Connection, Model, Types } from "mongoose";
import { JwtPayload } from "../../auth/auth.types";
import { nextBusinessNo } from "../../common/sequence";
import { Customer, CustomerDocument } from "../customer/customer.schema";
import { CustomerService } from "../customer/customer.service";
import { KycScenario, KycScenarioDocument } from "../kyc/kyc-scenario.schema";
import { AccessApplication, AccessApplicationDocument } from "./access-application.schema";
import { CustomerMaterial, CustomerMaterialDocument } from "./customer-material.schema";
import { ReviewCase, ReviewCaseDocument } from "./review-case.schema";
import {
  ArchiveMaterialsDto,
  CreateApplicationDto,
  QueryApplicationDto,
  SaveDraftDto,
  parseStatusList,
} from "./dto/access.dto";

/**
 * demo 状态语义：草稿/被驳回可直接编辑提交；审核拒绝、已过期、已取消需先「重新提交」
 * 回到草稿（reopen）再走工作台。
 */
const EDITABLE_STATUSES: AccessStatus[] = [AccessStatus.DRAFT, AccessStatus.SUPPLEMENT_REQUIRED];

/** 可通过「重新提交」重开为草稿的状态（demo materialStatusFlow 的 ⟳ 重新提交） */
const REOPENABLE_STATUSES: AccessStatus[] = [
  AccessStatus.REJECTED,
  AccessStatus.EXPIRED,
  AccessStatus.CANCELLED,
];

/** 视为"占用 客户×业务×渠道"的活跃状态：存在时不允许再提交同组合申请 */
const ACTIVE_STATUSES: AccessStatus[] = [AccessStatus.PENDING_REVIEW, AccessStatus.APPROVED];

type ScenarioLean = {
  _id: Types.ObjectId;
  scenario_code: string;
  scenario_name: string;
  process_description: string | null;
  channels: KycChannel[];
};

@Injectable()
export class AccessService {
  constructor(
    @InjectModel(AccessApplication.name)
    private readonly applicationModel: Model<AccessApplicationDocument>,
    @InjectModel(CustomerMaterial.name)
    private readonly materialModel: Model<CustomerMaterialDocument>,
    @InjectModel(ReviewCase.name)
    private readonly reviewCaseModel: Model<ReviewCaseDocument>,
    @InjectModel(KycScenario.name)
    private readonly scenarioModel: Model<KycScenarioDocument>,
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    private readonly customerService: CustomerService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /* ---------------- 申请 CRUD ---------------- */

  async create(dto: CreateApplicationDto, operator: JwtPayload): Promise<AccessApplicationVO> {
    const customer = await this.customerModel.findOne({ _id: dto.customer_id, is_deleted: false });
    if (!customer) throw new NotFoundException("客户不存在");
    const now = new Date();
    const doc = await this.applicationModel.create({
      application_no: await nextBusinessNo(this.connection, "APP"),
      customer_id: customer._id,
      customer_snapshot: {
        name: customer.name,
        customer_code: customer.customer_code,
        customer_kind: customer.customer_kind,
        customer_sub_type: customer.sub_type ?? null,
      },
      status: AccessStatus.DRAFT,
      owner_user_id: new Types.ObjectId(operator.sub),
      owner_name: operator.display_name,
      timeline: [
        {
          at: now,
          by_name: operator.display_name,
          action: "创建申请",
          from_status: null,
          to_status: AccessStatus.DRAFT,
          note: null,
        },
      ],
      created_by: new Types.ObjectId(operator.sub),
      updated_by: new Types.ObjectId(operator.sub),
    });
    return this.toVO(doc.toObject(), await this.loadScenarioMap([doc.scenario_id]));
  }

  async list(query: QueryApplicationDto): Promise<PageResult<AccessApplicationVO>> {
    const page = query.page || 1;
    const pageSize = Math.min(query.page_size || 10, 50);
    const filter: Record<string, unknown> = { is_deleted: false };
    const statuses = parseStatusList(query.status);
    if (statuses.length) filter.status = { $in: statuses };
    if (query.customer_id) filter.customer_id = new Types.ObjectId(query.customer_id);
    if (query.keyword) {
      const pattern = new RegExp(escapeRegExp(query.keyword.trim()), "i");
      filter.$or = [
        { application_no: pattern },
        { "customer_snapshot.name": pattern },
        { "customer_snapshot.customer_code": pattern },
      ];
    }
    const [items, total] = await Promise.all([
      this.applicationModel
        .find(filter)
        .sort({ updated_at: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      this.applicationModel.countDocuments(filter),
    ]);
    const scenarioMap = await this.loadScenarioMap(items.map(item => item.scenario_id));
    return {
      items: items.map(item => this.toVO(item, scenarioMap)),
      total,
      page,
      page_size: pageSize,
    };
  }

  async getById(id: string): Promise<AccessApplicationVO> {
    const doc = await this.findOrFail(id);
    return this.toVO(doc.toObject(), await this.loadScenarioMap([doc.scenario_id]));
  }

  /** 保存草稿：场景/渠道/表单/材料；材料换文件后审核状态复位为待检查 */
  async saveDraft(id: string, dto: SaveDraftDto, operator: JwtPayload): Promise<AccessApplicationVO> {
    const doc = await this.findOrFail(id);
    this.assertEditable(doc);

    if (dto.scenario_id !== undefined) {
      if (dto.scenario_id === null) {
        doc.scenario_id = null;
        doc.scenario_code = null;
        doc.scenario_name = null;
        doc.channel_code = null;
        doc.channel_name = null;
      } else {
        const scenario = await this.scenarioModel.findOne({
          _id: dto.scenario_id,
          is_deleted: false,
          status: "PUBLISHED",
        });
        if (!scenario) throw new BadRequestException("业务类型不存在或未发布");
        doc.scenario_id = scenario._id;
        doc.scenario_code = scenario.scenario_code;
        doc.scenario_name = scenario.scenario_name;
        // 换业务类型后原渠道可能不存在
        if (doc.channel_code && !scenario.channels.some(c => c.channel_code === doc.channel_code)) {
          doc.channel_code = null;
          doc.channel_name = null;
        }
      }
    }

    if (dto.channel_code !== undefined) {
      if (dto.channel_code === null) {
        doc.channel_code = null;
        doc.channel_name = null;
      } else {
        const scenario = doc.scenario_id
          ? await this.scenarioModel.findOne({ _id: doc.scenario_id, is_deleted: false })
          : null;
        const channel = scenario?.channels.find(c => c.channel_code === dto.channel_code);
        if (!channel) {
          throw new BadRequestException("渠道不在所选业务类型内");
        }
        doc.channel_code = channel.channel_code;
        doc.channel_name = channel.channel_name;
      }
    }

    if (dto.form) {
      doc.form = {
        customer_cn_name: dto.form.customer_cn_name ?? doc.form.customer_cn_name ?? null,
        customer_en_name: dto.form.customer_en_name ?? doc.form.customer_en_name ?? null,
        business_note: dto.form.business_note ?? doc.form.business_note ?? null,
      };
    }

    if (dto.materials) {
      const existing = new Map(doc.materials.map(material => [material.material_key, material]));
      doc.materials = dto.materials.map(input => {
        const prev = existing.get(input.material_key);
        const sameFile = prev?.file?.storage_key === input.file?.storage_key;
        return {
          material_key: input.material_key,
          requirement_item_id: input.requirement_item_id ?? null,
          name: input.name,
          source: input.source,
          file: input.file ?? null,
          library_material_id: input.library_material_id ?? null,
          // 文件未变化保留原审核状态；换文件/新增复位为待检查
          status: prev && sameFile ? prev.status : ApplicationMaterialStatus.PENDING,
          return_reason: prev && sameFile ? prev.return_reason : null,
          uploaded_at: prev && sameFile ? prev.uploaded_at : new Date().toISOString(),
        };
      });
    }

    doc.set("updated_by", new Types.ObjectId(operator.sub));
    await doc.save();
    return this.toVO(doc.toObject(), await this.loadScenarioMap([doc.scenario_id]));
  }

  /** 提交合规：生成审核工单（追加型），申请转待审核；review_type=找换/U相关（demo 提交坞） */
  async submit(id: string, reviewType: ReviewType, operator: JwtPayload): Promise<AccessApplicationVO> {
    const doc = await this.findOrFail(id);
    this.assertEditable(doc);
    if (!doc.scenario_id || !doc.channel_code) {
      throw new BadRequestException("请先选择业务类型和渠道");
    }
    const scenario = await this.scenarioModel.findOne({ _id: doc.scenario_id, is_deleted: false }).lean();
    if (!scenario) throw new BadRequestException("业务类型配置已被删除，请重新选择");

    const returned = doc.materials.filter(m => m.status === ApplicationMaterialStatus.RETURNED);
    if (returned.length) {
      throw new BadRequestException(
        `仍有 ${returned.length} 份被退回材料未替换：${returned.map(m => m.name).join("、")}`,
      );
    }
    /* demo 口径：完整度由右侧 KYC 助手动态提示，不做提交硬拦截（合规审核驱动补件回路） */
    const completeness = computeCompleteness(scenario as unknown as ScenarioLean, doc.channel_code, doc.materials);
    if (!doc.materials.length) {
      throw new BadRequestException("请至少上传 1 份材料再提交");
    }

    // 同 客户×业务×渠道 只允许一条活跃申请
    const duplicate = await this.applicationModel.findOne({
      _id: { $ne: doc._id },
      is_deleted: false,
      customer_id: doc.customer_id,
      scenario_id: doc.scenario_id,
      channel_code: doc.channel_code,
      status: { $in: ACTIVE_STATUSES },
    });
    if (duplicate) {
      throw new ConflictException(
        `该客户在此业务类型/渠道下已有申请（${duplicate.application_no}，${duplicate.status}）`,
      );
    }

    const priorCase = await this.reviewCaseModel.exists({ application_id: doc._id, is_deleted: false });
    const channel = scenario.channels.find(c => c.channel_code === doc.channel_code);
    const restrictionText = channel?.restrictions?.length
      ? `渠道限制（${channel.channel_name}）：\n${channel.restrictions.map(r => `- ${r.content}`).join("\n")}`
      : null;
    const requirementParts = [scenario.process_description, restrictionText].filter(Boolean);
    const now = new Date();

    await this.reviewCaseModel.create({
      case_no: await nextBusinessNo(this.connection, "RC"),
      application_id: doc._id,
      application_no: doc.application_no,
      customer_id: doc.customer_id,
      customer_name: doc.customer_snapshot.name,
      customer_code: doc.customer_snapshot.customer_code,
      customer_kind: doc.customer_snapshot.customer_kind,
      customer_sub_type: doc.customer_snapshot.customer_sub_type ?? null,
      scenario_name: doc.scenario_name,
      channel_code: doc.channel_code,
      channel_name: doc.channel_name,
      review_type: reviewType,
      audit_type: priorCase ? ReviewAuditType.RESUBMIT : ReviewAuditType.NEW,
      status: ReviewCaseStatus.PENDING,
      /* 客户主档已移除风险等级；工单风险快照仅保留历史数据 */
      risk_level: null,
      completeness,
      note: doc.form.business_note,
      form_snapshot: { ...doc.form },
      materials_snapshot: doc.materials.map(material => ({ ...material })),
      review_requirement: requirementParts.length ? requirementParts.join("\n") : null,
      submitted_by_name: operator.display_name,
      submitted_at: now,
      created_by: new Types.ObjectId(operator.sub),
      updated_by: new Types.ObjectId(operator.sub),
    });

    const fromStatus = doc.status;
    doc.status = AccessStatus.PENDING_REVIEW;
    doc.review_type = reviewType;
    doc.submitted_at = now;
    // timeline 为 Mixed 数组，原地 push 不触发 Mongoose 变更检测，必须整组赋值
    doc.timeline = [
      ...doc.timeline,
      {
        at: now,
        by_name: operator.display_name,
        action: fromStatus === AccessStatus.DRAFT ? "提交合规审核" : "补件后重新提交",
        from_status: fromStatus,
        to_status: AccessStatus.PENDING_REVIEW,
        note: null,
      },
    ];
    doc.set("updated_by", new Types.ObjectId(operator.sub));
    await doc.save();
    await this.customerService.recordEvent(
      doc.customer_id,
      CustomerEventType.ACCESS,
      "提交准入审核",
      `${doc.scenario_name ?? "未选业务类型"} · ${doc.channel_name ?? "-"} · 提交到合规（${ReviewTypeLabel[reviewType]}），申请 ${doc.application_no}`,
      operator,
    );
    return this.toVO(doc.toObject(), await this.loadScenarioMap([doc.scenario_id]));
  }

  /** 重新提交（demo ⟳）：审核拒绝/已过期/已取消 → 重开为草稿，回工作台继续 */
  async reopen(id: string, operator: JwtPayload): Promise<AccessApplicationVO> {
    const doc = await this.findOrFail(id);
    if (!REOPENABLE_STATUSES.includes(doc.status)) {
      throw new ConflictException(`当前状态（${doc.status}）不支持重新发起`);
    }
    const fromStatus = doc.status;
    doc.status = AccessStatus.DRAFT;
    doc.timeline = [
      ...doc.timeline,
      {
        at: new Date(),
        by_name: operator.display_name,
        action: "重新发起提交",
        from_status: fromStatus,
        to_status: AccessStatus.DRAFT,
        note: null,
      },
    ];
    doc.set("updated_by", new Types.ObjectId(operator.sub));
    await doc.save();
    return this.toVO(doc.toObject(), await this.loadScenarioMap([doc.scenario_id]));
  }

  async cancel(id: string, note: string | undefined, operator: JwtPayload): Promise<AccessApplicationVO> {
    const doc = await this.findOrFail(id);
    this.assertEditable(doc);
    const fromStatus = doc.status;
    doc.status = AccessStatus.CANCELLED;
    doc.timeline = [
      ...doc.timeline,
      {
        at: new Date(),
        by_name: operator.display_name,
        action: "取消申请",
        from_status: fromStatus,
        to_status: AccessStatus.CANCELLED,
        note: note ?? null,
      },
    ];
    doc.set("updated_by", new Types.ObjectId(operator.sub));
    await doc.save();
    return this.toVO(doc.toObject(), await this.loadScenarioMap([doc.scenario_id]));
  }

  /* ---------------- 客户材料库 ---------------- */

  async listCustomerMaterials(customerId: string): Promise<CustomerMaterialVO[]> {
    if (!Types.ObjectId.isValid(customerId)) throw new NotFoundException("客户不存在");
    const docs = await this.materialModel
      .find({ customer_id: new Types.ObjectId(customerId), is_deleted: false })
      .sort({ created_at: -1 })
      .lean();
    return docs.map(doc => ({
      id: String(doc._id),
      customer_id: String(doc.customer_id),
      name: doc.name,
      category: doc.category,
      file: doc.file,
      version: doc.version,
      uploader_name: doc.uploader_name,
      created_at: doc.created_at?.toISOString() ?? new Date().toISOString(),
    }));
  }

  /** 归档材料到客户材料库（仅归档，不进审核队列，PRD §4.7） */
  async archiveMaterials(
    customerId: string,
    dto: ArchiveMaterialsDto,
    operator: JwtPayload,
  ): Promise<CustomerMaterialVO[]> {
    const customer = await this.customerModel.findOne({ _id: customerId, is_deleted: false });
    if (!customer) throw new NotFoundException("客户不存在");
    if (!dto.items.length) throw new BadRequestException("没有可归档的材料");
    for (const item of dto.items) {
      const sameName = await this.materialModel.countDocuments({
        customer_id: customer._id,
        name: item.name,
        is_deleted: false,
      });
      await this.materialModel.create({
        customer_id: customer._id,
        name: item.name,
        category: item.category ?? null,
        file: item.file,
        version: sameName + 1,
        uploader_name: operator.display_name,
        created_by: new Types.ObjectId(operator.sub),
        updated_by: new Types.ObjectId(operator.sub),
      });
    }
    return this.listCustomerMaterials(customerId);
  }

  async deleteCustomerMaterial(id: string, operator: JwtPayload): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException("材料不存在");
    const doc = await this.materialModel.findOne({ _id: id, is_deleted: false });
    if (!doc) throw new NotFoundException("材料不存在");
    doc.is_deleted = true;
    doc.set("deleted_by", new Types.ObjectId(operator.sub));
    doc.set("deleted_at", new Date());
    await doc.save();
  }

  /* ---------------- 内部 ---------------- */

  private async findOrFail(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException("申请不存在");
    const doc = await this.applicationModel.findOne({ _id: id, is_deleted: false });
    if (!doc) throw new NotFoundException("申请不存在");
    return doc;
  }

  private assertEditable(doc: AccessApplicationDocument): void {
    if (!EDITABLE_STATUSES.includes(doc.status)) {
      throw new ConflictException(`当前状态（${doc.status}）不允许该操作`);
    }
  }

  private async loadScenarioMap(ids: Array<Types.ObjectId | null | undefined>) {
    const valid = [...new Set(ids.filter(Boolean).map(String))];
    if (!valid.length) return new Map<string, ScenarioLean>();
    const docs = await this.scenarioModel.find({ _id: { $in: valid } }).lean();
    return new Map(docs.map(doc => [String(doc._id), doc as unknown as ScenarioLean]));
  }

  private toVO(
    doc: AccessApplication & { _id: Types.ObjectId; created_at?: Date; updated_at?: Date },
    scenarioMap: Map<string, ScenarioLean>,
  ): AccessApplicationVO {
    const scenario = doc.scenario_id ? scenarioMap.get(String(doc.scenario_id)) : undefined;
    return {
      id: String(doc._id),
      application_no: doc.application_no,
      customer_id: String(doc.customer_id),
      customer_snapshot: {
        ...doc.customer_snapshot,
        customer_sub_type: doc.customer_snapshot.customer_sub_type ?? null,
      },
      scenario_id: doc.scenario_id ? String(doc.scenario_id) : null,
      scenario_code: doc.scenario_code,
      scenario_name: doc.scenario_name,
      channel_code: doc.channel_code,
      channel_name: doc.channel_name,
      review_type: (doc.review_type as AccessApplicationVO["review_type"]) ?? null,
      form: doc.form,
      materials: doc.materials,
      status: doc.status,
      completeness: scenario && doc.channel_code
        ? computeCompleteness(scenario, doc.channel_code, doc.materials)
        : { done: 0, total: 0 },
      owner_name: doc.owner_name,
      latest_review: doc.latest_review
        ? {
            case_id: doc.latest_review.case_id,
            action: doc.latest_review.action as ReviewDecisionAction,
            reason: doc.latest_review.reason,
            rejected_item_ids: doc.latest_review.rejected_item_ids,
            reviewed_at: doc.latest_review.reviewed_at.toISOString(),
            reviewer_name: doc.latest_review.reviewer_name,
          }
        : null,
      timeline: doc.timeline.map(entry => ({ ...entry, at: entry.at.toISOString() })),
      submitted_at: doc.submitted_at ? doc.submitted_at.toISOString() : null,
      created_at: doc.created_at?.toISOString() ?? "",
      updated_at: doc.updated_at?.toISOString() ?? "",
    };
  }
}

/** 必填材料完整度：按所选渠道的必填材料项统计（demo 四层结构：材料清单挂在渠道下） */
export function computeCompleteness(
  scenario: Pick<ScenarioLean, "channels">,
  channelCode: string,
  materials: ApplicationMaterialVO[],
): AccessCompletenessVO {
  const channel = scenario.channels.find(item => item.channel_code === channelCode);
  const requiredItems = (channel?.sections ?? [])
    .flatMap(section => section.items)
    .filter(item => item.required);
  const done = requiredItems.filter(item =>
    materials.some(
      material =>
        material.requirement_item_id === item.item_id &&
        material.status !== ApplicationMaterialStatus.RETURNED &&
        (material.file || material.source === MaterialSource.LIBRARY),
    ),
  ).length;
  return { done, total: requiredItems.length };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
