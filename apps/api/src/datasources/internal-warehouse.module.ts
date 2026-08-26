import { DynamicModule, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

/**
 * 内部数据仓库接入预留点。
 *
 * 现状：本地/测试环境不配置 INTERNAL_DW_MONGODB_URI，本模块为空壳，不建立任何连接。
 *
 * 后续接入公司内部数仓时：
 * 1. 在部署环境 .env 配置 INTERNAL_DW_MONGODB_URI（独立账号、按需只读、IP 白名单、按公司要求启用 TLS）；
 * 2. 本模块会以命名连接 INTERNAL_DW_CONNECTION 注册第二个 Mongo 连接，与业务主库完全隔离；
 * 3. 数仓侧集合的 Schema/Repository 统一放在本目录下，注入时使用
 *    `@InjectModel(Xxx.name, INTERNAL_DW_CONNECTION)`，禁止与业务库模型混用；
 * 4. 若数仓为其他协议（HTTP API / JDBC 网关等），在本目录新增对应 client provider，
 *    保持"数据来源都从 datasources 目录出"的约定不变。
 */
export const INTERNAL_DW_CONNECTION = "internal_dw";

@Module({})
export class InternalWarehouseModule {
  static forRoot(): DynamicModule {
    const uri = process.env.INTERNAL_DW_MONGODB_URI;
    if (!uri) {
      return { module: InternalWarehouseModule };
    }
    return {
      module: InternalWarehouseModule,
      imports: [MongooseModule.forRoot(uri, { connectionName: INTERNAL_DW_CONNECTION })],
    };
  }
}
