/** JWT 载荷；经 JwtAuthGuard 验证后挂到 request.user */
export interface JwtPayload {
  /** 用户 _id 字符串 */
  sub: string;
  username: string;
  role_code: string;
  display_name: string;
}
