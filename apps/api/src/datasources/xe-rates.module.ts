import { Module } from "@nestjs/common";
import { XeRatesService } from "./xe-rates.service";

/** XE 渠道汇率行情源接入点（预留）；数据来源统一从 datasources 目录出 */
@Module({
  providers: [XeRatesService],
  exports: [XeRatesService],
})
export class XeRatesModule {}
