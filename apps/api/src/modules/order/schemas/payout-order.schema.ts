import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { DispatchChannel, DispatchStatus } from "@bv/shared";
import { HydratedDocument, Schema as MongooseSchema, Types } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../../common/base.schema";

/** 出款排单（docs/db/trade-orders.md）。驳回/执行退回时作废（VOID），重新提交生成新排单。 */
export const PAYOUT_ORDER_COLLECTION = "payout_orders";

@Schema({ collection: PAYOUT_ORDER_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class PayoutOrder {
  @Prop({ type: String, required: true })
  dispatch_no: string;

  @Prop({ type: Types.ObjectId, required: true })
  order_id: Types.ObjectId;

  @Prop({ type: String, required: true })
  order_no: string;

  @Prop({ type: Types.ObjectId, required: true })
  customer_id: Types.ObjectId;

  @Prop({ type: String, required: true })
  customer_name: string;

  @Prop({ type: String, default: null })
  customer_code: string | null;

  @Prop({ type: String, required: true, enum: Object.values(DispatchChannel) })
  channel: DispatchChannel;

  @Prop({ type: String, required: true })
  currency: string;

  @Prop({ type: MongooseSchema.Types.Decimal128, required: true })
  amount: Types.Decimal128;

  @Prop({ type: String, required: true })
  order_title: string;

  @Prop({ type: String, required: true })
  final_text: string;

  @Prop({ type: String, required: true })
  payout_account: string;

  @Prop({ type: Object, default: null })
  va_account: { virtual_account_number: string; iban: string; currency: string } | null;

  @Prop({ type: String, required: true })
  payee: string;

  @Prop({ type: String, required: true })
  payee_bank: string;

  @Prop({ type: String, required: true, enum: Object.values(DispatchStatus), default: DispatchStatus.REVIEWING })
  status: DispatchStatus;

  @Prop({ type: String, required: true })
  submitted_by: string;

  @Prop({ type: Date, required: true })
  submitted_at: Date;

  @Prop({ type: String, default: null })
  reviewed_by: string | null;

  @Prop({ type: Date, default: null })
  reviewed_at: Date | null;

  @Prop({ type: String, default: null })
  paid_by: string | null;

  @Prop({ type: Date, default: null })
  paid_at: Date | null;

  @Prop({ type: Object, default: null })
  receipt: {
    file_name: string;
    reference: string | null;
    note: string | null;
    uploaded_by: string;
    uploaded_at: Date;
    matched: boolean;
  } | null;
}

export type PayoutOrderDocument = HydratedDocument<PayoutOrder> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const PayoutOrderSchema = SchemaFactory.createForClass(PayoutOrder);
addBaseFields(PayoutOrderSchema);

PayoutOrderSchema.index({ dispatch_no: 1 }, { name: "uk_payout_orders_dispatch_no", unique: true });
PayoutOrderSchema.index(
  { order_id: 1, created_at: -1 },
  { name: "idx_payout_orders_order_id_created_at" },
);
