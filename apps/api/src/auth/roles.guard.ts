import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { HandoffService } from "../modules/department/handoff.service";
import { JwtPayload } from "./auth.types";
import { ROLES_KEY } from "./decorators";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly handoffService: HandoffService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const user: JwtPayload | undefined = context.switchToHttp().getRequest().user;
    if (user && required.includes(user.role_code)) return true;
    /* 业务交接：请假区间内接手人临时按被代班岗位放行（部门管理里经理指定，到期自动失效） */
    if (user) {
      const delegated = await this.handoffService.activeRoleCodes(user.sub);
      if (delegated.some(code => required.includes(code))) return true;
    }
    throw new ForbiddenException("当前角色无权执行该操作");
  }
}
