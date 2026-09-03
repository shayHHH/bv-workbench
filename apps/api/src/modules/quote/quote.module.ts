import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { XeRatesModule } from "../../datasources/xe-rates.module";
import { Customer, CustomerSchema } from "../customer/customer.schema";
import { QuoteController } from "./quote.controller";
import { QuoteGroupService } from "./quote-group.service";
import { QuoteMarketService } from "./quote-market.service";
import { QuoteService } from "./quote.service";
import {
  QuoteBenchmark,
  QuoteBenchmarkSchema,
  QuoteBenchmarkSnapshot,
  QuoteBenchmarkSnapshotSchema,
} from "./schemas/benchmark.schema";
import { QuoteChannelRate, QuoteChannelRateSchema } from "./schemas/channel-rate.schema";
import { QuoteSettings, QuoteSettingsSchema } from "./schemas/quote-settings.schema";
import { QuoteConfig, QuoteConfigSchema } from "./schemas/quote-config.schema";
import { QuoteGroup, QuoteGroupSchema } from "./schemas/quote-group.schema";
import { QuoteRecord, QuoteRecordSchema } from "./schemas/quote-record.schema";

@Module({
  imports: [
    XeRatesModule,
    MongooseModule.forFeature([
      { name: QuoteBenchmark.name, schema: QuoteBenchmarkSchema },
      { name: QuoteBenchmarkSnapshot.name, schema: QuoteBenchmarkSnapshotSchema },
      { name: QuoteChannelRate.name, schema: QuoteChannelRateSchema },
      { name: QuoteSettings.name, schema: QuoteSettingsSchema },
      { name: QuoteConfig.name, schema: QuoteConfigSchema },
      { name: QuoteGroup.name, schema: QuoteGroupSchema },
      { name: QuoteRecord.name, schema: QuoteRecordSchema },
      { name: Customer.name, schema: CustomerSchema },
    ]),
  ],
  controllers: [QuoteController],
  providers: [QuoteService, QuoteMarketService, QuoteGroupService],
})
export class QuoteModule {}
