import { Global, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Role, RoleSchema } from "../user/role.schema";
import { HandoffService } from "./handoff.service";
import { LeaveRecord, LeaveRecordSchema } from "./leave-record.schema";

/**
 * 代班授权在 RolesGuard（全局守卫）与订单待办里都要用到，做成全局模块避免各处重复 import。
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LeaveRecord.name, schema: LeaveRecordSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
  ],
  providers: [HandoffService],
  exports: [HandoffService],
})
export class HandoffModule {}
