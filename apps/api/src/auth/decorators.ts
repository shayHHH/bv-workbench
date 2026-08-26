import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import { JwtPayload } from "./auth.types";

export const IS_PUBLIC_KEY = "isPublic";
/** 标记无需登录即可访问的路由（登录、健康检查） */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = "roles";
/** 限定允许访问的角色代码，如 @Roles("ADMIN") */
export const Roles = (...codes: string[]) => SetMetadata(ROLES_KEY, codes);

/** 注入当前登录用户（JWT 载荷） */
export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): JwtPayload | undefined =>
    context.switchToHttp().getRequest().user,
);
