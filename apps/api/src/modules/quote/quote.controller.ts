import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import { QUOTE_ACCESS_ROLES } from "@bv/shared";
import { Response } from "express";
import { JwtPayload } from "../../auth/auth.types";
import { CurrentUser, Roles } from "../../auth/decorators";
import {
  AddGroupMembersDto,
  CreateGroupDto,
  FormulaReplaceApplyDto,
  FormulaReplacePreviewDto,
  QueryRecordsDto,
  QuerySnapshotsDto,
  RenameGroupDto,
  SaveBenchmarksDto,
  SaveQuoteSettingsDto,
  UpdateChannelRatesDto,
  UpsertQuoteConfigDto,
} from "./dto/quote.dto";
import { QuoteGroupService } from "./quote-group.service";
import { QuoteMarketService } from "./quote-market.service";
import { QuoteService } from "./quote.service";

@Controller("quote")
@Roles(...QUOTE_ACCESS_ROLES)
export class QuoteController {
  constructor(
    private readonly quoteService: QuoteService,
    private readonly marketService: QuoteMarketService,
    private readonly groupService: QuoteGroupService,
  ) {}

  /* ---------- 平台基准价 / 渠道汇率 ---------- */

  @Get("benchmarks")
  getBenchmarks() {
    return this.marketService.getBenchmarkState();
  }

  /** 保存基准价后全量自动刷新引用它的报价（结果有变化的项落库并写历史） */
  @Put("benchmarks")
  async saveBenchmarks(@Body() dto: SaveBenchmarksDto, @CurrentUser() operator: JwtPayload) {
    const state = await this.marketService.saveBenchmarks(dto, operator);
    const refreshed = await this.quoteService.recalculateAllConfigs(operator);
    return { ...state, refreshed };
  }

  @Get("benchmark-snapshots")
  listSnapshots(@Query() query: QuerySnapshotsDto) {
    return this.marketService.listSnapshots(query);
  }

  @Get("channel-rates")
  listChannelRates() {
    return this.marketService.listChannelRates();
  }

  @Patch("channel-rates")
  async updateChannelRates(@Body() dto: UpdateChannelRatesDto, @CurrentUser() operator: JwtPayload) {
    const rates = await this.marketService.updateChannelRates(dto, operator);
    const refreshed = await this.quoteService.recalculateAllConfigs(operator);
    return { rates, refreshed };
  }

  /** 从 XE 行情源同步（未配置行情源时 synced=false，仅回读库中现值）；
      真实同步成功后同样全量刷新引用渠道汇率的报价 */
  @Post("channel-rates/sync")
  async syncChannelRates(@CurrentUser() operator: JwtPayload) {
    const result = await this.marketService.syncChannelRates(operator);
    if (!result.synced) return result;
    const refreshed = await this.quoteService.recalculateAllConfigs(operator);
    return { ...result, refreshed };
  }

  /* ---------- 报价监测阈值（admin 配置） ---------- */

  @Get("settings")
  @Roles("AGENT", "OPS", "MANAGER", "COMPLIANCE", "ADMIN")
  getMonitorSettings() {
    return this.marketService.getMonitorSettings();
  }

  @Put("settings")
  @Roles("ADMIN")
  saveMonitorSettings(@Body() dto: SaveQuoteSettingsDto, @CurrentUser() operator: JwtPayload) {
    return this.marketService.saveMonitorSettings(dto, operator);
  }

  /* ---------- 客户报价配置 ---------- */

  @Get("variables/:customerId")
  getVariables(@Param("customerId") customerId: string) {
    return this.quoteService.getVariables(customerId);
  }

  @Get("configs/:customerId")
  getConfig(@Param("customerId") customerId: string, @CurrentUser() operator: JwtPayload) {
    return this.quoteService.getConfig(customerId, operator);
  }

  @Put("configs/:customerId")
  upsertConfig(
    @Param("customerId") customerId: string,
    @Body() dto: UpsertQuoteConfigDto,
    @CurrentUser() operator: JwtPayload,
  ) {
    return this.quoteService.upsertConfig(customerId, dto, operator);
  }

  @Post("configs/:customerId/recalculate")
  recalculate(@Param("customerId") customerId: string, @CurrentUser() operator: JwtPayload) {
    return this.quoteService.recalculate(customerId, operator);
  }

  /* ---------- 批量调整公式 ---------- */

  @Post("formula-replace/preview")
  formulaReplacePreview(@Body() dto: FormulaReplacePreviewDto) {
    return this.quoteService.formulaReplacePreview(dto);
  }

  @Post("formula-replace/apply")
  formulaReplaceApply(@Body() dto: FormulaReplaceApplyDto, @CurrentUser() operator: JwtPayload) {
    return this.quoteService.formulaReplaceApply(dto, operator);
  }

  /* ---------- 往期报价 ---------- */

  @Get("records")
  listRecords(@Query() query: QueryRecordsDto) {
    return this.quoteService.listRecords(query);
  }

  /* ---------- 报价组 ---------- */

  @Get("groups")
  listGroups() {
    return this.groupService.list();
  }

  @Post("groups")
  createGroup(@Body() dto: CreateGroupDto, @CurrentUser() operator: JwtPayload) {
    return this.groupService.create(dto, operator);
  }

  @Get("groups/:id")
  groupDetail(@Param("id") id: string) {
    return this.groupService.detail(id);
  }

  @Get("groups/:id/board")
  groupBoard(@Param("id") id: string) {
    return this.groupService.board(id);
  }

  @Patch("groups/:id")
  renameGroup(
    @Param("id") id: string,
    @Body() dto: RenameGroupDto,
    @CurrentUser() operator: JwtPayload,
  ) {
    return this.groupService.rename(id, dto, operator);
  }

  @Delete("groups/:id")
  @HttpCode(204)
  async deleteGroup(@Param("id") id: string, @CurrentUser() operator: JwtPayload) {
    await this.groupService.softDelete(id, operator);
  }

  @Post("groups/:id/members")
  addMembers(
    @Param("id") id: string,
    @Body() dto: AddGroupMembersDto,
    @CurrentUser() operator: JwtPayload,
  ) {
    return this.groupService.addMembers(id, dto, operator);
  }

  @Delete("groups/:id/members/:customerId")
  @HttpCode(204)
  async removeMember(
    @Param("id") id: string,
    @Param("customerId") customerId: string,
    @CurrentUser() operator: JwtPayload,
  ) {
    await this.groupService.removeMember(id, customerId, operator);
  }

  @Post("groups/:id/recalculate")
  recalculateGroup(@Param("id") id: string, @CurrentUser() operator: JwtPayload) {
    return this.groupService.recalculate(id, operator);
  }

  @Get("groups/:id/export")
  async exportGroupCsv(@Param("id") id: string, @Res() res: Response) {
    const { filename, content } = await this.groupService.exportCsv(id);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.send(content);
  }
}
