<script setup lang="ts">
import {
  Calendar,
  EditPen,
  FolderOpened,
  Lock,
  Monitor,
  PriceTag,
  Search,
  Setting,
  Stamp,
  SwitchButton,
  Tickets,
  User,
  Wallet,
} from "@element-plus/icons-vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { QUOTE_ACCESS_ROLES } from "@bv/shared";
import { type AppLocale, localizeText, setLocale } from "@/i18n";
import { fetchApplications } from "@/api/access";
import { fetchOrders } from "@/api/order";
import { useAuthStore } from "@/stores/auth";
import UserProfileDialogs from "./UserProfileDialogs.vue";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { t, locale } = useI18n();

interface MenuItem {
  path: string;
  /** i18n key（layout.menu.*）；存量页面文案未抽包，菜单先统一走语言包 */
  titleKey: string;
  icon: unknown;
  roles?: string[];
  children?: { path: string; titleKey: string }[];
}

const menu: MenuItem[] = [
  { path: "/dashboard", titleKey: "layout.menu.dashboard", icon: Monitor },
  /* 客户管理全员可见（用户 2026-08-27：每个角色都可以看客户列表与详情抽屉） */
  { path: "/customers", titleKey: "layout.menu.customers", icon: User },
  { path: "/orders", titleKey: "layout.menu.orders", icon: Tickets, roles: ["AGENT", "OPS", "PAYOUT", "MANAGER", "FINANCE", "WALLET", "ADMIN"] },
  { path: "/department", titleKey: "layout.menu.department", icon: Calendar, roles: ["MANAGER"] },
  { path: "/fund-pools", titleKey: "layout.menu.fundPool", icon: Wallet, roles: ["MANAGER"] },
  {
    path: "/quote",
    titleKey: "layout.menu.quote",
    icon: PriceTag,
    roles: [...QUOTE_ACCESS_ROLES],
    children: [
      { path: "/quote/quick", titleKey: "layout.menu.quoteQuick" },
      { path: "/quote/batch", titleKey: "layout.menu.quoteBatch" },
      { path: "/quote/adjust", titleKey: "layout.menu.quoteAdjust" },
      { path: "/quote/history", titleKey: "layout.menu.quoteHistory" },
    ],
  },
  {
    path: "/access",
    titleKey: "layout.menu.access",
    icon: FolderOpened,
    roles: [...QUOTE_ACCESS_ROLES],
    children: [
      { path: "/access/materials", titleKey: "layout.menu.accessMaterials" },
      { path: "/access/documents", titleKey: "layout.menu.accessDocuments" },
    ],
  },
  {
    path: "/compliance",
    titleKey: "layout.menu.compliance",
    icon: Stamp,
    /* 风控专员＝合规官（RISK_OFFICER 为 admin 自建角色，真实名单在用） */
    roles: ["COMPLIANCE", "RISK_OFFICER", "ADMIN"],
    children: [
      { path: "/compliance/review", titleKey: "layout.menu.complianceReview" },
      { path: "/compliance/kyc-config", titleKey: "layout.menu.complianceKycConfig" },
      { path: "/compliance/audit", titleKey: "layout.menu.complianceAudit" },
    ],
  },
  {
    path: "/admin",
    titleKey: "layout.menu.admin",
    icon: Setting,
    roles: ["ADMIN"],
    children: [
      { path: "/admin/users", titleKey: "layout.menu.adminUsers" },
      { path: "/admin/review-assignment", titleKey: "layout.menu.adminReviewAssignment" },
      { path: "/admin/quote-monitor", titleKey: "layout.menu.adminQuoteMonitor" },
    ],
  },
];

function switchLocale(target: AppLocale) {
  setLocale(target);
}

/* 菜单按「本人角色 + 代班岗位」判定：业务交接期间接手人能进对方的功能面 */
const visibleMenu = computed(() => menu.filter(item => auth.hasRole(item.roles)));
const rejectedAccessCount = ref(0);
const orderTodoCount = ref(0);
const canViewAccess = computed(() => auth.hasRole(QUOTE_ACCESS_ROLES));
const canViewOrders = computed(() => auth.hasRole(["AGENT", "OPS", "PAYOUT", "MANAGER", "FINANCE", "WALLET", "ADMIN"]));
const canShowOrderBadge = computed(() => auth.hasRole(["AGENT", "OPS", "FINANCE", "PAYOUT"]));

async function loadAccessBadge() {
  if (!canViewAccess.value) {
    rejectedAccessCount.value = 0;
    return;
  }
  try {
    /* 待补件 + 延期补件（条件性放行/逾期受限）都计入业务准入角标 */
    const [supplement, conditional, overdue] = await Promise.all([
      fetchApplications({ status: "SUPPLEMENT_REQUIRED", page: 1, page_size: 1 }),
      fetchApplications({ status: "APPROVED_CONDITIONAL", page: 1, page_size: 1 }),
      fetchApplications({ status: "DEFERRAL_OVERDUE", page: 1, page_size: 1 }),
    ]);
    rejectedAccessCount.value = supplement.total + conditional.total + overdue.total;
  } catch {
    rejectedAccessCount.value = 0;
  }
}

async function loadOrderBadge() {
  if (!canShowOrderBadge.value) {
    orderTodoCount.value = 0;
    return;
  }
  try {
    const result = await fetchOrders({
      scope: "mine",
      page: 1,
      page_size: 1,
    });
    orderTodoCount.value = result.stats.todo;
  } catch {
    orderTodoCount.value = 0;
  }
}

function loadBadges() {
  void Promise.all([loadAccessBadge(), loadOrderBadge()]);
}

function syncOrderBadge(event: Event) {
  if (!canShowOrderBadge.value) return;
  const count = (event as CustomEvent<number>).detail;
  if (typeof count === "number" && Number.isFinite(count)) orderTodoCount.value = Math.max(0, count);
}

/* 审计 3.4：环境标示按构建环境区分，不再写死"正式环境" */
const envNote = computed(() => (import.meta.env.PROD ? t("layout.envProd") : t("layout.envDev")));

/* 切换语言时同步浏览器标签标题（路由 meta.title 为简体，经 localizeText 转当前语言） */
watch(locale, () => {
  const title = route.meta.title as string | undefined;
  document.title = title ? `${localizeText(title)} · Bitvast Workbench` : "Bitvast Workbench";
});

const searchText = ref("");
const profileVisible = ref(false);
const passwordVisible = ref(false);

/* 审计 3.5：单号路由（订单 YYYYMMDD-001 / SCH→订单，APP→审核跟踪，RC→合规队列），其余按客户搜索 */
function submitSearch() {
  const keyword = searchText.value.trim();
  const upper = keyword.toUpperCase();
  let path = "/customers";
  if (/^(SCH)-/.test(upper) || /^\d{8}-\d{3}$/.test(upper)) path = "/orders";
  else if (/^APP-/.test(upper)) path = "/access/documents";
  else if (/^RC-/.test(upper)) path = "/compliance/review";
  router.push({ path, query: keyword ? { kw: keyword } : {} });
}

function logout() {
  auth.logout();
  router.push("/login");
}

onMounted(() => {
  /* 代班岗位决定菜单可见范围，进壳时拉一次 */
  void auth.ensureHandoffs();
  loadBadges();
  window.addEventListener("order-todo-count-updated", syncOrderBadge);
});

onBeforeUnmount(() => {
  window.removeEventListener("order-todo-count-updated", syncOrderBadge);
});

watch(
  () => [auth.roleCode, route.fullPath],
  () => loadBadges(),
);
</script>

<template>
  <el-container class="layout">
    <el-aside width="220px" class="sidebar">
      <div class="brand">
        <img class="brand-mark" src="/bv.ico" alt="Bitvast" />
        <div>
          <strong>Bitvast</strong>
          <small>Trade Workbench</small>
        </div>
      </div>
      <div class="workspace-label">{{ t("layout.workspace") }}</div>
      <el-menu :default-active="route.path" router class="menu">
        <template v-for="item in visibleMenu" :key="item.path">
          <el-sub-menu v-if="item.children" :index="item.path">
            <template #title>
              <el-icon><component :is="item.icon" /></el-icon>
              <span class="menu-title">
                {{ t(item.titleKey) }}
                <span
                  v-if="item.path === '/access' && rejectedAccessCount"
                  class="menu-badge"
                >
                  {{ rejectedAccessCount > 99 ? "99+" : rejectedAccessCount }}
                </span>
              </span>
            </template>
            <el-menu-item v-for="child in item.children" :key="child.path" :index="child.path">
              <span class="menu-child-title">
                {{ t(child.titleKey) }}
                <span
                  v-if="child.path === '/access/documents' && rejectedAccessCount"
                  class="menu-badge menu-badge--child"
                >
                  {{ rejectedAccessCount > 99 ? "99+" : rejectedAccessCount }}
                </span>
              </span>
            </el-menu-item>
          </el-sub-menu>
          <el-menu-item v-else :index="item.path">
            <el-icon><component :is="item.icon" /></el-icon>
            <span class="menu-title">
              {{ t(item.titleKey) }}
              <span
                v-if="item.path === '/orders' && orderTodoCount"
                class="menu-badge"
              >
                {{ orderTodoCount > 99 ? "99+" : orderTodoCount }}
              </span>
              <span
                v-if="item.path === '/dashboard' && rejectedAccessCount"
                class="menu-badge"
              >
                {{ rejectedAccessCount > 99 ? "99+" : rejectedAccessCount }}
              </span>
            </span>
          </el-menu-item>
        </template>
      </el-menu>
      <div class="sidebar-note"><span></span>{{ envNote }}</div>
    </el-aside>
    <el-container>
      <el-header class="topbar">
        <el-input
          v-model="searchText"
          class="global-search"
          :placeholder="t('layout.searchPh')"
          :prefix-icon="Search"
          clearable
          @keyup.enter="submitSearch"
        />
        <div class="top-actions">
          <el-dropdown trigger="click" @command="switchLocale">
            <button class="lang-chip" type="button">
              {{ locale === "zh-TW" ? t("layout.zhTW") : t("layout.zhCN") }}
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="zh-CN" :disabled="locale === 'zh-CN'">
                  {{ t("layout.zhCN") }}
                </el-dropdown-item>
                <el-dropdown-item command="zh-TW" :disabled="locale === 'zh-TW'">
                  {{ t("layout.zhTW") }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-dropdown trigger="click">
            <button class="user-chip" type="button">
              <span class="avatar">{{ auth.initials }}</span>
              <span class="user-meta">
                <strong>{{ auth.user?.display_name }}</strong>
                <small>{{ auth.user?.title || auth.user?.role?.name }}</small>
              </span>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item disabled>
                  {{ auth.user?.username }} · {{ auth.user?.role?.name }}
                </el-dropdown-item>
                <el-dropdown-item divided @click="profileVisible = true">
                  <el-icon><EditPen /></el-icon>
                  {{ t("layout.profile") }}
                </el-dropdown-item>
                <el-dropdown-item @click="passwordVisible = true">
                  <el-icon><Lock /></el-icon>
                  {{ t("layout.changePassword") }}
                </el-dropdown-item>
                <el-dropdown-item divided @click="logout">
                  <el-icon><SwitchButton /></el-icon>
                  {{ t("layout.logout") }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
    <UserProfileDialogs v-model:profile="profileVisible" v-model:password="passwordVisible" />
  </el-container>
</template>

<style scoped>
.layout {
  height: 100%;
}

/* ── Sidebar ── */
.sidebar {
  background: var(--color-sidebar-bg, #1E293B);
  color: #fff;
  display: flex;
  flex-direction: column;
  border-right: none;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px 12px;
}

.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.1);
  object-fit: contain;
  padding: 4px;
  box-sizing: border-box;
}

.brand strong {
  display: block;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
}

.brand small {
  color: #64748B;
  letter-spacing: 0.06em;
  font-size: 11px;
}

.workspace-label {
  padding: 6px 16px 4px;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #475569;
  font-weight: 600;
}

/* ── Menu ── */
.menu {
  border-right: none;
  background: transparent;
  flex: 1;
  overflow-y: auto;
  padding: 0 8px;
  --el-menu-text-color: #94A3B8;
  --el-menu-hover-bg-color: rgba(255, 255, 255, 0.07);
  --el-menu-active-color: #FFFFFF;
  --el-menu-bg-color: transparent;
  --el-menu-item-height: 42px;
}

/* 激活菜单项 — 蓝色圆角 pill */
.menu :deep(.el-menu-item.is-active) {
  background: #2563EB;
  border-radius: 8px;
  color: #fff;
  font-weight: 600;
}

/* Sub-menu 激活项 */
.menu :deep(.el-sub-menu.is-active > .el-sub-menu__title) {
  color: #E2E8F0;
}

/* 普通 menu item */
.menu :deep(.el-menu-item),
.menu :deep(.el-sub-menu__title) {
  border-radius: 8px;
  margin-bottom: 2px;
  height: 42px;
  line-height: 42px;
}

.menu :deep(.el-menu-item:hover),
.menu :deep(.el-sub-menu__title:hover) {
  background: rgba(255, 255, 255, 0.07);
  border-radius: 8px;
  color: #E2E8F0;
}

.menu :deep(.el-sub-menu .el-menu) {
  background: transparent;
  padding: 0 0 0 8px;
}

.menu :deep(.el-sub-menu .el-menu .el-menu-item) {
  height: 38px;
  line-height: 38px;
  font-size: 13px;
  padding-left: 40px !important;
}

.menu-title {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.menu-child-title {
  min-width: 0;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.menu-badge {
  flex: none;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 999px;
  color: #E2E8F0;
  font-size: 11px;
  font-weight: 700;
  line-height: 20px;
  text-align: center;
  box-sizing: border-box;
}

.menu-badge--child {
  min-width: 18px;
  height: 18px;
  font-size: 10px;
  line-height: 18px;
}

.sidebar-note {
  padding: 12px 16px;
  font-size: 12px;
  color: #475569;
  display: flex;
  align-items: center;
  gap: 6px;
}

.sidebar-note span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22C55E;
  flex-shrink: 0;
}

/* ── Topbar ── */
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border-bottom: 1px solid #E2E8F0;
  height: 60px;
  padding: 0 20px;
  box-sizing: border-box;
}

.global-search {
  max-width: 380px;
}

/* 搜索框圆角 pill 样式 */
.global-search :deep(.el-input__wrapper) {
  border-radius: 999px;
  background: #F8FAFC;
  box-shadow: 0 0 0 1px #E2E8F0;
  padding-left: 14px;
}

.global-search :deep(.el-input__wrapper:hover),
.global-search :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 2px #DBEAFE;
}

.top-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.lang-chip {
  border: 1px solid #E2E8F0;
  background: transparent;
  color: #475569;
  border-radius: 8px;
  padding: 5px 12px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  font-family: var(--el-font-family);
  transition: border-color 0.15s, color 0.15s;
}

.lang-chip:hover {
  color: #2563EB;
  border-color: #BFDBFE;
  background: #EFF6FF;
}

.user-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 10px;
  font-family: var(--el-font-family);
  transition: background 0.15s;
}

.user-chip:hover {
  background: #F8FAFC;
}

.avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: #2563EB;
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.user-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.2;
}

.user-meta strong {
  color: #0F172A;
  font-size: 13px;
  font-weight: 600;
}

.user-meta small {
  color: #94A3B8;
  font-size: 12px;
}

/* ── Main content area ── */
.main {
  background: var(--color-bg, #F1F5F9);
  overflow-y: auto;
}
</style>

