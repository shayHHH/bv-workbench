import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { UserStatus, UserVO } from "@bv/shared";
import * as bcrypt from "bcryptjs";
import { Model, Types } from "mongoose";
import { JwtPayload } from "../../auth/auth.types";
import { Role, RoleDocument } from "./role.schema";
import { User, UserDocument } from "./user.schema";
import { CreateUserDto, ResetPasswordDto, UpdateUserDto } from "./dto/user.dto";

const BCRYPT_ROUNDS = 10;

@Injectable()
export class UserService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
  ) {}

  async list(): Promise<UserVO[]> {
    const users = await this.userModel
      .find({ is_deleted: false })
      .sort({ created_at: -1 })
      .lean();
    const roles = await this.roleModel
      .find({ _id: { $in: users.map(user => user.role_id) } })
      .lean();
    const roleMap = new Map(roles.map(role => [role._id.toString(), role]));
    return users.map(user => this.toVO(user, roleMap.get(user.role_id.toString())));
  }

  async create(dto: CreateUserDto, operator?: JwtPayload): Promise<UserVO> {
    const username = dto.username.toLowerCase();
    const exists = await this.userModel.exists({ username });
    if (exists) throw new ConflictException(`用户名 ${username} 已存在`);
    const role = await this.roleModel.findOne({ _id: dto.role_id, is_deleted: false }).lean();
    if (!role) throw new BadRequestException("所选角色不存在");
    const doc = await this.userModel.create({
      username,
      password_hash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
      display_name: dto.display_name.trim(),
      title: dto.title?.trim() || null,
      role_id: role._id,
      created_by: operator ? new Types.ObjectId(operator.sub) : null,
    });
    return this.toVO(doc.toObject(), role);
  }

  async update(id: string, dto: UpdateUserDto, operator: JwtPayload): Promise<UserVO> {
    const doc = await this.findActive(id);
    if (dto.user_status === UserStatus.DISABLED && doc._id.toString() === operator.sub) {
      throw new BadRequestException("不能停用自己的账号");
    }
    if (dto.role_id !== undefined) {
      const role = await this.roleModel.findOne({ _id: dto.role_id, is_deleted: false }).lean();
      if (!role) throw new BadRequestException("所选角色不存在");
      if (
        doc._id.toString() === operator.sub &&
        role.role_code !== operator.role_code
      ) {
        throw new BadRequestException("不能修改自己的角色");
      }
      doc.role_id = role._id;
    }
    if (dto.display_name !== undefined) doc.display_name = dto.display_name.trim();
    if (dto.title !== undefined) doc.title = dto.title?.trim() || null;
    if (dto.user_status !== undefined) doc.user_status = dto.user_status;
    doc.set("updated_by", new Types.ObjectId(operator.sub));
    await doc.save();
    const role = await this.roleModel.findById(doc.role_id).lean();
    return this.toVO(doc.toObject(), role ?? undefined);
  }

  async resetPassword(id: string, dto: ResetPasswordDto, operator: JwtPayload): Promise<void> {
    const doc = await this.findActive(id);
    doc.password_hash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    doc.set("updated_by", new Types.ObjectId(operator.sub));
    await doc.save();
  }

  async softDelete(id: string, operator: JwtPayload): Promise<void> {
    const doc = await this.findActive(id);
    if (doc._id.toString() === operator.sub) throw new BadRequestException("不能删除自己的账号");
    const role = await this.roleModel.findById(doc.role_id).lean();
    if (role?.role_code === "ADMIN") {
      const otherAdmins = await this.userModel.countDocuments({
        _id: { $ne: doc._id },
        role_id: role._id,
        is_deleted: false,
        user_status: UserStatus.ACTIVE,
      });
      if (!otherAdmins) throw new BadRequestException("系统至少需要保留一个可用的 Admin 账号");
    }
    doc.is_deleted = true;
    doc.set("deleted_at", new Date());
    doc.set("deleted_by", new Types.ObjectId(operator.sub));
    await doc.save();
  }

  async findActive(id: string): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException("用户 ID 不合法");
    const doc = await this.userModel.findOne({ _id: id, is_deleted: false });
    if (!doc) throw new NotFoundException("账号不存在");
    return doc;
  }

  /** 实体 -> VO；绝不外泄 password_hash（规范 §7.3） */
  toVO(doc: Record<string, any>, role?: Record<string, any> | null): UserVO {
    return {
      id: doc._id.toString(),
      username: doc.username,
      display_name: doc.display_name,
      title: doc.title ?? null,
      role: role
        ? { id: role._id.toString(), code: role.role_code, name: role.role_name }
        : null,
      user_status: doc.user_status,
      last_login_at: doc.last_login_at ? doc.last_login_at.toISOString() : null,
      created_at: doc.created_at?.toISOString?.() ?? String(doc.created_at),
    };
  }
}
