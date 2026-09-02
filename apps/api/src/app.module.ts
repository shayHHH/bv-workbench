import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MongooseModule } from "@nestjs/mongoose";
import { AuthModule } from "./auth/auth.module";
import configuration from "./config/configuration";
import { InternalWarehouseModule } from "./datasources/internal-warehouse.module";
import { HealthModule } from "./health/health.module";
import { AccessModule } from "./modules/access/access.module";
import { AssignmentModule } from "./modules/assignment/assignment.module";
import { CustomerModule } from "./modules/customer/customer.module";
import { DepartmentModule } from "./modules/department/department.module";
import { HandoffModule } from "./modules/department/handoff.module";
import { FileModule } from "./modules/file/file.module";
import { KycModule } from "./modules/kyc/kyc.module";
import { OrderModule } from "./modules/order/order.module";
import { QuoteModule } from "./modules/quote/quote.module";
import { UserModule } from "./modules/user/user.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      // 支持从 workspace 目录或仓库根目录读取 .env
      envFilePath: [".env", "../../.env"],
    }),
    // 业务主库连接
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>("mongodbUri"),
      }),
    }),
    // 内部数据仓库连接（预留：配置 INTERNAL_DW_MONGODB_URI 后启用）
    InternalWarehouseModule.forRoot(),
    HandoffModule,
    AuthModule,
    UserModule,
    HealthModule,
    CustomerModule,
    QuoteModule,
    KycModule,
    AccessModule,
    AssignmentModule,
    OrderModule,
    DepartmentModule,
    FileModule,
  ],
})
export class AppModule {}
