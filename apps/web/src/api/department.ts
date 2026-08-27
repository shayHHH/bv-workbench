import type { CreateLeaveInput, DepartmentOverviewVO, LeaveRecordVO } from "@bv/shared";
import { http } from "./http";

export async function fetchDepartmentOverview(start: string, end: string): Promise<DepartmentOverviewVO> {
  const { data } = await http.get<DepartmentOverviewVO>("/department/overview", { params: { start, end } });
  return data;
}

export async function createLeave(input: CreateLeaveInput): Promise<LeaveRecordVO> {
  const { data } = await http.post<LeaveRecordVO>("/department/leaves", input);
  return data;
}

export async function markLeaveHandoff(id: string, targetName?: string | null): Promise<LeaveRecordVO> {
  const { data } = await http.post<LeaveRecordVO>(`/department/leaves/${id}/handoff`, {
    target_name: targetName ?? null,
  });
  return data;
}

export async function cancelLeave(id: string): Promise<void> {
  await http.delete(`/department/leaves/${id}`);
}
