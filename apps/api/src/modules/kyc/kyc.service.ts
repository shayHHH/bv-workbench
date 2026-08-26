import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { KycScenarioStatus, KycScenarioVO } from "@bv/shared";
import { Model, Types } from "mongoose";
import { JwtPayload } from "../../auth/auth.types";
import { SaveScenarioDto } from "./dto/save-scenario.dto";
import { KycScenario, KycScenarioDocument } from "./kyc-scenario.schema";

@Injectable()
export class KycService {
  constructor(
    @InjectModel(KycScenario.name)
    private readonly scenarioModel: Model<KycScenarioDocument>,
  ) {}

  /** 配置页：全部场景（含草稿） */
  async listAll(): Promise<KycScenarioVO[]> {
    const docs = await this.scenarioModel
      .find({ is_deleted: false })
      .sort({ sort_order: 1, created_at: 1 })
      .lean();
    return docs.map(doc => this.toVO(doc));
  }

  /** 材料上传页：仅已发布场景 */
  async listPublished(): Promise<KycScenarioVO[]> {
    const docs = await this.scenarioModel
      .find({ is_deleted: false, status: KycScenarioStatus.PUBLISHED })
      .sort({ sort_order: 1, created_at: 1 })
      .lean();
    return docs.map(doc => this.toVO(doc));
  }

  async getById(id: string): Promise<KycScenarioVO> {
    const doc = await this.findOrFail(id);
    return this.toVO(doc.toObject());
  }

  async create(dto: SaveScenarioDto, operator: JwtPayload): Promise<KycScenarioVO> {
    this.validateStructure(dto);
    const exists = await this.scenarioModel.exists({
      scenario_code: dto.scenario_code,
      is_deleted: false,
    });
    if (exists) throw new ConflictException(`业务编号 ${dto.scenario_code} 已存在`);
    const doc = await this.scenarioModel.create({
      ...this.normalize(dto),
      status: KycScenarioStatus.DRAFT,
      created_by: new Types.ObjectId(operator.sub),
      updated_by: new Types.ObjectId(operator.sub),
    });
    return this.toVO(doc.toObject());
  }

  async update(id: string, dto: SaveScenarioDto, operator: JwtPayload): Promise<KycScenarioVO> {
    this.validateStructure(dto);
    const doc = await this.findOrFail(id);
    if (dto.scenario_code !== doc.scenario_code) {
      const exists = await this.scenarioModel.exists({
        scenario_code: dto.scenario_code,
        is_deleted: false,
        _id: { $ne: doc._id },
      });
      if (exists) throw new ConflictException(`业务编号 ${dto.scenario_code} 已存在`);
      if (doc.is_builtin) throw new BadRequestException("内置业务类型不允许修改业务编号");
    }
    Object.assign(doc, this.normalize(dto));
    doc.set("updated_by", new Types.ObjectId(operator.sub));
    await doc.save();
    return this.toVO(doc.toObject());
  }

  /** 发布：材料上传页开始实时引用该版本 */
  async publish(id: string, operator: JwtPayload): Promise<KycScenarioVO> {
    const doc = await this.findOrFail(id);
    if (!doc.channels.length) throw new BadRequestException("发布前至少配置一个渠道");
    const itemCount = doc.sections.reduce((sum, section) => sum + section.items.length, 0);
    if (!itemCount) throw new BadRequestException("发布前至少配置一个材料项");
    doc.status = KycScenarioStatus.PUBLISHED;
    doc.published_at = new Date();
    doc.set("updated_by", new Types.ObjectId(operator.sub));
    await doc.save();
    return this.toVO(doc.toObject());
  }

  async softDelete(id: string, operator: JwtPayload): Promise<void> {
    const doc = await this.findOrFail(id);
    if (doc.is_builtin) throw new BadRequestException("内置业务类型不可删除");
    doc.is_deleted = true;
    doc.set("deleted_by", new Types.ObjectId(operator.sub));
    doc.set("deleted_at", new Date());
    await doc.save();
  }

  private async findOrFail(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException("业务类型不存在");
    const doc = await this.scenarioModel.findOne({ _id: id, is_deleted: false });
    if (!doc) throw new NotFoundException("业务类型不存在");
    return doc;
  }

  /** 结构校验：item_id 场景内唯一；材料项适用渠道必须在渠道列表内 */
  private validateStructure(dto: SaveScenarioDto): void {
    const channelCodes = new Set(dto.channels.map(channel => channel.channel_code));
    if (channelCodes.size !== dto.channels.length) {
      throw new BadRequestException("渠道代码不能重复");
    }
    const itemIds = new Set<string>();
    for (const section of dto.sections) {
      for (const item of section.items) {
        if (itemIds.has(item.item_id)) {
          throw new BadRequestException(`材料项 ID 重复：${item.item_id}`);
        }
        itemIds.add(item.item_id);
        for (const code of item.channel_codes ?? []) {
          if (!channelCodes.has(code)) {
            throw new BadRequestException(`材料项「${item.item_name}」引用了不存在的渠道 ${code}`);
          }
        }
      }
    }
  }

  private normalize(dto: SaveScenarioDto) {
    return {
      scenario_code: dto.scenario_code,
      scenario_name: dto.scenario_name,
      process_description: dto.process_description ?? null,
      channels: dto.channels.map(channel => ({
        channel_code: channel.channel_code,
        channel_name: channel.channel_name,
        restriction_note: channel.restriction_note ?? null,
      })),
      sections: dto.sections.map(section => ({
        section_name: section.section_name,
        items: section.items.map(item => ({
          item_id: item.item_id,
          item_name: item.item_name,
          item_description: item.item_description ?? null,
          item_type: item.item_type,
          required: item.required,
          max_count: item.max_count,
          validity_note: item.validity_note ?? null,
          channel_codes: item.channel_codes?.length ? item.channel_codes : null,
        })),
      })),
    };
  }

  private toVO(doc: KycScenario & { _id: Types.ObjectId; updated_at?: Date }): KycScenarioVO {
    return {
      id: String(doc._id),
      scenario_code: doc.scenario_code,
      scenario_name: doc.scenario_name,
      process_description: doc.process_description,
      status: doc.status,
      is_builtin: doc.is_builtin,
      channels: doc.channels,
      sections: doc.sections,
      published_at: doc.published_at ? doc.published_at.toISOString() : null,
      updated_at: doc.updated_at ? doc.updated_at.toISOString() : new Date().toISOString(),
    };
  }
}
