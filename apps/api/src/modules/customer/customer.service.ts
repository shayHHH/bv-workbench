import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import {
  AuditEventVO,
  CUSTOMER_CODE_MAX,
  CUSTOMER_CODE_MIN,
  CustomerEventType,
  CustomerEventVO,
  CustomerKind,
  CustomerKindLabel,
  CustomerStatusLabel,
  CustomerVO,
  isValidCustomerCode,
  PageResult,
} from "@bv/shared";
import { FilterQuery, Model, PipelineStage, Types } from "mongoose";
import { JwtPayload } from "../../auth/auth.types";
import { CustomerEvent, CustomerEventDocument } from "./customer-event.schema";
import { Customer, CustomerDocument, CUSTOMER_COLLECTION } from "./customer.schema";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { QueryAuditDto } from "./dto/query-audit.dto";
import { QueryCustomerDto } from "./dto/query-customer.dto";
import { UpdateCustomerDto } from "./dto/update-customer.dto";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

@Injectable()
export class CustomerService {
  constructor(
    @InjectModel(Customer.name) private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(CustomerEvent.name)
    private readonly eventModel: Model<CustomerEventDocument>,
  ) {}

  /** 供其他业务模块（如准入）写入客户档案事件的公开入口 */
  async recordEvent(
    customerId: Types.ObjectId,
    eventType: CustomerEventType,
    title: string,
    detail: string,
    operator?: JwtPayload,
  ): Promise<void> {
    await this.logEvent(customerId, eventType, title, detail, operator);
  }

  /** 追加档案事件（只 insert；失败不阻断主流程，但记录到进程日志） */
  private async logEvent(
    customerId: Types.ObjectId,
    eventType: CustomerEventType,
    title: string,
    detail: string,
    operator?: JwtPayload,
  ): Promise<void> {
    try {
      await this.eventModel.create({
        customer_id: customerId,
        event_type: eventType,
        title,
        detail: detail.slice(0, 500),
        operator_id: operator ? new Types.ObjectId(operator.sub) : null,
        operator_name: operator?.display_name ?? null,
        created_by: operator ? new Types.ObjectId(operator.sub) : null,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[customer-event] 写入失败", error);
    }
  }

  /** 客户档案时间线（倒序）。历史数据没有建档事件时补一条基于 created_at 的展示项 */
  async events(id: string): Promise<CustomerEventVO[]> {
    const doc = await this.findActiveDoc(id);
    const rows = await this.eventModel
      .find({ customer_id: doc._id })
      .sort({ created_at: -1, _id: -1 })
      .limit(100)
      .lean();
    const items: CustomerEventVO[] = rows.map(row => ({
      id: row._id.toString(),
      event_type: row.event_type,
      title: row.title,
      detail: row.detail,
      operator_name: row.operator_name ?? null,
      created_at: (row as any).created_at?.toISOString?.() ?? String((row as any).created_at),
    }));
    if (!rows.some(row => row.event_type === CustomerEventType.CREATED)) {
      items.push({
        id: `synthetic-${doc._id.toString()}`,
        event_type: CustomerEventType.CREATED,
        title: "客户建档",
        detail: `${CustomerKindLabel[doc.customer_kind]}客户 ${doc.customer_code || "无编号"} 已建档`,
        operator_name: null,
        created_at: doc.created_at.toISOString(),
      });
    }
    return items;
  }

  /**
   * 审计日志（demo 合规官/管理员「审计日志」页）：跨客户的档案事件流水，倒序分页。
   * 事件为追加型日志，客户被软删后历史事件仍保留展示（审计不可抹除）。
   */
  async auditEvents(query: QueryAuditDto): Promise<PageResult<AuditEventVO>> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.page_size ?? 20, 100);
    const pipeline: PipelineStage[] = [
      ...(query.event_type ? [{ $match: { event_type: query.event_type } }] : []),
      {
        $lookup: {
          from: CUSTOMER_COLLECTION,
          localField: "customer_id",
          foreignField: "_id",
          as: "customer",
          pipeline: [{ $project: { name: 1, customer_code: 1 } }],
        },
      },
      { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
    ];
    if (query.keyword) {
      const pattern = new RegExp(escapeRegExp(query.keyword.trim()), "i");
      pipeline.push({
        $match: {
          $or: [
            { "customer.name": pattern },
            { "customer.customer_code": pattern },
            { title: pattern },
            { detail: pattern },
            { operator_name: pattern },
          ],
        },
      });
    }
    pipeline.push({
      $facet: {
        items: [
          { $sort: { created_at: -1, _id: -1 } },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
        ],
        total: [{ $count: "count" }],
      },
    });
    const [result] = await this.eventModel.aggregate<{
      items: Array<
        CustomerEvent & {
          _id: Types.ObjectId;
          created_at: Date;
          customer?: { name?: string; customer_code?: string | null };
        }
      >;
      total: Array<{ count: number }>;
    }>(pipeline);
    const items: AuditEventVO[] = (result?.items ?? []).map(row => ({
      id: row._id.toString(),
      customer_id: row.customer_id.toString(),
      customer_name: row.customer?.name ?? "已删除客户",
      customer_code: row.customer?.customer_code ?? null,
      event_type: row.event_type,
      title: row.title,
      detail: row.detail,
      operator_name: row.operator_name ?? null,
      created_at: row.created_at?.toISOString?.() ?? String(row.created_at),
    }));
    return { items, total: result?.total?.[0]?.count ?? 0, page, page_size: pageSize };
  }

  /**
   * 客户列表：顶层只返回直客/中介（对齐原型），中介行内联 sub_customers。
   * 关键词覆盖名称/编号/电话/交易员，并且命中下级客户时带出其所属中介。
   */
  async list(query: QueryCustomerDto): Promise<PageResult<CustomerVO> & { total_all: number }> {
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? 8;
    // 软删除集合的常规查询必须默认过滤 is_deleted:false（规范 §5.3）
    const filter: FilterQuery<CustomerDocument> = {
      is_deleted: false,
      customer_kind: { $ne: CustomerKind.SUB_CUSTOMER },
    };
    if (query.customer_status) filter.customer_status = query.customer_status;

    if (query.customer_kind === CustomerKind.SUB_CUSTOMER) {
      // 筛选“中介下级客户”＝有下级客户的中介（对齐原型行为）
      const parentIds = await this.customerModel.distinct("parent_id", {
        is_deleted: false,
        customer_kind: CustomerKind.SUB_CUSTOMER,
        parent_id: { $ne: null },
      });
      filter._id = { $in: parentIds };
    } else if (query.customer_kind) {
      filter.customer_kind = query.customer_kind;
    }

    if (query.keyword) {
      const pattern = new RegExp(escapeRegExp(query.keyword.trim()), "i");
      // 关键词命中下级客户时，把所属中介带进结果
      const matchedSubParents = await this.customerModel.distinct("parent_id", {
        is_deleted: false,
        customer_kind: CustomerKind.SUB_CUSTOMER,
        parent_id: { $ne: null },
        $or: [{ name: pattern }, { customer_code: pattern }],
      });
      filter.$or = [
        { name: pattern },
        { customer_code: pattern },
        { phone: pattern },
        { _id: { $in: matchedSubParents } },
      ];
    }

    const [items, total, totalAll] = await Promise.all([
      this.customerModel
        .find(filter)
        .sort({ created_at: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      this.customerModel.countDocuments(filter),
      this.customerModel.countDocuments({
        is_deleted: false,
        customer_kind: { $ne: CustomerKind.SUB_CUSTOMER },
      }),
    ]);

    // 本页中介的下级客户一次取回并归组
    const intermediaryIds = items
      .filter(item => item.customer_kind === CustomerKind.INTERMEDIARY)
      .map(item => item._id);
    const subs = intermediaryIds.length
      ? await this.customerModel
          .find({ parent_id: { $in: intermediaryIds }, is_deleted: false })
          .sort({ created_at: -1 })
          .lean()
      : [];
    const subGroups = new Map<string, CustomerVO[]>();
    const parentNames = new Map(items.map(item => [item._id.toString(), item.name]));
    for (const sub of subs) {
      const key = sub.parent_id!.toString();
      if (!subGroups.has(key)) subGroups.set(key, []);
      subGroups.get(key)!.push(this.toVO(sub, parentNames));
    }

    return {
      items: items.map(item => ({
        ...this.toVO(item, parentNames),
        ...(item.customer_kind === CustomerKind.INTERMEDIARY
          ? { sub_customers: subGroups.get(item._id.toString()) ?? [] }
          : {}),
      })),
      total,
      total_all: totalAll,
      page,
      page_size: pageSize,
    };
  }

  async getById(id: string): Promise<CustomerVO> {
    const doc = await this.findActiveDoc(id);
    const parentNames = await this.resolveParentNames([doc.parent_id]);
    const vo = this.toVO(doc.toObject(), parentNames);
    // 中介详情内联下级客户（与列表行为一致，供详情抽屉使用）
    if (doc.customer_kind === CustomerKind.INTERMEDIARY) {
      const subs = await this.customerModel
        .find({ parent_id: doc._id, is_deleted: false })
        .sort({ created_at: -1 })
        .lean();
      const selfName = new Map([[doc._id.toString(), doc.name]]);
      vo.sub_customers = subs.map(sub => this.toVO(sub, selfName));
    }
    return vo;
  }

  /** 下一个可用客户编号（编号区间固定且数据量有限，全量取码可接受） */
  async nextAvailableCode(): Promise<string> {
    const used = new Set(
      (await this.customerModel.distinct("customer_code", { customer_code: { $ne: null } })) as string[],
    );
    for (let code = CUSTOMER_CODE_MIN; code <= CUSTOMER_CODE_MAX; code++) {
      const text = String(code);
      if (!used.has(text)) return text;
    }
    throw new ConflictException("客户编号区间已用尽");
  }

  async create(dto: CreateCustomerDto, operator?: JwtPayload): Promise<CustomerVO> {
    const isSub = dto.customer_kind === CustomerKind.SUB_CUSTOMER;
    let parentId: Types.ObjectId | null = null;

    if (isSub) {
      parentId = await this.validateParent(dto.parent_id);
    } else if (dto.parent_id) {
      throw new BadRequestException("仅中介下级客户可指定所属中介");
    }

    const code = dto.customer_code?.trim() || null;
    if (!code && !isSub) throw new BadRequestException("请填写客户编号");
    if (code) await this.validateCode(code);

    try {
      const doc = await this.customerModel.create({
        customer_code: code,
        name: dto.name.trim(),
        customer_kind: dto.customer_kind,
        parent_id: parentId,
        sub_type: dto.sub_type ?? null,
        region: dto.region ?? null,
        phone: dto.phone?.trim() || null,
        remark: dto.remark?.trim() || null,
        created_by: operator ? new Types.ObjectId(operator.sub) : null,
      });
      await this.logEvent(
        doc._id,
        CustomerEventType.CREATED,
        "新建客户",
        `${CustomerKindLabel[dto.customer_kind]}客户 ${code || "无编号"} 已创建${dto.remark?.trim() ? `，备注：${dto.remark.trim()}` : ""}`,
        operator,
      );
      const parentNames = await this.resolveParentNames([doc.parent_id]);
      return this.toVO(doc.toObject(), parentNames);
    } catch (error: unknown) {
      // 唯一索引兜底（并发下先查后插可能撞车）
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException(`客户编号 ${code} 已被占用，请换一个编号`);
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateCustomerDto, operator?: JwtPayload): Promise<CustomerVO> {
    const doc = await this.findActiveDoc(id);
    /* 变更前快照：用于产出带前后值的档案事件（规范 §5.3） */
    const before = {
      kind: doc.customer_kind,
      status: doc.customer_status,
      parent: doc.parent_id ? doc.parent_id.toString() : null,
      profile: {
        customer_code: doc.customer_code,
        name: doc.name,
        phone: doc.phone,
        region: doc.region,
        remark: doc.remark,
        sub_type: doc.sub_type,
      },
    };
    const targetKind = dto.customer_kind ?? doc.customer_kind;

    /* 类型变更校验（对齐原型编辑弹窗：直客⇄中介⇄中介下级） */
    if (targetKind !== doc.customer_kind && doc.customer_kind === CustomerKind.INTERMEDIARY) {
      const hasChildren = await this.customerModel.exists({ parent_id: doc._id, is_deleted: false });
      if (hasChildren) throw new BadRequestException("该中介名下仍有下级客户，不能变更客户类型");
    }
    if (targetKind === CustomerKind.SUB_CUSTOMER) {
      const parentRef = dto.parent_id ?? doc.parent_id?.toString() ?? null;
      const parentId = await this.validateParent(parentRef);
      if (parentId.equals(doc._id)) throw new BadRequestException("客户不能挂载到自己名下");
      doc.parent_id = parentId;
    } else {
      doc.parent_id = null;
    }
    doc.customer_kind = targetKind;

    if (dto.customer_code !== undefined) {
      const code = dto.customer_code?.trim() || null;
      if (!code && targetKind !== CustomerKind.SUB_CUSTOMER) {
        throw new BadRequestException("直客/中介必须保留客户编号");
      }
      if (code && code !== doc.customer_code) await this.validateCode(code, doc._id);
      doc.customer_code = code;
    } else if (targetKind !== CustomerKind.SUB_CUSTOMER && !doc.customer_code) {
      throw new BadRequestException("直客/中介必须填写客户编号");
    }

    if (dto.name !== undefined) doc.name = dto.name.trim();
    if (dto.sub_type !== undefined) doc.sub_type = dto.sub_type ?? null;
    if (dto.sub_type !== undefined && targetKind === CustomerKind.SUB_CUSTOMER) {
      doc.sub_type = dto.sub_type ?? null;
    }
    if (dto.region !== undefined) doc.region = dto.region ?? null;
    if (dto.phone !== undefined) doc.phone = dto.phone?.trim() || null;
    if (dto.remark !== undefined) doc.remark = dto.remark?.trim() || null;
    if (dto.customer_status !== undefined) doc.customer_status = dto.customer_status;
    if (operator) doc.set("updated_by", new Types.ObjectId(operator.sub));

    await doc.save();
    const parentNames = await this.resolveParentNames([doc.parent_id]);

    /* 按变更类型分别落档案事件 */
    const note = dto.change_note?.trim() || "";
    if (doc.customer_kind !== before.kind) {
      const parentSuffix =
        doc.customer_kind === CustomerKind.SUB_CUSTOMER && doc.parent_id
          ? `（挂载 ${parentNames.get(doc.parent_id.toString()) ?? "指定中介"}）`
          : "";
      await this.logEvent(
        doc._id,
        CustomerEventType.KIND_CHANGED,
        "客户类型变更",
        `${CustomerKindLabel[before.kind]} → ${CustomerKindLabel[doc.customer_kind]}${parentSuffix}`,
        operator,
      );
    } else if ((doc.parent_id ? doc.parent_id.toString() : null) !== before.parent && doc.customer_kind === CustomerKind.SUB_CUSTOMER) {
      await this.logEvent(
        doc._id,
        CustomerEventType.PROFILE_UPDATED,
        "所属中介变更",
        `已改挂至 ${doc.parent_id ? (parentNames.get(doc.parent_id.toString()) ?? "指定中介") : "无"}`,
        operator,
      );
    }
    if (doc.customer_status !== before.status) {
      await this.logEvent(
        doc._id,
        CustomerEventType.STATUS_CHANGED,
        "状态变更",
        `${CustomerStatusLabel[before.status]} → ${CustomerStatusLabel[doc.customer_status]}${note ? `：${note}` : ""}`,
        operator,
      );
    }
    const profileFieldLabels: Record<keyof typeof before.profile, string> = {
      customer_code: "客户编号",
      name: "客户名称",
      phone: "联系电话",
      region: "地区",
      remark: "备注",
      sub_type: "下级主体类型",
    };
    const changedFields = (Object.keys(before.profile) as (keyof typeof before.profile)[])
      .filter(key => (doc.get(key) ?? null) !== (before.profile[key] ?? null))
      .map(key => profileFieldLabels[key]);
    if (changedFields.length) {
      await this.logEvent(
        doc._id,
        CustomerEventType.PROFILE_UPDATED,
        "资料更新",
        `更新了${changedFields.join("、")}${note && doc.customer_status === before.status ? `：${note}` : ""}`,
        operator,
      );
    }

    return this.toVO(doc.toObject(), parentNames);
  }

  async softDelete(id: string, operator?: JwtPayload): Promise<void> {
    const doc = await this.findActiveDoc(id);
    const hasActiveChildren = await this.customerModel.exists({
      parent_id: doc._id,
      is_deleted: false,
    });
    if (hasActiveChildren) {
      throw new BadRequestException("该中介名下仍有下级客户，请先处理下级客户");
    }
    doc.is_deleted = true;
    doc.set("deleted_at", new Date());
    if (operator) doc.set("deleted_by", new Types.ObjectId(operator.sub));
    await doc.save();
    await this.logEvent(
      doc._id,
      CustomerEventType.DELETED,
      "客户删除",
      `${CustomerKindLabel[doc.customer_kind]}客户 ${doc.customer_code || "无编号"} 已删除（软删除）`,
      operator,
    );
  }

  private async validateParent(parentRef: string | null | undefined): Promise<Types.ObjectId> {
    if (!parentRef) throw new BadRequestException("请选择所属中介");
    if (!Types.ObjectId.isValid(parentRef)) throw new BadRequestException("所属中介 ID 不合法");
    const parent = await this.customerModel.findOne({ _id: parentRef, is_deleted: false }).lean();
    if (!parent) throw new BadRequestException("所属中介不存在");
    if (parent.customer_kind !== CustomerKind.INTERMEDIARY) {
      throw new BadRequestException("所属中介必须是中介类型客户");
    }
    return parent._id;
  }

  private async validateCode(code: string, excludeId?: Types.ObjectId): Promise<void> {
    if (!isValidCustomerCode(code)) {
      throw new BadRequestException(
        `客户编号必须是 ${CUSTOMER_CODE_MIN}-${CUSTOMER_CODE_MAX} 之间的五位数字`,
      );
    }
    const exists = await this.customerModel.exists({
      customer_code: code,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    });
    if (exists) throw new ConflictException(`客户编号 ${code} 已被占用，请换一个编号`);
  }

  private async findActiveDoc(id: string): Promise<CustomerDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException("客户 ID 不合法");
    const doc = await this.customerModel.findOne({ _id: id, is_deleted: false });
    if (!doc) throw new NotFoundException("客户不存在");
    return doc;
  }

  private async resolveParentNames(
    parentIds: (Types.ObjectId | null | undefined)[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(parentIds.filter((v): v is Types.ObjectId => !!v).map(v => v.toString()))];
    if (!ids.length) return new Map();
    const parents = await this.customerModel
      .find({ _id: { $in: ids } })
      .select({ name: 1 })
      .lean();
    return new Map(parents.map(p => [p._id.toString(), p.name]));
  }

  /** 实体 -> 对外 VO：ObjectId 序列化为字符串，不外泄审计人等内部字段（规范 §7.3） */
  private toVO(doc: Record<string, any>, parentNames: Map<string, string>): CustomerVO {
    const parentId = doc.parent_id ? doc.parent_id.toString() : null;
    return {
      id: doc._id.toString(),
      customer_code: doc.customer_code ?? null,
      name: doc.name,
      customer_kind: doc.customer_kind,
      parent_id: parentId,
      parent_name: parentId ? (parentNames.get(parentId) ?? null) : null,
      sub_type: doc.sub_type ?? null,
      region: doc.region ?? null,
      phone: doc.phone ?? null,
      remark: doc.remark ?? null,
      customer_status: doc.customer_status,
      created_at: doc.created_at?.toISOString?.() ?? String(doc.created_at),
      updated_at: doc.updated_at?.toISOString?.() ?? String(doc.updated_at),
    };
  }
}
