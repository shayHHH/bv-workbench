import { Connection } from "mongoose";

/**
 * 业务单号序列：counters 集合按 key 原子自增（{_id: key, seq}）。
 * 产出形如 APP-20260827-003；按天分桶，重启/并发安全。
 * 日期取服务器本地时区（部署容器需正确设置 TZ），避免 UTC 导致
 * 本地 00:00-08:00 建单的编号日期与界面创建时间差一天。
 */
export async function nextBusinessNo(
  connection: Connection,
  prefix: string,
  date = new Date(),
): Promise<string> {
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
  const result = await connection
    .collection<{ _id: string; seq: number }>("counters")
    .findOneAndUpdate(
      { _id: `${prefix}_${day}` },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" },
    );
  const seq = result?.seq ?? 1;
  return `${prefix}-${day}-${String(seq).padStart(3, "0")}`;
}
