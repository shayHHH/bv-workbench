import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import { COMPLIANCE_DUTY_ROLES, ReviewType } from "@bv/shared";
import { IsArray, IsMongoId } from "class-validator";
import { JwtPayload } from "../../auth/auth.types";
import { CurrentUser, Roles } from "../../auth/decorators";
import { AssignmentService } from "./assignment.service";

class SaveAssignmentDto {
  @IsArray()
  @IsMongoId({ each: true })
  assignee_user_ids: string[];
}

/** 合规审核分配（admin 配置；合规官只读——用于展示自己的负责范围） */
@Controller("review-assignments")
export class AssignmentController {
  constructor(private readonly assignmentService: AssignmentService) {}

  @Get()
  @Roles("ADMIN", ...COMPLIANCE_DUTY_ROLES)
  board() {
    return this.assignmentService.board();
  }

  @Put(":reviewType")
  @Roles("ADMIN")
  save(
    @Param("reviewType") reviewType: string,
    @Body() dto: SaveAssignmentDto,
    @CurrentUser() operator: JwtPayload,
  ) {
    if (!Object.values(ReviewType).includes(reviewType as ReviewType)) {
      throw new BadRequestException("未知的审核类型");
    }
    return this.assignmentService.save(reviewType as ReviewType, dto.assignee_user_ids, operator);
  }
}
