import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { CustomerEventType } from "@bv/shared";
import { HydratedDocument, Types } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../common/base.schema";

/**
 * 客户档案事件（规范 §4.6 事件日志范式）：追加型，只 insert 不更新。
 * 关键状态变更记录操作人、动作与前后值（§5.3），驱动客户详情抽屉的时间线。
 */
export const CUSTOMER_EVENT_COLLECTION = "customer_events";

@Schema({ collection: CUSTOMER_EVENT_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class CustomerEvent {
  @Prop({ type: Types.ObjectId, required: true })
  customer_id: Types.ObjectId;

  @Prop({ type: String, required: true, enum: Object.values(CustomerEventType) })
  event_type: CustomerEventType;

  @Prop({ type: String, required: true, maxlength: 50 })
  title: string;

  @Prop({ type: String, required: true, maxlength: 500 })
  detail: string;

  @Prop({ type: Types.ObjectId, default: null })
  operator_id: Types.ObjectId | null;

  /** 冗余操作人姓名用于展示（规范允许少量展示冗余；事实来源为 users） */
  @Prop({ type: String, default: null, maxlength: 50 })
  operator_name: string | null;
}

export type CustomerEventDocument = HydratedDocument<CustomerEvent> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const CustomerEventSchema = SchemaFactory.createForClass(CustomerEvent);
addBaseFields(CustomerEventSchema);

CustomerEventSchema.index(
  { customer_id: 1, created_at: -1 },
  { name: "idx_customer_events_customer_id_created_at" },
);
