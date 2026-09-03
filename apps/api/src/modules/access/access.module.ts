import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { AssignmentModule } from "../assignment/assignment.module";
import { CustomerModule } from "../customer/customer.module";
import { Customer, CustomerSchema } from "../customer/customer.schema";
import { KycModule } from "../kyc/kyc.module";
import { OrderModule } from "../order/order.module";
import { AccessApplication, AccessApplicationSchema } from "./access-application.schema";
import { AccessController } from "./access.controller";
import { AccessService } from "./access.service";
import { DeferralScheduler } from "./deferral.scheduler";
import { CustomerMaterial, CustomerMaterialSchema } from "./customer-material.schema";
import { ReviewCase, ReviewCaseSchema } from "./review-case.schema";
import { ReviewController } from "./review.controller";
import { ReviewService } from "./review.service";

@Module({
  imports: [
    KycModule,
    CustomerModule,
    AssignmentModule,
    OrderModule,
    MongooseModule.forFeature([
      { name: AccessApplication.name, schema: AccessApplicationSchema },
      { name: CustomerMaterial.name, schema: CustomerMaterialSchema },
      { name: ReviewCase.name, schema: ReviewCaseSchema },
      { name: Customer.name, schema: CustomerSchema },
    ]),
  ],
  controllers: [AccessController, ReviewController],
  providers: [AccessService, ReviewService, DeferralScheduler],
})
export class AccessModule {}
