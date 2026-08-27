import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import {
  createItemAwareResolver,
  CustomerKind,
  evaluateFormula,
  FORMULA_OPERATORS,
  FormulaOperator,
  FormulaReplaceMatchVO,
  FormulaReplaceStatus,
  FormulaToken,
  formatVariableValue,
  formulaToCalcText,
  formulaToText,
  isNumericLiteral,
  QUOTE_NOTES_MAX,
  QuoteConfigVO,
  QuoteItemVO,
  QuoteRecordVO,
  QuoteRefreshSummary,
  QuoteVariablesVO,
  RecalculateResultVO,
  RoundMode,
  VariableResolver,
  VariableSource,
} from "@bv/shared";
import { Model, Types } from "mongoose";
import { JwtPayload } from "../../auth/auth.types";
import { Customer, CustomerDocument } from "../customer/customer.schema";
import {
  FormulaReplaceApplyDto,
  FormulaReplacePreviewDto,
  FormulaTokenDto,
  QueryRecordsDto,
  QuoteItemInputDto,
  UpsertQuoteConfigDto,
} from "./dto/quote.dto";
import {
  FormulaAlias,
  parseFormulaText,
  rawToToken as toToken,
  replaceTokenSubsequence,
  findTokenSubsequence,
} from "./formula-text.util";
import { QuoteMarketService } from "./quote-market.service";
import { QuoteConfig, QuoteConfigDocument } from "./schemas/quote-config.schema";
import { QuoteRecord, QuoteRecordDocument } from "./schemas/quote-record.schema";

function dec(value: Types.Decimal128 | null | undefined): string | null {
  return value == null ? null : value.toString();
}

@Injectable()
export class QuoteService {
  constructor(
    @InjectModel(QuoteConfig.name) private readonly configModel: Model<QuoteConfigDocument>,
    @InjectModel(QuoteRecord.name) private readonly recordModel: Model<QuoteRecordDocument>,
    @InjectModel(Customer.name) private readonly customerModel: Model<CustomerDocument>,
    private readonly marketService: QuoteMarketService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* 配置                                                              */
  /* ---------------------------------------------------------------- */

  async getConfig(customerId: string, operator: JwtPayload): Promise<QuoteConfigVO> {
    const customer = await this.findActiveCustomer(customerId);
    const doc = await this.getOrCreateConfig(customer, operator);
    return this.toConfigVO(doc);
  }

  async upsertConfig(
    customerId: string,
    dto: UpsertQuoteConfigDto,
    operator: JwtPayload,
  ): Promise<QuoteConfigVO> {
    const customer = await this.findActiveCustomer(customerId);
    const doc = await this.getOrCreateConfig(customer, operator);

    const existingById = new Map(doc.items.map(item => [item._id.toString(), item]));
    const finalIds: string[] = dto.items.map(item => item.id ?? new Types.ObjectId().toString());
    const idSet = new Set(finalIds);

    const nextItems = dto.items.map((input, index) => {
      const tokens = this.sanitizeTokens(input.formula, idSet);
      const prev = input.id ? existingById.get(input.id) : undefined;
      if (input.id && !prev) throw new BadRequestException("报价项不存在或已被删除");
      return {
        _id: new Types.ObjectId(finalIds[index]),
        trade_type: input.trade_type.trim(),
        prefix: input.prefix.trim(),
        suffix: input.suffix.trim(),
        formula: tokens,
        broker_point: input.broker_point ? Types.Decimal128.fromString(input.broker_point) : null,
        bv_point: input.bv_point ? Types.Decimal128.fromString(input.bv_point) : null,
        digits: input.digits,
        round_mode: input.round_mode,
        output_checked: input.output_checked ?? prev?.output_checked ?? true,
        last_result: prev?.last_result ?? null,
        last_quoted_at: prev?.last_quoted_at ?? null,
      };
    });

    doc.set("items", nextItems);
    if (dto.text) {
      doc.text_opening = dto.text.opening;
      doc.text_ending = dto.text.ending;
      doc.include_quote_time = dto.text.include_quote_time;
    }
    if (dto.common_notes) {
      doc.common_notes = [...new Set(dto.common_notes.map(n => n.trim()).filter(Boolean))].slice(
        0,
        QUOTE_NOTES_MAX,
      );
    }
    doc.set("updated_by", new Types.ObjectId(operator.sub));
    await doc.save();
    return this.toConfigVO(doc);
  }

  /* ---------------------------------------------------------------- */
  /* 变量与求值                                                        */
  /* ---------------------------------------------------------------- */

  async getVariables(customerId: string): Promise<QuoteVariablesVO> {
    const customer = await this.findActiveCustomer(customerId);
    const [state, channels, brokerItems] = await Promise.all([
      this.marketService.getBenchmarkState(),
      this.marketService.listChannelRates(),
      this.listBrokerItemOptions(customer),
    ]);
    return {
      benchmarks: state.items.map(item => ({
        source: VariableSource.BENCHMARK,
        code: item.code,
        label: item.label,
        value: item.value,
      })),
      channels: channels.map(item => ({
        source: VariableSource.CHANNEL,
        code: item.code,
        label: item.label,
        value: item.value,
      })),
      broker_items: brokerItems,
    };
  }

  async recalculate(customerId: string, operator: JwtPayload): Promise<RecalculateResultVO> {
    const customer = await this.findActiveCustomer(customerId);
    const doc = await this.getOrCreateConfig(customer, operator);
    const resolver = await this.buildResolver(customer, doc);
    const now = new Date();
    const errors: { item_id: string; error: string }[] = [];
    const records: Partial<QuoteRecord>[] = [];

    for (const item of doc.items) {
      const tokens = item.formula.map(raw => toToken(raw as Record<string, unknown>));
      const result = evaluateFormula(tokens, resolver, item.digits, item.round_mode);
      if (!result.ok || result.value === null) {
        errors.push({ item_id: item._id.toString(), error: result.error ?? "计算失败" });
        continue;
      }
      item.last_result = Types.Decimal128.fromString(result.value);
      item.last_quoted_at = now;
      records.push(
        this.buildRecord(customer, item, tokens, resolver, result.value, now, operator),
      );
    }

    doc.set("updated_by", new Types.ObjectId(operator.sub));
    await doc.save();
    if (records.length) await this.recordModel.insertMany(records);
    return { config: this.toConfigVO(doc), errors };
  }

  /**
   * 基准价/渠道汇率变动后的全量自动刷新：重算所有客户的报价配置，
   * 只有计算结果发生变化的项才更新 last_result 并写历史记录（避免噪音）。
   * 中介客户先算——下级客户的 BROKER_ITEM 变量读中介项的 last_result，
   * 保证一次变动就传导到下级报价。
   */
  async recalculateAllConfigs(operator: JwtPayload): Promise<QuoteRefreshSummary> {
    const lookup = await this.marketService.variableNumberLookup();
    const { configs, customers } = await this.loadConfigsWithCustomers();
    const rank = (config: QuoteConfigDocument) =>
      customers.get(config.customer_id.toString())?.customer_kind === CustomerKind.INTERMEDIARY
        ? 0
        : 1;
    const ordered = [...configs].sort((a, b) => rank(a) - rank(b));

    const now = new Date();
    let itemCount = 0;
    let customerCount = 0;
    for (const config of ordered) {
      const customer = customers.get(config.customer_id.toString());
      if (!customer) continue;
      const resolver = await this.buildResolver(customer, config, lookup);
      const records: Partial<QuoteRecord>[] = [];
      for (const item of config.items) {
        const tokens = item.formula.map(raw => toToken(raw as Record<string, unknown>));
        if (!tokens.length) continue;
        const result = evaluateFormula(tokens, resolver, item.digits, item.round_mode);
        if (!result.ok || result.value === null) continue; // 求值失败的项保留旧值，不打断整体刷新
        const previous = item.last_result ? Number(item.last_result.toString()) : null;
        if (previous !== null && Number(result.value) === previous) continue;
        item.last_result = Types.Decimal128.fromString(result.value);
        item.last_quoted_at = now;
        records.push(this.buildRecord(customer, item, tokens, resolver, result.value, now, operator));
        itemCount += 1;
      }
      if (records.length) {
        config.set("updated_by", new Types.ObjectId(operator.sub));
        await config.save();
        await this.recordModel.insertMany(records);
        customerCount += 1;
      }
    }
    return { customers: customerCount, items: itemCount };
  }

  /* ---------------------------------------------------------------- */
  /* 批量调整公式                                                      */
  /* ---------------------------------------------------------------- */

  async formulaReplacePreview(dto: FormulaReplacePreviewDto): Promise<FormulaReplaceMatchVO[]> {
    const aliases = await this.formulaAliases();
    let searchTokens: FormulaToken[];
    try {
      searchTokens = parseFormulaText(dto.search, aliases);
    } catch (error) {
      throw new BadRequestException(
        `目标参数${error instanceof Error ? error.message : "不合法"}`,
      );
    }
    let replaceTokens: FormulaToken[] | null = null;
    let replaceError: string | null = null;
    if (dto.replace.trim()) {
      try {
        replaceTokens = parseFormulaText(dto.replace, aliases);
      } catch (error) {
        replaceError = `替换内容${error instanceof Error ? error.message : "不合法"}`;
      }
    }

    const { configs, customers } = await this.loadConfigsWithCustomers(dto.customer_keyword);
    const matches: FormulaReplaceMatchVO[] = [];

    for (const config of configs) {
      const customer = customers.get(config.customer_id.toString());
      if (!customer) continue;
      const resolver = await this.buildResolver(customer, config);
      for (const item of config.items) {
        const tokens = item.formula.map(raw => toToken(raw as Record<string, unknown>));
        if (findTokenSubsequence(tokens, searchTokens) < 0) continue;

        const current = evaluateFormula(tokens, resolver, item.digits, item.round_mode);
        const base = {
          customer_id: customer._id.toString(),
          customer_name: customer.name,
          customer_code: customer.customer_code ?? null,
          item_id: item._id.toString(),
          trade_type: item.trade_type,
          prefix: item.prefix,
          current_formula: formulaToText(tokens),
          current_result: current.ok ? current.value : null,
        };

        if (!dto.replace.trim()) {
          matches.push({
            ...base,
            next_formula: null,
            next_result: null,
            status: FormulaReplaceStatus.NEED_REPLACE,
            error: null,
          });
          continue;
        }
        if (!replaceTokens) {
          matches.push({
            ...base,
            next_formula: null,
            next_result: null,
            status: FormulaReplaceStatus.INVALID,
            error: replaceError,
          });
          continue;
        }
        const nextTokens = replaceTokenSubsequence(tokens, searchTokens, replaceTokens)!;
        const next = evaluateFormula(nextTokens, resolver, item.digits, item.round_mode);
        matches.push({
          ...base,
          next_formula: formulaToText(nextTokens),
          next_result: next.ok ? next.value : null,
          status: next.ok ? FormulaReplaceStatus.OK : FormulaReplaceStatus.INVALID,
          error: next.ok ? null : next.error,
        });
        if (matches.length >= 200) return matches;
      }
    }
    return matches;
  }

  async formulaReplaceApply(
    dto: FormulaReplaceApplyDto,
    operator: JwtPayload,
  ): Promise<{ customers: number; items: number; errors: string[] }> {
    if (!dto.targets.length) throw new BadRequestException("请先勾选需要调整的报价项");
    const aliases = await this.formulaAliases();
    let searchTokens: FormulaToken[];
    let replaceTokens: FormulaToken[];
    try {
      searchTokens = parseFormulaText(dto.search, aliases);
      replaceTokens = parseFormulaText(dto.replace, aliases);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "公式片段不合法");
    }

    const byCustomer = new Map<string, string[]>();
    for (const target of dto.targets) {
      const list = byCustomer.get(target.customer_id) ?? [];
      list.push(target.item_id);
      byCustomer.set(target.customer_id, list);
    }

    const now = new Date();
    const errors: string[] = [];
    let itemCount = 0;
    let customerCount = 0;

    for (const [customerId, itemIds] of byCustomer) {
      const customer = await this.customerModel.findOne({ _id: customerId, is_deleted: false });
      const config = customer
        ? await this.configModel.findOne({ customer_id: customer._id, is_deleted: false })
        : null;
      if (!customer || !config) {
        errors.push("客户或其报价配置不存在");
        continue;
      }
      const resolver = await this.buildResolver(customer, config);
      let touched = false;
      const records: Partial<QuoteRecord>[] = [];
      for (const itemId of itemIds) {
        const item = config.items.find(i => i._id.toString() === itemId);
        if (!item) {
          errors.push(`${customer.name}：报价项不存在`);
          continue;
        }
        const tokens = item.formula.map(raw => toToken(raw as Record<string, unknown>));
        const nextTokens = replaceTokenSubsequence(tokens, searchTokens, replaceTokens);
        if (!nextTokens) {
          errors.push(`${customer.name} / ${item.trade_type || item.prefix}：公式已变化，未命中目标片段`);
          continue;
        }
        const result = evaluateFormula(nextTokens, resolver, item.digits, item.round_mode);
        if (!result.ok || result.value === null) {
          errors.push(
            `${customer.name} / ${item.trade_type || item.prefix}：${result.error ?? "公式不可计算"}`,
          );
          continue;
        }
        item.set("formula", nextTokens);
        item.last_result = Types.Decimal128.fromString(result.value);
        item.last_quoted_at = now;
        records.push(
          this.buildRecord(customer, item, nextTokens, resolver, result.value, now, operator),
        );
        touched = true;
        itemCount += 1;
      }
      if (touched) {
        config.set("updated_by", new Types.ObjectId(operator.sub));
        await config.save();
        if (records.length) await this.recordModel.insertMany(records);
        customerCount += 1;
      }
    }
    return { customers: customerCount, items: itemCount, errors };
  }

  /* ---------------------------------------------------------------- */
  /* 历史记录                                                          */
  /* ---------------------------------------------------------------- */

  async listRecords(query: QueryRecordsDto): Promise<QuoteRecordVO[]> {
    const customer = await this.findActiveCustomer(query.customer_id);
    const filter: Record<string, unknown> = {
      is_deleted: false,
      customer_id: customer._id,
    };
    if (query.from || query.to) {
      filter.quoted_at = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      };
    }
    const docs = await this.recordModel.find(filter).sort({ quoted_at: -1 }).limit(500).lean();
    const brokerLabel = await this.brokerLabel(customer);
    return docs.map(doc => ({
      id: doc._id.toString(),
      customer_id: customer._id.toString(),
      customer_name: customer.name,
      customer_code: customer.customer_code ?? null,
      broker_label: brokerLabel,
      trade_type: doc.trade_type,
      prefix: doc.prefix,
      suffix: doc.suffix,
      formula_text: doc.formula_text,
      formula_calc: doc.formula_calc,
      variables: doc.variables,
      result: dec(doc.result)!,
      broker_point: dec(doc.broker_point) ?? "0",
      bv_point: dec(doc.bv_point) ?? "0",
      digits: doc.digits,
      round_mode: doc.round_mode,
      quoted_at: doc.quoted_at.toISOString(),
      operator_name: doc.operator_name,
    }));
  }

  /* ---------------------------------------------------------------- */
  /* 内部工具（quote-group.service 亦复用部分公共方法）                  */
  /* ---------------------------------------------------------------- */

  async findActiveCustomer(id: string): Promise<CustomerDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException("客户 ID 不合法");
    const doc = await this.customerModel.findOne({ _id: id, is_deleted: false });
    if (!doc) throw new NotFoundException("客户不存在");
    return doc;
  }

  async getOrCreateConfig(
    customer: CustomerDocument,
    operator: JwtPayload,
  ): Promise<QuoteConfigDocument> {
    const existing = await this.configModel.findOne({
      customer_id: customer._id,
      is_deleted: false,
    });
    if (existing) return existing;

    /* 首次打开：生成默认模板（引用 sino 基准价；基准价缺失则给单个空白项）。
       与原型不同：默认项仅在首次创建时生成，删除后不会“复活”。 */
    const state = await this.marketService.getBenchmarkState();
    const sino = state.items.find(item => item.code === "sino");
    const defaults = sino
      ? [
          {
            trade_type: "美元",
            prefix: "sino",
            suffix: "(含手续费)",
            formula: [
              { type: "var", source: VariableSource.BENCHMARK, code: sino.code, label: sino.label },
            ],
            digits: 4,
            round_mode: RoundMode.HALF_UP,
            output_checked: true,
          },
          {
            trade_type: "港币",
            prefix: "sgb",
            suffix: "",
            formula: [
              { type: "var", source: VariableSource.BENCHMARK, code: sino.code, label: sino.label },
              { type: "op", value: "+" },
              { type: "num", value: "3" },
            ],
            digits: 4,
            round_mode: RoundMode.HALF_UP,
            output_checked: true,
          },
        ]
      : [
          {
            trade_type: "",
            prefix: "",
            suffix: "",
            formula: [],
            digits: 4,
            round_mode: RoundMode.HALF_UP,
            output_checked: true,
          },
        ];

    return this.configModel.create({
      customer_id: customer._id,
      items: defaults,
      text_opening: customer.customer_code
        ? `${customer.name}(${customer.customer_code})：`
        : `${customer.name}：`,
      text_ending: "",
      include_quote_time: false,
      common_notes: [],
      created_by: new Types.ObjectId(operator.sub),
    });
  }

  async buildResolver(
    customer: CustomerDocument,
    config: QuoteConfigDocument,
    sharedLookup?: (source: VariableSource, code: string) => number | null,
  ): Promise<VariableResolver> {
    const lookup = sharedLookup ?? (await this.marketService.variableNumberLookup());
    const brokerResults = await this.brokerItemResults(customer);
    const ownItems = new Map<string, QuoteItemVO>(
      config.items.map(item => [item._id.toString(), this.toItemVO(item)]),
    );
    return createItemAwareResolver({
      lookup,
      getOwnItem: id => ownItems.get(id) ?? null,
      getBrokerItemResult: id => brokerResults.get(id) ?? null,
    });
  }

  toConfigVO(doc: QuoteConfigDocument): QuoteConfigVO {
    return {
      id: doc._id.toString(),
      customer_id: doc.customer_id.toString(),
      items: doc.items.map(item => this.toItemVO(item)),
      text: {
        opening: doc.text_opening,
        ending: doc.text_ending,
        include_quote_time: doc.include_quote_time,
      },
      common_notes: doc.common_notes,
      updated_at: doc.updated_at?.toISOString() ?? null,
    };
  }

  private toItemVO(item: QuoteConfigDocument["items"][number]): QuoteItemVO {
    return {
      id: item._id.toString(),
      trade_type: item.trade_type,
      prefix: item.prefix,
      suffix: item.suffix,
      formula: (item.formula as Record<string, unknown>[]).map(toToken),
      broker_point: dec(item.broker_point) ?? "0",
      bv_point: dec(item.bv_point) ?? "0",
      digits: item.digits,
      round_mode: item.round_mode,
      output_checked: item.output_checked,
      last_result: dec(item.last_result),
      last_quoted_at: item.last_quoted_at?.toISOString() ?? null,
    };
  }

  async brokerLabel(customer: CustomerDocument): Promise<string | null> {
    if (!customer.parent_id) return null;
    const parent = await this.customerModel
      .findOne({ _id: customer.parent_id, is_deleted: false })
      .lean();
    if (!parent) return null;
    return `${parent.name} - ${parent.customer_code ?? "-"}`;
  }

  private async listBrokerItemOptions(customer: CustomerDocument) {
    if (!customer.parent_id) return [];
    const parent = await this.customerModel
      .findOne({ _id: customer.parent_id, is_deleted: false })
      .lean();
    const config = parent
      ? await this.configModel
          .findOne({ customer_id: parent._id, is_deleted: false })
          .lean()
      : null;
    if (!parent || !config) return [];
    return config.items.map(item => ({
      source: VariableSource.BROKER_ITEM,
      code: item._id.toString(),
      label: `${parent.name}${item.trade_type}${item.prefix}`,
      value: dec(item.last_result),
    }));
  }

  /** 绑定中介的报价项已计算结果（BROKER_ITEM 变量取值） */
  private async brokerItemResults(customer: CustomerDocument): Promise<Map<string, number>> {
    const options = await this.listBrokerItemOptions(customer);
    return new Map(
      options
        .filter(option => option.value !== null)
        .map(option => [option.code, Number(option.value)]),
    );
  }

  private buildRecord(
    customer: CustomerDocument,
    item: QuoteConfigDocument["items"][number],
    tokens: FormulaToken[],
    resolver: VariableResolver,
    resultValue: string,
    quotedAt: Date,
    operator: JwtPayload,
  ): Partial<QuoteRecord> {
    const variables = tokens
      .filter((t): t is Extract<FormulaToken, { type: "var" }> => t.type === "var")
      .map(t => {
        const value = resolver(t);
        return { label: t.label, value: value === null ? "-" : formatVariableValue(value) };
      });
    return {
      customer_id: customer._id,
      trade_type: item.trade_type,
      prefix: item.prefix,
      suffix: item.suffix,
      formula_text: formulaToText(tokens),
      formula_calc: formulaToCalcText(tokens, resolver),
      variables,
      result: Types.Decimal128.fromString(resultValue),
      broker_point: item.broker_point,
      bv_point: item.bv_point,
      digits: item.digits,
      round_mode: item.round_mode,
      quoted_at: quotedAt,
      operator_name: operator.display_name,
      created_by: new Types.ObjectId(operator.sub),
    } as Partial<QuoteRecord>;
  }

  private async formulaAliases(): Promise<FormulaAlias[]> {
    const [state, channels] = await Promise.all([
      this.marketService.getBenchmarkState(),
      this.marketService.listChannelRates(),
    ]);
    return [
      ...state.items.map(item => ({
        source: VariableSource.BENCHMARK,
        code: item.code,
        label: item.label,
      })),
      ...channels.map(item => ({
        source: VariableSource.CHANNEL,
        code: item.code,
        label: item.label,
      })),
    ];
  }

  private async loadConfigsWithCustomers(keyword?: string): Promise<{
    configs: QuoteConfigDocument[];
    customers: Map<string, CustomerDocument>;
  }> {
    const customerFilter: Record<string, unknown> = { is_deleted: false };
    if (keyword?.trim()) {
      const pattern = new RegExp(keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      customerFilter.$or = [{ name: pattern }, { customer_code: pattern }];
    }
    const customers = await this.customerModel.find(customerFilter);
    const customerMap = new Map(customers.map(c => [c._id.toString(), c]));
    const configs = await this.configModel.find({
      is_deleted: false,
      customer_id: { $in: customers.map(c => c._id) },
    });
    return { configs, customers: customerMap };
  }

  /** token 清洗：DTO → 结构化 token；QUOTE_ITEM 引用必须指向本配置内的项 */
  private sanitizeTokens(inputs: FormulaTokenDto[], ownItemIds: Set<string>): FormulaToken[] {
    return inputs.map(input => {
      if (input.type === "num") {
        const value = (input.value ?? "").trim();
        if (!isNumericLiteral(value)) throw new BadRequestException(`数字 "${value}" 不合法`);
        return { type: "num", value } satisfies FormulaToken;
      }
      if (input.type === "op") {
        const value = (input.value ?? "") as FormulaOperator;
        if (!FORMULA_OPERATORS.includes(value)) {
          throw new BadRequestException(`运算符 "${input.value ?? ""}" 不合法`);
        }
        return { type: "op", value } satisfies FormulaToken;
      }
      if (!input.source || !input.code || !input.label) {
        throw new BadRequestException("变量 token 缺少 source/code/label");
      }
      if (input.source === VariableSource.QUOTE_ITEM && !ownItemIds.has(input.code)) {
        throw new BadRequestException("公式引用的报价项不存在");
      }
      return {
        type: "var",
        source: input.source,
        code: input.code,
        label: input.label,
      } satisfies FormulaToken;
    });
  }
}
