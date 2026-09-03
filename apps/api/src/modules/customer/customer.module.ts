import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { AuditController } from "./audit.controller";
import { CustomerController } from "./customer.controller";
import { CustomerEvent, CustomerEventSchema } from "./customer-event.schema";
import { AccessApplication, AccessApplicationSchema } from "../access/access-application.schema";
import { Customer, CustomerSchema } from "./customer.schema";
import { CustomerService } from "./customer.service";
import { TradeOrder, TradeOrderSchema } from "../order/schemas/trade-order.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AccessApplication.name, schema: AccessApplicationSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: CustomerEvent.name, schema: CustomerEventSchema },
      { name: TradeOrder.name, schema: TradeOrderSchema },
    ]),
  ],
  controllers: [CustomerController, AuditController],
  providers: [CustomerService],
  exports: [CustomerService],
})
export class CustomerModule {}
