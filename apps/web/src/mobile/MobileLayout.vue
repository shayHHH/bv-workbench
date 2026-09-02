<script setup lang="ts">
/**
 * 移动端壳：顶部导航栏 + 底部 tabbar。仅 WALLET/OPS/MANAGER 三个移动角色使用。
 * tabbar 只在 route.meta.tab 有值的页面（首页/订单/我的）展示；订单详情等二级页面走返回箭头。
 */
import "vant/lib/index.css";
import { NavBar as VanNavBar, Tabbar as VanTabbar, TabbarItem as VanTabbarItem } from "vant";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { localizeText } from "@/i18n";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { t } = useI18n();

const activeTab = computed(() => (route.meta.tab as string | undefined) ?? "");
const showBack = computed(() => !route.meta.tab);
const title = computed(() => localizeText((route.meta.title as string | undefined) ?? ""));
/* 部门管理只对运营经理开放，其余两个移动角色 tabbar 只有三项 */
const isManager = computed(() => auth.roleCode === "MANAGER");

function switchTab(name: string | number) {
  router.push(`/m/${name}`);
}
</script>

<template>
  <div class="mobile-shell">
    <van-nav-bar
      :title="title"
      :left-arrow="showBack"
      fixed
      placeholder
      safe-area-inset-top
      @click-left="router.back()"
    />
    <main class="mobile-body" :class="{ 'with-tabbar': !showBack }">
      <router-view />
    </main>
    <van-tabbar v-if="!showBack" :model-value="activeTab" fixed placeholder safe-area-inset-bottom @update:model-value="switchTab">
      <van-tabbar-item name="home">
        <template #icon><span class="tab-emoji">🏠</span></template>
        {{ t("mobile.tabs.home") }}
      </van-tabbar-item>
      <van-tabbar-item name="orders">
        <template #icon><span class="tab-emoji">🧾</span></template>
        {{ t("mobile.tabs.orders") }}
      </van-tabbar-item>
      <van-tabbar-item v-if="isManager" name="department">
        <template #icon><span class="tab-emoji">🗂️</span></template>
        {{ t("mobile.tabs.department") }}
      </van-tabbar-item>
      <van-tabbar-item name="profile">
        <template #icon><span class="tab-emoji">👤</span></template>
        {{ t("mobile.tabs.profile") }}
      </van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<style scoped>
.mobile-shell {
  min-height: 100vh;
  background: #f5f6f8;
}

.mobile-body {
  box-sizing: border-box;
  min-height: calc(100vh - 46px);
}

.tab-emoji {
  font-size: 18px;
  line-height: 1;
}
</style>
