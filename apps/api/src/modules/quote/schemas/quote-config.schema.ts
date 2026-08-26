import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { RoundMode } from "@bv/shared";
import { HydratedDocument, Schema as MongooseSchema, Types } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../../common/base.schema";
import { FormulaTokenSchema } from "./formula-token.schema";

/**
 * 客户报价配置（一客户一文档；规范 §4.1）。
 * 报价项为有界嵌入数组（单客户报价项个位数量级），顺序即展示顺序。
 */
export const QUOTE_CONFIG_COLLECTION = "quote_configs";

const QuoteItemSchema = new MongooseSchema(
  {
    trade_type: { type: String, default: "", maxlength: 50 },
    prefix: { type: String, default: "", maxlength: 50 },
    suffix: { type: String, default: "", maxlength: 50 },
    formula: { type: [FormulaTokenSchema], default: [] },
    /** 中介加点 / BV 加点：仅记录展示，不参与计算（对齐原型） */
    broker_point: { type: Types.Decimal128, default: null },
    bv_point: { type: Types.Decimal128, default: null },
    digits: { type: Number, default: 4, min: 0, max: 8 },
    round_mode: {
      type: String,
      enum: Object.values(RoundMode),
      default: RoundMode.HALF_UP,
    },
    output_checked: { type: Boolean, default: true },
    last_result: { type: Types.Decimal128, default: null },
    last_quoted_at: { type: Date, default: null },
  },
  { _id: true },
);

@Schema({ collection: QUOTE_CONFIG_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class QuoteConfig {
  @Prop({ type: Types.ObjectId, required: true })
  customer_id: Types.ObjectId;

  @Prop({ type: [QuoteItemSchema], default: [] })
  items: Types.DocumentArray<{
    _id: Types.ObjectId;
    trade_type: string;
    prefix: string;
    suffix: string;
    formula: unknown[];
    broker_point: Types.Decimal128 | null;
    bv_point: Types.Decimal128 | null;
    digits: number;
    round_mode: RoundMode;
    output_checked: boolean;
    last_result: Types.Decimal128 | null;
    last_quoted_at: Date | null;
  }>;

  /** 对客文本：报价开头 / 报价结尾 / 是否附带报价时间 */
  @Prop({ type: String, default: "", maxlength: 500 })
  text_opening: string;

  @Prop({ type: String, default: "", maxlength: 500 })
  text_ending: string;

  @Prop({ type: Boolean, default: false })
  include_quote_time: boolean;

  /** 常用备注（≤8 条，去重，先进先出淘汰） */
  @Prop({ type: [String], default: [] })
  common_notes: string[];
}

export type QuoteConfigDocument = HydratedDocument<QuoteConfig> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const QuoteConfigSchema = SchemaFactory.createForClass(QuoteConfig);
addBaseFields(QuoteConfigSchema);

/* 索引（docs/db/quotes.md 查询卡） */
QuoteConfigSchema.index(
  { customer_id: 1 },
  { name: "uk_quote_configs_customer_id", unique: true },
);
