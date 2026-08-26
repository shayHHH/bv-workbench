import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { JwtPayload } from "../../auth/auth.types";
import { CurrentUser, Roles } from "../../auth/decorators";
import { AccessService } from "./access.service";
import {
  ArchiveMaterialsDto,
  CancelApplicationDto,
  CreateApplicationDto,
  QueryApplicationDto,
  SaveDraftDto,
} from "./dto/access.dto";

/** 交易员侧准入申请（材料上传/补件处理）；合规与管理员可读 */
@Controller("access")
export class AccessController {
  constructor(private readonly accessService: AccessService) {}

  @Get("applications")
  @Roles("AGENT", "OPS", "COMPLIANCE", "ADMIN", "MANAGER")
  list(@Query() query: QueryApplicationDto) {
    return this.accessService.list(query);
  }

  @Get("applications/:id")
  @Roles("AGENT", "OPS", "COMPLIANCE", "ADMIN", "MANAGER")
  getById(@Param("id") id: string) {
    return this.accessService.getById(id);
  }

  @Post("applications")
  @Roles("AGENT", "OPS")
  create(@Body() dto: CreateApplicationDto, @CurrentUser() operator: JwtPayload) {
    return this.accessService.create(dto, operator);
  }

  @Patch("applications/:id")
  @Roles("AGENT", "OPS")
  saveDraft(
    @Param("id") id: string,
    @Body() dto: SaveDraftDto,
    @CurrentUser() operator: JwtPayload,
  ) {
    return this.accessService.saveDraft(id, dto, operator);
  }

  @Post("applications/:id/submit")
  @Roles("AGENT", "OPS")
  submit(@Param("id") id: string, @CurrentUser() operator: JwtPayload) {
    return this.accessService.submit(id, operator);
  }

  @Post("applications/:id/cancel")
  @Roles("AGENT", "OPS")
  cancel(
    @Param("id") id: string,
    @Body() dto: CancelApplicationDto,
    @CurrentUser() operator: JwtPayload,
  ) {
    return this.accessService.cancel(id, dto.note, operator);
  }

  /* ---- 客户材料库 ---- */

  @Get("customers/:customerId/materials")
  @Roles("AGENT", "OPS", "COMPLIANCE", "ADMIN")
  listMaterials(@Param("customerId") customerId: string) {
    return this.accessService.listCustomerMaterials(customerId);
  }

  @Post("customers/:customerId/materials")
  @Roles("AGENT", "OPS")
  archiveMaterials(
    @Param("customerId") customerId: string,
    @Body() dto: ArchiveMaterialsDto,
    @CurrentUser() operator: JwtPayload,
  ) {
    return this.accessService.archiveMaterials(customerId, dto, operator);
  }

  @Delete("materials/:id")
  @Roles("AGENT", "OPS")
  @HttpCode(204)
  async deleteMaterial(@Param("id") id: string, @CurrentUser() operator: JwtPayload) {
    await this.accessService.deleteCustomerMaterial(id, operator);
  }
}
