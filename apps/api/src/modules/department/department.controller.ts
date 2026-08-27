import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { JwtPayload } from "../../auth/auth.types";
import { CurrentUser, Roles } from "../../auth/decorators";
import { DepartmentService } from "./department.service";
import { CreateLeaveDto, MarkHandoffDto, OverviewQueryDto } from "./dto/department.dto";

/** 部门管理（仅运营经理，PRD §部门管理） */
@Controller("department")
@Roles("MANAGER")
export class DepartmentController {
  constructor(private readonly departmentService: DepartmentService) {}

  @Get("overview")
  overview(@Query() query: OverviewQueryDto) {
    return this.departmentService.overview(query.start, query.end);
  }

  @Post("leaves")
  createLeave(@Body() dto: CreateLeaveDto, @CurrentUser() operator: JwtPayload) {
    return this.departmentService.createLeave(dto, operator);
  }

  @Post("leaves/:id/handoff")
  markHandoff(
    @Param("id") id: string,
    @Body() dto: MarkHandoffDto,
    @CurrentUser() operator: JwtPayload,
  ) {
    return this.departmentService.markHandoff(id, dto, operator);
  }

  @Delete("leaves/:id")
  @HttpCode(204)
  async cancelLeave(@Param("id") id: string, @CurrentUser() operator: JwtPayload) {
    await this.departmentService.cancelLeave(id, operator);
  }
}
