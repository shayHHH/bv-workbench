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
  DispatchChannel,
  DispatchStatus,
  FreezeState,
  FundingKind,
  fundingKindOf,
  fundingOwnerRole,
  KYC_BADGE_NONE,
  OrderKycBadge,
  OrderListStatsVO,
  PageResult,
  PayoutOrderVO,
  QuoteCandidateVO,
  TradeOrderStatus,
  TradeOrderVO,
  TreasuryAccountVO,
  VaAccountVO,
} from "@bv/shared";
import { Connection, Model, Types } from "mongoose";
import { JwtPayload } from "../../auth/auth.types";
import { nextBusinessNo } from "../../common/sequence";
import { AccessApplication, AccessApplicationDocument } from "../access/access-application.schema";
import { Customer, CustomerDocument } from "../customer/customer.schema";
import { QuoteRecord, QuoteRecordDocument } from "../quote/schemas/quote-record.schema";
import {
  CreateDispatchDto,
  CreateOrderDto,
  ExceptionMarkDto,
  ExceptionResolveDto,
  FundingActionDto,
  QueryOrderDto,
} from "./dto/order.dto";
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
    @InjectConnection() private readonly connection: Connection,
  ) {}

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

    const kyc = await this.kycBadgeFor(customer._id, dto.business_type ?? null);
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
            detail: `「${dto.business_type || "未选业务类型"}」准入状态「${kyc.label}」，本单进入待KYC；该业务类型准入通过后自动进入待客户入款`,
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
      person_name: null,
      business_type: dto.business_type ?? null,
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

  async list(query: QueryOrderDto): Promise<PageResult<TradeOrderVO> & { stats: OrderListStatsVO }> {
    const page = query.page || 1;
    const pageSize = Math.min(query.page_size || 10, 50);
    const filter: Record<string, unknown> = { is_deleted: false };
    if (query.status) {
      const valid = new Set(Object.values(TradeOrderStatus) as string[]);
      const statuses = query.status.split(",").map(s => s.trim()).filter(s => valid.has(s));
      if (statuses.length) filter.status = { $in: statuses };
    }
    if (query.customer_id) filter.customer_id = new Types.ObjectId(query.customer_id);
    if (query.inflow_kind) filter.sell_currency = query.inflow_kind === "chain" ? "USDT" : { $ne: "USDT" };
    if (query.outflow_kind) filter.buy_currency = query.outflow_kind === "chain" ? "USDT" : { $ne: "USDT" };
    if (query.kya_pending === "1") {
      filter.buy_currency = "USDT";
      filter.status = { $in: [TradeOrderStatus.AWAITING_INFLOW, TradeOrderStatus.AWAITING_DISPATCH] };
      filter["wallet_ops.kya_passed"] = { $ne: true };
    }
    if (query.flag === "exception") filter.exception = { $ne: null };
    if (query.flag === "payment_rejected") filter.payment_rejected = { $ne: null };
    if (query.flag === "dispatch_rejected") filter.dispatch_rejected = { $ne: null };
    if (query.flag === "rejected")
      filter.$or = [{ payment_rejected: { $ne: null } }, { dispatch_rejected: { $ne: null } }];
    if (query.keyword) {
      const pattern = new RegExp(escapeRegExp(query.keyword.trim()), "i");
      filter.$and = [
        {
          $or: [
            { order_no: pattern },
            { customer_name: pattern },
            { customer_code: pattern },
            { trade_type: pattern },
          ],
        },
      ];
    }
    const [items, total, statuses] = await Promise.all([
      this.orderModel
        .find(filter)
        .sort({ created_at: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      this.orderModel.countDocuments(filter),
      this.orderModel.aggregate<{ _id: string; count: number }>([
        { $match: { is_deleted: false } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);
    const [exceptions, paymentRejected, dispatchRejected, inflowFiat, inflowChain, outflowFiat, outflowChain, kyaPending] = await Promise.all([
      this.orderModel.countDocuments({ is_deleted: false, exception: { $ne: null }, status: { $ne: TradeOrderStatus.CANCELLED } }),
      this.orderModel.countDocuments({ is_deleted: false, payment_rejected: { $ne: null } }),
      this.orderModel.countDocuments({ is_deleted: false, dispatch_rejected: { $ne: null } }),
      this.orderModel.countDocuments({ is_deleted: false, status: TradeOrderStatus.AWAITING_INFLOW, sell_currency: { $ne: "USDT" } }),
      this.orderModel.countDocuments({ is_deleted: false, status: TradeOrderStatus.AWAITING_INFLOW, sell_currency: "USDT" }),
      this.orderModel.countDocuments({ is_deleted: false, status: TradeOrderStatus.AWAITING_PAYOUT, buy_currency: { $ne: "USDT" } }),
      this.orderModel.countDocuments({ is_deleted: false, status: TradeOrderStatus.AWAITING_PAYOUT, buy_currency: "USDT" }),
      this.orderModel.countDocuments({
        is_deleted: false,
        buy_currency: "USDT",
        status: { $in: [TradeOrderStatus.AWAITING_INFLOW, TradeOrderStatus.AWAITING_DISPATCH] },
        "wallet_ops.kya_passed": { $ne: true },
      }),
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
        active,
        by_status: byStatus,
        exceptions,
        payment_rejected: paymentRejected,
        dispatch_rejected: dispatchRejected,
        inflow_fiat: inflowFiat,
        inflow_chain: inflowChain,
        outflow_fiat: outflowFiat,
        outflow_chain: outflowChain,
        kya_pending: kyaPending,
      },
    };
  }

  async getById(id: string): Promise<TradeOrderVO> {
    const doc = await this.findOrFail(id);
    const kyc = await this.kycBadgeFor(doc.customer_id, doc.business_type);
    return this.toVO(doc.toObject(), kyc);
  }

  async getDispatch(orderId: string): Promise<PayoutOrderVO | null> {
    const doc = await this.findOrFail(orderId);
    if (!doc.dispatch_id) return null;
    const dispatch = await this.payoutModel.findOne({ _id: doc.dispatch_id }).lean();
    return dispatch ? toDispatchVO(dispatch) : null;
  }

  /** 排单弹窗上下文：客户 VA 账户 + SGB/SINO 通道可用余额 */
  async dispatchContext(orderId: string): Promise<{
    va_accounts: VaAccountVO[];
    treasury: TreasuryAccountVO[];
  }> {
    const doc = await this.findOrFail(orderId);
    const [vaAccounts, treasury] = await Promise.all([
      this.vaModel.find({ customer_id: doc.customer_id, is_deleted: false }).lean(),
      this.treasuryModel.find({ key: { $in: ["bank-SGB-USD", "bank-SINO-USD"] }, is_deleted: false }).lean(),
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
    const kyc = await this.kycBadgeFor(doc.customer_id, doc.business_type);
    if (!kyc.ready) {
      throw new BadRequestException(`KYC 仍未通过（当前「${kyc.label}」），请先在业务准入完成审核`);
    }
    this.advance(doc, TradeOrderStatus.AWAITING_INFLOW, operator, "KYC 审核通过", `客户 KYC 已通过，进入待客户入款（入款登记人：${this.inflowOwnerLabel(doc)}）`);
    await doc.save();
    return this.toVO(doc.toObject(), kyc);
  }

  /** 准入通过后自动推进该客户就绪的待KYC订单（review.service APPROVE 时调用） */
  async advanceAfterKyc(customerId: Types.ObjectId | string, reason = "客户准入审核通过"): Promise<number> {
    const docs = await this.orderModel.find({
      customer_id: new Types.ObjectId(String(customerId)),
      status: TradeOrderStatus.PENDING_KYC,
      is_deleted: false,
    });
    let advanced = 0;
    for (const doc of docs) {
      const kyc = await this.kycBadgeFor(doc.customer_id, doc.business_type);
      if (!kyc.ready) continue;
      doc.status = TradeOrderStatus.AWAITING_INFLOW;
      doc.timeline = [
        {
          at: new Date(),
          title: "KYC 审核通过",
          detail: `${reason}，订单进入待客户入款（入款登记人：${this.inflowOwnerLabel(doc)}）`,
          actor: "系统",
        },
        ...doc.timeline,
      ];
      await doc.save();
      advanced += 1;
    }
    return advanced;
  }

  /* ---------------- 取消 / 风险终止 ---------------- */

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
    return this.toVO(doc.toObject(), await this.kycBadgeFor(doc.customer_id, doc.business_type));
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
    return this.toVO(doc.toObject(), await this.kycBadgeFor(doc.customer_id, doc.business_type));
  }

  async walletKya(id: string, address: string, operator: JwtPayload): Promise<TradeOrderVO> {
    const doc = await this.findOrFail(id);
    if (fundingKindOf(shape(doc), "outflow") !== FundingKind.CHAIN) throw new BadRequestException("该订单出款不走链上");
    doc.wallet_ops = {
      ...(doc.wallet_ops ?? emptyWalletOps()),
      payout_address: address.trim(),
      kya_passed: true,
      kya_by: operator.display_name,
      kya_at: new Date(),
    };
    this.log(doc, "客户地址 KYA 通过", `${address.trim()} · 白名单校验通过，建议先做小额测试`, operator);
    await doc.save();
    return this.toVO(doc.toObject(), await this.kycBadgeFor(doc.customer_id, doc.business_type));
  }

  /* ---------------- 入款确认（登记即确认） ---------------- */

  async inflowConfirm(id: string, dto: FundingActionDto, operator: JwtPayload): Promise<TradeOrderVO> {
    const doc = await this.findOrFail(id);
    if (doc.status !== TradeOrderStatus.AWAITING_INFLOW) throw new ConflictException("订单不在待客户入款状态");
    this.assertFundingOwner(doc, "inflow", operator);
    const kind = fundingKindOf(shape(doc), "inflow");
    if (kind === FundingKind.CHAIN && !dto.hash?.trim()) throw new BadRequestException("请填写 Transaction Hash");
    if (kind === FundingKind.CASH && !dto.place?.trim()) throw new BadRequestException("请填写交收地点");

    doc.inflow_mark = markOf(dto, operator, doc.sell_currency);
    this.log(
      doc,
      kind === FundingKind.CHAIN ? "链上入款已到账" : kind === FundingKind.CASH ? "现金交收已确认" : "法币入款已到账",
      inflowDetail(kind, dto, doc.sell_currency),
      operator,
    );
    await this.freezeFunds(doc);
    doc.payment_rejected = null;
    this.advance(doc, TradeOrderStatus.AWAITING_DISPATCH, operator, "入款登记确认", `冻结 ${doc.buy_currency} ${fmt(num(doc.buy_amount))}，进入待出款排单`);
    await doc.save();
    return this.toVO(doc.toObject(), await this.kycBadgeFor(doc.customer_id, doc.business_type));
  }

  /* ---------------- 出款排单 ---------------- */

  async dispatchCreate(id: string, dto: CreateDispatchDto, operator: JwtPayload): Promise<TradeOrderVO> {
    const doc = await this.findOrFail(id);
    if (doc.status !== TradeOrderStatus.AWAITING_DISPATCH) throw new ConflictException("订单不在待出款排单状态");
    const text = dto.text.trim();
    if (!text) throw new BadRequestException("请粘贴或编辑排单文案");
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
      payout_account: dto.channel === DispatchChannel.SGB ? `${(doc.person_name || doc.customer_name).toUpperCase()} SGB VA` : "pobo cq開-開",
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
    return this.toVO(doc.toObject(), await this.kycBadgeFor(doc.customer_id, doc.business_type));
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
    return this.toVO(doc.toObject(), await this.kycBadgeFor(doc.customer_id, doc.business_type));
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
    return this.toVO(doc.toObject(), await this.kycBadgeFor(doc.customer_id, doc.business_type));
  }

  /* ---------------- 出款执行 / 执行退回 ---------------- */

  async outflowExecute(id: string, dto: FundingActionDto, operator: JwtPayload): Promise<TradeOrderVO> {
    const doc = await this.findOrFail(id);
    if (doc.status !== TradeOrderStatus.AWAITING_PAYOUT) {
      throw new ConflictException(`订单不在待出款执行状态（当前：${doc.status}），请等待排单审核通过`);
    }
    this.assertFundingOwner(doc, "outflow", operator);
    const kind = fundingKindOf(shape(doc), "outflow");
    if (kind === FundingKind.CHAIN) {
      if (!doc.wallet_ops?.kya_passed) throw new BadRequestException("客户收 U 地址 KYA 未通过，不能执行链上出款");
      if (!dto.hash?.trim()) throw new BadRequestException("请填写 Transaction Hash");
    }
    if (kind === FundingKind.BANK && !dto.account?.trim()) throw new BadRequestException("请填写出款账户");
    if (kind === FundingKind.CASH && !dto.place?.trim()) throw new BadRequestException("请填写交收地点");

    doc.outflow_mark = markOf(dto, operator, doc.buy_currency);
    const receiptName = dto.voucher?.trim() || (dto.hash ? `${dto.hash.slice(0, 12)}…` : "手工登记");
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
    return this.toVO(doc.toObject(), await this.kycBadgeFor(doc.customer_id, doc.business_type));
  }

  async outflowReturn(id: string, reason: string | undefined, operator: JwtPayload): Promise<TradeOrderVO> {
    const doc = await this.findOrFail(id);
    if (doc.status !== TradeOrderStatus.AWAITING_PAYOUT) throw new ConflictException("订单不在待出款执行状态");
    if (doc.dispatch_id) {
      await this.payoutModel.updateOne({ _id: doc.dispatch_id }, { $set: { status: DispatchStatus.VOID } });
    }
    doc.dispatch_id = null;
    doc.dispatch_rejected = { reason: reason || "执行异常，需重新排单", by: operator.display_name, at: new Date() };
    this.advance(doc, TradeOrderStatus.AWAITING_DISPATCH, operator, "执行异常退回", `${reason || "账户错误 / KYA 失败 / 通道不可用"}，订单回到待出款排单`);
    await doc.save();
    return this.toVO(doc.toObject(), await this.kycBadgeFor(doc.customer_id, doc.business_type));
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
    return this.toVO(doc.toObject(), await this.kycBadgeFor(doc.customer_id, doc.business_type));
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
    return this.toVO(doc.toObject(), await this.kycBadgeFor(doc.customer_id, doc.business_type));
  }

  /* ---------------- 内部 ---------------- */

  private async findOrFail(id: string): Promise<TradeOrderDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException("订单不存在");
    const doc = await this.orderModel.findOne({ _id: id, is_deleted: false });
    if (!doc) throw new NotFoundException("订单不存在");
    return doc;
  }

  private assertFundingOwner(doc: TradeOrderDocument, side: "inflow" | "outflow", operator: JwtPayload): void {
    const owner = fundingOwnerRole(shape(doc), side);
    if (operator.role_code !== owner && operator.role_code !== "ADMIN") {
      throw new ForbiddenException(`该动作由${ROLE_NAME.get(owner) ?? owner}执行`);
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
    this.log(doc, title, detail, operator);
  }

  private inflowOwnerLabel(doc: TradeOrderDocument): string {
    return ROLE_NAME.get(fundingOwnerRole(shape(doc), "inflow")) ?? "财务";
  }

  private outflowOwnerLabel(doc: TradeOrderDocument): string {
    return ROLE_NAME.get(fundingOwnerRole(shape(doc), "outflow")) ?? "出款员";
  }

  /** 冻结应付资金：账户 available→frozen */
  private async freezeFunds(doc: TradeOrderDocument): Promise<void> {
    const key = await this.payoutAccountKeyFor(doc);
    const account = key ? await this.treasuryModel.findOne({ key, is_deleted: false }) : null;
    if (!account) return;
    const amount = num(doc.buy_amount);
    account.available = Types.Decimal128.fromString(String(num(account.available) - amount));
    account.frozen = Types.Decimal128.fromString(String(num(account.frozen) + amount));
    await account.save();
    doc.freeze = {
      account_key: account.key,
      account_name: account.name,
      currency: doc.buy_currency,
      amount: doc.buy_amount,
      state: FreezeState.FROZEN,
    };
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

  /** 订单 KYC 徽标：联查 access_applications（客户 + 业务类型），demo 表2/表3 映射 */
  private async kycBadgeFor(customerId: Types.ObjectId, businessType: string | null): Promise<OrderKycBadge> {
    const filter: Record<string, unknown> = { customer_id: customerId, is_deleted: false };
    if (businessType) filter.scenario_name = businessType;
    const applications = await this.applicationModel.find(filter).select("status").lean();
    if (!applications.length) return KYC_BADGE_NONE;
    const statuses = new Set(applications.map(app => app.status as string));
    const best = ADMISSION_RANK.find(status => statuses.has(status));
    return best ? (AccessToKycBadge[best] ?? KYC_BADGE_NONE) : KYC_BADGE_NONE;
  }

  private async kycBadgeMap(items: Array<{ _id: Types.ObjectId; customer_id: Types.ObjectId; business_type: string | null }>): Promise<Map<string, OrderKycBadge>> {
    const map = new Map<string, OrderKycBadge>();
    const customerIds = [...new Set(items.map(item => String(item.customer_id)))];
    if (!customerIds.length) return map;
    const applications = await this.applicationModel
      .find({ customer_id: { $in: customerIds.map(id => new Types.ObjectId(id)) }, is_deleted: false })
      .select("customer_id scenario_name status")
      .lean();
    for (const item of items) {
      const related = applications.filter(
        app =>
          String(app.customer_id) === String(item.customer_id) &&
          (!item.business_type || app.scenario_name === item.business_type),
      );
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
            payout_address: doc.wallet_ops.payout_address,
            kya_passed: doc.wallet_ops.kya_passed,
            kya_by: doc.wallet_ops.kya_by,
            kya_at: doc.wallet_ops.kya_at ? new Date(doc.wallet_ops.kya_at).toISOString() : null,
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
    payout_address: null,
    kya_passed: false,
    kya_by: null,
    kya_at: null,
  };
}

function markOf(dto: FundingActionDto, operator: JwtPayload, currency = "") {
  return {
    by: operator.display_name,
    at: new Date(),
    amount: dto.amount,
    currency,
    account: dto.account?.trim() || null,
    voucher: dto.voucher?.trim() || null,
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
  if (kind === FundingKind.CHAIN) return `链上收款 · 实际到账 ${amount} · 哈希 ${(dto.hash ?? "").slice(0, 16)}…（${dto.chain || "TRC20"} · ${dto.confirms || "-"} 次确认）`;
  if (kind === FundingKind.CASH) return `现金交收 ${dto.place}${dto.handler ? ` · 交收人 ${dto.handler}` : ""}${dto.token ? ` · 信物 ${dto.token}` : ""}`;
  return `实收 ${amount} · ${dto.method || "电汇转账"}${dto.voucher ? ` · 凭证 ${dto.voucher}` : ""}${dto.note ? ` · 说明：${dto.note}` : ""}`;
}

function outflowDetail(kind: FundingKind, dto: FundingActionDto): string {
  if (kind === FundingKind.CHAIN) return `链上哈希 ${dto.hash}（${dto.chain || "TRC20"} · ${dto.confirms || "-"} 次确认）`;
  if (kind === FundingKind.CASH) return `现金交收 ${dto.place}${dto.handler ? ` · 交收人 ${dto.handler}` : ""}`;
  return `账户 ${dto.account}${dto.voucher ? ` · 凭证 ${dto.voucher}` : ""}`;
}

/** demo computeOrderProfit：固定比例（汇差 0.4% / 手续费 0.1% / 渠道成本 0.05% / 佣金 0.35%） */
function computeProfit(doc: { sell_currency: string; buy_currency: string; sell_amount: unknown; buy_amount: unknown }) {
  const baseAmount = doc.buy_currency === "USDT" ? num(doc.sell_amount) : num(doc.buy_amount);
  const currency = doc.buy_currency === "USDT" ? doc.sell_currency : doc.buy_currency;
  const spread = Math.round(baseAmount * 0.004);
  const fee = Math.round(baseAmount * 0.001);
  const channelCost = Math.round(baseAmount * 0.0005);
  const commission = Math.round(baseAmount * 0.0035);
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
    voucher: (mark.voucher as string) ?? null,
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
      ? { ...doc.receipt, uploaded_at: new Date(doc.receipt.uploaded_at).toISOString() }
      : null,
  };
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
