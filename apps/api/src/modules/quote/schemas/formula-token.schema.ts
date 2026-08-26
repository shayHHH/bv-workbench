import { Schema } from "mongoose";
import { FORMULA_OPERATORS, VariableSource } from "@bv/shared";

/**
 * 公式 token 子文档（规范 §5.2：嵌入对象须有固定字段）。
 * type=num → value 为数字字面量；type=op → value 为运算符；
 * type=var → source/code/label 描述变量（value 为空）。
 */
export const FormulaTokenSchema = new Schema(
  {
    type: { type: String, required: true, enum: ["num", "op", "var"] },
    value: { type: String, default: null, maxlength: 40 },
    source: { type: String, default: null, enum: [...Object.values(VariableSource), null] },
    code: { type: String, default: null, maxlength: 64 },
    label: { type: String, default: null, maxlength: 100 },
  },
  { _id: false },
);

export { FORMULA_OPERATORS };
