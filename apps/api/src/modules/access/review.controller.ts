import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { COMPLIANCE_DUTY_ROLES } from "@bv/shared";
import { JwtPayload } from "../../auth/auth.types";
import { CurrentUser, Roles } from "../../auth/decorators";
import { QueryReviewDto, ReviewDecisionDto } from "./dto/access.dto";
import { ReviewService } from "./review.service";

/** 合规审核队列/详情（PRD §4.8/4.9）；仅合规官（含风控专员）与管理员 */
@Controller("review/cases")
@Roles(...COMPLIANCE_DUTY_ROLES, "ADMIN")
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Get()
  list(@Query() query: QueryReviewDto) {
    return this.reviewService.list(query);
  }

  /** 注意：必须声明在 :id 路由之前 */
  @Get("stats")
  stats() {
    return this.reviewService.stats();
  }

  @Get(":id")
  getById(@Param("id") id: string) {
    return this.reviewService.getById(id);
  }

  @Post(":id/decision")
  decide(
    @Param("id") id: string,
    @Body() dto: ReviewDecisionDto,
    @CurrentUser() operator: JwtPayload,
  ) {
    return this.reviewService.decide(id, dto, operator);
  }
}
