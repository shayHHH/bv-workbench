import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { CustomerController } from "./customer.controller";
import { CustomerEvent, CustomerEventSchema } from "./customer-event.schema";
import { Customer, CustomerSchema } from "./customer.schema";
import { CustomerService } from "./customer.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: CustomerEvent.name, schema: CustomerEventSchema },
    ]),
  ],
  controllers: [CustomerController],
  providers: [CustomerService],
  exports: [CustomerService],
})
export class CustomerModule {}
