import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Schema as MongooseSchema, Types } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../../common/base.schema";

/**
 * 简化账户（资金模块前身，docs/db/trade-orders.md）。
 * 本轮仅承担订单冻结/释放/消耗的余额联动；账务流水与调仓留资金模块。
 */
export const TREASURY_ACCOUNT_COLLECTION = "treasury_accounts";

const Money = MongooseSchema.Types.Decimal128;

@Schema({ collection: TREASURY_ACCOUNT_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class TreasuryAccount {
  @Prop({ type: String, required: true })
  key: string;

  @Prop({ type: String, required: true })
  group: string;

  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String, required: true })
  currency: string;

  @Prop({ type: Money, required: true })
  available: Types.Decimal128;

  @Prop({ type: Money, required: true })
  frozen: Types.Decimal128;

  @Prop({ type: Money, required: true })
  opening: Types.Decimal128;

  @Prop({ type: Money, required: true })
  floor: Types.Decimal128;
}

export type TreasuryAccountDocument = HydratedDocument<TreasuryAccount> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const TreasuryAccountSchema = SchemaFactory.createForClass(TreasuryAccount);
addBaseFields(TreasuryAccountSchema);

TreasuryAccountSchema.index({ key: 1 }, { name: "uk_treasury_accounts_key", unique: true });
