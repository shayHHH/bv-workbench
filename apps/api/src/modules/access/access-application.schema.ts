import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import {
  AccessStatus,
  AccessTimelineVO,
  ApplicationFormVO,
  ApplicationMaterialVO,
} from "@bv/shared";
import { HydratedDocument, Types } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../common/base.schema";

/**
 * 准入申请当前态主表（PRD §5.2 状态机；客户 × 业务类型 × 渠道一条活跃申请）。
 * 提交时的表单与材料快照落 review_cases（规范 §4.5），本表始终反映"当前资料"。
 * materials/timeline 为有界嵌入数组（材料至多几十份、时间线随审批步进）。
 */
export const ACCESS_APPLICATION_COLLECTION = "access_applications";

@Schema({ collection: ACCESS_APPLICATION_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class AccessApplication {
  @Prop({ type: String, required: true })
  application_no: string;

  @Prop({ type: Types.ObjectId, required: true })
  customer_id: Types.ObjectId;

  /** 创建申请时的客户快照 */
  @Prop({ type: Object, required: true })
  customer_snapshot: {
    name: string;
    customer_code: string | null;
    customer_kind: string;
    customer_sub_type: string | null;
  };

  @Prop({ type: Types.ObjectId, default: null })
  scenario_id: Types.ObjectId | null;

  /** 业务类型冗余快照（配置被改名后申请仍可读） */
  @Prop({ type: String, default: null })
  scenario_code: string | null;

  @Prop({ type: String, default: null })
  scenario_name: string | null;

  @Prop({ type: String, default: null })
  channel_code: string | null;

  /** 渠道名冗余快照（配置改名后申请仍可读） */
  @Prop({ type: String, default: null })
  channel_name: string | null;

  /** 提交模式：找换 / U相关（demo 提交坞选择；草稿期为空） */
  @Prop({ type: String, default: null })
  review_type: string | null;

  @Prop({ type: Object, default: { customer_cn_name: null, customer_en_name: null, business_note: null } })
  form: ApplicationFormVO;

  @Prop({ type: Array, default: [] })
  materials: ApplicationMaterialVO[];

  @Prop({ type: String, required: true, enum: Object.values(AccessStatus), default: AccessStatus.DRAFT })
  status: AccessStatus;

  @Prop({ type: Types.ObjectId, default: null })
  owner_user_id: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  owner_name: string | null;

  /** 最近一次合规结论摘要（补件处理页直接展示，免联查） */
  @Prop({ type: Object, default: null })
  latest_review: {
    case_id: string;
    action: string;
    reason: string | null;
    rejected_item_ids: string[];
    reviewed_at: Date;
    reviewer_name: string | null;
  } | null;

  /** 审批流步进记录（规范 §4.5：操作人/动作/前后状态） */
  @Prop({ type: Array, default: [] })
  timeline: Array<Omit<AccessTimelineVO, "at"> & { at: Date }>;

  /** 条件性放行的延期补件设置（合规出具 CONDITIONAL 结论时写入，正式通过后清空） */
  @Prop({ type: Object, default: null })
  deferral: {
    due_at: Date;
    missing_item_ids: string[];
    missing_item_names: string[];
    limit_amount: number | null;
    limit_currency: string | null;
    restrict_large_outflow: boolean;
    notes: string;
    decided_by: string | null;
    decided_at: Date;
    reminded: string[];
    overdue_at: Date | null;
  } | null;

  @Prop({ type: Date, default: null })
  submitted_at: Date | null;
}

export type AccessApplicationDocument = HydratedDocument<AccessApplication> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const AccessApplicationSchema = SchemaFactory.createForClass(AccessApplication);
addBaseFields(AccessApplicationSchema);

/* 索引（docs/db/business-access.md 查询卡） */
AccessApplicationSchema.index(
  { application_no: 1 },
  { name: "uk_access_applications_application_no", unique: true },
);
AccessApplicationSchema.index(
  { is_deleted: 1, status: 1, updated_at: -1 },
  { name: "idx_access_applications_deleted_status_updated_at" },
);
AccessApplicationSchema.index(
  { customer_id: 1, created_at: -1 },
  { name: "idx_access_applications_customer_id_created_at" },
);
