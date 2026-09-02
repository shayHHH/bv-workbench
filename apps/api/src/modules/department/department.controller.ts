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
    return this.departmentService.overview(query.start, query.end, query.done_period);
  }

  @Post("leaves")
  createLeave(@Body() dto: CreateLeaveDto, @CurrentUser() operator: JwtPayload) {
    return this.departmentService.createLeave(dto, operator);
  }

  /** 接手人候选：系统全部启用账号（含 Admin），经理自选 */
  @Get("handoff-candidates")
  handoffCandidates() {
    return this.departmentService.handoffCandidates();
  }

  @Post("leaves/:id/handoff")
  markHandoff(
    @Param("id") id: string,
    @Body() dto: MarkHandoffDto,
    @CurrentUser() operator: JwtPayload,
  ) {
    return this.departmentService.markHandoff(id, dto, operator);
  }

  /** 撤销交接（接手人代班权限立即失效） */
  @Delete("leaves/:id/handoff")
  revokeHandoff(@Param("id") id: string, @CurrentUser() operator: JwtPayload) {
    return this.departmentService.revokeHandoff(id, operator);
  }

  /** 我的代班（任意登录角色查自己）：工作台提示条与前端菜单按此扩展可见范围 */
  @Get("my-handoffs")
  @Roles()
  myHandoffs(@CurrentUser() operator: JwtPayload) {
    return this.departmentService.myHandoffs(operator);
  }

  @Delete("leaves/:id")
  @HttpCode(204)
  async cancelLeave(@Param("id") id: string, @CurrentUser() operator: JwtPayload) {
    await this.departmentService.cancelLeave(id, operator);
  }
}
