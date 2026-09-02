<script setup lang="ts">
import {
  AccessStatus,
  ReviewAuditTypeLabel,
  TradeOrderStatus,
  TradeOrderStatusLabel,
  type AccessApplicationVO,
  type DepartmentOverviewVO,
  type OrderListStatsVO,
  type ReviewCaseVO,
  type ReviewStatsVO,
  type TradeOrderVO,
} from "@bv/shared";
import { ArrowDown, ArrowUp, Grid, Operation, Refresh, Setting } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { fetchApplications, fetchReviewCases, fetchReviewStats } from "@/api/access";
import { fetchDepartmentOverview } from "@/api/department";
import { fetchOrders } from "@/api/order";
import { localizeText } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { formatRelative } from "@/utils/format";

type RoleKey =
  | "AGENT"
  | "MANAGER"
  | "OPS"
  | "FINANCE"
  | "PAYOUT"
  | "WALLET"
  | "COMPLIANCE"
  | "ADMIN"
  | "UNKNOWN";

type ModuleKey = "metrics" | "todo" | "team" | "review" | "exceptions" | "recent" | "quick";

interface MetricCard {
  label: string;
  value: number | string;
  hint: string;
  tone?: "orange" | "blue" | "green" | "red" | "gray";
}

interface DashboardRow {
  key: string;
  title: string;
  meta: string;
  status: string;
  tone?: "success" | "warning" | "danger" | "info";
  action: string;
  run: () => void;
}

interface QuickAction {
  label: string;
  desc: string;
  route: string;
}

interface PrimaryAction {
  label: string;
  route: string;
}

interface ModuleConfig {
  key: ModuleKey;
  label: string;
  enabled: boolean;
}

const ACTIVE_ORDER_STATUSES = [
  TradeOrderStatus.PENDING_KYC,
  TradeOrderStatus.AWAITING_INFLOW,
  TradeOrderStatus.AWAITING_DISPATCH,
  TradeOrderStatus.DISPATCH_REVIEW,
  TradeOrderStatus.AWAITING_PAYOUT,
].join(",");
const roleOrder: RoleKey[] = [
  "AGENT",
  "MANAGER",
  "OPS",
  "FINANCE",
  "PAYOUT",
  "WALLET",
  "COMPLIANCE",
  "ADMIN",
];
const complianceRoles = new Set(["COMPLIANCE", "RISK_OFFICER"]);
const orderRoles = new Set(["AGENT", "MANAGER", "OPS", "FINANCE", "PAYOUT", "WALLET", "ADMIN"]);

const router = useRouter();
const auth = useAuthStore();

const loading = ref(false);
const configVisible = ref(false);
const moduleConfig = ref<ModuleConfig[]>([]);
const orderMine = ref<{ items: TradeOrderVO[]; total: number; stats: OrderListStatsVO | null }>({
  items: [],
  total: 0,
  stats: null,
});
const orderActive = ref<TradeOrderVO[]>([]);
const orderRecent = ref<TradeOrderVO[]>([]);
const orderExceptions = ref<TradeOrderVO[]>([]);
const supplementApps = ref<AccessApplicationVO[]>([]);
const supplementTotal = ref(0);
const reviewStats = ref<ReviewStatsVO | null>(null);
const reviewPending = ref<ReviewCaseVO[]>([]);
const department = ref<DepartmentOverviewVO | null>(null);

const roleKey = computed<RoleKey>(() => {
  if (complianceRoles.has(auth.roleCode)) return "COMPLIANCE";
  if (roleOrder.includes(auth.roleCode as RoleKey)) return auth.roleCode as RoleKey;
  return "UNKNOWN";
});

const roleDisplay = computed(() => localizeText(auth.user?.role?.name || auth.roleCode || "工作台"));
const roleCodeDisplay = computed(() => roleKey.value.replace("_", " "));
const userName = computed(() => auth.user?.display_name || auth.user?.username || "");

const roleIntro = computed(() => {
  const map: Record<RoleKey, { title: string; subtitle: string }> = {
    AGENT: {
      title: "初级交易员工作台",
      subtitle: "聚焦客户 KYC、材料补件、待出款排单和交易跟进。",
    },
    MANAGER: {
      title: "运营经理工作台",
      subtitle: "总览订单状态、异常分布与团队可用性，用于排班和交接安排。",
    },
    OPS: {
      title: "高级交易员工作台",
      subtitle: "聚焦排单审核、异常复核和高优先级订单推进。",
    },
    FINANCE: {
      title: "财务工作台",
      subtitle: "聚焦待客户入款、入款确认和资金异常。",
    },
    PAYOUT: {
      title: "出款员工作台",
      subtitle: "聚焦待出款执行、回单登记和排单退回处理。",
    },
    WALLET: {
      title: "钱包运营工作台",
      subtitle: "聚焦链上入款、链上出款与交易哈希登记。",
    },
    COMPLIANCE: {
      title: "合规官工作台",
      subtitle: "聚焦待审核案件、驳回重审、审核效率和近期结论。",
    },
    ADMIN: {
      title: "系统管理员工作台",
      subtitle: "总览系统关键队列、审核配置和用户管理入口。",
    },
    UNKNOWN: {
      title: "工作台",
      subtitle: "当前角色暂未配置专属数据看板。",
    },
  };
  return map[roleKey.value];
});

const defaultModules = computed<ModuleConfig[]>(() => {
  const base: ModuleConfig[] = [
    { key: "metrics", label: "数据看板", enabled: true },
    { key: "todo", label: "待办事项", enabled: true },
    { key: "exceptions", label: "异常关注", enabled: true },
    { key: "recent", label: "近期动态", enabled: true },
    { key: "quick", label: "快捷入口", enabled: true },
  ];
  if (roleKey.value === "MANAGER") {
    base.splice(2, 0, { key: "team", label: "团队可用性", enabled: true });
  }
  if (roleKey.value === "COMPLIANCE" || roleKey.value === "ADMIN") {
    base.splice(2, 0, { key: "review", label: "合规审核", enabled: true });
  }
  return base;
});

const visibleModules = computed(() => moduleConfig.value.filter(item => item.enabled));
const stats = computed(() => orderMine.value.stats);
const byStatus = computed(() => stats.value?.by_status || {});

function hasModule(key: ModuleKey): boolean {
  return visibleModules.value.some(item => item.key === key);
}

const dashboardMetrics = computed<MetricCard[]>(() => {
  const statusCount = (...statuses: TradeOrderStatus[]) =>
    statuses.reduce((sum, status) => sum + (byStatus.value[status] || 0), 0);
  const review = reviewStats.value;
  const oldest = review?.oldest_pending_submitted_at
    ? formatRelative(review.oldest_pending_submitted_at)
    : "暂无";
  const map: Record<RoleKey, MetricCard[]> = {
    AGENT: [
      { label: "待我处理", value: stats.value?.todo ?? 0, hint: "待KYC / 待出款排单", tone: "orange" },
      { label: "待KYC", value: statusCount(TradeOrderStatus.PENDING_KYC), hint: "等待业务准入", tone: "blue" },
      {
        label: "待出款排单",
        value: statusCount(TradeOrderStatus.AWAITING_DISPATCH),
        hint: "需发起排单",
        tone: "green",
      },
      { label: "待补件", value: supplementTotal.value, hint: "合规驳回后需补充材料", tone: "red" },
    ],
    MANAGER: [
      { label: "进行中订单", value: stats.value?.active ?? 0, hint: "未完成 / 未取消", tone: "blue" },
      { label: "异常订单", value: stats.value?.exceptions ?? 0, hint: "需协调处理", tone: "red" },
      {
        label: "资金执行阶段",
        value: statusCount(
          TradeOrderStatus.AWAITING_DISPATCH,
          TradeOrderStatus.DISPATCH_REVIEW,
          TradeOrderStatus.AWAITING_PAYOUT,
        ),
        hint: "排单 / 审核 / 出款",
        tone: "orange",
      },
      {
        label: "待交接任务",
        value: department.value?.leaves.filter(item => item.handoff && !item.handoff_done).length ?? 0,
        hint: "请假员工名下待办",
        tone: "gray",
      },
    ],
    OPS: [
      { label: "待排单审核", value: stats.value?.todo ?? 0, hint: "出款审核中", tone: "orange" },
      {
        label: "排单审核中",
        value: statusCount(TradeOrderStatus.DISPATCH_REVIEW),
        hint: "待高级交易员审核",
        tone: "blue",
      },
      { label: "异常订单", value: stats.value?.exceptions ?? 0, hint: "金额 / 规则 / 排单异常", tone: "red" },
      { label: "进行中订单", value: stats.value?.active ?? 0, hint: "全链路未完结", tone: "green" },
    ],
    FINANCE: [
      { label: "待客户入款", value: stats.value?.todo ?? 0, hint: "需登记或确认入款", tone: "orange" },
      { label: "银行 / 现金入款", value: stats.value?.inflow_fiat ?? 0, hint: "财务处理", tone: "blue" },
      { label: "链上入款", value: stats.value?.inflow_chain ?? 0, hint: "钱包运营协同", tone: "green" },
      { label: "入款退回", value: stats.value?.payment_rejected ?? 0, hint: "需重新处理", tone: "red" },
    ],
    PAYOUT: [
      { label: "待出款执行", value: stats.value?.todo ?? 0, hint: "需出款并上传回单", tone: "orange" },
      { label: "银行 / 现金出款", value: stats.value?.outflow_fiat ?? 0, hint: "出款员处理", tone: "blue" },
      { label: "链上出款", value: stats.value?.outflow_chain ?? 0, hint: "钱包运营协同", tone: "green" },
      { label: "排单退回", value: stats.value?.dispatch_rejected ?? 0, hint: "需查看原因", tone: "red" },
    ],
    WALLET: [
      { label: "待链上处理", value: stats.value?.todo ?? 0, hint: "链上入款 / 出款", tone: "orange" },
      { label: "链上入款", value: stats.value?.inflow_chain ?? 0, hint: "登记地址和到账", tone: "blue" },
      { label: "链上出款", value: stats.value?.outflow_chain ?? 0, hint: "登记哈希与回单", tone: "green" },
      { label: "链上异常", value: stats.value?.exceptions ?? 0, hint: "需协同处理", tone: "red" },
    ],
    COMPLIANCE: [
      { label: "待合规审核", value: review?.pending_total ?? 0, hint: "待处理工单", tone: "orange" },
      { label: "驳回重审", value: review?.pending_resubmit ?? 0, hint: "补件后重新提交", tone: "blue" },
      { label: "今日通过", value: review?.approved_today ?? 0, hint: "已出具通过结论", tone: "green" },
      { label: "等待最久", value: oldest, hint: "最早提交的待审工单", tone: "red" },
    ],
    ADMIN: [
      { label: "进行中订单", value: stats.value?.active ?? 0, hint: "订单全局队列", tone: "blue" },
      { label: "异常订单", value: stats.value?.exceptions ?? 0, hint: "全局异常", tone: "red" },
      { label: "待合规审核", value: review?.pending_total ?? 0, hint: "审核队列", tone: "orange" },
      { label: "已完成订单", value: statusCount(TradeOrderStatus.COMPLETED), hint: "历史完成", tone: "green" },
    ],
    UNKNOWN: [
      { label: "待处理", value: 0, hint: "当前角色未配置", tone: "gray" },
      { label: "进行中", value: 0, hint: "当前角色未配置", tone: "gray" },
      { label: "已完成", value: 0, hint: "当前角色未配置", tone: "gray" },
      { label: "异常", value: 0, hint: "当前角色未配置", tone: "gray" },
    ],
  };
  return map[roleKey.value];
});

const quickActions = computed<QuickAction[]>(() => {
  const map: Record<RoleKey, QuickAction[]> = {
    AGENT: [
      { label: "新建订单", desc: "录入交易与客户信息", route: "/orders" },
      { label: "材料上传", desc: "提交 KYC 材料", route: "/access/materials" },
      { label: "审核跟踪", desc: "查看补件与审核状态", route: "/access/documents" },
      { label: "快速报价", desc: "生成客户报价", route: "/quote/quick" },
    ],
    MANAGER: [
      { label: "交易订单总览", desc: "查看全量订单和异常", route: "/orders" },
      { label: "部门管理", desc: "查看排班和交接", route: "/department" },
      { label: "客户管理", desc: "查看客户主档", route: "/customers" },
    ],
    OPS: [
      { label: "排单审核", desc: "处理出款审核中订单", route: "/orders" },
      { label: "批量报价", desc: "管理报价组", route: "/quote/batch" },
      { label: "材料上传", desc: "协助准入材料", route: "/access/materials" },
      { label: "审核跟踪", desc: "查看审核工单", route: "/access/documents" },
    ],
    FINANCE: [
      { label: "入款登记", desc: "确认客户入款", route: "/orders" },
      { label: "客户管理", desc: "核对客户信息", route: "/customers" },
    ],
    PAYOUT: [
      { label: "出款执行", desc: "登记出款和回单", route: "/orders" },
      { label: "客户管理", desc: "核对收付款信息", route: "/customers" },
    ],
    WALLET: [
      { label: "链上任务", desc: "处理链上出入款", route: "/orders" },
      { label: "客户管理", desc: "核对链上相关资料", route: "/customers" },
    ],
    COMPLIANCE: [
      { label: "审核队列", desc: "处理待审核案件", route: "/compliance/review" },
      { label: "KYC 配置", desc: "维护材料清单", route: "/compliance/kyc-config" },
      { label: "审计日志", desc: "追踪审核动作", route: "/compliance/audit" },
    ],
    ADMIN: [
      { label: "用户管理", desc: "维护账号和角色", route: "/admin/users" },
      { label: "审核分配", desc: "配置合规分派", route: "/admin/review-assignment" },
      { label: "KYC 配置", desc: "维护材料规则", route: "/compliance/kyc-config" },
      { label: "审计日志", desc: "查看系统操作", route: "/compliance/audit" },
    ],
    UNKNOWN: [{ label: "客户管理", desc: "查看客户信息", route: "/customers" }],
  };
  return map[roleKey.value];
});

const primaryAction = computed<PrimaryAction>(() => {
  const firstAction = quickActions.value[0];
  const fallback = { label: "进入客户管理", route: "/customers" };
  return firstAction ? { label: firstAction.label, route: firstAction.route } : fallback;
});

const todoRows = computed<DashboardRow[]>(() => {
  if (roleKey.value === "COMPLIANCE") return reviewRows(reviewPending.value, "去审核");
  if (roleKey.value === "ADMIN") {
    return [
      ...reviewRows(reviewPending.value, "去审核"),
      ...orderRows(orderMine.value.items, "查看"),
    ].slice(0, 6);
  }
  const rows = orderRows(orderMine.value.items, "处理");
  if (roleKey.value === "AGENT" || roleKey.value === "OPS") {
    rows.push(...supplementRows(supplementApps.value));
  }
  return rows.slice(0, 6);
});

const exceptionRows = computed(() => orderRows(orderExceptions.value, "查看"));
const recentRows = computed(() => {
  if (roleKey.value === "COMPLIANCE") return reviewRows(reviewPending.value, "查看");
  return orderRows(orderRecent.value, "查看");
});
const reviewRowsComputed = computed(() => reviewRows(reviewPending.value, "去审核"));
const teamRows = computed<DashboardRow[]>(() => {
  const members = [...(department.value?.members || [])].sort((a, b) => b.pending - a.pending).slice(0, 6);
  return members.map(member => ({
    key: member.user_id,
    title: member.display_name || member.username,
    meta: `${localizeText(member.role_name)} · 待处理 ${member.pending} · 已处理 ${member.period_done}`,
    status: member.last_login_at ? `最近登录 ${formatRelative(member.last_login_at)}` : "暂无登录记录",
    tone: member.pending > 0 ? "warning" : "success",
    action: "查看排班",
    run: () => router.push("/department"),
  }));
});

function orderRows(rows: TradeOrderVO[], action: string): DashboardRow[] {
  return rows.slice(0, 8).map(order => ({
    key: order.id,
    title: `${order.order_no} · ${order.customer_name}`,
    meta: `${order.trade_type} · ${order.sell_currency} ${formatAmount(order.sell_amount)} → ${order.buy_currency} ${formatAmount(order.buy_amount)}`,
    status: TradeOrderStatusLabel[order.status],
    tone: order.exception ? "danger" : order.status === TradeOrderStatus.COMPLETED ? "success" : "info",
    action,
    run: () => router.push({ path: "/orders", query: { order: order.id } }),
  }));
}

function supplementRows(rows: AccessApplicationVO[]): DashboardRow[] {
  return rows.slice(0, 4).map(item => ({
    key: item.id,
    title: `${item.application_no} · ${item.customer_snapshot.name}`,
    meta: `${item.scenario_name || "业务准入"} · ${item.channel_name || item.channel_code || "未选渠道"}`,
    status: "待补件",
    tone: "warning",
    action: "补件",
    run: () => router.push(`/access/documents/${item.id}/supplement`),
  }));
}

function reviewRows(rows: ReviewCaseVO[], action: string): DashboardRow[] {
  return rows.slice(0, 8).map(item => ({
    key: item.id,
    title: `${item.case_no} · ${item.customer_name}`,
    meta: `${item.scenario_name || "业务准入"} · ${item.channel_name || item.channel_code || "未选渠道"} · ${ReviewAuditTypeLabel[item.audit_type]}`,
    status: "待审核",
    tone: item.audit_type === "RESUBMIT" ? "warning" : "info",
    action,
    run: () => router.push(`/compliance/review/${item.id}`),
  }));
}

function formatAmount(value: number): string {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function moduleLabel(key: ModuleKey): string {
  return defaultModules.value.find(item => item.key === key)?.label || key;
}

function emptyText(key: ModuleKey): string {
  const map: Record<ModuleKey, string> = {
    metrics: "暂无看板数据",
    todo: "当前没有需要你处理的事项",
    team: "暂无团队数据",
    review: "暂无待审核案件",
    exceptions: "当前没有异常订单",
    recent: "暂无近期动态",
    quick: "暂无快捷入口",
  };
  return map[key];
}

function configKey() {
  return `bv-dashboard-config-${roleKey.value}`;
}

function syncModuleConfig() {
  const defaults = defaultModules.value;
  let saved: ModuleConfig[] = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(configKey()) || "[]");
    if (Array.isArray(parsed)) saved = parsed;
  } catch {
    saved = [];
  }
  const validKeys = new Set(defaults.map(item => item.key));
  const merged = saved
    .filter(item => validKeys.has(item.key))
    .map(item => ({
      ...defaults.find(def => def.key === item.key)!,
      enabled: item.enabled !== false,
    }));
  defaults.forEach(item => {
    if (!merged.some(savedItem => savedItem.key === item.key)) merged.push({ ...item });
  });
  moduleConfig.value = merged;
}

function saveModuleConfig() {
  localStorage.setItem(configKey(), JSON.stringify(moduleConfig.value));
  configVisible.value = false;
  ElMessage.success("工作台配置已保存");
}

function resetModuleConfig() {
  localStorage.removeItem(configKey());
  syncModuleConfig();
  ElMessage.success("已恢复默认工作台");
}

function moveModule(index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= moduleConfig.value.length) return;
  const list = [...moduleConfig.value];
  const current = list[index];
  list[index] = list[nextIndex];
  list[nextIndex] = current;
  moduleConfig.value = list;
}

function todayIso() {
  const now = new Date();
  const mm = `${now.getMonth() + 1}`.padStart(2, "0");
  const dd = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

async function loadDashboard() {
  loading.value = true;
  orderMine.value = { items: [], total: 0, stats: null };
  orderActive.value = [];
  orderRecent.value = [];
  orderExceptions.value = [];
  supplementApps.value = [];
  supplementTotal.value = 0;
  reviewStats.value = null;
  reviewPending.value = [];
  department.value = null;

  const tasks: Promise<unknown>[] = [];
  if (orderRoles.has(roleKey.value)) {
    tasks.push(
      fetchOrders({ scope: "mine", page: 1, page_size: 8 }).then(page => {
        orderMine.value = { items: page.items, total: page.total, stats: page.stats };
      }),
    );
    tasks.push(
      fetchOrders({ status: ACTIVE_ORDER_STATUSES, page: 1, page_size: 8 }).then(page => {
        orderActive.value = page.items;
        if (!orderMine.value.stats) orderMine.value.stats = page.stats;
      }),
    );
    tasks.push(
      fetchOrders({ page: 1, page_size: 8 }).then(page => {
        orderRecent.value = page.items;
        if (!orderMine.value.stats) orderMine.value.stats = page.stats;
      }),
    );
    tasks.push(
      fetchOrders({ flag: "exception", page: 1, page_size: 6 }).then(page => {
        orderExceptions.value = page.items;
      }),
    );
  }

  if (roleKey.value === "AGENT" || roleKey.value === "OPS") {
    tasks.push(
      fetchApplications({ status: AccessStatus.SUPPLEMENT_REQUIRED, page: 1, page_size: 6 }).then(page => {
        supplementApps.value = page.items;
        supplementTotal.value = page.total;
      }),
    );
  }

  if (roleKey.value === "MANAGER") {
    const today = todayIso();
    tasks.push(fetchDepartmentOverview(today, today, "today").then(data => (department.value = data)));
  }

  if (roleKey.value === "COMPLIANCE" || roleKey.value === "ADMIN") {
    tasks.push(fetchReviewStats().then(data => (reviewStats.value = data)));
    tasks.push(
      fetchReviewCases({ status: "PENDING", page: 1, page_size: 8, sort_by: "submitted_at", sort_order: "asc" }).then(
        page => (reviewPending.value = page.items),
      ),
    );
  }

  const results = await Promise.allSettled(tasks);
  if (results.some(item => item.status === "rejected")) {
    ElMessage.warning("部分工作台数据加载失败，请确认后端服务状态");
  }
  loading.value = false;
}

watch(roleKey, () => {
  syncModuleConfig();
  void loadDashboard();
});

onMounted(() => {
  syncModuleConfig();
  void loadDashboard();
});
</script>

<template>
  <div v-loading="loading" class="dashboard-page">
    <header class="workbench-hero">
      <div class="hero-glow"></div>
      <div class="hero-copy">
        <div class="hero-meta">
          <span>{{ roleCodeDisplay }}</span>
          <i></i>
          <em>实时监控与协同系统</em>
        </div>
        <h1>{{ roleIntro.title }}</h1>
        <p>{{ userName ? `欢迎，${userName}。` : "" }}{{ roleIntro.subtitle }}</p>
      </div>
      <div class="hero-side">
        <div class="hero-chip">
          <span>当前角色</span>
          <strong>{{ roleDisplay }}</strong>
        </div>
        <div class="hero-chip">
          <span>模块</span>
          <strong>{{ visibleModules.length }} / {{ moduleConfig.length }}</strong>
        </div>
        <div class="hero-actions">
          <el-button class="icon-action" :icon="Refresh" @click="loadDashboard">刷新</el-button>
          <el-button class="icon-action" :icon="Setting" @click="configVisible = true">配置</el-button>
          <el-button class="primary-action" type="primary" @click="router.push(primaryAction.route)">
            {{ primaryAction.label }}
          </el-button>
        </div>
      </div>
    </header>

    <!-- 业务交接：代班期间本工作台的待办已并入被代班岗位 -->
    <div v-if="auth.handoffs.length" class="handoff-banner">
      <strong>代班中</strong>
      <span v-for="item in auth.handoffs" :key="item.leave_id">
        {{ item.from_user_name }}（{{ item.role_name }}）· 至 {{ item.end_date }}
      </span>
      <em>该岗位的待办与操作权限已并入你的工作台，交接结束后自动收回。</em>
    </div>

    <div v-if="hasModule('metrics')" class="metric-grid">
      <article v-for="metric in dashboardMetrics" :key="metric.label" class="metric-card" :class="metric.tone">
        <div class="metric-top">
          <span class="metric-label">{{ metric.label }}</span>
          <span class="metric-icon">
            <el-icon><Operation /></el-icon>
          </span>
        </div>
        <strong>{{ metric.value }}</strong>
        <div class="metric-foot">
          <span>{{ metric.hint }}</span>
          <em v-if="metric.tone === 'orange'">高优先级</em>
        </div>
      </article>
    </div>

    <el-card v-if="hasModule('todo')" class="work-panel primary-panel" shadow="never">
      <template #header>
        <div class="panel-heading">
          <div>
            <p>Next actions</p>
            <h2>待办事项</h2>
          </div>
          <span class="panel-count">{{ todoRows.length }}</span>
        </div>
      </template>
      <div v-if="todoRows.length" class="task-list">
        <button v-for="row in todoRows" :key="row.key" class="work-row" type="button" @click="row.run">
          <span class="task-mark" :class="row.tone">
            <el-icon><Operation /></el-icon>
          </span>
          <div class="task-body">
            <strong>{{ row.title }}</strong>
            <p>{{ row.meta }}</p>
          </div>
          <div class="row-tail">
            <el-tag :type="row.tone || 'info'" effect="light">{{ row.status }}</el-tag>
            <span class="row-action">{{ row.action }} →</span>
          </div>
        </button>
      </div>
      <div v-else class="panel-empty">{{ emptyText("todo") }}</div>
    </el-card>

    <section class="module-columns">
      <div class="module-stack">
        <el-card v-if="hasModule('team') && teamRows.length" class="work-panel" shadow="never">
          <template #header>
            <div class="panel-heading compact">
              <h2>团队可用性</h2>
              <span class="panel-count">{{ teamRows.length }}</span>
            </div>
          </template>
          <div class="compact-list">
            <button v-for="row in teamRows" :key="row.key" class="compact-row" type="button" @click="row.run">
              <div>
                <strong>{{ row.title }}</strong>
                <p>{{ row.meta }}</p>
              </div>
              <el-tag :type="row.tone || 'info'" effect="light">{{ row.status }}</el-tag>
            </button>
          </div>
        </el-card>

        <div v-if="hasModule('team') && !teamRows.length" class="soft-empty">
          暂无团队可用性数据
        </div>

        <el-card v-if="hasModule('review') && reviewRowsComputed.length" class="work-panel" shadow="never">
          <template #header>
            <div class="panel-heading compact">
              <h2>合规审核</h2>
              <span class="panel-count">{{ reviewRowsComputed.length }}</span>
            </div>
          </template>
          <div class="compact-list">
            <button v-for="row in reviewRowsComputed" :key="row.key" class="compact-row" type="button" @click="row.run">
              <div>
                <strong>{{ row.title }}</strong>
                <p>{{ row.meta }}</p>
              </div>
              <el-tag :type="row.tone || 'info'" effect="light">{{ row.status }}</el-tag>
            </button>
          </div>
        </el-card>

        <div v-if="hasModule('review') && !reviewRowsComputed.length" class="soft-empty">
          暂无待审核案件
        </div>

        <el-card v-if="hasModule('recent') && recentRows.length" class="work-panel" shadow="never">
          <template #header>
            <div class="panel-heading compact">
              <h2>近期动态</h2>
              <span class="panel-count">{{ recentRows.length }}</span>
            </div>
          </template>
          <div class="compact-list">
            <button v-for="row in recentRows" :key="row.key" class="compact-row" type="button" @click="row.run">
              <div>
                <strong>{{ row.title }}</strong>
                <p>{{ row.meta }}</p>
              </div>
              <el-tag :type="row.tone || 'info'" effect="light">{{ row.status }}</el-tag>
            </button>
          </div>
        </el-card>

        <div v-if="hasModule('recent') && !recentRows.length" class="soft-empty">
          暂无近期动态
        </div>
      </div>

      <aside class="module-stack">
        <el-card v-if="hasModule('exceptions') && exceptionRows.length" class="work-panel" shadow="never">
          <template #header>
            <div class="panel-heading compact danger-title">
              <h2>异常关注</h2>
              <span class="panel-count">{{ exceptionRows.length }}</span>
            </div>
          </template>
          <div class="compact-list">
            <button v-for="row in exceptionRows" :key="row.key" class="compact-row" type="button" @click="row.run">
              <div>
                <strong>{{ row.title }}</strong>
                <p>{{ row.meta }}</p>
              </div>
              <el-tag type="danger" effect="light">异常</el-tag>
            </button>
          </div>
        </el-card>

        <div v-if="hasModule('exceptions') && !exceptionRows.length" class="soft-empty danger-soft">
          当前没有异常订单
        </div>

        <el-card v-if="hasModule('quick')" class="work-panel quick-panel" shadow="never">
          <template #header>
            <div class="panel-heading compact">
              <h2>快捷入口</h2>
            </div>
          </template>
          <div v-if="quickActions.length" class="quick-grid">
            <button
              v-for="action in quickActions"
              :key="action.route"
              class="quick-action"
              type="button"
              @click="router.push(action.route)"
            >
              <span class="quick-icon">
                <el-icon><Grid /></el-icon>
              </span>
              <strong>{{ action.label }}</strong>
              <span>{{ action.desc }}</span>
            </button>
          </div>
          <el-empty v-else :description="emptyText('quick')" />
        </el-card>
      </aside>
    </section>

    <el-drawer v-model="configVisible" title="配置工作台模块" size="360px">
      <div class="config-list">
        <div v-for="(item, index) in moduleConfig" :key="item.key" class="config-row">
          <el-checkbox v-model="item.enabled">{{ item.label }}</el-checkbox>
          <div class="config-actions">
            <el-button :disabled="index === 0" :icon="ArrowUp" text @click="moveModule(index, -1)" />
            <el-button :disabled="index === moduleConfig.length - 1" :icon="ArrowDown" text @click="moveModule(index, 1)" />
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="resetModuleConfig">恢复默认</el-button>
        <el-button type="primary" @click="saveModuleConfig">保存配置</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.dashboard-page {
  min-height: 100%;
  padding-bottom: 28px;
  color: oklch(23% 0.018 54);
}

.workbench-hero {
  position: relative;
  display: flex;
  justify-content: space-between;
  gap: 28px;
  margin-bottom: 16px;
  padding: 22px 24px;
  background: oklch(99.2% 0.006 72);
  border: 1px solid oklch(88% 0.014 72);
  border-radius: 16px;
  box-shadow: 0 16px 34px -30px oklch(23% 0.018 54 / 0.35);
  overflow: hidden;
}

.hero-glow {
  position: absolute;
  right: -54px;
  bottom: -70px;
  width: 260px;
  height: 180px;
  border-radius: 999px;
  background: oklch(93.5% 0.055 66 / 0.72);
  filter: blur(34px);
  pointer-events: none;
}

.hero-copy {
  position: relative;
  max-width: 760px;
  z-index: 1;
}

.hero-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
}

.hero-meta span {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 9px;
  border-radius: 6px;
  background: oklch(93.5% 0.055 66);
  color: oklch(42% 0.14 51);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.hero-meta i {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: oklch(76% 0.010 54);
}

.hero-meta em {
  color: oklch(58% 0.012 54);
  font-size: 12px;
  font-style: normal;
  font-weight: 600;
}

.eyebrow {
  color: oklch(58% 0.183 51);
  font-size: 12px;
  letter-spacing: 0.12em;
  margin: 0 0 4px;
}

h1 {
  margin: 0 0 6px;
  font-size: 25px;
  font-weight: 760;
  line-height: 1.18;
}

.hero-copy p {
  color: oklch(49% 0.013 54);
  margin: 0;
  font-size: 15px;
}

.hero-side {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-shrink: 0;
  z-index: 1;
}

.hero-chip {
  min-width: 104px;
  padding: 10px 12px;
  background: oklch(97% 0.008 72);
  border: 1px solid oklch(89% 0.012 72 / 0.9);
  border-radius: 11px;
}

.hero-chip span,
.hero-chip strong {
  display: block;
}

.hero-chip span {
  color: oklch(58% 0.012 54);
  font-size: 12px;
}

.hero-chip strong {
  margin-top: 2px;
  font-size: 14px;
}

.hero-actions {
  display: flex;
  gap: 8px;
}

.icon-action {
  border-radius: 10px;
  border-color: oklch(88% 0.012 72);
  background: oklch(97% 0.008 72);
  color: oklch(42% 0.015 54);
  font-weight: 650;
}

.primary-action {
  border: 0;
  border-radius: 10px;
  background: oklch(58% 0.183 51);
  box-shadow: 0 8px 18px -14px oklch(58% 0.183 51 / 0.75);
  font-weight: 700;
}

.handoff-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  margin-bottom: 16px;
  padding: 10px 16px;
  background: var(--el-color-warning-light-9, #fdf6ec);
  border: 1px solid var(--el-color-warning-light-7, #f5dab1);
  border-radius: 10px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.handoff-banner strong {
  color: var(--el-color-warning);
}
.handoff-banner em {
  flex-basis: 100%;
  font-style: normal;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.metric-card {
  min-height: 124px;
  background: oklch(99.2% 0.006 72);
  border: 1px solid oklch(90% 0.011 72);
  border-radius: 16px;
  padding: 17px;
  box-shadow: 0 14px 30px -28px oklch(23% 0.018 54 / 0.35);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.metric-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 18px 32px -28px oklch(23% 0.018 54 / 0.55);
}

.metric-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.metric-label {
  color: oklch(49% 0.013 54);
  font-size: 13px;
  font-weight: 650;
}

.metric-icon {
  width: 36px;
  height: 36px;
  border-radius: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: oklch(96.3% 0.011 72);
  color: oklch(58% 0.012 54);
}

.metric-card strong {
  display: block;
  margin: 10px 0 12px;
  color: oklch(23% 0.018 54);
  font-size: 31px;
  font-weight: 820;
  line-height: 1;
}

.metric-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 9px;
  border-top: 1px solid oklch(88% 0.016 72 / 0.65);
  color: oklch(58% 0.012 54);
  font-size: 12px;
}

.metric-foot em {
  color: oklch(42% 0.14 51);
  font-style: normal;
  font-weight: 760;
}

.metric-card.orange {
  background: oklch(96.5% 0.03 66);
  border-color: oklch(88% 0.055 66);
}

.metric-card.blue {
  background: oklch(96% 0.016 245);
  border-color: oklch(88% 0.028 245);
}

.metric-card.green {
  background: oklch(96.5% 0.025 148);
  border-color: oklch(88% 0.045 148);
}

.metric-card.red {
  background: oklch(96% 0.024 25);
  border-color: oklch(88% 0.045 25);
}

.metric-card.gray {
  background: oklch(97% 0.006 72);
  border-color: oklch(88% 0.009 72);
}

.metric-card.orange .metric-icon {
  background: oklch(89% 0.068 66);
  color: oklch(42% 0.14 51);
}

.metric-card.blue .metric-icon {
  background: oklch(91% 0.038 245);
  color: oklch(45% 0.105 245);
}

.metric-card.green .metric-icon {
  background: oklch(90% 0.055 148);
  color: oklch(42% 0.105 148);
}

.metric-card.red .metric-icon {
  background: oklch(91% 0.044 25);
  color: oklch(48% 0.15 27);
}

.module-columns {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(360px, 0.8fr);
  gap: 16px;
  align-items: start;
}

.module-stack {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.work-panel {
  border: 1px solid oklch(90% 0.011 72);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 16px 34px -31px oklch(23% 0.018 54 / 0.42);
}

.primary-panel {
  margin-bottom: 16px;
}

.dashboard-page :deep(.work-panel > .el-card__header) {
  padding: 15px 18px;
  border-bottom-color: oklch(91% 0.01 72);
  background: oklch(98.5% 0.009 72);
}

.dashboard-page :deep(.work-panel > .el-card__body) {
  padding: 0;
  background: oklch(99.2% 0.006 72);
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.panel-heading p {
  margin: 0 0 3px;
  color: oklch(58% 0.183 51);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.panel-heading h2 {
  margin: 0;
  color: oklch(23% 0.018 54);
  font-size: 18px;
  font-weight: 760;
  line-height: 1.25;
}

.panel-heading.compact h2 {
  font-size: 16px;
}

.panel-count {
  min-width: 28px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: oklch(96.3% 0.011 72);
  color: oklch(42% 0.015 54);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
}

.danger-title .panel-count {
  background: oklch(94% 0.035 25);
  color: oklch(48% 0.15 27);
}

.task-list,
.compact-list {
  display: grid;
  gap: 0;
}

.work-row,
.compact-row,
.quick-action {
  width: 100%;
  border: 0;
  border-bottom: 1px solid oklch(89% 0.012 72 / 0.68);
  background: oklch(99.2% 0.006 72);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.18s ease, transform 0.18s ease;
}

.work-row:hover,
.compact-row:hover,
.quick-action:hover {
  background: oklch(97.5% 0.014 72);
}

.work-row {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 15px 18px;
}

.task-mark {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: oklch(96.3% 0.011 72);
  color: oklch(58% 0.012 54);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.task-mark.warning {
  background: oklch(94% 0.045 82);
  color: oklch(53% 0.11 72);
}

.task-mark.danger {
  background: oklch(94% 0.035 25);
  color: oklch(48% 0.15 27);
}

.task-mark.info {
  background: oklch(94% 0.028 245);
  color: oklch(45% 0.105 245);
}

.task-mark.success {
  background: oklch(94% 0.045 148);
  color: oklch(45% 0.11 148);
}

.work-row strong,
.compact-row strong {
  display: block;
  color: oklch(23% 0.018 54);
  font-size: 15px;
  font-weight: 730;
}

.work-row p,
.compact-row p {
  margin: 5px 0 0;
  color: oklch(58% 0.012 54);
  font-size: 13px;
}

.row-tail {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.row-action {
  color: oklch(45% 0.105 245);
  font-weight: 700;
  font-size: 13px;
}

.compact-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 68px;
  padding: 13px 16px;
}

.quick-grid {
  display: grid;
  gap: 0;
}

.quick-action {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  column-gap: 10px;
  min-height: 70px;
  padding: 14px 16px;
}

.quick-action strong,
.quick-action span {
  display: block;
}

.quick-icon {
  grid-row: span 2;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: oklch(96.3% 0.011 72);
  color: oklch(58% 0.183 51);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.quick-action > span:not(.quick-icon) {
  margin-top: 4px;
  color: oklch(58% 0.012 54);
  font-size: 13px;
}

.panel-empty,
.soft-empty {
  border: 1px dashed oklch(88% 0.012 72);
  border-radius: 14px;
  background: oklch(97.5% 0.009 72);
  color: oklch(58% 0.012 54);
  font-weight: 650;
  text-align: center;
}

.panel-empty {
  padding: 28px 16px;
}

.soft-empty {
  padding: 18px 16px;
}

.danger-soft {
  border-color: oklch(88% 0.04 25);
  background: oklch(96% 0.024 25);
  color: oklch(48% 0.15 27);
}

.config-list {
  display: grid;
  gap: 8px;
}

.config-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid #eef1f6;
  border-radius: 8px;
  padding: 10px 12px;
}

.config-actions {
  display: flex;
  gap: 4px;
}

@media (max-width: 1180px) {
  .workbench-hero,
  .metric-grid,
  .module-columns {
    grid-template-columns: 1fr;
  }

  .workbench-hero {
    flex-direction: column;
  }
}

@media (max-width: 720px) {
  .hero-side,
  .work-row {
    align-items: stretch;
  }

  .work-row {
    grid-template-columns: 1fr;
  }

  .hero-actions,
  .row-tail {
    justify-content: flex-start;
  }
}
</style>
