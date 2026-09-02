import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { QUOTE_ACCESS_ROLES } from "@bv/shared";
import { JwtPayload } from "../../auth/auth.types";
import { CurrentUser, Roles } from "../../auth/decorators";
import { AccessService } from "./access.service";
import {
  ArchiveMaterialsDto,
  CancelApplicationDto,
  CreateApplicationDto,
  QueryApplicationDto,
  SaveDraftDto,
  SubmitApplicationDto,
} from "./dto/access.dto";

/** 准入申请（材料上传/补件处理）：交易员与运营经理可写，合规与管理员可读 */
@Controller("access")
export class AccessController {
  constructor(private readonly accessService: AccessService) {}

  /* 只读查看不设角色门槛（用户 2026-08-27：客户管理页与客户详情抽屉全员可看）；写操作限交易员与运营经理 */
  @Get("applications")
  list(@Query() query: QueryApplicationDto) {
    return this.accessService.list(query);
  }

  @Get("applications/:id")
  getById(@Param("id") id: string) {
    return this.accessService.getById(id);
  }

  @Post("applications")
  @Roles(...QUOTE_ACCESS_ROLES)
  create(@Body() dto: CreateApplicationDto, @CurrentUser() operator: JwtPayload) {
    return this.accessService.create(dto, operator);
  }

  @Patch("applications/:id")
  @Roles(...QUOTE_ACCESS_ROLES)
  saveDraft(
    @Param("id") id: string,
    @Body() dto: SaveDraftDto,
    @CurrentUser() operator: JwtPayload,
  ) {
    return this.accessService.saveDraft(id, dto, operator);
  }

  @Post("applications/:id/submit")
  @Roles(...QUOTE_ACCESS_ROLES)
  submit(
    @Param("id") id: string,
    @Body() dto: SubmitApplicationDto,
    @CurrentUser() operator: JwtPayload,
  ) {
    return this.accessService.submit(id, dto.review_type, operator);
  }

  /** 重新提交（审核拒绝/已过期/已取消 → 重开为草稿） */
  @Post("applications/:id/reopen")
  @Roles(...QUOTE_ACCESS_ROLES)
  reopen(@Param("id") id: string, @CurrentUser() operator: JwtPayload) {
    return this.accessService.reopen(id, operator);
  }

  @Post("applications/:id/cancel")
  @Roles(...QUOTE_ACCESS_ROLES)
  cancel(
    @Param("id") id: string,
    @Body() dto: CancelApplicationDto,
    @CurrentUser() operator: JwtPayload,
  ) {
    return this.accessService.cancel(id, dto.note, operator);
  }

  /* ---- 客户材料库 ---- */

  /* 只读查看与准入申请接口同口径：全员可看（客户抽屉-材料页签） */
  @Get("customers/:customerId/materials")
  listMaterials(@Param("customerId") customerId: string) {
    return this.accessService.listCustomerMaterials(customerId);
  }

  @Post("customers/:customerId/materials")
  @Roles(...QUOTE_ACCESS_ROLES)
  archiveMaterials(
    @Param("customerId") customerId: string,
    @Body() dto: ArchiveMaterialsDto,
    @CurrentUser() operator: JwtPayload,
  ) {
    return this.accessService.archiveMaterials(customerId, dto, operator);
  }

  @Delete("materials/:id")
  @Roles(...QUOTE_ACCESS_ROLES)
  @HttpCode(204)
  async deleteMaterial(@Param("id") id: string, @CurrentUser() operator: JwtPayload) {
    await this.accessService.deleteCustomerMaterial(id, operator);
  }
}
