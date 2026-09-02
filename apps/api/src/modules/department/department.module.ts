import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { AccessApplication, AccessApplicationSchema } from "../access/access-application.schema";
import { ReviewCase, ReviewCaseSchema } from "../access/review-case.schema";
import { ReviewAssignment, ReviewAssignmentSchema } from "../assignment/review-assignment.schema";
import { PayoutOrder, PayoutOrderSchema } from "../order/schemas/payout-order.schema";
import { TradeOrder, TradeOrderSchema } from "../order/schemas/trade-order.schema";
import { Role, RoleSchema } from "../user/role.schema";
import { User, UserSchema } from "../user/user.schema";
import { DepartmentController } from "./department.controller";
import { DepartmentService } from "./department.service";
import { HandoffModule } from "./handoff.module";
import { LeaveRecord, LeaveRecordSchema } from "./leave-record.schema";

@Module({
  imports: [
    HandoffModule,
    MongooseModule.forFeature([
      { name: LeaveRecord.name, schema: LeaveRecordSchema },
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
      { name: TradeOrder.name, schema: TradeOrderSchema },
      { name: PayoutOrder.name, schema: PayoutOrderSchema },
      { name: AccessApplication.name, schema: AccessApplicationSchema },
      { name: ReviewCase.name, schema: ReviewCaseSchema },
      { name: ReviewAssignment.name, schema: ReviewAssignmentSchema },
    ]),
  ],
  controllers: [DepartmentController],
  providers: [DepartmentService],
  exports: [DepartmentService],
})
export class DepartmentModule {}
