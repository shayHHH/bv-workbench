import type {
  CreateRoleInput,
  CreateUserInput,
  RoleVO,
  UpdateUserInput,
  UserVO,
} from "@bv/shared";
import { http } from "./http";

export async function fetchUsers(): Promise<UserVO[]> {
  const { data } = await http.get<UserVO[]>("/users");
  return data;
}

export async function createUser(input: CreateUserInput): Promise<UserVO> {
  const { data } = await http.post<UserVO>("/users", input);
  return data;
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<UserVO> {
  const { data } = await http.patch<UserVO>(`/users/${id}`, input);
  return data;
}

export async function resetUserPassword(id: string, password: string): Promise<void> {
  await http.post(`/users/${id}/reset-password`, { password });
}

export async function deleteUser(id: string): Promise<void> {
  await http.delete(`/users/${id}`);
}

export async function fetchRoles(): Promise<RoleVO[]> {
  const { data } = await http.get<RoleVO[]>("/roles");
  return data;
}

export async function createRole(input: CreateRoleInput): Promise<RoleVO> {
  const { data } = await http.post<RoleVO>("/roles", input);
  return data;
}

export async function deleteRole(id: string): Promise<void> {
  await http.delete(`/roles/${id}`);
}
