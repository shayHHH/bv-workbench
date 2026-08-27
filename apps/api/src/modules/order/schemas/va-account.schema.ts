import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../../common/base.schema";

/** 客户 VA 账户（SGB 渠道排单要素，docs/db/trade-orders.md）。登记界面留后续模块，seed 迁移 demo 数据。 */
export const VA_ACCOUNT_COLLECTION = "va_accounts";

@Schema({ collection: VA_ACCOUNT_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class VaAccount {
  @Prop({ type: Types.ObjectId, required: true })
  customer_id: Types.ObjectId;

  @Prop({ type: String, required: true })
  label: string;

  @Prop({ type: String, required: true })
  virtual_account_number: string;

  @Prop({ type: String, required: true })
  iban: string;

  @Prop({ type: String, required: true })
  currency: string;

  @Prop({ type: String, required: true })
  bank: string;
}

export type VaAccountDocument = HydratedDocument<VaAccount> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const VaAccountSchema = SchemaFactory.createForClass(VaAccount);
addBaseFields(VaAccountSchema);

VaAccountSchema.index({ customer_id: 1 }, { name: "idx_va_accounts_customer_id" });
