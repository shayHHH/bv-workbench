import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectModel } from "@nestjs/mongoose";
import { LoginResult, UserStatus, UserVO } from "@bv/shared";
import * as bcrypt from "bcryptjs";
import { Model, Types } from "mongoose";
import { Role, RoleDocument } from "../modules/user/role.schema";
import { User, UserDocument } from "../modules/user/user.schema";
import { UserService } from "../modules/user/user.service";
import { JwtPayload } from "./auth.types";

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async login(username: string, password: string): Promise<LoginResult> {
    const user = await this.userModel.findOne({
      username: username.toLowerCase().trim(),
      is_deleted: false,
    });
    /* 统一报错文案，不区分“账号不存在/密码错误”，避免账号枚举 */
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new UnauthorizedException("用户名或密码不正确");
    }
    if (user.user_status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("账号已被停用，请联系管理员");
    }
    const role = await this.roleModel.findOne({ _id: user.role_id, is_deleted: false }).lean();
    if (!role) throw new UnauthorizedException("账号未分配有效角色，请联系管理员");

    user.last_login_at = new Date();
    await user.save();

    const payload: JwtPayload = {
      sub: user._id.toString(),
      username: user.username,
      role_code: role.role_code,
      display_name: user.display_name,
    };
    return {
      token: await this.jwtService.signAsync(payload),
      user: this.userService.toVO(user.toObject(), role),
    };
  }

  async me(payload: JwtPayload) {
    const user = await this.userService.findActive(payload.sub);
    const role = await this.roleModel.findById(user.role_id).lean();
    return this.userService.toVO(user.toObject(), role ?? undefined);
  }

  /** 自助修改个人资料（姓名/职位；用户名与角色不可自改） */
  async updateProfile(
    payload: JwtPayload,
    dto: { display_name?: string; title?: string | null },
  ): Promise<UserVO> {
    const user = await this.userService.findActive(payload.sub);
    if (dto.display_name !== undefined) user.display_name = dto.display_name.trim();
    if (dto.title !== undefined) user.title = dto.title?.trim() || null;
    user.set("updated_by", new Types.ObjectId(payload.sub));
    await user.save();
    const role = await this.roleModel.findById(user.role_id).lean();
    return this.userService.toVO(user.toObject(), role ?? undefined);
  }

  /** 自助修改密码：先校验当前密码 */
  async changePassword(payload: JwtPayload, oldPassword: string, newPassword: string): Promise<void> {
    const user = await this.userService.findActive(payload.sub);
    if (!(await bcrypt.compare(oldPassword, user.password_hash))) {
      throw new BadRequestException("当前密码不正确");
    }
    user.password_hash = await bcrypt.hash(newPassword, 10);
    user.set("updated_by", new Types.ObjectId(payload.sub));
    await user.save();
  }
}
