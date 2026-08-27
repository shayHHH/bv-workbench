import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { JwtPayload } from "../../auth/auth.types";
import { COMPLIANCE_DUTY_ROLES } from "@bv/shared";
import { CurrentUser, Roles } from "../../auth/decorators";
import { SaveScenarioDto } from "./dto/save-scenario.dto";
import { KycService } from "./kyc.service";

@Controller("kyc/scenarios")
export class KycController {
  constructor(private readonly kycService: KycService) {}

  /** 材料上传页引用：已发布模板（交易员/合规/管理员可读） */
  @Get("active")
  @Roles("AGENT", "OPS", ...COMPLIANCE_DUTY_ROLES, "ADMIN")
  listActive() {
    return this.kycService.listPublished();
  }

  /* ---- 以下为配置管理（PRD §4.10），仅合规官与管理员 ---- */

  @Get()
  @Roles(...COMPLIANCE_DUTY_ROLES, "ADMIN")
  listAll() {
    return this.kycService.listAll();
  }

  @Get(":id")
  @Roles(...COMPLIANCE_DUTY_ROLES, "ADMIN")
  getById(@Param("id") id: string) {
    return this.kycService.getById(id);
  }

  @Post()
  @Roles(...COMPLIANCE_DUTY_ROLES, "ADMIN")
  create(@Body() dto: SaveScenarioDto, @CurrentUser() operator: JwtPayload) {
    return this.kycService.create(dto, operator);
  }

  @Patch(":id")
  @Roles(...COMPLIANCE_DUTY_ROLES, "ADMIN")
  update(
    @Param("id") id: string,
    @Body() dto: SaveScenarioDto,
    @CurrentUser() operator: JwtPayload,
  ) {
    return this.kycService.update(id, dto, operator);
  }

  @Post(":id/publish")
  @Roles(...COMPLIANCE_DUTY_ROLES, "ADMIN")
  publish(@Param("id") id: string, @CurrentUser() operator: JwtPayload) {
    return this.kycService.publish(id, operator);
  }

  @Delete(":id")
  @Roles(...COMPLIANCE_DUTY_ROLES, "ADMIN")
  @HttpCode(204)
  async remove(@Param("id") id: string, @CurrentUser() operator: JwtPayload) {
    await this.kycService.softDelete(id, operator);
  }
}
