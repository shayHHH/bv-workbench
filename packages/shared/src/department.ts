/**
 * 部门管理域共享定义（运营经理：员工出勤、请假登记与任务交接）。
 * 员工名单与任务统计关联系统用户（users），不使用演示种子数据；
 * 请假记录为手工登记，正式审批以第三方 OA 为准，这里只服务内部排班与交接。
 */

/** 请假 / 不可用类型 */
export const LeaveType = {
  ANNUAL: "ANNUAL",
  SICK: "SICK",
  PERSONAL: "PERSONAL",
  REST: "REST",
  OUTING: "OUTING",
  TRAINING: "TRAINING",
  OTHER: "OTHER",
} as const;
export type LeaveType = (typeof LeaveType)[keyof typeof LeaveType];

export const LeaveTypeLabel: Record<LeaveType, string> = {
  ANNUAL: "年假",
  SICK: "病假",
  PERSONAL: "事假",
  REST: "调休",
  OUTING: "外出",
  TRAINING: "培训",
  OTHER: "其他",
};

/** 时间段：全天 / 上午 / 下午 / 自定义时段 */
export const LeavePart = {
  FULL_DAY: "FULL_DAY",
  MORNING: "MORNING",
  AFTERNOON: "AFTERNOON",
  CUSTOM: "CUSTOM",
} as const;
export type LeavePart = (typeof LeavePart)[keyof typeof LeavePart];

export const LeavePartLabel: Record<LeavePart, string> = {
  FULL_DAY: "全天",
  MORNING: "上午",
  AFTERNOON: "下午",
  CUSTOM: "自定义时段",
};

/** 各时间段默认起止时间（HH:mm） */
export const LEAVE_PART_DEFAULT_TIMES: Record<LeavePart, { start: string; end: string }> = {
  FULL_DAY: { start: "09:00", end: "18:00" },
  MORNING: { start: "09:00", end: "12:00" },
  AFTERNOON: { start: "13:00", end: "18:00" },
  CUSTOM: { start: "10:00", end: "16:00" },
};

/** 角色 → 主要任务描述（员工概览「主要任务」列） */
export const ROLE_FOCUS: Record<string, string> = {
  AGENT: "交易订单、材料上传",
  OPS: "出款审核、异常处理",
  COMPLIANCE: "合规审核、KYC 结论",
  FINANCE: "入款登记、每日对账",
  PAYOUT: "出款执行、回单上传",
  WALLET: "链上出入款登记",
  MANAGER: "运营调度、异常监控",
};

/** 「已处理」统计范围（员工概览列可切换） */
export const DONE_PERIODS = ["today", "week", "month", "quarter", "year"] as const;
export type DonePeriod = (typeof DONE_PERIODS)[number];

/** 部门成员（来自系统用户，附实时任务统计） */
export interface DepartmentMemberVO {
  user_id: string;
  username: string;
  display_name: string;
  title: string | null;
  role_code: string;
  role_name: string;
  /** 今日已处理：完成订单 + 出具合规结论 + 出款/审核登记 */
  today_done: number;
  /** 所选统计范围内已处理（done_period=today 时等于 today_done） */
  period_done: number;
  /** 待处理：名下进行中订单 + 待补件/草稿申请 + 分配到的待审核案件等 */
  pending: number;
  last_login_at: string | null;
}

/** 请假 / 不可用记录 */
export interface LeaveRecordVO {
  id: string;
  leave_no: string;
  user_id: string;
  user_name: string;
  role_name: string;
  leave_type: LeaveType;
  part: LeavePart;
  /** YYYY-MM-DD */
  start_date: string;
  end_date: string;
  /** HH:mm */
  start_time: string;
  end_time: string;
  note: string | null;
  source: string;
  /** 登记时勾选「需要任务交接提醒」 */
  handoff: boolean;
  handoff_done: boolean;
  handoff_target: string | null;
  handoff_at: string | null;
  registered_by: string;
  registered_at: string;
}

export interface DepartmentOverviewVO {
  members: DepartmentMemberVO[];
  leaves: LeaveRecordVO[];
}

export interface CreateLeaveInput {
  user_id: string;
  leave_type: LeaveType;
  part: LeavePart;
  start_date: string;
  end_date: string;
  start_time?: string;
  end_time?: string;
  note?: string | null;
  handoff?: boolean;
}

/** 请假记录的时间段文案：全天 / 上午 09:00-12:00 / … */
export function leaveTimeLabel(leave: Pick<LeaveRecordVO, "part" | "start_time" | "end_time">): string {
  if (leave.part === LeavePart.FULL_DAY) return "全天";
  const start = leave.start_time || LEAVE_PART_DEFAULT_TIMES[leave.part].start;
  const end = leave.end_time || LEAVE_PART_DEFAULT_TIMES[leave.part].end;
  return `${start}-${end}`;
}

/** 完整时间描述：2026-08-26 至 2026-08-27 · 全天 */
export function leaveFullLabel(
  leave: Pick<LeaveRecordVO, "part" | "start_time" | "end_time" | "start_date" | "end_date">,
): string {
  const dates = `${leave.start_date}${leave.end_date !== leave.start_date ? ` 至 ${leave.end_date}` : ""}`;
  const part = leave.part === LeavePart.FULL_DAY ? "全天" : `${LeavePartLabel[leave.part]} ${leaveTimeLabel(leave)}`;
  return `${dates} · ${part}`;
}

/** 该记录是否覆盖某天（YYYY-MM-DD 字符串比较） */
export function leaveCoversDay(
  leave: Pick<LeaveRecordVO, "start_date" | "end_date">,
  iso: string,
): boolean {
  return leave.start_date <= iso && leave.end_date >= iso;
}
