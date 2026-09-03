import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { RoundMode } from "@bv/shared";
import { HydratedDocument, Schema as MongooseSchema, Types } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../../common/base.schema";

/**
 * 报价历史（规范 §4.6 事件日志）：每次计算、每个报价项一条，不可覆盖。
 * 变量取值与公式文本为落库时点快照，供往期报价的明细抽屉回放。
 */
export const QUOTE_RECORD_COLLECTION = "quote_records";

const RecordVariableSchema = new MongooseSchema(
  {
    label: { type: String, required: true, maxlength: 100 },
    value: { type: String, required: true, maxlength: 50 },
  },
  { _id: false },
);

@Schema({ collection: QUOTE_RECORD_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class QuoteRecord {
  @Prop({ type: Types.ObjectId, required: true })
  customer_id: Types.ObjectId;

  @Prop({ type: String, default: "", maxlength: 50 })
  trade_type: string;

  @Prop({ type: String, default: "", maxlength: 50 })
  prefix: string;

  @Prop({ type: String, default: "", maxlength: 50 })
  suffix: string;

  /** 变量名形式的公式文本，如 "XE-USDT:CNH - 3.02890" */
  @Prop({ type: String, default: "", maxlength: 500 })
  formula_text: string;

  /** 变量代入数值后的算式，如 "7.23680 - 3.02890" */
  @Prop({ type: String, default: "", maxlength: 500 })
  formula_calc: string;

  @Prop({ type: [RecordVariableSchema], default: [] })
  variables: { label: string; value: string }[];

  @Prop({ type: Types.Decimal128, required: true })
  result: Types.Decimal128;

  @Prop({ type: Types.Decimal128, default: null })
  broker_point: Types.Decimal128 | null;

  @Prop({ type: Types.Decimal128, default: null })
  bv_point: Types.Decimal128 | null;

  @Prop({ type: Number, default: 4 })
  digits: number;

  @Prop({ type: String, enum: Object.values(RoundMode), default: RoundMode.HALF_UP })
  round_mode: RoundMode;

  @Prop({ type: Date, required: true })
  quoted_at: Date;

  @Prop({ type: String, required: true, maxlength: 50 })
  operator_name: string;

  /** 计算时引用的数据版本快照（基准价最近保存时间 / 渠道汇率最近更新时间），用于追溯与陈旧核验 */
  @Prop({
    type: {
      benchmark_saved_at: { type: Date, default: null },
      channel_updated_at: { type: Date, default: null },
    },
    _id: false,
    default: null,
  })
  pricing_version: { benchmark_saved_at: Date | null; channel_updated_at: Date | null } | null;
}

export type QuoteRecordDocument = HydratedDocument<QuoteRecord> & {
  created_at: Date;
  is_deleted: boolean;
};

export const QuoteRecordSchema = SchemaFactory.createForClass(QuoteRecord);
addBaseFields(QuoteRecordSchema);
QuoteRecordSchema.index(
  { customer_id: 1, quoted_at: -1 },
  { name: "idx_quote_records_customer_id_quoted_at" },
);
