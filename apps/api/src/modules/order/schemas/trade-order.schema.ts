import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { TradeOrderStatus } from "@bv/shared";
import { HydratedDocument, Schema as MongooseSchema, Types } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../../common/base.schema";

/**
 * 交易订单主线（docs/db/trade-orders.md）。状态机与字段对齐 demo；
 * 金额 Decimal128 落库；timeline 为追加型活动记录（规范 §4.5，整组赋值写入）。
 */
export const TRADE_ORDER_COLLECTION = "trade_orders";

const Money = MongooseSchema.Types.Decimal128;

@Schema({ collection: TRADE_ORDER_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class TradeOrder {
  @Prop({ type: String, required: true })
  order_no: string;

  @Prop({ type: Types.ObjectId, required: true })
  customer_id: Types.ObjectId;

  @Prop({ type: String, required: true })
  customer_name: string;

  @Prop({ type: String, default: null })
  customer_code: string | null;

  @Prop({ type: String, default: null })
  person_name: string | null;

  /** 准入业务类型（KYC 场景名快照）；联动以 business_scenario_id 为准（审计 1.2.10） */
  @Prop({ type: String, default: null })
  business_type: string | null;

  @Prop({ type: Types.ObjectId, default: null })
  business_scenario_id: Types.ObjectId | null;

  @Prop({ type: String, required: true })
  trade_type: string;

  @Prop({ type: String, required: true })
  sell_currency: string;

  @Prop({ type: Money, required: true })
  sell_amount: Types.Decimal128;

  @Prop({ type: String, required: true })
  buy_currency: string;

  @Prop({ type: Money, required: true })
  buy_amount: Types.Decimal128;

  @Prop({ type: String, required: true })
  rate: string;

  @Prop({ type: String, required: true })
  pay_method: string;

  @Prop({ type: String, default: null })
  remark: string | null;

  /** 关联报价快照 */
  @Prop({ type: Object, default: null })
  quote: {
    quote_record_id: string | null;
    deal_rate: string;
    cost_rate: string | null;
    source: string;
    quoted_at: Date | null;
    quoted_by: string | null;
    fee: string | null;
  } | null;

  @Prop({ type: String, required: true, enum: Object.values(TradeOrderStatus), default: TradeOrderStatus.PENDING_KYC })
  status: TradeOrderStatus;

  @Prop({ type: String, default: null })
  handler_name: string | null;

  @Prop({ type: Types.ObjectId, default: null })
  owner_user_id: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, default: null })
  dispatch_id: Types.ObjectId | null;

  @Prop({ type: Object, default: null })
  wallet_ops: {
    deposit_address: string | null;
    deposit_by: string | null;
    deposit_at: Date | null;
  } | null;

  @Prop({ type: Object, default: null })
  inflow_mark: Record<string, unknown> | null;

  @Prop({ type: Object, default: null })
  outflow_mark: Record<string, unknown> | null;

  @Prop({ type: Object, default: null })
  freeze: {
    account_key: string;
    account_name: string;
    currency: string;
    amount: Types.Decimal128;
    state: string;
  } | null;

  @Prop({ type: Object, default: null })
  profit: {
    currency: string;
    spread: number;
    fee: number;
    channel_cost: number;
    commission: number;
    net: number;
  } | null;

  @Prop({ type: Object, default: null })
  exception: {
    kind: string;
    reason: string;
    detail: string;
    prev_status: TradeOrderStatus;
    escalated: boolean;
    since: Date;
  } | null;

  @Prop({ type: Object, default: null })
  payment_rejected: { reason: string; by: string; at: Date } | null;

  @Prop({ type: Object, default: null })
  dispatch_rejected: { reason: string; by: string; at: Date } | null;

  @Prop({ type: String, default: null })
  receipt_ref: string | null;

  /** 活动时间线（新在前）；Mixed 数组必须整组赋值写入 */
  @Prop({ type: Array, default: [] })
  timeline: Array<{ at: Date; title: string; detail: string; actor: string }>;
}

export type TradeOrderDocument = HydratedDocument<TradeOrder> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const TradeOrderSchema = SchemaFactory.createForClass(TradeOrder);
addBaseFields(TradeOrderSchema);

/* 索引（docs/db/trade-orders.md 查询卡） */
TradeOrderSchema.index({ order_no: 1 }, { name: "uk_trade_orders_order_no", unique: true });
TradeOrderSchema.index(
  { is_deleted: 1, status: 1, created_at: -1 },
  { name: "idx_trade_orders_deleted_status_created_at" },
);
TradeOrderSchema.index(
  { customer_id: 1, created_at: -1 },
  { name: "idx_trade_orders_customer_id_created_at" },
);
