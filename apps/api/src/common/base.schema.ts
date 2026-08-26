import { Schema, Types } from "mongoose";

/**
 * 公共审计与软删除字段，对应《BV MongoDB 表结构与设计规范》§3.2 BaseDocument。
 * created_at / updated_at 由 schema 的 timestamps 选项维护（见 BASE_TIMESTAMPS）；
 * created_by / updated_by 在接入登录鉴权后由统一审计逻辑填充，当前允许为空。
 */
export const BASE_TIMESTAMPS = {
  createdAt: "created_at",
  updatedAt: "updated_at",
} as const;

export function addBaseFields(schema: Schema): void {
  schema.add({
    created_by: { type: Types.ObjectId, default: null },
    updated_by: { type: Types.ObjectId, default: null },
    is_deleted: { type: Boolean, default: false, required: true },
    deleted_by: { type: Types.ObjectId, default: null },
    deleted_at: { type: Date, default: null },
  });
}
