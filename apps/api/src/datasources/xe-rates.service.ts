import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * XE 渠道即时汇率行情源接入预留点。
 *
 * 现状：XE_RATES_API_URL / XE_RATES_API_KEY 未配置时 isConfigured=false，
 * 报价页「刷新」按钮只重读 quote_channel_rates 里的人工维护数据。
 *
 * 后续拿到 API 文档接入时（用户会提供具体情况）：
 * 1. 在部署环境 .env 配置 XE_RATES_API_URL / XE_RATES_API_KEY；
 * 2. 补全下方 fetchLatestRates()：按文档发起请求（鉴权头、超时、重试按需），
 *    把响应映射为 { 渠道汇率 code（如 xe_usdt_cnh）→ 十进制字符串数值 }；
 *    货币对与 code 的对照见 scripts/seed.mjs 的 channelRates 表；
 * 3. QuoteMarketService.syncChannelRates() 已就绪：拿到映射后按 code 更新
 *    quote_channel_rates（Decimal128），前端与公式引擎无需任何改动；
 * 4. 若行情改为定时拉取，在本目录加调度即可，仍从 datasources 出数据。
 */
@Injectable()
export class XeRatesService {
  private readonly logger = new Logger(XeRatesService.name);

  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    return !!this.config.get<string>("xeRatesApiUrl");
  }

  /** code → 十进制字符串；未接入返回 null（调用方回退为读库） */
  async fetchLatestRates(): Promise<Map<string, string> | null> {
    if (!this.isConfigured) return null;
    /* 已配置但映射未实现：提醒补全，不吞错误 */
    this.logger.warn(
      "XE_RATES_API_URL 已配置，但行情映射尚未实现——请按 API 文档补全 fetchLatestRates()",
    );
    throw new Error("XE 行情源映射尚未实现，请补全 datasources/xe-rates.service.ts");
  }
}
