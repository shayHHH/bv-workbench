import { Controller, Get, Query } from "@nestjs/common";
import { COMPLIANCE_DUTY_ROLES } from "@bv/shared";
import { Roles } from "../../auth/decorators";
import { CustomerService } from "./customer.service";
import { QueryAuditDto } from "./dto/query-audit.dto";

/** 审计日志（PRD 合规官职责：查看审计日志）；demo 中合规官与管理员可见 */
@Controller("audit")
@Roles(...COMPLIANCE_DUTY_ROLES, "ADMIN")
export class AuditController {
  constructor(private readonly customerService: CustomerService) {}

  @Get("events")
  events(@Query() query: QueryAuditDto) {
    return this.customerService.auditEvents(query);
  }
}
