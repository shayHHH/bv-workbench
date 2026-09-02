import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { LeavePart, LeaveType } from "@bv/shared";
import { HydratedDocument, Types } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../common/base.schema";

/**
 * 部门请假 / 不可用记录（运营经理手工登记，PRD §部门管理）。
 * 员工关联系统用户（users），登记只服务内部排班与交接，正式审批以第三方 OA 为准。
 * 日期存 YYYY-MM-DD、时间存 HH:mm 字符串，与出勤日历的按天比对口径一致。
 */
export const DEPARTMENT_LEAVE_COLLECTION = "department_leaves";

@Schema({ collection: DEPARTMENT_LEAVE_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class LeaveRecord {
  @Prop({ type: String, required: true })
  leave_no: string;

  @Prop({ type: Types.ObjectId, required: true })
  user_id: Types.ObjectId;

  /** 登记时用户姓名 / 角色快照 */
  @Prop({ type: String, required: true })
  user_name: string;

  @Prop({ type: String, default: "" })
  role_name: string;

  @Prop({ type: String, required: true, enum: Object.values(LeaveType) })
  leave_type: LeaveType;

  @Prop({ type: String, required: true, enum: Object.values(LeavePart) })
  part: LeavePart;

  @Prop({ type: String, required: true })
  start_date: string;

  @Prop({ type: String, required: true })
  end_date: string;

  @Prop({ type: String, required: true })
  start_time: string;

  @Prop({ type: String, required: true })
  end_time: string;

  @Prop({ type: String, default: null, maxlength: 500 })
  note: string | null;

  @Prop({ type: String, required: true, default: "手工登记" })
  source: string;

  /** 登记时勾选「需要任务交接提醒」 */
  @Prop({ type: Boolean, default: false })
  handoff: boolean;

  @Prop({ type: Boolean, default: false })
  handoff_done: boolean;

  /** 接手人姓名快照（展示用） */
  @Prop({ type: String, default: null })
  handoff_target: string | null;

  /** 接手人用户 id：代班授权的判定依据（经理指定，可为系统任一启用账号） */
  @Prop({ type: Types.ObjectId, default: null })
  handoff_user_id: Types.ObjectId | null;

  /** 被代班的岗位（交接时的请假人角色快照）：接手人在请假区间内按此角色放行 */
  @Prop({ type: String, default: null })
  handoff_role_code: string | null;

  @Prop({ type: Date, default: null })
  handoff_at: Date | null;

  @Prop({ type: String, required: true })
  registered_by: string;
}

export type LeaveRecordDocument = HydratedDocument<LeaveRecord> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const LeaveRecordSchema = SchemaFactory.createForClass(LeaveRecord);
addBaseFields(LeaveRecordSchema);

LeaveRecordSchema.index({ leave_no: 1 }, { name: "uk_department_leaves_leave_no", unique: true });
LeaveRecordSchema.index(
  { is_deleted: 1, end_date: 1, start_date: 1 },
  { name: "idx_department_leaves_deleted_range" },
);
/* 代班授权判定：每次守卫兜底查询按「接手人 + 生效中」命中 */
LeaveRecordSchema.index(
  { handoff_user_id: 1, is_deleted: 1, handoff_done: 1, end_date: 1, start_date: 1 },
  { name: "idx_department_leaves_handoff_user" },
);
