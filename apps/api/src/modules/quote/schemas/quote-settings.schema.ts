import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../../common/base.schema";

/**
 * 报价监测阈值（admin 全局配置，单文档；单位：小时）。
 * 用 singleton_key 唯一约束保证全局仅一条；缺省值由 DEFAULT_QUOTE_MONITOR_SETTINGS 兜底。
 */
export const QUOTE_SETTINGS_COLLECTION = "quote_settings";

@Schema({ collection: QUOTE_SETTINGS_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class QuoteSettings {
  /** 单例键，固定 "global" */
  @Prop({ type: String, required: true, default: "global" })
  singleton_key: string;

  @Prop({ type: Number, required: true, default: 12 })
  benchmark_hours: number;

  @Prop({ type: Number, required: true, default: 4 })
  channel_hours: number;

  @Prop({ type: Number, required: true, default: 12 })
  broker_hours: number;

  @Prop({ type: Number, required: true, default: 12 })
  quote_item_hours: number;

  @Prop({ type: Number, required: true, default: 24 })
  result_hours: number;
}

export type QuoteSettingsDocument = HydratedDocument<QuoteSettings> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const QuoteSettingsSchema = SchemaFactory.createForClass(QuoteSettings);
addBaseFields(QuoteSettingsSchema);
QuoteSettingsSchema.index({ singleton_key: 1 }, { name: "uk_quote_settings_singleton", unique: true });
