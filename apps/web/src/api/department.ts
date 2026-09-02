import type {
  ActiveHandoffVO,
  CreateLeaveInput,
  DepartmentOverviewVO,
  DonePeriod,
  HandoffCandidateVO,
  LeaveRecordVO,
} from "@bv/shared";
import { http } from "./http";

export async function fetchDepartmentOverview(
  start: string,
  end: string,
  donePeriod: DonePeriod = "today",
): Promise<DepartmentOverviewVO> {
  const { data } = await http.get<DepartmentOverviewVO>("/department/overview", {
    params: { start, end, done_period: donePeriod },
  });
  return data;
}

export async function createLeave(input: CreateLeaveInput): Promise<LeaveRecordVO> {
  const { data } = await http.post<LeaveRecordVO>("/department/leaves", input);
  return data;
}

/** 接手人候选：系统全部启用账号（含 Admin） */
export async function fetchHandoffCandidates(): Promise<HandoffCandidateVO[]> {
  const { data } = await http.get<HandoffCandidateVO[]>("/department/handoff-candidates");
  return data;
}

/** 指定接手人：接手人在请假区间内获得请假人岗位的待办与操作权限 */
export async function markLeaveHandoff(id: string, targetUserId: string): Promise<LeaveRecordVO> {
  const { data } = await http.post<LeaveRecordVO>(`/department/leaves/${id}/handoff`, {
    target_user_id: targetUserId,
  });
  return data;
}

/** 撤销交接（代班权限立即失效） */
export async function revokeLeaveHandoff(id: string): Promise<LeaveRecordVO> {
  const { data } = await http.delete<LeaveRecordVO>(`/department/leaves/${id}/handoff`);
  return data;
}

/** 我的代班：任意角色查自己当前生效的代班（工作台提示条 / 前端可见范围） */
export async function fetchMyHandoffs(): Promise<ActiveHandoffVO[]> {
  const { data } = await http.get<ActiveHandoffVO[]>("/department/my-handoffs");
  return data;
}

export async function cancelLeave(id: string): Promise<void> {
  await http.delete(`/department/leaves/${id}`);
}
