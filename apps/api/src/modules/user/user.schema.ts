import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { UserStatus } from "@bv/shared";
import { HydratedDocument, Types } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../common/base.schema";

/**
 * 登录账号主数据（规范 §4.1；参考 BV admin 集合）。
 * password_hash 只存 bcrypt 哈希；任何查询/VO 不得外泄该字段（规范 §7.3）。
 */
export const USER_COLLECTION = "users";

@Schema({ collection: USER_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class User {
  @Prop({ type: String, required: true, trim: true, lowercase: true })
  username: string;

  @Prop({ type: String, required: true })
  password_hash: string;

  @Prop({ type: String, required: true, trim: true })
  display_name: string;

  /** 职位/工号展示，如 "Junior Trader · JT-018" */
  @Prop({ type: String, default: null, maxlength: 100 })
  title: string | null;

  @Prop({ type: Types.ObjectId, required: true })
  role_id: Types.ObjectId;

  @Prop({ type: String, required: true, enum: Object.values(UserStatus), default: UserStatus.ACTIVE })
  user_status: UserStatus;

  @Prop({ type: Date, default: null })
  last_login_at: Date | null;
}

export type UserDocument = HydratedDocument<User> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const UserSchema = SchemaFactory.createForClass(User);
addBaseFields(UserSchema);

UserSchema.index({ username: 1 }, { name: "uk_users_username", unique: true });
UserSchema.index({ is_deleted: 1, user_status: 1, created_at: -1 }, { name: "idx_users_deleted_status_created_at" });
UserSchema.index({ role_id: 1 }, { name: "idx_users_role_id" });
