import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectConnection, InjectModel } from "@nestjs/mongoose";
import {
  AccessToKycBadge,
  BUILTIN_ROLES,
  CustomBusinessTypeVO,
  DispatchChannel,
  DispatchStatus,
  FreezeState,
  FundingKind,
  fundingKindOf,
  fundingOwnerRole,
  isValidTxHash,
  TX_HASH_FORMAT_HINTS,
  KYC_BADGE_NONE,
  OrderKycBadge,
  OrderListStatsVO,
  PageResult,
  PayoutOrderVO,
  PROFIT_RATE_CONFIG,
  QuoteCandidateVO,
  TradeOrderStatus,
  TradeOrderVO,
  TreasuryAccountVO,
  VaAccountVO,
  type FileRef,
} from "@bv/shared";
import { Connection, FilterQuery, Model, Types } from "mongoose";
import { JwtPayload } from "../../auth/auth.types";
import { HandoffService } from "../department/handoff.service";
import { nextBusinessNo } from "../../common/sequence";
import { AccessApplication, AccessApplicationDocument } from "../access/access-application.schema";
import { Customer, CustomerDocument } from "../customer/customer.schema";
import { KycScenario, KycScenarioDocument } from "../kyc/kyc-scenario.schema";
import { QuoteRecord, QuoteRecordDocument } from "../quote/schemas/quote-record.schema";
import {
  CreateDispatchDto,
  CreateOrderDto,
  ExceptionMarkDto,
  ExceptionResolveDto,
  FundingActionDto,
  QueryOrderDto,
  UpdateOrderDto,
} from "./dto/order.dto";
import { CustomBusinessType, CustomBusinessTypeDocument } from "./schemas/custom-business-type.schema";
import { PayoutOrder, PayoutOrderDocument } from "./schemas/payout-order.schema";
import { TradeOrder, TradeOrderDocument } from "./schemas/trade-order.schema";
import { TreasuryAccount, TreasuryAccountDocument } from "./schemas/treasury-account.schema";
import { VaAccount, VaAccountDocument } from "./schemas/va-account.schema";

const num = (value: unknown): number => (value == null ? 0 : Number(String(value)));
const ROLE_NAME = new Map(BUILTIN_ROLES.map(role => [role.code, role.name]));

/** demo 表2 归一后的排序：同客户同业务类型取最优状态 */
const ADMISSION_RANK: string[] = [
  "APPROVED",
  "PENDING_REVIEW",
  "SUPPLEMENT_REQUIRED",
  "EXPIRED",
  "SUSPENDED",
  "REJECTED",
  "CANCELLED",
  "DRAFT",
];

@Injectable()
export class OrderService {
  constructor(
    @InjectModel(TradeOrder.name) private readonly orderModel: Model<TradeOrderDocument>,
    @InjectModel(PayoutOrder.name) private readonly payoutModel: Model<PayoutOrderDocument>,
    @InjectModel(TreasuryAccount.name) private readonly treasuryModel: Model<TreasuryAccountDocument>,
    @InjectModel(VaAccount.name) private readonly vaModel: Model<VaAccountDocument>,
    @InjectModel(Customer.name) private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(AccessApplication.name)
    private readonly applicationModel: Model<AccessApplicationDocument>,
    @InjectModel(QuoteRecord.name) private readonly quoteRecordModel: Model<QuoteRecordDocument>,
    @InjectModel(KycScenario.name) private readonly scenarioModel: Model<KycScenarioDocument>,
    @InjectModel(CustomBusinessType.name)
    private readonly customBusinessTypeModel: Model<CustomBusinessTypeDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly handoffService: HandoffService,
  ) {}

  /* ---------------- 自定义准入业务类型 ---------------- */

  /** 全员共享；order_count 供前端删除前二次确认展示 */
  async listCustomBusinessTypes(): Promise<CustomBusinessTypeVO[]> {
    const docs = await this.customBusinessTypeModel
      .find({ is_deleted: false })
      .sort({ created_at: -1 })
      .lean();
    if (!docs.length) return [];
    const counts = await this.orderModel.aggregate<{ _id: string; count: number }>([
      { $match: { is_deleted: false, business_type: { $in: docs.map(doc => doc.name) } } },
      { $group: { _id: "$business_type", count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map(row => [row._id, row.count]));
    return docs.map(doc => ({
      id: String(doc._id),
      name: doc.name,
      created_by_name: doc.created_by_name ?? null,
      order_count: countMap.get(doc.name) ?? 0,
      created_at: doc.created_at?.toISOString?.() ?? String(doc.created_at),
    }));
  }

  async createCustomBusinessType(name: string, operator: JwtPayload): Promise<CustomBusinessTypeVO> {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException("请填写业务类型名称");
    /* 与 KYC 业务类型重名会让下拉出现两条同名项，直接拒绝并提示改用已有配置 */
    const scenario = await this.scenarioModel.findOne({ scenario_name: trimmed, is_deleted: false }).lean();
    if (scenario) throw new ConflictException(`「${trimmed}」已是 KYC 配置的业务类型，请直接选择`);
    const existing = await this.customBusinessTypeModel.findOne({ name: trimmed, is_deleted: false }).lean();
    if (existing) throw new ConflictException(`自定义业务类型「${trimmed}」已存在`);
    const doc = await this.customBusinessTypeModel.create({
      name: trimmed,
      created_by_name: operator.display_name ?? null,
      created_by: new Types.ObjectId(operator.sub),
    });
    return {
      id: String(doc._id),
      name: doc.name,
      created_by_name: doc.created_by_name ?? null,
      order_count: 0,
      created_at: doc.created_at?.toISOString?.() ?? String(doc.created_at),
    };
  }

  /**
   * 删除自定义业务类型。订单上的 business_type 是名称快照而非外键，
   * 删除不影响历史订单展示，仅使其不再出现在新建订单的下拉里（前端按 order_count 做二次确认）。
   */
  async deleteCustomBusinessType(id: string, operator: JwtPayload): Promise<void> {
    const doc = await this.customBusinessTypeModel.findOne({ _id: id, is_deleted: false });
    if (!doc) throw new NotFoundException("自定义业务类型不存在");
    doc.is_deleted = true;
    doc.set("deleted_by", new Types.ObjectId(operator.sub));
    doc.set("deleted_at", new Date());
    await doc.save();
  }

  /* ---------------- 建单 ---------------- */

  async create(dto: CreateOrderDto, operator: JwtPayload): Promise<TradeOrderVO> {
    const customer = await this.customerModel.findOne({ _id: dto.customer_id, is_deleted: false });
    if (!customer) throw new NotFoundException("客户不存在");

    let quote: TradeOrder["quote"] = null;
    if (dto.quote_record_id) {
      const record = await this.quoteRecordModel.findOne({ _id: dto.quote_record_id }).lean();
      if (record) {
        quote = {
          quote_record_id: String(record._id),
          deal_rate: String(record.result),
          cost_rate: null,
          source: "报价记录",
          quoted_at: record.quoted_at ?? null,
          quoted_by: record.operator_name ?? null,
          fee: null,
        };
      }
    }

    /* 业务类型改存 scenario_id（审计 1.2.10）：名称仅作快照，改名不断链 */
    let scenarioId: Types.ObjectId | null = null;
    let businessType = dto.business_type ?? null;
    if (dto.business_scenario_id) {
      const scenario = await this.scenarioModel.findOne({ _id: dto.business_scenario_id, is_deleted: false }).lean();
      if (scenario) {
        scenarioId = scenario._id;
        businessType = scenario.scenario_name;
      }
    }
    const kyc = await this.kycBadgeFor(customer._id, businessType, scenarioId);
    const pendingKyc = !kyc.ready;
    const now = new Date();
    const actor = this.actorLabel(operator);
    const timeline: TradeOrder["timeline"] = [];
    timeline.push({
      at: now,
      title: "订单创建",
      detail: `${dto.trade_type} · 卖出 ${dto.sell_currency} ${fmt(dto.sell_amount)} 买入 ${dto.buy_currency} ${fmt(dto.buy_amount)} · 创建人 ${operator.display_name}`,
      actor,
    });
    if (quote) {
      timeline.unshift({
        at: now,
        title: "关联报价",
        detail: `报价 ${quote.deal_rate}（${quote.quoted_by ?? "—"} · ${quote.quoted_at ? fmtTime(quote.quoted_at) : "—"}）`,
        actor,
      });
    }
    timeline.unshift(
      pendingKyc
        ? {
            at: now,
            title: "合规提示",
            detail: `「${businessType || "未选业务类型"}」准入状态「${kyc.label}」，本单进入待KYC；该业务类型准入通过后自动进入待客户入款`,
            actor: "系统",
          }
        : {
            at: now,
            title: "KYC 校验通过",
            detail: `建单时客户已准入（${kyc.label}），订单直接进入待客户入款`,
            actor: "系统",
          },
    );

    const doc = await this.orderModel.create({
      order_no: await nextBusinessNo(this.connection, "TO"),
      customer_id: customer._id,
      customer_name: customer.name,
      customer_code: customer.customer_code,
      person_name: dto.person_name?.trim() || null,
      business_type: businessType,
      business_scenario_id: scenarioId,
      trade_type: dto.trade_type,
      sell_currency: dto.sell_currency,
      sell_amount: Types.Decimal128.fromString(String(dto.sell_amount)),
      buy_currency: dto.buy_currency,
      buy_amount: Types.Decimal128.fromString(String(dto.buy_amount)),
      rate: dto.rate,
      pay_method: dto.pay_method,
      remark: dto.remark?.trim() || null,
      quote,
      status: pendingKyc ? TradeOrderStatus.PENDING_KYC : TradeOrderStatus.AWAITING_INFLOW,
      handler_name: operator.display_name,
      owner_user_id: new Types.ObjectId(operator.sub),
      timeline,
      created_by: new Types.ObjectId(operator.sub),
      updated_by: new Types.ObjectId(operator.sub),
    });
    return this.toVO(doc.toObject(), kyc);
  }

  /* ---------------- 编辑订单 ---------------- */

  /** 排单进入审核后订单要素锁定，改动需先驳回排单 */
  private static readonly EDITABLE_STATUSES: TradeOrderStatus[] = [
    TradeOrderStatus.PENDING_KYC,
    TradeOrderStatus.AWAITING_INFLOW,
    TradeOrderStatus.AWAITING_DISPATCH,
  ];

  /**
   * 编辑交易订单（初级/高级交易员）。
   * 待出款排单状态下资金已冻结，改动买入金额/币种会先校验目标账户余额，再释放旧冻结并按新值重新冻结。
   */
  async update(id: string, dto: UpdateOrderDto, operator: JwtPayload): Promise<TradeOrderVO> {
    const doc = await this.findOrFail(id);
    if (!OrderService.EDITABLE_STATUSES.includes(doc.status)) {
      throw new ConflictException(`当前状态（${doc.status}）不允许编辑订单；排单审核中或之后的订单需先驳回排单`);
    }
    if (doc.exception) throw new ConflictException("订单存在未解除的附加异常，请先处理异常再编辑");

    const changes: string[] = [];
    const before = {
      sellCurrency: doc.sell_currency,
      sellAmount: num(doc.sell_amount),
      buyCurrency: doc.buy_currency,
      buyAmount: num(doc.buy_amount),
    };

    /* 业务类型：传 scenario_id 时以 KYC 配置的名称为准，自定义类型只存名称 */
    if (dto.business_scenario_id !== undefined || dto.business_type !== undefined) {
      let scenarioId: Types.ObjectId | null = null;
      let businessType = dto.business_type ?? null;
      if (dto.business_scenario_id) {
        const scenario = await this.scenarioModel
          .findOne({ _id: dto.business_scenario_id, is_deleted: false })
          .lean();
        if (scenario) {
          scenarioId = scenario._id;
          businessType = scenario.scenario_name;
        }
      }
      if (doc.business_type !== businessType) {
        changes.push(`业务类型 ${doc.business_type || "未选"} → ${businessType || "未选"}`);
      }
      doc.business_type = businessType;
      doc.business_scenario_id = scenarioId;
    }

    if (dto.person_name !== undefined) doc.person_name = dto.person_name?.trim() || null;
    if (dto.remark !== undefined) doc.remark = dto.remark?.trim() || null;
    if (dto.trade_type !== undefined && dto.trade_type !== doc.trade_type) {
      changes.push(`交易类型 ${doc.trade_type} → ${dto.trade_type}`);
      doc.trade_type = dto.trade_type;
    }
    if (dto.pay_method !== undefined && dto.pay_method !== doc.pay_method) {
      changes.push(`收款方式 ${doc.pay_method} → ${dto.pay_method}`);
      doc.pay_method = dto.pay_method;
    }
    if (dto.rate !== undefined && dto.rate !== doc.rate) {
      changes.push(`执行汇率 ${doc.rate} → ${dto.rate}`);
      doc.rate = dto.rate;
    }
    if (dto.sell_currency !== undefined) doc.sell_currency = dto.sell_currency;
    if (dto.sell_amount !== undefined) doc.sell_amount = Types.Decimal128.fromString(String(dto.sell_amount));
    if (dto.buy_currency !== undefined) doc.buy_currency = dto.buy_currency;
    if (dto.buy_amount !== undefined) doc.buy_amount = Types.Decimal128.fromString(String(dto.buy_amount));

    const sellChanged =
      doc.sell_currency !== before.sellCurrency || Math.abs(num(doc.sell_amount) - before.sellAmount) > 0.009;
    const buyChanged =
      doc.buy_currency !== before.buyCurrency || Math.abs(num(doc.buy_amount) - before.buyAmount) > 0.009;
    if (sellChanged) {
      changes.push(`客户卖出 ${before.sellCurrency} ${fmt(before.sellAmount)} → ${doc.sell_currency} ${fmt(num(doc.sell_amount))}`);
    }
    if (buyChanged) {
      changes.push(`客户买入 ${before.buyCurrency} ${fmt(before.buyAmount)} → ${doc.buy_currency} ${fmt(num(doc.buy_amount))}`);
    }

    if (!changes.length && dto.person_name === undefined && dto.remark === undefined) {
      throw new BadRequestException("没有需要保存的改动");
    }

    /* 已冻结且买入侧有变化时重算冻结：先确认目标账户余额够，再释放旧冻结并重新冻结 */
    if (buyChanged && doc.freeze?.state === FreezeState.FROZEN) {
      await this.refreezeForEdit(doc, before, operator);
    }

    /* 待客户入款状态改了应收金额时，此前登记的付款驳回标记失去意义 */
    if (sellChanged && doc.status === TradeOrderStatus.AWAITING_INFLOW) doc.payment_rejected = null;

    this.log(doc, "订单信息修改", changes.join("；"), operator);
    doc.set("updated_by", new Types.ObjectId(operator.sub));
    await doc.save();
    return this.toVO(doc.toObject(), await this.kycBadgeForDoc(doc));
  }

  /**
   * 编辑导致买入侧变化时重算冻结。数据库为单机部署无事务，
   * 因此先做余额预检，再释放旧冻结、冻结新金额；重新冻结失败会补偿回滚到原冻结额，避免资金账户悬空。
   */
  private async refreezeForEdit(
    doc: TradeOrderDocument,
    before: { buyCurrency: string; buyAmount: number },
    operator: JwtPayload,
  ): Promise<void> {
    const oldFreeze = { ...doc.freeze! };
    const oldAmount = num(oldFreeze.amount);
    const newAmount = num(doc.buy_amount);
    const targetKey = await this.payoutAccountKeyFor(doc);
    const target = targetKey ? await this.treasuryModel.findOne({ key: targetKey, is_deleted: false }) : null;
    if (!target) {
      throw new BadRequestException(`未找到可冻结的 ${doc.buy_currency} 出款账户，请先在资金账户中配置后再修改金额`);
    }
    /* 同账户时释放的旧冻结会回到可用余额，一并计入预检 */
    const availableAfterRelease =
      num(target.available) + (target.key === oldFreeze.account_key ? oldAmount : 0);
    if (availableAfterRelease < newAmount) {
      throw new BadRequestException(
        `${target.name} 可用余额不足（调整后可用 ${fmt(availableAfterRelease)}，需冻结 ${fmt(newAmount)}），请先补仓或调整金额`,
      );
    }

    await this.releaseFunds(doc);
    try {
      await this.freezeFunds(doc, operator);
    } catch (error) {
      /* 预检后仍失败（并发改动余额）：把旧冻结原样恢复，避免订单处于已释放但未重新冻结的悬空状态 */
      const source = await this.treasuryModel.findOne({ key: oldFreeze.account_key, is_deleted: false });
      if (source) {
        source.available = Types.Decimal128.fromString(String(round2(num(source.available) - oldAmount)));
        source.frozen = Types.Decimal128.fromString(String(round2(num(source.frozen) + oldAmount)));
        await source.save();
      }
      doc.freeze = { ...oldFreeze, state: FreezeState.FROZEN };
      throw error;
    }
    this.log(
      doc,
      "冻结金额调整",
      `随订单修改由 ${before.buyCurrency} ${fmt(oldAmount)} 调整为 ${doc.buy_currency} ${fmt(newAmount)}（${doc.freeze?.account_name ?? "-"}）`,
      operator,
    );
  }

  /** 建单弹窗：客户近期报价记录（真实 quote_records） */
  async quoteCandidates(customerId: string): Promise<QuoteCandidateVO[]> {
    if (!Types.ObjectId.isValid(customerId)) return [];
    const records = await this.quoteRecordModel
      .find({ customer_id: new Types.ObjectId(customerId), is_deleted: false })
      .sort({ quoted_at: -1 })
      .limit(10)
      .lean();
    return records.map(record => ({
      quote_record_id: String(record._id),
      trade_type: record.trade_type,
      prefix: record.prefix ?? null,
      result: String(record.result),
      quoted_at: record.quoted_at?.toISOString() ?? "",
      operator_name: record.operator_name ?? null,
    }));
  }

  /* ---------------- 列表 / 详情 ---------------- */

  async list(query: QueryOrderDto, operator?: JwtPayload): Promise<PageResult<TradeOrderVO> & { stats: OrderListStatsVO }> {
    const page = query.page || 1;
    const pageSize = Math.min(query.page_size || 10, 50);
    const filter: FilterQuery<TradeOrderDocument> = { is_deleted: false };
    if (query.status) {
      const valid = new Set(Object.values(TradeOrderStatus) as string[]);
      const statuses = query.status.split(",").map(s => s.trim()).filter(s => valid.has(s));
      if (statuses.length) filter.status = { $in: statuses };
    }
    if (query.customer_id) filter.customer_id = new Types.ObjectId(query.customer_id);
    const createdRange: Record<string, Date> = {};
    const createdFrom = Number(query.created_from);
    const createdTo = Number(query.created_to);
    if (Number.isFinite(createdFrom) && createdFrom > 0) createdRange.$gte = new Date(createdFrom);
    if (Number.isFinite(createdTo) && createdTo > 0) createdRange.$lte = new Date(createdTo);
    if (Object.keys(createdRange).length) filter.created_at = createdRange;
    if (query.inflow_kind) filter.sell_currency = query.inflow_kind === "chain" ? "USDT" : { $ne: "USDT" };
    if (query.outflow_kind) filter.buy_currency = query.outflow_kind === "chain" ? "USDT" : { $ne: "USDT" };
    if (query.flag === "exception") filter.exception = { $ne: null };
    if (query.flag === "payment_rejected") filter.payment_rejected = { $ne: null };
    if (query.flag === "dispatch_rejected") filter.dispatch_rejected = { $ne: null };
    if (query.flag === "rejected")
      this.appendAnd(filter, { $or: [{ payment_rejected: { $ne: null } }, { dispatch_rejected: { $ne: null } }] });
    if (query.keyword) {
      const pattern = new RegExp(escapeRegExp(query.keyword.trim()), "i");
      this.appendAnd(filter, {
        $or: [
          { order_no: pattern },
          { customer_name: pattern },
          { customer_code: pattern },
          { trade_type: pattern },
        ],
      });
    }
    /* 我的待办 = 本人岗位队列 ∪ 代班岗位队列（业务交接期间接手人在自己工作台看到对方的活） */
    const actingRoles = [
      ...new Set([
        ...(operator?.role_code ? [operator.role_code] : []),
        ...(await this.handoffService.activeRoleCodes(operator?.sub)),
      ]),
    ];
    const todoFilter = this.myTodoFilter(actingRoles);
    if (query.scope === "mine") this.appendAnd(filter, todoFilter ?? { _id: null });
    /* 附加异常的订单不再同时出现在正常状态审核列表里，只在「附加异常」页签（flag=exception）
       和运营经理的异常待办（scope=mine）里可见；按状态筛选或个人待办时一律排除 */
    const actsAsManager = actingRoles.includes("MANAGER");
    const wantsExceptionOrders = query.flag === "exception" || (query.scope === "mine" && actsAsManager);
    if (!wantsExceptionOrders && (query.status || query.scope === "mine")) filter.exception = null;
    const todoCountFilter: FilterQuery<TradeOrderDocument> = { is_deleted: false };
    if (todoFilter) this.appendAnd(todoCountFilter, todoFilter);
    if (!actsAsManager) todoCountFilter.exception = null;
    const [items, total, statuses, all] = await Promise.all([
      this.orderModel
        .find(filter)
        .sort({ created_at: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      this.orderModel.countDocuments(filter),
      this.orderModel.aggregate<{ _id: string; count: number }>([
        { $match: { is_deleted: false, exception: null } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      this.orderModel.countDocuments({ is_deleted: false }),
    ]);
    const [todo, exceptions, paymentRejected, dispatchRejected, inflowFiat, inflowChain, outflowFiat, outflowChain] = await Promise.all([
      todoFilter ? this.orderModel.countDocuments(todoCountFilter) : Promise.resolve(0),
      this.orderModel.countDocuments({ is_deleted: false, exception: { $ne: null }, status: { $ne: TradeOrderStatus.CANCELLED } }),
      this.orderModel.countDocuments({ is_deleted: false, payment_rejected: { $ne: null } }),
      this.orderModel.countDocuments({ is_deleted: false, dispatch_rejected: { $ne: null } }),
      this.orderModel.countDocuments({ is_deleted: false, status: TradeOrderStatus.AWAITING_INFLOW, sell_currency: { $ne: "USDT" } }),
      this.orderModel.countDocuments({ is_deleted: false, status: TradeOrderStatus.AWAITING_INFLOW, sell_currency: "USDT" }),
      this.orderModel.countDocuments({ is_deleted: false, status: TradeOrderStatus.AWAITING_PAYOUT, buy_currency: { $ne: "USDT" } }),
      this.orderModel.countDocuments({ is_deleted: false, status: TradeOrderStatus.AWAITING_PAYOUT, buy_currency: "USDT" }),
    ]);
    const byStatus = Object.fromEntries(statuses.map(item => [item._id, item.count]));
    const active = Object.entries(byStatus)
      .filter(([status]) => status !== TradeOrderStatus.COMPLETED && status !== TradeOrderStatus.CANCELLED)
      .reduce((sum, [, count]) => sum + count, 0);
    const kycMap = await this.kycBadgeMap(items);
    return {
      items: items.map(item => this.toVO(item, kycMap.get(String(item._id)) ?? KYC_BADGE_NONE)),
      total,
      page,
      page_size: pageSize,
      stats: {
        todo,
        active,
        all,
        by_status: byStatus,
        exceptions,
        payment_rejected: paymentRejected,
        dispatch_rejected: dispatchRejected,
        inflow_fiat: inflowFiat,
        inflow_chain: inflowChain,
        outflow_fiat: outflowFiat,
        outflow_chain: outflowChain,
      },
    };
  }

  private appendAnd(filter: FilterQuery<TradeOrderDocument>, condition: FilterQuery<TradeOrderDocument>): void {
    const existing = Array.isArray(filter.$and) ? filter.$and : [];
    filter.$and = [...existing, condition];
  }

  /** 多个岗位（本人 + 代班）的待办并集；都没有队列时返回 null */
  private myTodoFilter(roleCodes: string[]): FilterQuery<TradeOrderDocument> | null {
    const filters = roleCodes
      .map(code => this.roleTodoFilter(code))
      .filter((item): item is FilterQuery<TradeOrderDocument> => !!item);
    if (!filters.length) return null;
    return filters.length === 1 ? filters[0] : { $or: filters };
  }

  private roleTodoFilter(roleCode?: string): FilterQuery<TradeOrderDocument> | null {
    switch (roleCode) {
      case "AGENT":
        return {
          status: { $in: [TradeOrderStatus.PENDING_KYC, TradeOrderStatus.AWAITING_DISPATCH] },
        };
      case "OPS":
        return {
          status: TradeOrderStatus.DISPATCH_REVIEW,
        };
      case "FINANCE":
        return {
          status: TradeOrderStatus.AWAITING_INFLOW,
        };
      case "WALLET":
        return {
          $or: [
            { status: TradeOrderStatus.AWAITING_INFLOW, sell_currency: "USDT" },
            { status: TradeOrderStatus.AWAITING_PAYOUT, buy_currency: "USDT" },
          ],
        };
      case "PAYOUT":
        return {
          status: TradeOrderStatus.AWAITING_PAYOUT,
        };
      case "MANAGER":
        return {
          exception: { $ne: null },
          status: { $nin: [TradeOrderStatus.COMPLETED, TradeOrderStatus.CANCELLED] },
        };
      case "ADMIN":
        return {
          status: { $nin: [TradeOrderStatus.COMPLETED, TradeOrderStatus.CANCELLED] },
        };
      default:
        return null;
    }
  }

  async getById(id: string): Promise<TradeOrderVO> {
    const doc = await this.findOrFail(id);
    const kyc = await this.kycBadgeForDoc(doc);
    return this.toVO(doc.toObject(), kyc);
  }

  async getDispatch(orderId: string): Promise<PayoutOrderVO | null> {
    const doc = await this.findOrFail(orderId);
    if (!doc.dispatch_id) return null;
    const dispatch = await this.payoutModel.findOne({ _id: doc.dispatch_id }).lean();
    return dispatch ? toDispatchVO(dispatch) : null;
  }

  /** 排单弹窗上下文：客户 VA 账户 + 银行/钱包通道可用余额 */
  async dispatchContext(orderId: string): Promise<{
    va_accounts: VaAccountVO[];
    treasury: TreasuryAccountVO[];
  }> {
    const doc = await this.findOrFail(orderId);
    /* 通道可用余额按订单出款币种查询（审计 1.4.10），无对应账户则前端显示 — */
    const treasuryKeys = [`bank-SGB-${doc.buy_currency}`, `bank-SINO-${doc.buy_currency}`];
    if (fundingKindOf(shape(doc), "outflow") === FundingKind.CHAIN) treasuryKeys.push(`wallet-${doc.buy_currency}`);
    const [vaAccounts, treasury] = await Promise.all([
      this.vaModel.find({ customer_id: doc.customer_id, is_deleted: false }).lean(),
      this.treasuryModel
        .find({ key: { $in: treasuryKeys }, is_deleted: false })
        .lean(),
    ]);
    return {
      va_accounts: vaAccounts.map(item => ({
        id: String(item._id),
        customer_id: String(item.customer_id),
        label: item.label,
        virtual_account_number: item.virtual_account_number,
        iban: item.iban,
        currency: item.currency,
        bank: item.bank,
      })),
      treasury: treasury.map(item => ({
        key: item.key,
        group: item.group,
        name: item.name,
        currency: item.currency,
        available: num(item.available),
        frozen: num(item.frozen),
      })),
    };
  }

  /* ---------------- KYC 联动 ---------------- */

  /** 手动同步 KYC（demo syncOrderKyc） */
  async kycSync(id: string, operator: JwtPayload): Promise<TradeOrderVO> {
    const doc = await this.findOrFail(id);
    if (doc.status !== TradeOrderStatus.PENDING_KYC) throw new ConflictException("订单不在待KYC状态");
    const kyc = await this.kycBadgeForDoc(doc);
    if (!kyc.ready) {
      throw new BadRequestException(`KYC 仍未通过（当前「${kyc.label}」），请先在业务准入完成审核`);
    }
    this.advance(doc, TradeOrderStatus.AWAITING_INFLOW, operator, "KYC 审核通过", `客户 KYC 已通过，进入待客户入款（入款登记人：${this.inflowOwnerLabel(doc)}）`);
    await doc.save();
    return this.toVO(doc.toObject(), kyc);
  }

  /** 准入通过后自动推进该客户就绪的待KYC订单（review.service APPROVE 时调用） */
  async advanceAfterKyc(
    customerId: Types.ObjectId | string,
    decision: { reviewer?: string | null; reviewedAt?: Date } = {},
  ): Promise<number> {
    const docs = await this.orderModel.find({
      customer_id: new Types.ObjectId(String(customerId)),
      status: TradeOrderStatus.PENDING_KYC,
      is_deleted: false,
    });
    const reviewedAt = decision.reviewedAt ?? new Date();
    const reviewer = decision.reviewer?.trim() || null;
    let advanced = 0;
    for (const doc of docs) {
      const kyc = await this.kycBadgeForDoc(doc);
      if (!kyc.ready) continue;
      doc.status = TradeOrderStatus.AWAITING_INFLOW;
      doc.timeline = [
        {
          at: reviewedAt,
          title: "KYC 审核通过",
          detail: `客户准入审核通过（${reviewer ? `合规官 ${reviewer} · ` : ""}审核通过时间 ${fmtTime(reviewedAt)}），订单进入待客户入款（入款登记人：${this.inflowOwnerLabel(doc)}）`,
          actor: reviewer ? `合规官 ${reviewer}` : "系统",
        },
        ...doc.timeline,
      ];
      await doc.save();
      advanced += 1;
    }
    return advanced;
  }

  /** 合规驳回/终止时，在受影响的待KYC订单时间线登记结论（合规官、时间、驳回说明；不改订单状态） */
  async noteKycRejected(
    customerId: Types.ObjectId | string,
    scenario: { scenarioId?: Types.ObjectId | string | null; scenarioName?: string | null },
    decision: { action: "REJECT" | "TERMINATE"; reviewer?: string | null; reviewedAt?: Date; reason?: string | null },
  ): Promise<number> {
    const docs = await this.orderModel.find({
      customer_id: new Types.ObjectId(String(customerId)),
      status: TradeOrderStatus.PENDING_KYC,
      is_deleted: false,
    });
    const reviewedAt = decision.reviewedAt ?? new Date();
    const reviewer = decision.reviewer?.trim() || null;
    const rejected = decision.action === "REJECT";
    let noted = 0;
    for (const doc of docs) {
      const matchesScenario = scenario.scenarioId && doc.business_scenario_id
        ? String(doc.business_scenario_id) === String(scenario.scenarioId)
        : !scenario.scenarioName || !doc.business_type || doc.business_type === scenario.scenarioName;
      if (!matchesScenario) continue;
      doc.timeline = [
        {
          at: reviewedAt,
          title: rejected ? "KYC 审核驳回" : "KYC 审核终止",
          detail: `客户准入审核${rejected ? "驳回" : "终止"}（${reviewer ? `合规官 ${reviewer} · ` : ""}${rejected ? "驳回" : "终止"}时间 ${fmtTime(reviewedAt)}）${decision.reason ? `，${rejected ? "驳回" : "终止"}说明：${decision.reason}` : ""}，订单继续停留在待KYC`,
          actor: reviewer ? `合规官 ${reviewer}` : "系统",
        },
        ...doc.timeline,
      ];
      await doc.save();
      noted += 1;
    }
    return noted;
  }

  /* ---------------- 取消 / 风险终止 ---------------- */

  /** 删除订单：与编辑同口径（排单审核前、无未解除异常），释放冻结资金后软删除 */
  async softDelete(id: string, operator: JwtPayload): Promise<void> {
    const doc = await this.findOrFail(id);
    if (!OrderService.EDITABLE_STATUSES.includes(doc.status)) {
      throw new ConflictException(`当前状态（${doc.status}）不允许删除订单；排单审核中或之后请走取消/风险终止`);
    }
    if (doc.exception) throw new ConflictException("订单存在未解除的附加异常，请先处理异常再删除");
    await this.releaseFunds(doc);
    this.log(doc, "订单删除", `删除前状态「${doc.status}」，订单从列表移除（软删除）`, operator);
    doc.set("is_deleted", true);
    doc.set("deleted_by", new Types.ObjectId(operator.sub));
    doc.set("deleted_at", new Date());
    await doc.save();
  }

  async cancel(id: string, reason: string | undefined, operator: JwtPayload, riskStop = false): Promise<TradeOrderVO> {
    const doc = await this.findOrFail(id);
    const cancellable: TradeOrderStatus[] = riskStop
      ? [TradeOrderStatus.DISPATCH_REVIEW, TradeOrderStatus.AWAITING_PAYOUT]
      : [TradeOrderStatus.PENDING_KYC, TradeOrderStatus.AWAITING_INFLOW, TradeOrderStatus.AWAITING_DISPATCH];
    if (!cancellable.includes(doc.status)) {
      throw new ConflictException(`当前状态（${doc.status}）不允许${riskStop ? "风险终止" : "取消"}`);
    }
    await this.releaseFunds(doc);
    if (doc.dispatch_id) {
      await this.payoutModel.updateOne(
        { _id: doc.dispatch_id, status: { $ne: DispatchStatus.PAID } },
        { $set: { status: DispatchStatus.VOID } },
      );
    }
    this.advance(
      doc,
      TradeOrderStatus.CANCELLED,
      operator,
      riskStop ? "风险终止" : "订单取消",
      reason || (riskStop ? "风险事件，终止出款 / 排单作废" : "交易员取消订单"),
    );
    doc.exception = null;
    await doc.save();
    return this.toVO(doc.toObject(), await this.kycBadgeForDoc(doc));
  }

  /* ---------------- 钱包节点 ---------------- */

  async walletDepositAddress(id: string, address: string, operator: JwtPayload): Promise<TradeOrderVO> {
    const doc = await this.findOrFail(id);
    if (fundingKindOf(shape(doc), "inflow") !== FundingKind.CHAIN) throw new BadRequestException("该订单入款不走链上");
    doc.wallet_ops = {
      ...(doc.wallet_ops ?? emptyWalletOps()),
      deposit_address: address.trim(),
      deposit_by: operator.display_name,
      deposit_at: new Date(),
    };
    this.log(doc, "提供公司收 U 地址", `${address.trim()} · 由钱包运营登记`, operator);
    await doc.save();
    return this.toVO(doc.toObject(), await this.kycBadgeForDoc(doc));
  }

  /* ---------------- 入款确认（登记即确认） ---------------- */

  async inflowConfirm(id: string, dto: FundingActionDto, operator: JwtPayload): Promise<TradeOrderVO> {
    const doc = await this.findOrFail(id);
    if (doc.status !== TradeOrderStatus.AWAITING_INFLOW) throw new ConflictException("订单不在待客户入款状态");
    await this.assertFundingOwner(doc, "inflow", operator);
    const kind = fundingKindOf(shape(doc), "inflow");
    if (kind === FundingKind.CHAIN) {
      if (!dto.hash?.trim()) throw new BadRequestException("请填写 Transaction Hash");
      this.assertTxHashFormat(dto.chain, dto.hash);
    }
    if (kind === FundingKind.CASH && !dto.place?.trim()) throw new BadRequestException("请填写交收地点");

    doc.inflow_mark = markOf(dto, operator, doc.sell_currency);
    this.log(
      doc,
      kind === FundingKind.CHAIN ? "链上入款已到账" : kind === FundingKind.CASH ? "现金交收已确认" : "法币入款已到账",
      inflowDetail(kind, dto, doc.sell_currency),
      operator,
    );

    /* 实收 vs 应收校验（审计 1.1.1/1.1.3）：不符则登记实收并自动标记金额不符异常，主线停留待客户入款 */
    const expected = num(doc.sell_amount);
    const diff = round2(dto.amount - expected);
    if (Math.abs(diff) > 0.009) {
      doc.exception = {
        kind: "业务异常",
        reason: "金额不符",
        detail: `实付 ${doc.sell_currency} ${fmt(dto.amount)} / 应收 ${doc.sell_currency} ${fmt(expected)}，差额 ${diff > 0 ? "+" : ""}${fmt(diff)}`,
        prev_status: doc.status,
        escalated: false,
        since: new Date(),
      };
      this.log(doc, "标记异常", `实收与应收不符（${doc.exception.detail}），入款已登记但未确认，等待处理`, operator);
      await doc.save();
      return this.toVO(doc.toObject(), await this.kycBadgeForDoc(doc));
    }

    await this.freezeFunds(doc, operator);
    doc.payment_rejected = null;
    this.advance(doc, TradeOrderStatus.AWAITING_DISPATCH, operator, "入款登记确认", `实收 ${doc.sell_currency} ${fmt(dto.amount)} 与应收一致，冻结 ${doc.buy_currency} ${fmt(num(doc.buy_amount))}，进入待出款排单`);
    await doc.save();
    return this.toVO(doc.toObject(), await this.kycBadgeForDoc(doc));
  }

  /* ---------------- 出款排单 ---------------- */

  async dispatchCreate(id: string, dto: CreateDispatchDto, operator: JwtPayload): Promise<TradeOrderVO> {
    const doc = await this.findOrFail(id);
    if (doc.status !== TradeOrderStatus.AWAITING_DISPATCH) throw new ConflictException("订单不在待出款排单状态");
    const text = dto.text.trim();
    if (!text) throw new BadRequestException("请粘贴或编辑排单文案");
    if (dto.channel === DispatchChannel.WALLET && fundingKindOf(shape(doc), "outflow") !== FundingKind.CHAIN) {
      throw new BadRequestException("钱包通道仅用于链上出款订单");
    }
    let vaAccount: PayoutOrder["va_account"] = null;
    if (dto.channel === DispatchChannel.SGB) {
      const va = dto.va_account_id
        ? await this.vaModel.findOne({ _id: dto.va_account_id, is_deleted: false }).lean()
        : await this.vaModel.findOne({ customer_id: doc.customer_id, is_deleted: false }).lean();
      if (!va) throw new BadRequestException("该客户没有已登记的 VA 账户，无法走 SGB 渠道；可切换 SINO 渠道后提交");
      vaAccount = {
        virtual_account_number: va.virtual_account_number,
        iban: va.iban,
        currency: va.currency,
      };
    }
    await this.moveFreezeToChannel(doc, dto.channel, operator);
    const parsed = parseDispatchRaw(text);
    const orderTitle = (text.split("\n").map(line => line.trim()).find(line => line && !/^\*/.test(line)) || `補單:${doc.customer_code || "无编号"}`).slice(0, 42);
    const now = new Date();
    const dispatch = await this.payoutModel.create({
      dispatch_no: await nextBusinessNo(this.connection, "SCH"),
      order_id: doc._id,
      order_no: doc.order_no,
      customer_id: doc.customer_id,
      customer_name: doc.customer_name,
      customer_code: doc.customer_code,
      channel: dto.channel,
      currency: doc.buy_currency,
      amount: doc.buy_amount,
      order_title: orderTitle,
      final_text: text,
      payout_account:
        dto.payout_account?.trim() ||
        (dto.channel === DispatchChannel.SGB
          ? `${(doc.person_name || doc.customer_name).toUpperCase()} SGB VA`
          : dto.channel === DispatchChannel.WALLET
            ? `${doc.buy_currency} 钱包`
            : "pobo cq開-開"),
      va_account: vaAccount,
      payee: parsed.payee || doc.person_name || doc.customer_name,
      payee_bank: [parsed.bankName, parsed.accountNumber].filter(Boolean).join(" · ") || "見排单文案",
      status: DispatchStatus.REVIEWING,
      submitted_by: operator.display_name,
      submitted_at: now,
      created_by: new Types.ObjectId(operator.sub),
      updated_by: new Types.ObjectId(operator.sub),
    });
    doc.dispatch_id = dispatch._id;
    doc.dispatch_rejected = null;
    this.advance(doc, TradeOrderStatus.DISPATCH_REVIEW, operator, "排单已提交", `${dispatch.dispatch_no} · ${orderTitle} · ${doc.buy_currency} ${fmt(num(doc.buy_amount))} 进入排单审核`);
    await doc.save();
    return this.toVO(doc.toObject(), await this.kycBadgeForDoc(doc));
  }

  async dispatchApprove(id: string, operator: JwtPayload): Promise<TradeOrderVO> {
    const doc = await this.findOrFail(id);
    if (doc.status !== TradeOrderStatus.DISPATCH_REVIEW || !doc.dispatch_id) throw new ConflictException("订单不在出款审核中");
    await this.payoutModel.updateOne(
      { _id: doc.dispatch_id, status: DispatchStatus.REVIEWING },
      { $set: { status: DispatchStatus.AWAITING_PAYOUT, reviewed_by: operator.display_name, reviewed_at: new Date() } },
    );
    const dispatch = await this.payoutModel.findOne({ _id: doc.dispatch_id }).lean();
    this.advance(doc, TradeOrderStatus.AWAITING_PAYOUT, operator, "排单审核通过", `${dispatch?.dispatch_no ?? ""} 进入待出款执行（执行人：${this.outflowOwnerLabel(doc)}）`);
    await doc.save();
    return this.toVO(doc.toObject(), await this.kycBadgeForDoc(doc));
  }

  async dispatchReturn(id: string, reason: string | undefined, operator: JwtPayload): Promise<TradeOrderVO> {
    const doc = await this.findOrFail(id);
    if (doc.status !== TradeOrderStatus.DISPATCH_REVIEW || !doc.dispatch_id) throw new ConflictException("订单不在出款审核中");
    const dispatch = await this.payoutModel.findOne({ _id: doc.dispatch_id }).lean();
    await this.payoutModel.updateOne({ _id: doc.dispatch_id }, { $set: { status: DispatchStatus.VOID } });
    doc.dispatch_id = null;
    doc.dispatch_rejected = { reason: reason || "需重新排单", by: operator.display_name, at: new Date() };
    this.advance(doc, TradeOrderStatus.AWAITING_DISPATCH, operator, "排单被驳回", `${dispatch?.dispatch_no ?? ""} · ${reason || "需重新排单"}，等待交易员重新提交排单`);
    await doc.save();
    return this.toVO(doc.toObject(), await this.kycBadgeForDoc(doc));
  }

  /* ---------------- 出款执行 / 执行退回 ---------------- */

  async outflowExecute(id: string, dto: FundingActionDto, operator: JwtPayload): Promise<TradeOrderVO> {
    const doc = await this.findOrFail(id);
    if (doc.status !== TradeOrderStatus.AWAITING_PAYOUT) {
      throw new ConflictException(`订单不在待出款执行状态（当前：${doc.status}），请等待排单审核通过`);
    }
    await this.assertFundingOwner(doc, "outflow", operator);
    const kind = fundingKindOf(shape(doc), "outflow");
    if (kind === FundingKind.CHAIN) {
      if (!dto.hash?.trim()) throw new BadRequestException("请填写 Transaction Hash");
      this.assertTxHashFormat(dto.chain, dto.hash);
    }
    if (kind === FundingKind.BANK && !dto.account?.trim()) throw new BadRequestException("请填写出款账户");
    if (kind === FundingKind.CASH && !dto.place?.trim()) throw new BadRequestException("请填写交收地点");

    doc.outflow_mark = markOf(dto, operator, doc.buy_currency);
    const receiptName = voucherLabel(dto.voucher) || (dto.hash ? `${dto.hash.slice(0, 12)}…` : "手工登记");
    if (doc.dispatch_id) {
      await this.payoutModel.updateOne(
        { _id: doc.dispatch_id, status: DispatchStatus.AWAITING_PAYOUT },
        {
          $set: {
            status: DispatchStatus.PAID,
            paid_by: operator.display_name,
            paid_at: new Date(),
            receipt: {
              file_name: receiptName,
              file: isFileRef(dto.voucher) ? dto.voucher : null,
              reference: dto.hash?.trim() || dto.account?.trim() || null,
              note: null,
              uploaded_by: operator.display_name,
              uploaded_at: new Date(),
              matched: false,
            },
          },
        },
      );
    }
    await this.consumeFunds(doc);
    doc.profit = doc.profit ?? computeProfit(doc);
    doc.receipt_ref = receiptName;
    this.log(
      doc,
      kind === FundingKind.CHAIN ? "链上出款已完成" : kind === FundingKind.CASH ? "现金出款已交付" : "银行出款已完成",
      outflowDetail(kind, dto),
      operator,
    );
    this.advance(doc, TradeOrderStatus.COMPLETED, operator, "订单完成", `出款已执行、凭证已归档，预计净收益 ${doc.profit.currency} ${fmt(doc.profit.net)}，订单闭环`);
    await doc.save();
    return this.toVO(doc.toObject(), await this.kycBadgeForDoc(doc));
  }

  async outflowReturn(id: string, reason: string | undefined, operator: JwtPayload): Promise<TradeOrderVO> {
    const doc = await this.findOrFail(id);
    if (doc.status !== TradeOrderStatus.AWAITING_PAYOUT) throw new ConflictException("订单不在待出款执行状态");
    if (doc.dispatch_id) {
      await this.payoutModel.updateOne({ _id: doc.dispatch_id }, { $set: { status: DispatchStatus.VOID } });
    }
    doc.dispatch_id = null;
    doc.dispatch_rejected = { reason: reason || "执行异常，需重新排单", by: operator.display_name, at: new Date() };
    this.advance(doc, TradeOrderStatus.AWAITING_DISPATCH, operator, "执行异常退回", `${reason || "账户错误 / 通道不可用"}，订单回到待出款排单`);
    await doc.save();
    return this.toVO(doc.toObject(), await this.kycBadgeForDoc(doc));
  }

  /* ---------------- 异常（附加标记，不打断主线） ---------------- */

  async exceptionMark(id: string, dto: ExceptionMarkDto, operator: JwtPayload): Promise<TradeOrderVO> {
    const doc = await this.findOrFail(id);
    if (([TradeOrderStatus.COMPLETED, TradeOrderStatus.CANCELLED] as TradeOrderStatus[]).includes(doc.status)) {
      throw new ConflictException("已完成/已取消的订单不能标记异常");
    }
    doc.exception = { kind: dto.kind, reason: dto.reason, detail: dto.detail, prev_status: doc.status, escalated: false, since: new Date() };
    this.log(doc, "标记异常", `${dto.kind} · ${dto.reason}：${dto.detail}（主线状态保持「${doc.status}」）`, operator);
    await doc.save();
    return this.toVO(doc.toObject(), await this.kycBadgeForDoc(doc));
  }

  async exceptionResolve(id: string, dto: ExceptionResolveDto, operator: JwtPayload): Promise<TradeOrderVO> {
    const doc = await this.findOrFail(id);
    if (!doc.exception) throw new ConflictException("订单没有待处理的异常");
    if (dto.action === "restore") {
      doc.exception = null;
      this.log(doc, "异常已解除", dto.note || "异常处理完成，订单继续推进", operator);
    } else if (dto.action === "cancel") {
      await this.releaseFunds(doc);
      if (doc.dispatch_id) {
        await this.payoutModel.updateOne(
          { _id: doc.dispatch_id, status: { $ne: DispatchStatus.PAID } },
          { $set: { status: DispatchStatus.VOID } },
        );
      }
      doc.exception = null;
      this.advance(doc, TradeOrderStatus.CANCELLED, operator, "订单取消", dto.note || "异常订单已取消");
    } else {
      doc.exception = { ...doc.exception, escalated: true };
      this.log(doc, "升级合规", "异常升级至合规复核，等待合规结论", operator);
    }
    await doc.save();
    return this.toVO(doc.toObject(), await this.kycBadgeForDoc(doc));
  }

  /* ---------------- 内部 ---------------- */

  private async findOrFail(id: string): Promise<TradeOrderDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException("订单不存在");
    const doc = await this.orderModel.findOne({ _id: id, is_deleted: false });
    if (!doc) throw new NotFoundException("订单不存在");
    return doc;
  }

  private async assertFundingOwner(
    doc: TradeOrderDocument,
    side: "inflow" | "outflow",
    operator: JwtPayload,
  ): Promise<void> {
    const owner = fundingOwnerRole(shape(doc), side);
    if (operator.role_code === owner || operator.role_code === "ADMIN") return;
    /* 代班期间按被交接岗位放行，与 RolesGuard 同口径 */
    const delegated = await this.handoffService.activeRoleCodes(operator.sub);
    if (delegated.includes(owner) || delegated.includes("ADMIN")) return;
    throw new ForbiddenException(`该动作由${ROLE_NAME.get(owner) ?? owner}执行`);
  }

  /** 按所选网络校验交易哈希位数/前缀（TRC20 64 位十六进制；ERC20 0x+64 位） */
  private assertTxHashFormat(chain: string | null | undefined, hash: string): void {
    if (!isValidTxHash(chain, hash)) {
      throw new BadRequestException(
        TX_HASH_FORMAT_HINTS[chain ?? ""] ?? "Transaction Hash 格式不正确",
      );
    }
  }

  private actorLabel(operator: JwtPayload): string {
    return `${ROLE_NAME.get(operator.role_code) ?? operator.role_code} ${operator.display_name}`;
  }

  private log(doc: TradeOrderDocument, title: string, detail: string, operator: JwtPayload): void {
    doc.timeline = [{ at: new Date(), title, detail, actor: this.actorLabel(operator) }, ...doc.timeline];
    doc.set("updated_by", new Types.ObjectId(operator.sub));
  }

  private advance(doc: TradeOrderDocument, to: TradeOrderStatus, operator: JwtPayload, title: string, detail: string): void {
    doc.status = to;
    doc.handler_name = operator.display_name;
    this.log(doc, title, detail, operator);
  }

  private inflowOwnerLabel(doc: TradeOrderDocument): string {
    return ROLE_NAME.get(fundingOwnerRole(shape(doc), "inflow")) ?? "财务";
  }

  private outflowOwnerLabel(doc: TradeOrderDocument): string {
    return ROLE_NAME.get(fundingOwnerRole(shape(doc), "outflow")) ?? "出款员";
  }

  /**
   * 冻结应付资金：账户 available→frozen。
   * 审计 1.4.7/1.4.8：找不到账户或可用余额不足时阻断（不再静默跳过/扣成负数）；
   * 冻结后跌破账户下限（floor）不阻断但写入时间线警示。
   */
  private async freezeFunds(doc: TradeOrderDocument, operator: JwtPayload): Promise<void> {
    const key = await this.payoutAccountKeyFor(doc);
    const account = key ? await this.treasuryModel.findOne({ key, is_deleted: false }) : null;
    if (!account) {
      throw new BadRequestException(
        `未找到可冻结的 ${doc.buy_currency} 出款账户，请先在资金账户中配置后再确认入款`,
      );
    }
    const amount = num(doc.buy_amount);
    const available = num(account.available);
    if (available < amount) {
      throw new BadRequestException(
        `${account.name} 可用余额不足（可用 ${fmt(available)}，需冻结 ${fmt(amount)}），请先补仓或调整账户`,
      );
    }
    const remaining = round2(available - amount);
    account.available = Types.Decimal128.fromString(String(remaining));
    account.frozen = Types.Decimal128.fromString(String(round2(num(account.frozen) + amount)));
    await account.save();
    doc.freeze = {
      account_key: account.key,
      account_name: account.name,
      currency: doc.buy_currency,
      amount: doc.buy_amount,
      state: FreezeState.FROZEN,
    };
    const floor = num(account.floor);
    if (floor > 0 && remaining < floor) {
      this.log(doc, "账户余额预警", `${account.name} 冻结后可用 ${fmt(remaining)}，已跌破下限 ${fmt(floor)}，请及时补仓`, operator);
    }
  }

  /** 排单时冻结账户跟随所选渠道（审计 1.4.12）：与已冻结账户不一致则迁移冻结 */
  private async moveFreezeToChannel(doc: TradeOrderDocument, channel: string, operator: JwtPayload): Promise<void> {
    if (!doc.freeze || doc.freeze.state !== FreezeState.FROZEN) return;
    if (fundingKindOf(shape(doc), "outflow") !== FundingKind.BANK) return;
    const targetKey = `bank-${channel}-${doc.buy_currency}`;
    if (doc.freeze.account_key === targetKey) return;
    const target = await this.treasuryModel.findOne({ key: targetKey, is_deleted: false });
    if (!target) return; // 渠道无对应币种账户时维持原冻结账户
    const amount = num(doc.freeze.amount);
    if (num(target.available) < amount) {
      throw new BadRequestException(
        `${target.name} 可用余额不足（可用 ${fmt(num(target.available))}，需冻结 ${fmt(amount)}），无法切换到 ${channel} 通道`,
      );
    }
    const source = await this.treasuryModel.findOne({ key: doc.freeze.account_key, is_deleted: false });
    if (source) {
      source.available = Types.Decimal128.fromString(String(round2(num(source.available) + amount)));
      source.frozen = Types.Decimal128.fromString(String(Math.max(0, round2(num(source.frozen) - amount))));
      await source.save();
    }
    target.available = Types.Decimal128.fromString(String(round2(num(target.available) - amount)));
    target.frozen = Types.Decimal128.fromString(String(round2(num(target.frozen) + amount)));
    await target.save();
    const fromName = doc.freeze.account_name;
    doc.freeze = { ...doc.freeze, account_key: target.key, account_name: target.name };
    this.log(doc, "冻结账户调整", `随 ${channel} 通道由「${fromName}」迁移至「${target.name}」（${doc.buy_currency} ${fmt(amount)}）`, operator);
  }

  private async releaseFunds(doc: TradeOrderDocument): Promise<void> {
    if (!doc.freeze || doc.freeze.state !== FreezeState.FROZEN) return;
    const account = await this.treasuryModel.findOne({ key: doc.freeze.account_key, is_deleted: false });
    if (account) {
      const amount = num(doc.freeze.amount);
      account.available = Types.Decimal128.fromString(String(num(account.available) + amount));
      account.frozen = Types.Decimal128.fromString(String(Math.max(0, num(account.frozen) - amount)));
      await account.save();
    }
    doc.freeze = { ...doc.freeze, state: FreezeState.RELEASED };
  }

  private async consumeFunds(doc: TradeOrderDocument): Promise<void> {
    if (!doc.freeze || doc.freeze.state !== FreezeState.FROZEN) return;
    const account = await this.treasuryModel.findOne({ key: doc.freeze.account_key, is_deleted: false });
    if (account) {
      account.frozen = Types.Decimal128.fromString(String(Math.max(0, num(account.frozen) - num(doc.freeze.amount))));
      await account.save();
    }
    doc.freeze = { ...doc.freeze, state: FreezeState.CONSUMED };
  }

  /** 出款账户选择：链上→USDT 热钱包；现金→现金库存；银行→SGB 优先，SINO 兜底 */
  private async payoutAccountKeyFor(doc: TradeOrderDocument): Promise<string | null> {
    const kind = fundingKindOf(shape(doc), "outflow");
    const candidates =
      kind === FundingKind.CHAIN
        ? ["wallet-USDT"]
        : kind === FundingKind.CASH
          ? [`cash-${doc.buy_currency}`]
          : [`bank-SGB-${doc.buy_currency}`, `bank-SINO-${doc.buy_currency}`, `cash-${doc.buy_currency}`];
    for (const key of candidates) {
      const exists = await this.treasuryModel.exists({ key, is_deleted: false });
      if (exists) return key;
    }
    return null;
  }

  private kycBadgeForDoc(doc: { customer_id: Types.ObjectId; business_type: string | null; business_scenario_id?: Types.ObjectId | null }): Promise<OrderKycBadge> {
    return this.kycBadgeFor(doc.customer_id, doc.business_type, doc.business_scenario_id ?? null);
  }

  /** 订单 KYC 徽标：联查 access_applications（优先 scenario_id，名称兜底），demo 表2/表3 映射 */
  private async kycBadgeFor(
    customerId: Types.ObjectId,
    businessType: string | null,
    scenarioId: Types.ObjectId | null = null,
  ): Promise<OrderKycBadge> {
    const filter: Record<string, unknown> = { customer_id: customerId, is_deleted: false };
    if (scenarioId) filter.scenario_id = scenarioId;
    else if (businessType) filter.scenario_name = businessType;
    const applications = await this.applicationModel.find(filter).select("status").lean();
    if (!applications.length) return KYC_BADGE_NONE;
    const statuses = new Set(applications.map(app => app.status as string));
    const best = ADMISSION_RANK.find(status => statuses.has(status));
    return best ? (AccessToKycBadge[best] ?? KYC_BADGE_NONE) : KYC_BADGE_NONE;
  }

  private async kycBadgeMap(items: Array<{ _id: Types.ObjectId; customer_id: Types.ObjectId; business_type: string | null; business_scenario_id?: Types.ObjectId | null }>): Promise<Map<string, OrderKycBadge>> {
    const map = new Map<string, OrderKycBadge>();
    const customerIds = [...new Set(items.map(item => String(item.customer_id)))];
    if (!customerIds.length) return map;
    const applications = await this.applicationModel
      .find({ customer_id: { $in: customerIds.map(id => new Types.ObjectId(id)) }, is_deleted: false })
      .select("customer_id scenario_id scenario_name status")
      .lean();
    for (const item of items) {
      const related = applications.filter(app => {
        if (String(app.customer_id) !== String(item.customer_id)) return false;
        if (item.business_scenario_id) return String(app.scenario_id) === String(item.business_scenario_id);
        if (item.business_type) return app.scenario_name === item.business_type;
        return true;
      });
      if (!related.length) {
        map.set(String(item._id), KYC_BADGE_NONE);
        continue;
      }
      const statuses = new Set(related.map(app => app.status as string));
      const best = ADMISSION_RANK.find(status => statuses.has(status));
      map.set(String(item._id), best ? (AccessToKycBadge[best] ?? KYC_BADGE_NONE) : KYC_BADGE_NONE);
    }
    return map;
  }

  private toVO(
    doc: TradeOrder & { _id: Types.ObjectId; created_at?: Date; updated_at?: Date },
    kyc: OrderKycBadge,
  ): TradeOrderVO {
    return {
      id: String(doc._id),
      order_no: doc.order_no,
      customer_id: String(doc.customer_id),
      customer_name: doc.customer_name,
      customer_code: doc.customer_code,
      person_name: doc.person_name,
      business_type: doc.business_type,
      business_scenario_id: doc.business_scenario_id ? String(doc.business_scenario_id) : null,
      trade_type: doc.trade_type,
      sell_currency: doc.sell_currency,
      sell_amount: num(doc.sell_amount),
      buy_currency: doc.buy_currency,
      buy_amount: num(doc.buy_amount),
      rate: doc.rate,
      pay_method: doc.pay_method,
      remark: doc.remark,
      quote: doc.quote
        ? {
            quote_record_id: doc.quote.quote_record_id,
            deal_rate: doc.quote.deal_rate,
            cost_rate: doc.quote.cost_rate,
            source: doc.quote.source,
            quoted_at: doc.quote.quoted_at ? new Date(doc.quote.quoted_at).toISOString() : null,
            quoted_by: doc.quote.quoted_by,
            fee: doc.quote.fee,
          }
        : null,
      status: doc.status,
      kyc,
      handler_name: doc.handler_name,
      dispatch_id: doc.dispatch_id ? String(doc.dispatch_id) : null,
      wallet_ops: doc.wallet_ops
        ? {
            deposit_address: doc.wallet_ops.deposit_address,
            deposit_by: doc.wallet_ops.deposit_by,
            deposit_at: doc.wallet_ops.deposit_at ? new Date(doc.wallet_ops.deposit_at).toISOString() : null,
          }
        : null,
      inflow_mark: fundingMarkVO(doc.inflow_mark),
      outflow_mark: fundingMarkVO(doc.outflow_mark),
      freeze: doc.freeze
        ? {
            account_key: doc.freeze.account_key,
            account_name: doc.freeze.account_name,
            currency: doc.freeze.currency,
            amount: num(doc.freeze.amount),
            state: doc.freeze.state as FreezeState,
          }
        : null,
      profit: doc.profit,
      exception: doc.exception
        ? { ...doc.exception, since: new Date(doc.exception.since).toISOString() }
        : null,
      payment_rejected: rejectVO(doc.payment_rejected),
      dispatch_rejected: rejectVO(doc.dispatch_rejected),
      receipt_ref: doc.receipt_ref,
      timeline: doc.timeline.map(entry => ({
        at: new Date(entry.at).toISOString(),
        title: entry.title,
        detail: entry.detail,
        actor: entry.actor,
      })),
      created_at: doc.created_at?.toISOString() ?? "",
      updated_at: doc.updated_at?.toISOString() ?? "",
    };
  }
}

/* ---------------- 纯函数 ---------------- */

function shape(doc: { trade_type: string; sell_currency: string; buy_currency: string; pay_method: string }) {
  return {
    trade_type: doc.trade_type,
    sell_currency: doc.sell_currency,
    buy_currency: doc.buy_currency,
    pay_method: doc.pay_method,
  };
}

function emptyWalletOps() {
  return {
    deposit_address: null,
    deposit_by: null,
    deposit_at: null,
  };
}

function markOf(dto: FundingActionDto, operator: JwtPayload, currency = "") {
  return {
    by: operator.display_name,
    at: new Date(),
    amount: dto.amount,
    currency,
    account: dto.account?.trim() || null,
    voucher: normalizeVoucher(dto.voucher),
    chain: dto.chain?.trim() || null,
    hash: dto.hash?.trim() || null,
    confirms: dto.confirms?.trim() || null,
    place: dto.place?.trim() || null,
    handler: dto.handler?.trim() || null,
    token: dto.token?.trim() || null,
    method: dto.method?.trim() || null,
    note: dto.note?.trim() || null,
  };
}

function inflowDetail(kind: FundingKind, dto: FundingActionDto, currency: string): string {
  const amount = `${currency} ${fmt(dto.amount)}`;
  const voucher = voucherLabel(dto.voucher);
  if (kind === FundingKind.CHAIN) return `链上收款 · 实际到账 ${amount} · 哈希 ${(dto.hash ?? "").slice(0, 16)}…（${dto.chain || "TRC20"} · ${dto.confirms || "-"} 次确认）`;
  if (kind === FundingKind.CASH) return `现金交收 ${dto.place}${dto.handler ? ` · 交收人 ${dto.handler}` : ""}${dto.token ? ` · 信物 ${dto.token}` : ""}`;
  return `实收 ${amount} · ${dto.method || "电汇转账"}${voucher ? ` · 凭证 ${voucher}` : ""}${dto.note ? ` · 说明：${dto.note}` : ""}`;
}

function outflowDetail(kind: FundingKind, dto: FundingActionDto): string {
  const voucher = voucherLabel(dto.voucher);
  if (kind === FundingKind.CHAIN) return `链上哈希 ${dto.hash}（${dto.chain || "TRC20"} · ${dto.confirms || "-"} 次确认）`;
  if (kind === FundingKind.CASH) return `现金交收 ${dto.place}${dto.handler ? ` · 交收人 ${dto.handler}` : ""}`;
  return `账户 ${dto.account}${voucher ? ` · 凭证 ${voucher}` : ""}`;
}

function isFileRef(value: unknown): value is FileRef {
  return !!value && typeof value === "object" && "storage_key" in value && "original_name" in value;
}

function normalizeVoucher(voucher: FundingActionDto["voucher"]): FileRef | string | null {
  if (isFileRef(voucher)) return voucher;
  if (typeof voucher === "string") return voucher.trim() || null;
  return null;
}

function voucherLabel(voucher: FundingActionDto["voucher"]): string {
  if (isFileRef(voucher)) return voucher.original_name;
  if (typeof voucher === "string") return voucher.trim();
  return "";
}

/** 收益估算：比例取共享 PROFIT_RATE_CONFIG（demo 口径），界面标注"估算"，待接真实成本配置 */
function computeProfit(doc: { sell_currency: string; buy_currency: string; sell_amount: unknown; buy_amount: unknown }) {
  const baseAmount = doc.buy_currency === "USDT" ? num(doc.sell_amount) : num(doc.buy_amount);
  const currency = doc.buy_currency === "USDT" ? doc.sell_currency : doc.buy_currency;
  const spread = Math.round(baseAmount * PROFIT_RATE_CONFIG.spread);
  const fee = Math.round(baseAmount * PROFIT_RATE_CONFIG.fee);
  const channelCost = Math.round(baseAmount * PROFIT_RATE_CONFIG.channel_cost);
  const commission = Math.round(baseAmount * PROFIT_RATE_CONFIG.commission);
  return { currency, spread, fee, channel_cost: channelCost, commission, net: spread + fee - channelCost - commission };
}

/** demo parseDispatchRaw：从排单文案解析收款要素 */
function parseDispatchRaw(text: string) {
  const find = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }
    return "";
  };
  return {
    payee: find([/Account Name[^:：]*[:：]\s*(.+)/i, /[账賬][户戶]名[称稱][^:：]*[:：]\s*(.+)/]),
    bankName: find([/Name of Bank[^:：]*[:：]\s*(.+)/i, /收款[银銀]行名[称稱][^:：]*[:：]\s*(.+)/, /[银銀]行名[称稱][^:：]*[:：]\s*(.+)/]),
    accountNumber: find([/Bank Account Number[^:：]*[:：]\s*(.+)/i, /[账賬][户戶][号號][码碼][^:：]*[:：]\s*(.+)/, /[账賬][号號][^:：]*[:：]\s*(.+)/]),
  };
}

function fundingMarkVO(mark: Record<string, unknown> | null) {
  if (!mark) return null;
  return {
    by: String(mark.by ?? ""),
    at: mark.at ? new Date(mark.at as Date).toISOString() : "",
    amount: num(mark.amount),
    currency: (mark.currency as string) ?? "",
    account: (mark.account as string) ?? null,
    voucher: normalizeVoucher(mark.voucher as FundingActionDto["voucher"]),
    chain: (mark.chain as string) ?? null,
    hash: (mark.hash as string) ?? null,
    confirms: (mark.confirms as string) ?? null,
    place: (mark.place as string) ?? null,
    handler: (mark.handler as string) ?? null,
    token: (mark.token as string) ?? null,
    method: (mark.method as string) ?? null,
    note: (mark.note as string) ?? null,
  };
}

function rejectVO(mark: { reason: string; by: string; at: Date } | null) {
  return mark ? { reason: mark.reason, by: mark.by, at: new Date(mark.at).toISOString() } : null;
}

function toDispatchVO(doc: PayoutOrder & { _id: Types.ObjectId }): PayoutOrderVO {
  return {
    id: String(doc._id),
    dispatch_no: doc.dispatch_no,
    order_id: String(doc.order_id),
    order_no: doc.order_no,
    customer_name: doc.customer_name,
    customer_code: doc.customer_code,
    channel: doc.channel,
    currency: doc.currency,
    amount: num(doc.amount),
    order_title: doc.order_title,
    final_text: doc.final_text,
    payout_account: doc.payout_account,
    va_account: doc.va_account,
    payee: doc.payee,
    payee_bank: doc.payee_bank,
    status: doc.status,
    submitted_by: doc.submitted_by,
    submitted_at: doc.submitted_at.toISOString(),
    reviewed_by: doc.reviewed_by,
    reviewed_at: doc.reviewed_at ? doc.reviewed_at.toISOString() : null,
    paid_by: doc.paid_by,
    paid_at: doc.paid_at ? doc.paid_at.toISOString() : null,
    receipt: doc.receipt
      ? {
          ...doc.receipt,
          file: isFileRef(doc.receipt.file) ? doc.receipt.file : null,
          uploaded_at: new Date(doc.receipt.uploaded_at).toISOString(),
        }
      : null,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function fmt(value: number): string {
  return value.toLocaleString("en-US");
}

function fmtTime(value: Date): string {
  return new Date(value).toLocaleString("zh-CN");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
