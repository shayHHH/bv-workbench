import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtPayload } from "./auth.types";
import { ROLES_KEY } from "./decorators";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const user: JwtPayload | undefined = context.switchToHttp().getRequest().user;
    if (!user || !required.includes(user.role_code)) {
      throw new ForbiddenException("当前角色无权执行该操作");
    }
    return true;
  }
}
