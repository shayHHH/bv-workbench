import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../../common/base.schema";

/**
 * 渠道即时汇率（当前为人工维护的演示数据；真实行情源 / 内部数仓接入后由
 * datasources 层写入本集合，接口结构保持不变）。
 */
export const QUOTE_CHANNEL_RATE_COLLECTION = "quote_channel_rates";

@Schema({ collection: QUOTE_CHANNEL_RATE_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class QuoteChannelRate {
  /** 公式变量稳定键，如 xe_usdt_cnh */
  @Prop({ type: String, required: true, maxlength: 64 })
  code: string;

  /** 展示名，如 XE-USDT:CNH */
  @Prop({ type: String, required: true, maxlength: 100 })
  label: string;

  @Prop({ type: Types.Decimal128, required: true })
  value: Types.Decimal128;

  @Prop({ type: Number, default: 0 })
  sort: number;

  @Prop({ type: String, default: "XE" , maxlength: 50})
  source: string;
}

export type QuoteChannelRateDocument = HydratedDocument<QuoteChannelRate> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const QuoteChannelRateSchema = SchemaFactory.createForClass(QuoteChannelRate);
addBaseFields(QuoteChannelRateSchema);
QuoteChannelRateSchema.index(
  { code: 1 },
  {
    name: "uk_quote_channel_rates_code",
    unique: true,
    partialFilterExpression: { is_deleted: false },
  },
);
