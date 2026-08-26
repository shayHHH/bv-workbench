import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { KycChannel, KycScenarioStatus } from "@bv/shared";
import { HydratedDocument } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../common/base.schema";

/**
 * KYC 材料清单配置（demo 四层：业务类型 → 渠道 → 材料模块 → 材料项，
 * 每个渠道持有独立材料清单与限制条目）。配置型集合，量级极小；发布后被材料上传页引用。
 */
export const KYC_SCENARIO_COLLECTION = "kyc_scenarios";

@Schema({ collection: KYC_SCENARIO_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class KycScenario {
  @Prop({ type: String, required: true, trim: true })
  scenario_code: string;

  @Prop({ type: String, required: true, trim: true })
  scenario_name: string;

  @Prop({ type: String, default: null })
  process_description: string | null;

  @Prop({ type: String, required: true, enum: Object.values(KycScenarioStatus), default: KycScenarioStatus.DRAFT })
  status: KycScenarioStatus;

  @Prop({ type: Boolean, default: false })
  is_builtin: boolean;

  /** 渠道列表：{ channel_code, channel_name, theme, restrictions[], sections[{ section_name, items[] }] } */
  @Prop({ type: Array, default: [] })
  channels: KycChannel[];

  @Prop({ type: Number, default: 0 })
  sort_order: number;

  @Prop({ type: Date, default: null })
  published_at: Date | null;
}

export type KycScenarioDocument = HydratedDocument<KycScenario> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const KycScenarioSchema = SchemaFactory.createForClass(KycScenario);
addBaseFields(KycScenarioSchema);

/* 索引（docs/db/business-access.md 查询卡） */
KycScenarioSchema.index(
  { scenario_code: 1 },
  { name: "uk_kyc_scenarios_scenario_code", unique: true },
);
