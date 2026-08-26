import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { ReviewType } from "@bv/shared";
import { HydratedDocument, Types } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../common/base.schema";

/**
 * 合规审核分配（admin「审核分配」板块，docs/db/review-assignments.md）。
 * 每种审核类型一条文档；assignee_user_ids 为空 = 未配置，兜底全体合规可办。
 */
export const REVIEW_ASSIGNMENT_COLLECTION = "review_assignments";

@Schema({ collection: REVIEW_ASSIGNMENT_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class ReviewAssignment {
  @Prop({ type: String, required: true, enum: Object.values(ReviewType) })
  review_type: ReviewType;

  @Prop({ type: [Types.ObjectId], default: [] })
  assignee_user_ids: Types.ObjectId[];

  @Prop({ type: String, default: null })
  updated_by_name: string | null;
}

export type ReviewAssignmentDocument = HydratedDocument<ReviewAssignment> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const ReviewAssignmentSchema = SchemaFactory.createForClass(ReviewAssignment);
addBaseFields(ReviewAssignmentSchema);

ReviewAssignmentSchema.index(
  { review_type: 1 },
  { name: "uk_review_assignments_review_type", unique: true },
);
