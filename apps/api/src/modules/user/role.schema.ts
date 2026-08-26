import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../common/base.schema";

/** 角色主数据（规范 §4.1）。内置角色由启动引导写入，admin 可追加自定义角色。 */
export const ROLE_COLLECTION = "roles";

@Schema({ collection: ROLE_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class Role {
  /** 稳定角色代码（大写），如 ADMIN、AGENT */
  @Prop({ type: String, required: true, uppercase: true, trim: true })
  role_code: string;

  @Prop({ type: String, required: true, trim: true })
  role_name: string;

  @Prop({ type: String, default: null, maxlength: 200 })
  description: string | null;

  /** 内置角色不可删除、不可改代码 */
  @Prop({ type: Boolean, default: false, required: true })
  is_builtin: boolean;
}

export type RoleDocument = HydratedDocument<Role> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const RoleSchema = SchemaFactory.createForClass(Role);
addBaseFields(RoleSchema);

RoleSchema.index({ role_code: 1 }, { name: "uk_roles_role_code", unique: true });
RoleSchema.index({ is_deleted: 1, created_at: -1 }, { name: "idx_roles_deleted_created_at" });
