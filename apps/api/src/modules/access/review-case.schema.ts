import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import {
  ApplicationFormVO,
  ApplicationMaterialVO,
  ReviewAuditType,
  ReviewCaseStatus,
  ReviewDecisionAction,
  ReviewFinalResult,
  ReviewMaterialVerdict,
} from "@bv/shared";
import { HydratedDocument, Types } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../common/base.schema";

/**
 * 合规审核工单（PRD §4.8/§6.4）。追加型：交易员每次提交（含驳回后重提）新增一条，
 * 携带提交当时的表单/材料快照（规范 §4.5：审核结论必须能还原当时输入）。
 */
export const REVIEW_CASE_COLLECTION = "review_cases";

@Schema({ collection: REVIEW_CASE_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class ReviewCase {
  @Prop({ type: String, required: true })
  case_no: string;

  @Prop({ type: Types.ObjectId, required: true })
  application_id: Types.ObjectId;

  @Prop({ type: String, required: true })
  application_no: string;

  @Prop({ type: Types.ObjectId, required: true })
  customer_id: Types.ObjectId;

  @Prop({ type: String, required: true })
  customer_name: string;

  @Prop({ type: String, default: null })
  customer_code: string | null;

  @Prop({ type: String, default: null })
  scenario_name: string | null;

  @Prop({ type: String, default: null })
  channel_code: string | null;

  @Prop({ type: String, required: true, enum: Object.values(ReviewAuditType) })
  audit_type: ReviewAuditType;

  @Prop({ type: String, required: true, enum: Object.values(ReviewCaseStatus), default: ReviewCaseStatus.PENDING })
  status: ReviewCaseStatus;

  @Prop({ type: String, enum: [...Object.values(ReviewFinalResult), null], default: null })
  final_result: ReviewFinalResult | null;

  /** 提交时客户风险等级快照 */
  @Prop({ type: String, default: null })
  risk_level: string | null;

  @Prop({ type: Object, required: true })
  completeness: { done: number; total: number };

  /** 交易员业务说明快照 */
  @Prop({ type: String, default: null })
  note: string | null;

  @Prop({ type: Object, required: true })
  form_snapshot: ApplicationFormVO;

  @Prop({ type: Array, default: [] })
  materials_snapshot: ApplicationMaterialVO[];

  /** 场景审核要求快照（流程约束 + 渠道限制，审核详情"人工审核要求"卡片） */
  @Prop({ type: String, default: null })
  review_requirement: string | null;

  @Prop({ type: Object, default: null })
  decision: {
    action: ReviewDecisionAction;
    reason: string | null;
    rejected_item_ids: string[];
  } | null;

  @Prop({ type: Array, default: [] })
  material_verdicts: ReviewMaterialVerdict[];

  @Prop({ type: String, default: null })
  submitted_by_name: string | null;

  @Prop({ type: Date, required: true })
  submitted_at: Date;

  @Prop({ type: Types.ObjectId, default: null })
  reviewer_id: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  reviewer_name: string | null;

  @Prop({ type: Date, default: null })
  reviewed_at: Date | null;
}

export type ReviewCaseDocument = HydratedDocument<ReviewCase> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const ReviewCaseSchema = SchemaFactory.createForClass(ReviewCase);
addBaseFields(ReviewCaseSchema);

/* 索引（docs/db/business-access.md 查询卡） */
ReviewCaseSchema.index({ case_no: 1 }, { name: "uk_review_cases_case_no", unique: true });
ReviewCaseSchema.index(
  { is_deleted: 1, status: 1, submitted_at: -1 },
  { name: "idx_review_cases_deleted_status_submitted_at" },
);
ReviewCaseSchema.index(
  { application_id: 1, submitted_at: -1 },
  { name: "idx_review_cases_application_id_submitted_at" },
);
