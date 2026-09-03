import { FormulaOperator, RoundMode, VariableSource } from "@bv/shared";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;
const DECIMAL_MESSAGE = "数值必须是十进制数字";

export class FormulaTokenDto {
  @IsIn(["num", "op", "var"], { message: "公式 token 类型不合法" })
  type: "num" | "op" | "var";

  @IsOptional()
  @IsString()
  @MaxLength(40)
  value?: string;

  @IsOptional()
  @IsIn(Object.values(VariableSource))
  source?: VariableSource;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;
}

export class QuoteItemInputDto {
  @IsOptional()
  @IsMongoId()
  id?: string;

  @IsString()
  @MaxLength(50)
  trade_type: string;

  @IsString()
  @MaxLength(50)
  prefix: string;

  @IsString()
  @MaxLength(50)
  suffix: string;

  @IsArray()
  @ArrayMaxSize(60, { message: "公式过长" })
  @ValidateNested({ each: true })
  @Type(() => FormulaTokenDto)
  formula: FormulaTokenDto[];

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: DECIMAL_MESSAGE })
  broker_point?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: DECIMAL_MESSAGE })
  bv_point?: string;

  @IsInt()
  @Min(0, { message: "保留位数不能小于 0" })
  @Max(8, { message: "保留位数不能大于 8" })
  digits: number;

  @IsIn(Object.values(RoundMode), { message: "舍入模式不合法" })
  round_mode: RoundMode;

  @IsOptional()
  @IsBoolean()
  output_checked?: boolean;
}

export class QuoteTextConfigDto {
  @IsString()
  @MaxLength(500, { message: "报价开头过长" })
  opening: string;

  @IsString()
  @MaxLength(500, { message: "报价结尾过长" })
  ending: string;

  @IsBoolean()
  include_quote_time: boolean;
}

export class UpsertQuoteConfigDto {
  @IsArray()
  @ArrayMaxSize(30, { message: "单客户报价项过多" })
  @ValidateNested({ each: true })
  @Type(() => QuoteItemInputDto)
  items: QuoteItemInputDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => QuoteTextConfigDto)
  text?: QuoteTextConfigDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8, { message: "常用备注最多 8 条" })
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  common_notes?: string[];
}

export class BenchmarkItemInputDto {
  @IsOptional()
  @IsMongoId()
  id?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_]{1,64}$/, { message: "基准价 code 只允许小写字母/数字/下划线" })
  code?: string;

  @IsString()
  @MinLength(1, { message: "请输入价格类型名称" })
  @MaxLength(100)
  label: string;

  @Matches(DECIMAL_PATTERN, { message: DECIMAL_MESSAGE })
  value: string;
}

export class SaveBenchmarksDto {
  @IsArray()
  @ArrayMaxSize(50, { message: "基准价项目过多" })
  @ValidateNested({ each: true })
  @Type(() => BenchmarkItemInputDto)
  items: BenchmarkItemInputDto[];
}

export class ChannelRateUpdateDto {
  @IsMongoId()
  id: string;

  @Matches(DECIMAL_PATTERN, { message: DECIMAL_MESSAGE })
  value: string;
}

export class UpdateChannelRatesDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ChannelRateUpdateDto)
  items: ChannelRateUpdateDto[];
}

export class CreateGroupDto {
  @IsString()
  @MinLength(1, { message: "请输入报价组名称" })
  @MaxLength(50, { message: "报价组名称过长" })
  name: string;
}

export class RenameGroupDto extends CreateGroupDto {}

export class AddGroupMembersDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsMongoId({ each: true, message: "客户 ID 不合法" })
  customer_ids: string[];
}

export class FormulaReplacePreviewDto {
  @IsString()
  @MinLength(1, { message: "请输入目标参数 / 公式片段" })
  @MaxLength(200)
  search: string;

  @IsString()
  @MaxLength(200)
  replace: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  customer_keyword?: string;
}

export class FormulaReplaceTargetDto {
  @IsMongoId()
  customer_id: string;

  @IsMongoId()
  item_id: string;
}

export class FormulaReplaceApplyDto {
  @IsString()
  @MinLength(1, { message: "请输入目标参数 / 公式片段" })
  @MaxLength(200)
  search: string;

  @IsString()
  @MinLength(1, { message: "请先输入替换内容" })
  @MaxLength(200)
  replace: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => FormulaReplaceTargetDto)
  targets: FormulaReplaceTargetDto[];
}

export class QueryRecordsDto {
  @IsMongoId({ message: "客户 ID 不合法" })
  customer_id: string;

  @IsOptional()
  @IsISO8601({}, { message: "起始时间格式不合法" })
  from?: string;

  @IsOptional()
  @IsISO8601({}, { message: "结束时间格式不合法" })
  to?: string;
}

export class QuerySnapshotsDto {
  @IsOptional()
  @IsISO8601({}, { message: "起始时间格式不合法" })
  from?: string;

  @IsOptional()
  @IsISO8601({}, { message: "结束时间格式不合法" })
  to?: string;
}

/** 报价监测阈值（单位小时，1-720） */
export class SaveQuoteSettingsDto {
  @IsInt() @Min(1) @Max(720)
  benchmark_hours: number;

  @IsInt() @Min(1) @Max(720)
  channel_hours: number;

  @IsInt() @Min(1) @Max(720)
  broker_hours: number;

  @IsInt() @Min(1) @Max(720)
  quote_item_hours: number;

  @IsInt() @Min(1) @Max(720)
  result_hours: number;
}
