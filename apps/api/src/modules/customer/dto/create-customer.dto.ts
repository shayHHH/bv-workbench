import {
  CustomerKind,
  CustomerSubType,
  Region,
} from "@bv/shared";
import {
  IsEnum,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateCustomerDto {
  @IsString()
  @MinLength(1, { message: "请输入客户名称" })
  @MaxLength(100)
  name: string;

  @IsIn(Object.values(CustomerKind), { message: "客户类型不合法" })
  customer_kind: CustomerKind;

  @IsOptional()
  @Matches(/^\d{5}$/, { message: "客户编号必须是五位数字" })
  customer_code?: string | null;

  @IsOptional()
  @IsMongoId({ message: "所属中介 ID 不合法" })
  parent_id?: string | null;

  @IsOptional()
  @IsIn(Object.values(CustomerSubType))
  sub_type?: CustomerSubType | null;

  @IsOptional()
  @IsIn(Object.values(Region))
  region?: Region | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  agent_name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  follow_trader?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string | null;
}
