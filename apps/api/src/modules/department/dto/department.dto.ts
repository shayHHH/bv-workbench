import { LeavePart, LeaveType } from "@bv/shared";
import { IsBoolean, IsIn, IsMongoId, IsOptional, IsString, Matches, MaxLength } from "class-validator";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export class OverviewQueryDto {
  /** 出勤日历需要的日期范围（含当天），YYYY-MM-DD */
  @IsOptional()
  @Matches(DATE_RE)
  start?: string;

  @IsOptional()
  @Matches(DATE_RE)
  end?: string;
}

export class CreateLeaveDto {
  @IsMongoId()
  user_id: string;

  @IsIn(Object.values(LeaveType))
  leave_type: LeaveType;

  @IsIn(Object.values(LeavePart))
  part: LeavePart;

  @Matches(DATE_RE)
  start_date: string;

  @Matches(DATE_RE)
  end_date: string;

  @IsOptional()
  @Matches(TIME_RE)
  start_time?: string;

  @IsOptional()
  @Matches(TIME_RE)
  end_time?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @IsOptional()
  @IsBoolean()
  handoff?: boolean;
}

export class MarkHandoffDto {
  /** 接手人姓名（可选，默认取系统建议） */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  target_name?: string | null;
}
