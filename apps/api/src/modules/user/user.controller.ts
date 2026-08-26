import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { JwtPayload } from "../../auth/auth.types";
import { CurrentUser, Roles } from "../../auth/decorators";
import { CreateRoleDto, CreateUserDto, ResetPasswordDto, UpdateRoleDto, UpdateUserDto } from "./dto/user.dto";
import { RoleService } from "./role.service";
import { UserService } from "./user.service";

/** 用户管理（仅 Admin） */
@Controller("users")
@Roles("ADMIN")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  list() {
    return this.userService.list();
  }

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() operator: JwtPayload) {
    return this.userService.create(dto, operator);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateUserDto, @CurrentUser() operator: JwtPayload) {
    return this.userService.update(id, dto, operator);
  }

  @Post(":id/reset-password")
  @HttpCode(204)
  async resetPassword(
    @Param("id") id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() operator: JwtPayload,
  ) {
    await this.userService.resetPassword(id, dto, operator);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id") id: string, @CurrentUser() operator: JwtPayload) {
    await this.userService.softDelete(id, operator);
  }
}

/** 角色管理：列表向所有登录用户开放（新建账号选角色用），写操作仅 Admin */
@Controller("roles")
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  list() {
    return this.roleService.list();
  }

  @Post()
  @Roles("ADMIN")
  create(@Body() dto: CreateRoleDto, @CurrentUser() operator: JwtPayload) {
    return this.roleService.create(dto, operator);
  }

  @Patch(":id")
  @Roles("ADMIN")
  update(@Param("id") id: string, @Body() dto: UpdateRoleDto, @CurrentUser() operator: JwtPayload) {
    return this.roleService.update(id, dto, operator);
  }

  @Delete(":id")
  @Roles("ADMIN")
  @HttpCode(204)
  async remove(@Param("id") id: string, @CurrentUser() operator: JwtPayload) {
    await this.roleService.softDelete(id, operator);
  }
}
