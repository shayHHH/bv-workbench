import {
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from "class-validator";
import { DispatchChannel, TradeOrderStatus, type FileRef } from "@bv/shared";

export class CreateOrderDto {
  @IsMongoId()
  customer_id: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  business_type?: string | null;

  @IsOptional()
  @IsMongoId()
  business_scenario_id?: string | null;

  /** 客户英文名/收款人名（排单收款要素用），选填 */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  person_name?: string | null;

  @IsString()
  @MaxLength(30)
  trade_type: string;

  @IsString()
  @MaxLength(10)
  sell_currency: string;

  @IsNumber()
  @IsPositive()
  sell_amount: number;

  @IsString()
  @MaxLength(10)
  buy_currency: string;

  @IsNumber()
  @IsPositive()
  buy_amount: number;

  @IsString()
  @MaxLength(20)
  rate: string;

  @IsString()
  @MaxLength(20)
  pay_method: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string | null;

  @IsOptional()
  @IsMongoId()
  quote_record_id?: string | null;
}

export class QueryOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  /** 创建时间筛选（毫秒时间戳） */
  @IsOptional()
  created_from?: number;

  @IsOptional()
  created_to?: number;

  /** 逗号分隔状态列表 */
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsMongoId()
  customer_id?: string;

  /** 当前角色待处理订单 */
  @IsOptional()
  @IsIn(["mine"])
  scope?: "mine";

  /** 入款/出款资金形态筛选（fiat=法币或现金 / chain=链上） */
  @IsOptional()
  @IsIn(["fiat", "chain"])
  inflow_kind?: "fiat" | "chain";

  @IsOptional()
  @IsIn(["fiat", "chain"])
  outflow_kind?: "fiat" | "chain";


  /** 待办快捷筛选（demo 页签）：exception / payment_rejected / dispatch_rejected / rejected */
  @IsOptional()
  @IsIn(["exception", "payment_rejected", "dispatch_rejected", "rejected"])
  flag?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  page_size?: number;
}

export class ReasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class FundingActionDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional() @IsString() @MaxLength(100) account?: string | null;
  @IsOptional() voucher?: FileRef | string | null;
  @IsOptional() @IsString() @MaxLength(20) chain?: string | null;
  @IsOptional() @IsString() @MaxLength(120) hash?: string | null;
  @IsOptional() @IsString() @MaxLength(10) confirms?: string | null;
  @IsOptional() @IsString() @MaxLength(100) place?: string | null;
  @IsOptional() @IsString() @MaxLength(50) handler?: string | null;
  @IsOptional() @IsString() @MaxLength(50) token?: string | null;
  @IsOptional() @IsString() @MaxLength(30) method?: string | null;
  @IsOptional() @IsString() @MaxLength(300) note?: string | null;
}

export class CreateDispatchDto {
  @IsIn(Object.values(DispatchChannel))
  channel: DispatchChannel;

  @IsString()
  @MaxLength(4000)
  text: string;

  @IsOptional()
  @IsMongoId()
  va_account_id?: string | null;

  /** 出款账户名/描述（可编辑，默认由渠道推导），审计 1.4.2 */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  payout_account?: string | null;
}

export class WalletAddressDto {
  @IsString()
  @MaxLength(80)
  address: string;
}

export class ExceptionMarkDto {
  @IsString()
  @MaxLength(30)
  kind: string;

  @IsString()
  @MaxLength(50)
  reason: string;

  @IsString()
  @MaxLength(300)
  detail: string;
}

export class ExceptionResolveDto {
  @IsIn(["restore", "cancel", "escalate"])
  action: "restore" | "cancel" | "escalate";

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class CreateCustomBusinessTypeDto {
  @IsString()
  @MaxLength(60)
  name: string;
}

/**
 * 编辑交易订单（初级/高级交易员，排单进入审核前可改）。
 * 全部字段可选，只提交需要变更的部分；改动买入金额/币种时服务层会重算冻结。
 */
/** 编辑不允许更换客户（客户是订单主体，换客户请删除后重建） */
export class UpdateOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  business_type?: string | null;

  @IsOptional()
  @IsMongoId()
  business_scenario_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  person_name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  trade_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  sell_currency?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  sell_amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  buy_currency?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  buy_amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  rate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  pay_method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string | null;
}
