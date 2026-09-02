<script setup lang="ts">
/**
 * 移动端「我的」：账号信息 + 切换桌面版（会话级记忆）+ 退出登录。
 */
import { Cell as VanCell, CellGroup as VanCellGroup } from "vant";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { setPrefersDesktop } from "@/utils/device";

const auth = useAuthStore();
const router = useRouter();
const { t } = useI18n();

function switchDesktop() {
  setPrefersDesktop(true);
  router.replace("/dashboard");
}

function logout() {
  auth.logout();
  router.replace("/login");
}
</script>

<template>
  <div class="profile-view">
    <section class="user-card">
      <div class="avatar">{{ auth.initials }}</div>
      <div class="user-meta">
        <strong>{{ auth.user?.display_name }}</strong>
        <span>{{ auth.user?.username }}</span>
      </div>
    </section>

    <van-cell-group inset class="menu-group">
      <van-cell :title="t('mobile.profile.roleLabel')" :value="auth.user?.role?.name ?? ''" />
    </van-cell-group>

    <van-cell-group inset class="menu-group">
      <van-cell :title="t('mobile.profile.switchDesktop')" is-link @click="switchDesktop" />
      <van-cell :title="t('mobile.profile.logout')" is-link @click="logout" />
    </van-cell-group>
  </div>
</template>

<style scoped>
.profile-view {
  padding: 16px 12px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.user-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border-radius: 12px;
  padding: 16px;
}

.avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #ff7a00;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.user-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.user-meta strong {
  font-size: 15px;
}

.user-meta span {
  font-size: 12px;
  color: #909399;
}

.menu-group {
  margin: 0 !important;
}
</style>
