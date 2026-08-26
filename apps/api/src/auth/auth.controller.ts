import { Body, Controller, Get, HttpCode, Patch, Post } from "@nestjs/common";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { AuthService } from "./auth.service";
import { JwtPayload } from "./auth.types";
import { CurrentUser, Public } from "./decorators";

class LoginDto {
  @IsString()
  @MinLength(1, { message: "请输入用户名" })
  @MaxLength(64)
  username: string;

  @IsString()
  @MinLength(1, { message: "请输入密码" })
  @MaxLength(64)
  password: string;
}

/** 当前用户自助修改个人资料（用户名与角色不可自改） */
class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: "请输入姓名" })
  @MaxLength(50)
  display_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string | null;
}

class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: "请输入当前密码" })
  @MaxLength(64)
  old_password: string;

  @IsString()
  @MinLength(6, { message: "新密码至少 6 位" })
  @MaxLength(64)
  new_password: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.username, dto.password);
  }

  @Get("me")
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.me(user);
  }

  @Patch("profile")
  updateProfile(@CurrentUser() user: JwtPayload, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user, dto);
  }

  @Post("change-password")
  @HttpCode(204)
  async changePassword(@CurrentUser() user: JwtPayload, @Body() dto: ChangePasswordDto) {
    await this.authService.changePassword(user, dto.old_password, dto.new_password);
  }
}
