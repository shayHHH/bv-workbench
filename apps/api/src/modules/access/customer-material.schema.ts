import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { FileRef } from "@bv/shared";
import { HydratedDocument, Types } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../common/base.schema";

/**
 * 客户材料库（PRD §4.7"保存客户材料库仅归档材料，不进入审核队列"）。
 * 一对多：子集合持有 customer_id（规范 §4.2）；申请复用时复制文件引用快照。
 */
export const CUSTOMER_MATERIAL_COLLECTION = "customer_materials";

@Schema({ collection: CUSTOMER_MATERIAL_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class CustomerMaterial {
  @Prop({ type: Types.ObjectId, required: true })
  customer_id: Types.ObjectId;

  @Prop({ type: String, required: true })
  name: string;

  /** 归档时关联的材料项名称（展示用途，不做强关联） */
  @Prop({ type: String, default: null })
  category: string | null;

  @Prop({ type: Object, required: true })
  file: FileRef;

  /** 同名材料重复归档时递增 */
  @Prop({ type: Number, default: 1 })
  version: number;

  @Prop({ type: String, default: null })
  uploader_name: string | null;
}

export type CustomerMaterialDocument = HydratedDocument<CustomerMaterial> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const CustomerMaterialSchema = SchemaFactory.createForClass(CustomerMaterial);
addBaseFields(CustomerMaterialSchema);

/* 索引（docs/db/business-access.md 查询卡） */
CustomerMaterialSchema.index(
  { customer_id: 1, is_deleted: 1, created_at: -1 },
  { name: "idx_customer_materials_customer_id_deleted_created_at" },
);
