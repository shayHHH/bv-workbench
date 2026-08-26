import { UserStatus } from "@bv/shared";
import {
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateUserDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_.-]{3,32}$/, { message: "用户名为 3-32 位字母、数字或 _ . -" })
  username: string;

  @IsString()
  @MinLength(6, { message: "初始密码至少 6 位" })
  @MaxLength(64)
  password: string;

  @IsString()
  @MinLength(1, { message: "请输入姓名" })
  @MaxLength(50)
  display_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string | null;

  @IsMongoId({ message: "请选择角色" })
  role_id: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  display_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string | null;

  @IsOptional()
  @IsMongoId()
  role_id?: string;

  @IsOptional()
  @IsIn(Object.values(UserStatus))
  user_status?: UserStatus;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(6, { message: "新密码至少 6 位" })
  @MaxLength(64)
  password: string;
}

export class CreateRoleDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,31}$/, { message: "角色代码为 2-32 位大写字母/数字/下划线，字母开头" })
  role_code: string;

  @IsString()
  @MinLength(1, { message: "请输入角色名称" })
  @MaxLength(50)
  role_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string | null;
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  role_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string | null;
}
