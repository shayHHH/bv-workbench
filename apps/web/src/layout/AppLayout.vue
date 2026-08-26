<script setup lang="ts">
import {
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
} from "@element-plus/icons-vue";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { type AppLocale, setLocale } from "@/i18n";
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
  { path: "/customers", titleKey: "layout.menu.customers", icon: User, roles: ["AGENT", "OPS", "MANAGER", "FINANCE", "ADMIN"] },
  { path: "/orders", titleKey: "layout.menu.orders", icon: Tickets, roles: ["AGENT", "OPS", "PAYOUT", "MANAGER", "FINANCE", "WALLET"] },
  {
    path: "/quote",
    titleKey: "layout.menu.quote",
    icon: PriceTag,
    roles: ["AGENT", "OPS"],
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
    roles: ["AGENT", "OPS"],
    children: [
      { path: "/access/materials", titleKey: "layout.menu.accessMaterials" },
      { path: "/access/documents", titleKey: "layout.menu.accessDocuments" },
    ],
  },
  {
    path: "/compliance",
    titleKey: "layout.menu.compliance",
    icon: Stamp,
    roles: ["COMPLIANCE", "ADMIN"],
    children: [
      { path: "/compliance/review", titleKey: "layout.menu.complianceReview" },
      { path: "/compliance/kyc-config", titleKey: "layout.menu.complianceKycConfig" },
    ],
  },
  {
    path: "/admin",
    titleKey: "layout.menu.admin",
    icon: Setting,
    roles: ["ADMIN"],
    children: [{ path: "/admin/users", titleKey: "layout.menu.adminUsers" }],
  },
];

function switchLocale(target: AppLocale) {
  setLocale(target);
}

const visibleMenu = computed(() =>
  menu.filter(item => !item.roles || item.roles.includes(auth.roleCode)),
);

const searchText = ref("");
const profileVisible = ref(false);
const passwordVisible = ref(false);

function submitSearch() {
  const keyword = searchText.value.trim();
  router.push({ path: "/customers", query: keyword ? { kw: keyword } : {} });
}

function logout() {
  auth.logout();
  router.push("/login");
}
</script>

<template>
  <el-container class="layout">
    <el-aside width="220px" class="sidebar">
      <div class="brand">
        <span class="brand-mark">B</span>
        <div>
          <strong>Bitvast</strong>
          <small>Trade Workbench</small>
        </div>
      </div>
      <div class="workspace-label">业务工作台</div>
      <el-menu :default-active="route.path" router class="menu">
        <template v-for="item in visibleMenu" :key="item.path">
          <el-sub-menu v-if="item.children" :index="item.path">
            <template #title>
              <el-icon><component :is="item.icon" /></el-icon>
              <span>{{ t(item.titleKey) }}</span>
            </template>
            <el-menu-item v-for="child in item.children" :key="child.path" :index="child.path">
              {{ t(child.titleKey) }}
            </el-menu-item>
          </el-sub-menu>
          <el-menu-item v-else :index="item.path">
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ t(item.titleKey) }}</span>
          </el-menu-item>
        </template>
      </el-menu>
      <div class="sidebar-note"><span></span>正式环境 · 数据实时入库</div>
    </el-aside>
    <el-container>
      <el-header class="topbar">
        <el-input
          v-model="searchText"
          class="global-search"
          placeholder="搜索客户、案件编号或交易编号"
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
                  个人资料
                </el-dropdown-item>
                <el-dropdown-item @click="passwordVisible = true">
                  <el-icon><Lock /></el-icon>
                  修改密码
                </el-dropdown-item>
                <el-dropdown-item divided @click="logout">
                  <el-icon><SwitchButton /></el-icon>
                  退出登录
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

.sidebar {
  background: #1f2430;
  color: #fff;
  display: flex;
  flex-direction: column;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 20px 10px;
}

.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: #231c17;
  color: #ff7a00;
  font-weight: 800;
  font-size: 19px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.brand strong {
  display: block;
  color: #fff;
}

.brand small {
  color: #9aa3b2;
  letter-spacing: 0.08em;
  font-size: 11px;
}

.workspace-label {
  padding: 8px 20px;
  font-size: 11px;
  letter-spacing: 0.14em;
  color: #78808f;
}

.menu {
  border-right: none;
  background: transparent;
  flex: 1;
  overflow-y: auto;
  --el-menu-text-color: #c3c9d5;
  --el-menu-hover-bg-color: rgba(255, 255, 255, 0.08);
  --el-menu-active-color: #ff7a00;
  --el-menu-bg-color: transparent;
}

.menu :deep(.el-sub-menu .el-menu) {
  background: rgba(0, 0, 0, 0.18);
}

.sidebar-note {
  padding: 14px 20px;
  font-size: 12px;
  color: #78808f;
  display: flex;
  align-items: center;
  gap: 6px;
}

.sidebar-note span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #67c23a;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  background: #fff;
  border-bottom: 1px solid #ebeef5;
}

.global-search {
  max-width: 420px;
}

.top-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.lang-chip {
  border: 1px solid #dcdfe6;
  background: transparent;
  color: #606266;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 13px;
  cursor: pointer;
}

.lang-chip:hover {
  color: #ff7a00;
  border-color: #ff7a00;
}

.user-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 8px;
}

.user-chip:hover {
  background: #f5f6f8;
}

.avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: #ff7a00;
  color: #fff;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.user-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.2;
}

.user-meta small {
  color: #909399;
  font-size: 12px;
}

.main {
  background: #f5f6f8;
}
</style>
