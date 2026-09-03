import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { AccessStatus, CustomerEventType } from "@bv/shared";
import { Model } from "mongoose";
import { CustomerService } from "../customer/customer.service";
import { AccessApplication, AccessApplicationDocument } from "./access-application.schema";

const TICK_MS = 10 * 60 * 1000;

/** 催办档位：距截止不足 7/3/1 天各推一次（系统内闭环：申请时间线 + 客户动态） */
const REMINDERS: Array<{ key: string; ms: number; label: string }> = [
  { key: "7d", ms: 7 * 86_400_000, label: "7 天" },
  { key: "3d", ms: 3 * 86_400_000, label: "3 天" },
  { key: "1d", ms: 1 * 86_400_000, label: "1 天" },
];

function fmtDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

/**
 * 条件性放行的超时熔断（需求 §4）：每 10 分钟扫描附条件通过的申请，
 * 7/3/1 天催办留痕；超过截止时间自动转「逾期受限」（订单 KYC 徽标随之不可交易），
 * 直至交易员补齐材料、合规复核通过。
 */
@Injectable()
export class DeferralScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("DeferralScheduler");
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectModel(AccessApplication.name)
    private readonly applicationModel: Model<AccessApplicationDocument>,
    private readonly customerService: CustomerService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    try {
      const docs = await this.applicationModel.find({
        is_deleted: false,
        status: AccessStatus.APPROVED_CONDITIONAL,
        deferral: { $ne: null },
      });
      const now = Date.now();
      for (const doc of docs) {
        const deferral = doc.deferral;
        if (!deferral) continue;
        const dueMs = new Date(deferral.due_at).getTime();
        if (dueMs <= now) {
          await this.markOverdue(doc);
          continue;
        }
        const reminded = new Set(deferral.reminded ?? []);
        const pending = REMINDERS.filter(r => dueMs - now <= r.ms && !reminded.has(r.key));
        if (!pending.length) continue;
        for (const reminder of pending) reminded.add(reminder.key);
        const tightest = pending[pending.length - 1];
        doc.deferral = { ...deferral, reminded: [...reminded] };
        doc.timeline = [
          ...doc.timeline,
          {
            at: new Date(),
            by_name: null,
            action: `延期补件催办：距截止不足 ${tightest.label}`,
            from_status: doc.status,
            to_status: doc.status,
            note: `截止 ${fmtDate(new Date(deferral.due_at))}，待补齐：${deferral.missing_item_names.join("、")}`,
          },
        ];
        await doc.save();
        await this.customerService.recordEvent(
          doc.customer_id,
          CustomerEventType.ACCESS,
          "延期补件催办",
          `申请 ${doc.application_no} 距补件截止不足 ${tightest.label}（截止 ${fmtDate(new Date(deferral.due_at))}），待补齐：${deferral.missing_item_names.join("、")}`,
        );
      }
    } catch (error) {
      this.logger.warn(`延期补件巡检失败：${String(error)}`);
    }
  }

  private async markOverdue(doc: AccessApplicationDocument): Promise<void> {
    const deferral = doc.deferral;
    if (!deferral) return;
    const fromStatus = doc.status;
    doc.status = AccessStatus.DEFERRAL_OVERDUE;
    doc.deferral = { ...deferral, overdue_at: new Date() };
    doc.timeline = [
      ...doc.timeline,
      {
        at: new Date(),
        by_name: null,
        action: "延期补件逾期，业务受限",
        from_status: fromStatus,
        to_status: doc.status,
        note: `截止 ${fmtDate(new Date(deferral.due_at))} 未补齐：${deferral.missing_item_names.join("、")}；补齐并经合规复核后恢复`,
      },
    ];
    await doc.save();
    await this.customerService.recordEvent(
      doc.customer_id,
      CustomerEventType.ACCESS,
      "延期补件逾期",
      `申请 ${doc.application_no} 超过补件截止时间（${fmtDate(new Date(deferral.due_at))}）仍未补齐：${deferral.missing_item_names.join("、")}，该业务类型转「逾期受限」，直至合规重新复核`,
    );
  }
}
