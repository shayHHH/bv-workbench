import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import {
  KycChannelTheme,
  KycItemType,
  KycItemValidity,
  KycRestrictionType,
} from "@bv/shared";

/* demo 四层结构：业务类型 → 渠道 → 材料模块 → 材料项（每渠道独立材料清单） */

export class KycRestrictionDto {
  @IsIn(Object.values(KycRestrictionType))
  type: KycRestrictionType;

  @IsString()
  @MaxLength(500)
  content: string;
}

export class KycItemDto {
  @IsString()
  @MaxLength(50)
  item_id: string;

  @IsString()
  @MaxLength(100)
  item_name: string;

  /** 补充要求（demo subRequirement） */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  item_description?: string | null;

  @IsIn(Object.values(KycItemType))
  item_type: KycItemType;

  @IsBoolean()
  required: boolean;

  @IsIn(Object.values(KycItemValidity))
  validity: KycItemValidity;
}

export class KycSectionDto {
  @IsString()
  @MaxLength(50)
  section_name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KycItemDto)
  items: KycItemDto[];
}

export class KycChannelDto {
  @IsString()
  @MaxLength(30)
  channel_code: string;

  @IsString()
  @MaxLength(50)
  channel_name: string;

  @IsIn(Object.values(KycChannelTheme))
  theme: KycChannelTheme;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KycRestrictionDto)
  restrictions: KycRestrictionDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KycSectionDto)
  sections: KycSectionDto[];
}

export class SaveScenarioDto {
  @IsString()
  @MaxLength(30)
  scenario_code: string;

  @IsString()
  @MaxLength(50)
  scenario_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  process_description?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KycChannelDto)
  channels: KycChannelDto[];
}
