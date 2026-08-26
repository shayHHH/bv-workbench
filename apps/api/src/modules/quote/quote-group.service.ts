import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import {
  formulaToText,
  QuoteGroupBoardVO,
  QuoteGroupDetailVO,
  QuoteGroupVO,
} from "@bv/shared";
import { Model, Types } from "mongoose";
import { JwtPayload } from "../../auth/auth.types";
import { Customer, CustomerDocument } from "../customer/customer.schema";
import { AddGroupMembersDto, CreateGroupDto, RenameGroupDto } from "./dto/quote.dto";
import { rawToToken } from "./formula-text.util";
import { QuoteService } from "./quote.service";
import { QuoteConfig, QuoteConfigDocument } from "./schemas/quote-config.schema";
import { QuoteGroup, QuoteGroupDocument } from "./schemas/quote-group.schema";

function dec(value: Types.Decimal128 | null | undefined): string | null {
  return value == null ? null : value.toString();
}

/** 组成员只需要的客户字段（结构化类型，避免与 Hydrated 文档类型纠缠） */
interface MemberDoc {
  _id: Types.ObjectId;
  name: string;
  customer_code: string | null;
  parent_id: Types.ObjectId | null;
}

@Injectable()
export class QuoteGroupService {
  constructor(
    @InjectModel(QuoteGroup.name) private readonly groupModel: Model<QuoteGroupDocument>,
    @InjectModel(QuoteConfig.name) private readonly configModel: Model<QuoteConfigDocument>,
    @InjectModel(Customer.name) private readonly customerModel: Model<CustomerDocument>,
    private readonly quoteService: QuoteService,
  ) {}

  async list(): Promise<QuoteGroupVO[]> {
    const docs = await this.groupModel.find({ is_deleted: false }).sort({ created_at: 1 }).lean();
    return docs.map(doc => ({
      id: doc._id.toString(),
      name: doc.name,
      customer_count: doc.customer_ids.length,
    }));
  }

  async detail(id: string): Promise<QuoteGroupDetailVO> {
    const doc = await this.findActiveGroup(id);
    const customers = await this.resolveMembers(doc);
    const brokerLabels = await this.brokerLabels(customers);
    return {
      id: doc._id.toString(),
      name: doc.name,
      members: customers.map(customer => ({
        customer_id: customer._id.toString(),
        name: customer.name,
        customer_code: customer.customer_code ?? null,
        broker_label: brokerLabels.get(customer._id.toString()) ?? null,
      })),
    };
  }

  /** 批量报价看板：组内成员的报价项现值（含未初始化配置的空成员） */
  async board(id: string): Promise<QuoteGroupBoardVO> {
    const doc = await this.findActiveGroup(id);
    const customers = await this.resolveMembers(doc);
    const configs = await this.configModel
      .find({ is_deleted: false, customer_id: { $in: customers.map(c => c._id) } })
      .lean();
    const configByCustomer = new Map(configs.map(c => [c.customer_id.toString(), c]));
    const brokerLabels = await this.brokerLabels(customers);

    return {
      id: doc._id.toString(),
      name: doc.name,
      members: customers.map(customer => {
        const config = configByCustomer.get(customer._id.toString());
        const items = (config?.items ?? []).map(item => ({
          id: item._id.toString(),
          trade_type: item.trade_type,
          prefix: item.prefix,
          suffix: item.suffix,
          formula_text: formulaToText(
            (item.formula as Record<string, unknown>[]).map(rawToToken),
          ),
          result: dec(item.last_result),
          last_quoted_at: item.last_quoted_at?.toISOString() ?? null,
          output_checked: item.output_checked,
        }));
        const latest = items.reduce<string | null>(
          (max, item) =>
            item.last_quoted_at && (!max || item.last_quoted_at > max) ? item.last_quoted_at : max,
          null,
        );
        return {
          customer_id: customer._id.toString(),
          name: customer.name,
          customer_code: customer.customer_code ?? null,
          broker_label: brokerLabels.get(customer._id.toString()) ?? null,
          last_quoted_at: latest,
          items,
        };
      }),
    };
  }

  async create(dto: CreateGroupDto, operator: JwtPayload): Promise<QuoteGroupVO> {
    const doc = await this.groupModel.create({
      name: dto.name.trim(),
      customer_ids: [],
      created_by: new Types.ObjectId(operator.sub),
    });
    return { id: doc._id.toString(), name: doc.name, customer_count: 0 };
  }

  async rename(id: string, dto: RenameGroupDto, operator: JwtPayload): Promise<QuoteGroupVO> {
    const doc = await this.findActiveGroup(id);
    doc.name = dto.name.trim();
    doc.set("updated_by", new Types.ObjectId(operator.sub));
    await doc.save();
    return { id: doc._id.toString(), name: doc.name, customer_count: doc.customer_ids.length };
  }

  async softDelete(id: string, operator: JwtPayload): Promise<void> {
    const doc = await this.findActiveGroup(id);
    doc.is_deleted = true;
    doc.set("deleted_at", new Date());
    doc.set("deleted_by", new Types.ObjectId(operator.sub));
    await doc.save();
  }

  async addMembers(id: string, dto: AddGroupMembersDto, operator: JwtPayload): Promise<QuoteGroupDetailVO> {
    if (!dto.customer_ids.length) throw new BadRequestException("请先勾选需要添加的客户");
    const doc = await this.findActiveGroup(id);
    const candidates = await this.customerModel
      .find({ _id: { $in: dto.customer_ids }, is_deleted: false })
      .lean();
    if (candidates.length !== dto.customer_ids.length) {
      throw new BadRequestException("包含不存在的客户");
    }
    const existing = new Set(doc.customer_ids.map(v => v.toString()));
    for (const target of dto.customer_ids) {
      if (!existing.has(target)) {
        doc.customer_ids.push(new Types.ObjectId(target));
        existing.add(target);
      }
    }
    doc.set("updated_by", new Types.ObjectId(operator.sub));
    await doc.save();
    return this.detail(id);
  }

  async removeMember(id: string, customerId: string, operator: JwtPayload): Promise<void> {
    const doc = await this.findActiveGroup(id);
    const before = doc.customer_ids.length;
    doc.set(
      "customer_ids",
      doc.customer_ids.filter(v => v.toString() !== customerId),
    );
    if (doc.customer_ids.length === before) throw new NotFoundException("该客户不在组内");
    doc.set("updated_by", new Types.ObjectId(operator.sub));
    await doc.save();
  }

  /** 重算整组：逐客户走统一重算（写历史记录），返回汇总 */
  async recalculate(
    id: string,
    operator: JwtPayload,
  ): Promise<{ customers: number; items: number; errors: string[] }> {
    const doc = await this.findActiveGroup(id);
    const customers = await this.resolveMembers(doc);
    let itemCount = 0;
    const errors: string[] = [];
    for (const customer of customers) {
      const result = await this.quoteService.recalculate(customer._id.toString(), operator);
      itemCount += result.config.items.length - result.errors.length;
      errors.push(...result.errors.map(e => `${customer.name}：${e.error}`));
    }
    return { customers: customers.length, items: itemCount, errors };
  }

  /** 导出全组报价 CSV（UTF-8 BOM，Excel 友好） */
  async exportCsv(id: string): Promise<{ filename: string; content: string }> {
    const board = await this.board(id);
    const header = ["客户", "编号", "交易类型", "前缀", "公式", "结果", "后缀", "最后更新"];
    const rows: string[][] = [header];
    for (const member of board.members) {
      for (const item of member.items) {
        rows.push([
          member.name,
          member.customer_code ?? "-",
          item.trade_type,
          item.prefix,
          item.formula_text,
          item.result ?? "-",
          item.suffix,
          item.last_quoted_at ?? "-",
        ]);
      }
    }
    const escape = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
    const content = `﻿${rows.map(row => row.map(escape).join(",")).join("\n")}`;
    return { filename: `quote-group-${board.name}.csv`, content };
  }

  private async findActiveGroup(id: string): Promise<QuoteGroupDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException("报价组 ID 不合法");
    const doc = await this.groupModel.findOne({ _id: id, is_deleted: false });
    if (!doc) throw new NotFoundException("报价组不存在");
    return doc;
  }

  /** 按组内顺序解析成员（剔除已删除客户） */
  private async resolveMembers(doc: QuoteGroupDocument): Promise<MemberDoc[]> {
    const customers = await this.customerModel
      .find({ _id: { $in: doc.customer_ids }, is_deleted: false })
      .lean();
    const byId = new Map(customers.map(c => [c._id.toString(), c]));
    const members: MemberDoc[] = [];
    for (const id of doc.customer_ids) {
      const customer = byId.get(id.toString());
      if (customer) members.push(customer);
    }
    return members;
  }

  private async brokerLabels(customers: MemberDoc[]): Promise<Map<string, string>> {
    const parentIds = [
      ...new Set(
        customers
          .map(c => c.parent_id?.toString())
          .filter((v): v is string => !!v),
      ),
    ];
    if (!parentIds.length) return new Map();
    const parents = await this.customerModel
      .find({ _id: { $in: parentIds } })
      .select({ name: 1, customer_code: 1 })
      .lean();
    const parentById = new Map(parents.map(p => [p._id.toString(), p]));
    const labels = new Map<string, string>();
    for (const customer of customers) {
      const parent = customer.parent_id ? parentById.get(customer.parent_id.toString()) : null;
      if (parent) {
        labels.set(customer._id.toString(), `${parent.name} - ${parent.customer_code ?? "-"}`);
      }
    }
    return labels;
  }
}
