import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { AccessStatus, FileRef, MaterialSource, ReviewDecisionAction, ReviewType } from "@bv/shared";

export class CreateApplicationDto {
  @IsMongoId()
  customer_id: string;
}

export class DraftFormDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  customer_cn_name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  customer_en_name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  business_note?: string | null;
}

export class DraftMaterialDto {
  @IsString()
  @MaxLength(50)
  material_key: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  requirement_item_id?: string | null;

  @IsString()
  @MaxLength(200)
  name: string;

  @IsIn(Object.values(MaterialSource))
  source: MaterialSource;

  @IsOptional()
  @IsObject()
  file?: FileRef | null;

  @IsOptional()
  @IsMongoId()
  library_material_id?: string | null;
}

export class SaveDraftDto {
  @IsOptional()
  @IsMongoId()
  scenario_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  channel_code?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => DraftFormDto)
  form?: DraftFormDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DraftMaterialDto)
  materials?: DraftMaterialDto[];
}

export class QueryApplicationDto {
  /** 逗号分隔的状态列表，如 SUPPLEMENT_REQUIRED,REJECTED */
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @IsOptional()
  @IsMongoId()
  customer_id?: string;

  @IsOptional()
  @IsNumber()
  updated_from?: number;

  @IsOptional()
  @IsNumber()
  updated_to?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  page_size?: number;
}

export class ArchiveMaterialItemDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string | null;

  @IsObject()
  file: FileRef;
}

export class ArchiveMaterialsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ArchiveMaterialItemDto)
  items: ArchiveMaterialItemDto[];
}

export class CancelApplicationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SubmitApplicationDto {
  /** 提交模式：找换 / U相关（demo 提交坞选择） */
  @IsIn(Object.values(ReviewType))
  review_type: ReviewType;
}

export class MaterialVerdictDto {
  @IsString()
  @MaxLength(50)
  material_key: string;

  @IsIn(["ACCEPTED", "RETURNED"])
  verdict: "ACCEPTED" | "RETURNED";

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}

export class ReviewDecisionDto {
  @IsIn(Object.values(ReviewDecisionAction))
  action: ReviewDecisionAction;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MaterialVerdictDto)
  material_verdicts?: MaterialVerdictDto[];
}

export class QueryReviewDto {
  @IsOptional()
  @IsIn(["PENDING", "PROCESSED"])
  status?: "PENDING" | "PROCESSED";

  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @IsOptional()
  @IsIn(["NEW", "RESUBMIT"])
  audit_type?: "NEW" | "RESUBMIT";

  /** 提交模式筛选（FX 找换 / USDT U相关；双合规分工的分配过滤将基于它扩展） */
  @IsOptional()
  @IsIn(Object.values(ReviewType))
  review_type?: ReviewType;

  /** 已处理页签的最终结论筛选 */
  @IsOptional()
  @IsIn(["APPROVED", "UNRESOLVED", "TERMINATED"])
  final_result?: "APPROVED" | "UNRESOLVED" | "TERMINATED";

  /** 已处理页签的「我的结论」筛选（demo 处理过工具栏） */
  @IsOptional()
  @IsIn(Object.values(ReviewDecisionAction))
  decision_action?: ReviewDecisionAction;

  @IsOptional()
  @IsNumber()
  submitted_from?: number;

  @IsOptional()
  @IsNumber()
  submitted_to?: number;

  /** 排序（待处理按提交时间 / 已处理按审核时间），默认倒序 */
  @IsOptional()
  @IsIn(["submitted_at", "reviewed_at"])
  sort_by?: "submitted_at" | "reviewed_at";

  @IsOptional()
  @IsIn(["asc", "desc"])
  sort_order?: "asc" | "desc";

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  page_size?: number;
}

/** 供 service 内部使用的状态列表解析 */
export function parseStatusList(raw?: string): AccessStatus[] {
  if (!raw) return [];
  const valid = new Set(Object.values(AccessStatus) as string[]);
  return raw
    .split(",")
    .map(item => item.trim())
    .filter(item => valid.has(item)) as AccessStatus[];
}
