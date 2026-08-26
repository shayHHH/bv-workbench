import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import {
  BenchmarkSnapshotVO,
  BenchmarkStateVO,
  ChannelRateVO,
  VariableSource,
} from "@bv/shared";
import { Model, Types } from "mongoose";
import { JwtPayload } from "../../auth/auth.types";
import {
  QuoteBenchmark,
  QuoteBenchmarkDocument,
  QuoteBenchmarkSnapshot,
  QuoteBenchmarkSnapshotDocument,
} from "./schemas/benchmark.schema";
import { QuoteChannelRate, QuoteChannelRateDocument } from "./schemas/channel-rate.schema";
import { QuerySnapshotsDto, SaveBenchmarksDto, UpdateChannelRatesDto } from "./dto/quote.dto";

function dec(value: Types.Decimal128 | null | undefined): string | null {
  return value == null ? null : value.toString();
}

/** 平台基准价（当前行 + 保存快照）与渠道即时汇率 */
@Injectable()
export class QuoteMarketService {
  constructor(
    @InjectModel(QuoteBenchmark.name)
    private readonly benchmarkModel: Model<QuoteBenchmarkDocument>,
    @InjectModel(QuoteBenchmarkSnapshot.name)
    private readonly snapshotModel: Model<QuoteBenchmarkSnapshotDocument>,
    @InjectModel(QuoteChannelRate.name)
    private readonly channelModel: Model<QuoteChannelRateDocument>,
  ) {}

  async getBenchmarkState(): Promise<BenchmarkStateVO> {
    const [items, latest] = await Promise.all([
      this.benchmarkModel.find({ is_deleted: false }).sort({ sort: 1, created_at: 1 }).lean(),
      this.snapshotModel.findOne({ is_deleted: false }).sort({ saved_at: -1 }).lean(),
    ]);
    return {
      items: items.map(item => ({
        id: item._id.toString(),
        code: item.code,
        label: item.label,
        value: dec(item.value)!,
        sort: item.sort,
      })),
      saved_at: latest?.saved_at?.toISOString() ?? null,
      operator_name: latest?.operator_name ?? null,
    };
  }

  /**
   * 保存基准价：全量提交，入参未包含的现有行软删除；同时写入一条不可覆盖的快照。
   */
  async saveBenchmarks(dto: SaveBenchmarksDto, operator: JwtPayload): Promise<BenchmarkStateVO> {
    if (!dto.items.length) throw new BadRequestException("至少保留一项基准价");
    const labels = new Set<string>();
    for (const item of dto.items) {
      const label = item.label.trim();
      if (!label) throw new BadRequestException("价格类型名称不能为空");
      if (labels.has(label)) throw new BadRequestException(`价格类型「${label}」重复`);
      labels.add(label);
    }

    const existing = await this.benchmarkModel.find({ is_deleted: false });
    const byId = new Map(existing.map(doc => [doc._id.toString(), doc]));
    const operatorId = new Types.ObjectId(operator.sub);
    const keptIds = new Set<string>();

    for (const [index, item] of dto.items.entries()) {
      const doc = item.id ? byId.get(item.id) : undefined;
      if (item.id && !doc) throw new BadRequestException("基准价项目不存在或已被删除");
      if (doc) {
        doc.label = item.label.trim();
        doc.value = Types.Decimal128.fromString(item.value);
        doc.sort = index;
        doc.set("updated_by", operatorId);
        await doc.save();
        keptIds.add(doc._id.toString());
      } else {
        const id = new Types.ObjectId();
        const created = await this.benchmarkModel.create({
          _id: id,
          /* code 是公式变量的稳定引用键：允许显式指定（seed），否则派生自 _id */
          code: item.code?.trim() || `bench_${id.toString()}`,
          label: item.label.trim(),
          value: Types.Decimal128.fromString(item.value),
          sort: index,
          created_by: operatorId,
        });
        keptIds.add(created._id.toString());
      }
    }

    /* 未提交的行 = 用户删除的行（引用它的公式此后求值报「变量暂无取值」） */
    for (const doc of existing) {
      if (keptIds.has(doc._id.toString())) continue;
      doc.is_deleted = true;
      doc.set("deleted_at", new Date());
      doc.set("deleted_by", operatorId);
      await doc.save();
    }

    await this.snapshotModel.create({
      saved_at: new Date(),
      operator_name: operator.display_name,
      prices: dto.items.map(item => ({
        label: item.label.trim(),
        value: Types.Decimal128.fromString(item.value),
      })),
      created_by: operatorId,
    });

    return this.getBenchmarkState();
  }

  async listSnapshots(query: QuerySnapshotsDto): Promise<BenchmarkSnapshotVO[]> {
    const filter: Record<string, unknown> = { is_deleted: false };
    if (query.from || query.to) {
      filter.saved_at = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      };
    }
    const docs = await this.snapshotModel.find(filter).sort({ saved_at: -1 }).limit(100).lean();
    return docs.map(doc => ({
      id: doc._id.toString(),
      saved_at: doc.saved_at.toISOString(),
      operator_name: doc.operator_name,
      prices: doc.prices.map(p => ({ label: p.label, value: dec(p.value)! })),
    }));
  }

  async listChannelRates(): Promise<ChannelRateVO[]> {
    const docs = await this.channelModel
      .find({ is_deleted: false })
      .sort({ sort: 1, created_at: 1 })
      .lean();
    return docs.map(doc => ({
      id: doc._id.toString(),
      code: doc.code,
      label: doc.label,
      value: dec(doc.value)!,
      sort: doc.sort,
      updated_at: doc.updated_at?.toISOString() ?? null,
    }));
  }

  /** 手工维护渠道汇率（真实行情源接入前的过渡通道） */
  async updateChannelRates(dto: UpdateChannelRatesDto, operator: JwtPayload): Promise<ChannelRateVO[]> {
    for (const item of dto.items) {
      const updated = await this.channelModel.updateOne(
        { _id: item.id, is_deleted: false },
        {
          $set: {
            value: Types.Decimal128.fromString(item.value),
            updated_by: new Types.ObjectId(operator.sub),
          },
        },
      );
      if (!updated.matchedCount) throw new BadRequestException("渠道汇率项不存在");
    }
    return this.listChannelRates();
  }

  /** 公式求值用：BENCHMARK / CHANNEL 变量 code → 数值 */
  async variableNumberLookup(): Promise<(source: VariableSource, code: string) => number | null> {
    const [benchmarks, channels] = await Promise.all([
      this.benchmarkModel.find({ is_deleted: false }).lean(),
      this.channelModel.find({ is_deleted: false }).lean(),
    ]);
    const benchMap = new Map(benchmarks.map(b => [b.code, Number(b.value.toString())]));
    const chanMap = new Map(channels.map(c => [c.code, Number(c.value.toString())]));
    return (source, code) => {
      const map =
        source === VariableSource.BENCHMARK
          ? benchMap
          : source === VariableSource.CHANNEL
            ? chanMap
            : null;
      const value = map?.get(code);
      return value === undefined || Number.isNaN(value) ? null : value;
    };
  }
}
