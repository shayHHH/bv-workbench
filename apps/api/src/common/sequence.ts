import { Connection } from "mongoose";

/**
 * 业务单号序列：counters 集合按 key 原子自增（{_id: key, seq}）。
 * 产出形如 APP-20260826-003；按天分桶，重启/并发安全。
 */
export async function nextBusinessNo(
  connection: Connection,
  prefix: string,
  date = new Date(),
): Promise<string> {
  const day = date.toISOString().slice(0, 10).replace(/-/g, "");
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
