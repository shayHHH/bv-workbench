import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { KycScenario, KycScenarioSchema } from "./kyc-scenario.schema";
import { KycController } from "./kyc.controller";
import { KycService } from "./kyc.service";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: KycScenario.name, schema: KycScenarioSchema }]),
  ],
  controllers: [KycController],
  providers: [KycService],
  exports: [KycService, MongooseModule],
})
export class KycModule {}
