import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { AccessApplication, AccessApplicationSchema } from "../access/access-application.schema";
import { Customer, CustomerSchema } from "../customer/customer.schema";
import { QuoteRecord, QuoteRecordSchema } from "../quote/schemas/quote-record.schema";
import { OrderController } from "./order.controller";
import { OrderService } from "./order.service";
import { PayoutOrder, PayoutOrderSchema } from "./schemas/payout-order.schema";
import { TradeOrder, TradeOrderSchema } from "./schemas/trade-order.schema";
import { TreasuryAccount, TreasuryAccountSchema } from "./schemas/treasury-account.schema";
import { VaAccount, VaAccountSchema } from "./schemas/va-account.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TradeOrder.name, schema: TradeOrderSchema },
      { name: PayoutOrder.name, schema: PayoutOrderSchema },
      { name: TreasuryAccount.name, schema: TreasuryAccountSchema },
      { name: VaAccount.name, schema: VaAccountSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: AccessApplication.name, schema: AccessApplicationSchema },
      { name: QuoteRecord.name, schema: QuoteRecordSchema },
    ]),
  ],
  controllers: [OrderController],
  /** 导出给准入模块：合规通过后自动推进待KYC订单（OrderService.advanceAfterKyc） */
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
