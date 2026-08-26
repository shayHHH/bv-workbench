import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { JwtPayload } from "../../auth/auth.types";
import { CurrentUser } from "../../auth/decorators";
import { CustomerService } from "./customer.service";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { QueryCustomerDto } from "./dto/query-customer.dto";
import { UpdateCustomerDto } from "./dto/update-customer.dto";

@Controller("customers")
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get()
  list(@Query() query: QueryCustomerDto) {
    return this.customerService.list(query);
  }

  /** 注意：必须声明在 :id 路由之前 */
  @Get("next-code")
  async nextCode() {
    return { customer_code: await this.customerService.nextAvailableCode() };
  }

  @Get(":id/events")
  events(@Param("id") id: string) {
    return this.customerService.events(id);
  }

  @Get(":id")
  getById(@Param("id") id: string) {
    return this.customerService.getById(id);
  }

  @Post()
  create(@Body() dto: CreateCustomerDto, @CurrentUser() operator: JwtPayload) {
    return this.customerService.create(dto, operator);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() operator: JwtPayload,
  ) {
    return this.customerService.update(id, dto, operator);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id") id: string, @CurrentUser() operator: JwtPayload) {
    await this.customerService.softDelete(id, operator);
  }
}
