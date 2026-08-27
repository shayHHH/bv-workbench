import { CustomerEventType } from "@bv/shared";
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class QueryAuditDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @IsOptional()
  @IsIn(Object.values(CustomerEventType))
  event_type?: CustomerEventType;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  page_size?: number;
}
