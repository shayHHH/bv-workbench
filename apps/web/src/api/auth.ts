import type { LoginResult, UserVO } from "@bv/shared";
import { http } from "./http";

export async function login(username: string, password: string): Promise<LoginResult> {
  const { data } = await http.post<LoginResult>("/auth/login", { username, password });
  return data;
}

/** 自助修改个人资料（入参类型暂放本地，待与团队统一抽入 @bv/shared） */
export interface UpdateProfileInput {
  display_name?: string;
  title?: string | null;
}

export async function updateProfile(input: UpdateProfileInput): Promise<UserVO> {
  const { data } = await http.patch<UserVO>("/auth/profile", input);
  return data;
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await http.post("/auth/change-password", {
    old_password: oldPassword,
    new_password: newPassword,
  });
}
