import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { BUILTIN_ROLES } from "@bv/shared";
import * as bcrypt from "bcryptjs";
import { Model } from "mongoose";
import { Role, RoleDocument } from "../modules/user/role.schema";
import { User, UserDocument } from "../modules/user/user.schema";

/**
 * 启动引导：写入内置角色，并保证系统至少有一个 Admin 账号可登录。
 * 幂等：角色按 role_code upsert；仅当不存在任何 ADMIN 账号时创建默认账号。
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger("Bootstrap");

  constructor(
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const role of BUILTIN_ROLES) {
      await this.roleModel.updateOne(
        { role_code: role.code },
        {
          $setOnInsert: {
            role_code: role.code,
            role_name: role.name,
            description: role.description,
            is_builtin: true,
            is_deleted: false,
          },
        },
        { upsert: true },
      );
    }

    const adminRole = await this.roleModel.findOne({ role_code: "ADMIN" }).lean();
    if (!adminRole) return;
    const hasAdmin = await this.userModel.exists({ role_id: adminRole._id, is_deleted: false });
    if (hasAdmin) return;

    await this.userModel.create({
      username: "admin",
      password_hash: await bcrypt.hash("admin123", 10),
      display_name: "系统管理员",
      title: "Administrator",
      role_id: adminRole._id,
    });
    this.logger.warn("已创建默认管理员账号 admin / admin123，请登录后立即修改密码");
  }
}
