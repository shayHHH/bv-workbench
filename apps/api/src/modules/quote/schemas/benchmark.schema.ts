import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Schema as MongooseSchema, Types } from "mongoose";
import { addBaseFields, BASE_TIMESTAMPS } from "../../../common/base.schema";

/**
 * 平台基准价：当前行集合 + 保存快照（规范 §4.5 当前主表 + 不可覆盖历史）。
 * code 是公式变量的稳定引用键；行删除用软删除，公式里引用已删行时求值报「变量暂无取值」。
 */
export const QUOTE_BENCHMARK_COLLECTION = "quote_benchmarks";
export const QUOTE_BENCHMARK_SNAPSHOT_COLLECTION = "quote_benchmark_snapshots";

@Schema({ collection: QUOTE_BENCHMARK_COLLECTION, timestamps: BASE_TIMESTAMPS, versionKey: false })
export class QuoteBenchmark {
  @Prop({ type: String, required: true, maxlength: 64 })
  code: string;

  /** 价格类型展示名（如「sino每日价格」） */
  @Prop({ type: String, required: true, maxlength: 100 })
  label: string;

  @Prop({ type: Types.Decimal128, required: true })
  value: Types.Decimal128;

  @Prop({ type: Number, default: 0 })
  sort: number;

  /** 数值最近一次变更时间（仅 value 改动时刷新；label/sort 改动不影响，供陈旧监测） */
  @Prop({ type: Date, default: () => new Date() })
  value_updated_at: Date;
}

export type QuoteBenchmarkDocument = HydratedDocument<QuoteBenchmark> & {
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
};

export const QuoteBenchmarkSchema = SchemaFactory.createForClass(QuoteBenchmark);
addBaseFields(QuoteBenchmarkSchema);
QuoteBenchmarkSchema.index(
  { code: 1 },
  {
    name: "uk_quote_benchmarks_code",
    unique: true,
    partialFilterExpression: { is_deleted: false },
  },
);

const SnapshotPriceSchema = new MongooseSchema(
  {
    label: { type: String, required: true, maxlength: 100 },
    value: { type: Types.Decimal128, required: true },
  },
  { _id: false },
);

@Schema({
  collection: QUOTE_BENCHMARK_SNAPSHOT_COLLECTION,
  timestamps: BASE_TIMESTAMPS,
  versionKey: false,
})
export class QuoteBenchmarkSnapshot {
  @Prop({ type: Date, required: true })
  saved_at: Date;

  @Prop({ type: String, required: true, maxlength: 50 })
  operator_name: string;

  @Prop({ type: [SnapshotPriceSchema], default: [] })
  prices: { label: string; value: Types.Decimal128 }[];
}

export type QuoteBenchmarkSnapshotDocument = HydratedDocument<QuoteBenchmarkSnapshot> & {
  created_at: Date;
  is_deleted: boolean;
};

export const QuoteBenchmarkSnapshotSchema = SchemaFactory.createForClass(QuoteBenchmarkSnapshot);
addBaseFields(QuoteBenchmarkSnapshotSchema);
QuoteBenchmarkSnapshotSchema.index(
  { saved_at: -1 },
  { name: "idx_quote_benchmark_snapshots_saved_at" },
);
