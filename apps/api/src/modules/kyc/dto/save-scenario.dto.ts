import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { KycItemType } from "@bv/shared";

export class KycChannelDto {
  @IsString()
  @MaxLength(30)
  channel_code: string;

  @IsString()
  @MaxLength(50)
  channel_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  restriction_note?: string | null;
}

export class KycItemDto {
  @IsString()
  @MaxLength(50)
  item_id: string;

  @IsString()
  @MaxLength(100)
  item_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  item_description?: string | null;

  @IsIn(Object.values(KycItemType))
  item_type: KycItemType;

  @IsBoolean()
  required: boolean;

  @IsInt()
  @Min(1)
  @Max(20)
  max_count: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  validity_note?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  channel_codes?: string[] | null;
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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KycSectionDto)
  sections: KycSectionDto[];
}
