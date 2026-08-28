import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { JwtPayload } from "../../auth/auth.types";
import { CurrentUser, Roles } from "../../auth/decorators";
import {
  CreateDispatchDto,
  CreateOrderDto,
  ExceptionMarkDto,
  ExceptionResolveDto,
  FundingActionDto,
  QueryOrderDto,
  ReasonDto,
  WalletAddressDto,
} from "./dto/order.dto";
import { OrderService } from "./order.service";

const ORDER_VIEW_ROLES = ["AGENT", "OPS", "FINANCE", "MANAGER", "PAYOUT", "WALLET", "ADMIN"] as const;

/** 交易订单主线（demo 按钮矩阵表5：动作按角色拆分） */
@Controller("orders")
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  @Roles(...ORDER_VIEW_ROLES)
  list(@Query() query: QueryOrderDto, @CurrentUser() operator: JwtPayload) {
    return this.orderService.list(query, operator);
  }

  @Get("quote-candidates")
  @Roles("AGENT", "OPS")
  quoteCandidates(@Query("customer_id") customerId: string) {
    return this.orderService.quoteCandidates(customerId);
  }

  @Get(":id")
  @Roles(...ORDER_VIEW_ROLES)
  getById(@Param("id") id: string) {
    return this.orderService.getById(id);
  }

  @Get(":id/dispatch")
  @Roles(...ORDER_VIEW_ROLES)
  getDispatch(@Param("id") id: string) {
    return this.orderService.getDispatch(id);
  }

  @Get(":id/dispatch-context")
  @Roles("AGENT", "OPS")
  dispatchContext(@Param("id") id: string) {
    return this.orderService.dispatchContext(id);
  }

  @Post()
  @Roles("AGENT", "OPS")
  create(@Body() dto: CreateOrderDto, @CurrentUser() operator: JwtPayload) {
    return this.orderService.create(dto, operator);
  }

  @Post(":id/cancel")
  @Roles("AGENT", "OPS")
  cancel(@Param("id") id: string, @Body() dto: ReasonDto, @CurrentUser() operator: JwtPayload) {
    return this.orderService.cancel(id, dto.reason, operator, false);
  }

  @Post(":id/risk-stop")
  @Roles("OPS")
  riskStop(@Param("id") id: string, @Body() dto: ReasonDto, @CurrentUser() operator: JwtPayload) {
    return this.orderService.cancel(id, dto.reason, operator, true);
  }

  @Post(":id/kyc-sync")
  @Roles("AGENT", "OPS")
  kycSync(@Param("id") id: string, @CurrentUser() operator: JwtPayload) {
    return this.orderService.kycSync(id, operator);
  }

  @Post(":id/wallet/deposit-address")
  @Roles("WALLET")
  walletDeposit(@Param("id") id: string, @Body() dto: WalletAddressDto, @CurrentUser() operator: JwtPayload) {
    return this.orderService.walletDepositAddress(id, dto.address, operator);
  }

  /** 入款登记即确认：责任人（财务/钱包/现金）由服务层按资金形态校验 */
  @Post(":id/inflow-confirm")
  @Roles("FINANCE", "WALLET", "ADMIN")
  inflowConfirm(@Param("id") id: string, @Body() dto: FundingActionDto, @CurrentUser() operator: JwtPayload) {
    return this.orderService.inflowConfirm(id, dto, operator);
  }

  @Post(":id/dispatch")
  @Roles("AGENT", "OPS")
  dispatchCreate(@Param("id") id: string, @Body() dto: CreateDispatchDto, @CurrentUser() operator: JwtPayload) {
    return this.orderService.dispatchCreate(id, dto, operator);
  }

  @Post(":id/dispatch/approve")
  @Roles("OPS")
  dispatchApprove(@Param("id") id: string, @CurrentUser() operator: JwtPayload) {
    return this.orderService.dispatchApprove(id, operator);
  }

  @Post(":id/dispatch/return")
  @Roles("OPS")
  dispatchReturn(@Param("id") id: string, @Body() dto: ReasonDto, @CurrentUser() operator: JwtPayload) {
    return this.orderService.dispatchReturn(id, dto.reason, operator);
  }

  @Post(":id/outflow-execute")
  @Roles("PAYOUT", "WALLET", "ADMIN")
  outflowExecute(@Param("id") id: string, @Body() dto: FundingActionDto, @CurrentUser() operator: JwtPayload) {
    return this.orderService.outflowExecute(id, dto, operator);
  }

  @Post(":id/outflow-return")
  @Roles("PAYOUT", "WALLET", "OPS")
  outflowReturn(@Param("id") id: string, @Body() dto: ReasonDto, @CurrentUser() operator: JwtPayload) {
    return this.orderService.outflowReturn(id, dto.reason, operator);
  }

  @Post(":id/exception")
  @Roles("OPS", "FINANCE", "WALLET")
  exceptionMark(@Param("id") id: string, @Body() dto: ExceptionMarkDto, @CurrentUser() operator: JwtPayload) {
    return this.orderService.exceptionMark(id, dto, operator);
  }

  @Post(":id/exception/resolve")
  @Roles("OPS")
  exceptionResolve(@Param("id") id: string, @Body() dto: ExceptionResolveDto, @CurrentUser() operator: JwtPayload) {
    return this.orderService.exceptionResolve(id, dto, operator);
  }
}
