<script setup lang="ts">
/**
 * 移动端订单列表：全量浏览入口（角色全部页签 + 搜索）。
 * 待办队列已收进首页（HomeView），这里是"查看全部订单"的落地页。
 */
import { useRoute } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import OrderQueue from "../../components/OrderQueue.vue";
import { MOBILE_TODO_TABS } from "../../orderMeta";

const auth = useAuthStore();
const route = useRoute();

const tabs = MOBILE_TODO_TABS[auth.roleCode] ?? [];
const initialTab = Number(route.query.tab) || 0;
</script>

<template>
  <div class="order-list">
    <OrderQueue :tabs="tabs" :initial-tab="initialTab" show-search />
  </div>
</template>

<style scoped>
.order-list {
  min-height: 100%;
  background: #f5f6f8;
}
</style>
