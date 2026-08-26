import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { UserModule } from "../user/user.module";
import { AssignmentController } from "./assignment.controller";
import { AssignmentService } from "./assignment.service";
import { ReviewAssignment, ReviewAssignmentSchema } from "./review-assignment.schema";

@Module({
  imports: [
    UserModule,
    MongooseModule.forFeature([
      { name: ReviewAssignment.name, schema: ReviewAssignmentSchema },
    ]),
  ],
  controllers: [AssignmentController],
  providers: [AssignmentService],
  /** 导出给审核模块做"能看不能办"校验（AssignmentService.canDecide） */
  exports: [AssignmentService],
})
export class AssignmentModule {}
