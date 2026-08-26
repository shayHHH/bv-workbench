import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../../common/base.schema";

/**
 * 报价组：组内成员为有序 ObjectId 数组（规范 §5.1 多值关联——数量有上限、
 * 始终整组读取，故不建关系集合）。
 */
export const QUOTE_GROUP_COLLECTION = "quote_groups";

@Schema({ collection: QUOTE_GROUP_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class QuoteGroup {
  @Prop({ type: String, required: true, trim: true, maxlength: 50 })
  name: string;

  /** 成员客户，数组顺序即展示顺序 */
  @Prop({ type: [Types.ObjectId], default: [] })
  customer_ids: Types.ObjectId[];
}

export type QuoteGroupDocument = HydratedDocument<QuoteGroup> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const QuoteGroupSchema = SchemaFactory.createForClass(QuoteGroup);
addBaseFields(QuoteGroupSchema);
QuoteGroupSchema.index(
  { is_deleted: 1, created_at: 1 },
  { name: "idx_quote_groups_deleted_created_at" },
);
