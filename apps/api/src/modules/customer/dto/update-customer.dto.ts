import { PartialType, PickType } from "@nestjs/mapped-types";
import { CustomerKind, CustomerStatus } from "@bv/shared";
import { IsIn, IsMongoId, IsOptional, IsString, MaxLength } from "class-validator";
import { CreateCustomerDto } from "./create-customer.dto";

/** 编辑客户：资料字段 + 类型变更（直客⇄中介⇄中介下级，服务层做层级校验） */
export class UpdateCustomerDto extends PartialType(
  PickType(CreateCustomerDto, [
    "name",
    "customer_code",
    "sub_type",
    "region",
    "phone",
    "remark",
  ] as const),
) {
  @IsOptional()
  @IsIn(Object.values(CustomerKind), { message: "客户类型不合法" })
  customer_kind?: CustomerKind;

  @IsOptional()
  @IsMongoId({ message: "所属中介 ID 不合法" })
  parent_id?: string | null;

  @IsOptional()
  @IsIn(Object.values(CustomerStatus))
  customer_status?: CustomerStatus;

  /** 仅写入变更事件的备注（如暂停合作原因），不落客户主档 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  change_note?: string | null;
}
