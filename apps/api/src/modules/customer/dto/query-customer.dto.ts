import { CustomerKind, CustomerStatus } from "@bv/shared";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class QueryCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  keyword?: string;

  @IsOptional()
  @IsIn(Object.values(CustomerStatus))
  customer_status?: CustomerStatus;

  @IsOptional()
  @IsIn(Object.values(CustomerKind))
  customer_kind?: CustomerKind;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number = 8;
}
