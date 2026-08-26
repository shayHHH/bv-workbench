import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { RoleVO } from "@bv/shared";
import { Model, Types } from "mongoose";
import { JwtPayload } from "../../auth/auth.types";
import { Role, RoleDocument } from "./role.schema";
import { User, UserDocument } from "./user.schema";
import { CreateRoleDto, UpdateRoleDto } from "./dto/user.dto";

@Injectable()
export class RoleService {
  constructor(
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async list(): Promise<RoleVO[]> {
    const roles = await this.roleModel
      .find({ is_deleted: false })
      .sort({ is_builtin: -1, created_at: 1 })
      .lean();
    const counts = await this.userModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { is_deleted: false } },
      { $group: { _id: "$role_id", count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map(item => [item._id.toString(), item.count]));
    return roles.map(role => this.toVO(role, countMap.get(role._id.toString()) ?? 0));
  }

  async create(dto: CreateRoleDto, operator?: JwtPayload): Promise<RoleVO> {
    const code = dto.role_code.toUpperCase();
    const exists = await this.roleModel.exists({ role_code: code });
    if (exists) throw new ConflictException(`角色代码 ${code} 已存在`);
    const doc = await this.roleModel.create({
      role_code: code,
      role_name: dto.role_name.trim(),
      description: dto.description?.trim() || null,
      is_builtin: false,
      created_by: operator ? new Types.ObjectId(operator.sub) : null,
    });
    return this.toVO(doc.toObject(), 0);
  }

  async update(id: string, dto: UpdateRoleDto, operator?: JwtPayload): Promise<RoleVO> {
    const doc = await this.findActive(id);
    if (dto.role_name !== undefined) doc.role_name = dto.role_name.trim();
    if (dto.description !== undefined) doc.description = dto.description?.trim() || null;
    if (operator) doc.set("updated_by", new Types.ObjectId(operator.sub));
    await doc.save();
    const count = await this.userModel.countDocuments({ role_id: doc._id, is_deleted: false });
    return this.toVO(doc.toObject(), count);
  }

  async softDelete(id: string, operator?: JwtPayload): Promise<void> {
    const doc = await this.findActive(id);
    if (doc.is_builtin) throw new BadRequestException("内置角色不可删除");
    const inUse = await this.userModel.exists({ role_id: doc._id, is_deleted: false });
    if (inUse) throw new BadRequestException("仍有账号使用该角色，请先调整账号角色");
    doc.is_deleted = true;
    doc.set("deleted_at", new Date());
    if (operator) doc.set("deleted_by", new Types.ObjectId(operator.sub));
    await doc.save();
  }

  async findActive(id: string): Promise<RoleDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException("角色 ID 不合法");
    const doc = await this.roleModel.findOne({ _id: id, is_deleted: false });
    if (!doc) throw new NotFoundException("角色不存在");
    return doc;
  }

  private toVO(doc: Record<string, any>, userCount: number): RoleVO {
    return {
      id: doc._id.toString(),
      role_code: doc.role_code,
      role_name: doc.role_name,
      description: doc.description ?? null,
      is_builtin: !!doc.is_builtin,
      user_count: userCount,
      created_at: doc.created_at?.toISOString?.() ?? String(doc.created_at),
    };
  }
}
