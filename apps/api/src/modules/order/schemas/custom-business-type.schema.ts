import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../../common/base.schema";

/**
 * 自定义准入业务类型（交易员在新建订单时手填、全员共享）。
 * 与 kyc_scenarios 的区别：这里只有一个名称、没有渠道与材料清单，
 * 因此走自定义类型建单的订单不会带 business_scenario_id，材料上传页也不会显示材料项。
 */
export const CUSTOM_BUSINESS_TYPE_COLLECTION = "custom_business_types";

@Schema({ collection: CUSTOM_BUSINESS_TYPE_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class CustomBusinessType {
  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, default: null })
  created_by_name: string | null;
}

export type CustomBusinessTypeDocument = HydratedDocument<CustomBusinessType> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const CustomBusinessTypeSchema = SchemaFactory.createForClass(CustomBusinessType);
addBaseFields(CustomBusinessTypeSchema);

CustomBusinessTypeSchema.index(
  { name: 1 },
  { name: "uk_custom_business_types_name", unique: true },
);
