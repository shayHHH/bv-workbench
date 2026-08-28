import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import {
  CustomerKind,
  CustomerStatus,
  CustomerSubType,
  Region,
} from "@bv/shared";
import { HydratedDocument, Types } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../common/base.schema";

/**
 * 客户主数据（规范 §4.1 主数据范式）。
 * 集合名与字段统一 snake_case；枚举存稳定英文代码。
 * 中介层级用 parent_id 自引用（SUB_CUSTOMER -> INTERMEDIARY）。
 */
export const CUSTOMER_COLLECTION = "customers";

@Schema({ collection: CUSTOMER_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class Customer {
  /** 业务客户编号（20001-29999）；中介下级客户允许无编号 */
  @Prop({ type: String, default: null })
  customer_code: string | null;

  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, required: true, enum: Object.values(CustomerKind) })
  customer_kind: CustomerKind;

  /** 所属中介（仅 customer_kind = SUB_CUSTOMER 时有值） */
  @Prop({ type: Types.ObjectId, default: null })
  parent_id: Types.ObjectId | null;

  @Prop({ type: String, enum: Object.values(CustomerSubType), default: null })
  sub_type: CustomerSubType | null;

  @Prop({ type: String, enum: Object.values(Region), default: null })
  region: Region | null;

  @Prop({ type: String, default: null })
  phone: string | null;

  @Prop({ type: String, default: null, maxlength: 500 })
  remark: string | null;

  @Prop({ type: String, required: true, enum: Object.values(CustomerStatus), default: CustomerStatus.NEW })
  customer_status: CustomerStatus;
}

export type CustomerDocument = HydratedDocument<Customer> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const CustomerSchema = SchemaFactory.createForClass(Customer);
addBaseFields(CustomerSchema);

/* 索引（规范 §6，与 docs/db/customers.md 查询卡对应） */
CustomerSchema.index(
  { customer_code: 1 },
  {
    name: "uk_customers_customer_code",
    unique: true,
    // 无编号的中介下级客户 customer_code 为 null，不参与唯一约束
    partialFilterExpression: { customer_code: { $type: "string" } },
  },
);
CustomerSchema.index(
  { is_deleted: 1, customer_status: 1, created_at: -1 },
  { name: "idx_customers_deleted_status_created_at" },
);
CustomerSchema.index(
  { parent_id: 1, created_at: -1 },
  { name: "idx_customers_parent_id_created_at" },
);
