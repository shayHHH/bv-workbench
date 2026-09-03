<script setup lang="ts">
/**
 * 移动端首页。
 * WALLET/OPS：首页直接是待办队列（少一层导航，打开 App 就是要处理的订单）；
 * MANAGER：总览监控角色，保留统计卡片首页，全量订单浏览走「订单」tab。
 */
import type { OrderListStatsVO } from "@bv/shared";
import { Cell as VanCell, Loading as VanLoading } from "vant";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { fetchOrders } from "@/api/order";
import { useAuthStore } from "@/stores/auth";
import OrderQueue from "../components/OrderQueue.vue";
import { MOBILE_TODO_TABS } from "../orderMeta";

const auth = useAuthStore();
const router = useRouter();
const { t } = useI18n();

const isQueueRole = computed(() => auth.roleCode === "WALLET" || auth.roleCode === "OPS");

/* 待办队列角色：排除「全部订单」页签，全量浏览留给底部「订单」tab */
const queueTabs = computed(() => (MOBILE_TODO_TABS[auth.roleCode] ?? []).filter(tab => tab.labelKey !== "orders.list.tabs.all"));

/* MANAGER：统计卡片首页 */
const loading = ref(true);
const loadFailed = ref(false);
const stats = ref<OrderListStatsVO | null>(null);
const overviewTabs = MOBILE_TODO_TABS[auth.roleCode] ?? [];

async function loadOverview() {
  loading.value = true;
  loadFailed.value = false;
  try {
    const page = await fetchOrders({ page: 1, page_size: 1 });
    stats.value = page.stats;
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
}

function openTab(index: number) {
  router.push({ path: "/m/orders", query: { tab: String(index) } });
}

onMounted(() => {
  if (!isQueueRole.value) loadOverview();
});
</script>

<template>
  <div class="home-view">
    <!-- 业务交接：代班期间待办已并入被代班岗位 -->
    <div v-if="auth.handoffs.length" class="handoff-banner">
      <strong>代班中</strong>
      <span v-for="item in auth.handoffs" :key="item.leave_id">
        {{ item.from_user_name }}（{{ item.role_name }}）· 至 {{ item.end_date }}
      </span>
    </div>
    <template v-if="isQueueRole">
      <p class="queue-greeting">{{ t("mobile.home.greeting", { name: auth.user?.display_name ?? "" }) }}</p>
      <OrderQueue :tabs="queueTabs" />
    </template>

    <template v-else>
      <section class="greeting-card">
        <strong>{{ t("mobile.home.greeting", { name: auth.user?.display_name ?? "" }) }}</strong>
        <span>{{ t("mobile.home.roleNote", { role: auth.user?.role?.name ?? "" }) }}</span>
      </section>

      <section class="todo-card">
        <header>{{ t("mobile.home.todoTitle") }}</header>
        <div v-if="loading" class="state"><van-loading size="20" /></div>
        <p v-else-if="loadFailed" class="state" @click="loadOverview">{{ t("mobile.home.loadFailed") }}</p>
        <template v-else-if="stats">
          <van-cell
            v-for="(tabDef, index) in overviewTabs"
            :key="tabDef.labelKey"
            :title="t(tabDef.labelKey)"
            is-link
            @click="openTab(index)"
          >
            <template #value>
              <strong class="count">{{ tabDef.count(stats) }}</strong>
            </template>
          </van-cell>
        </template>
      </section>

      <button type="button" class="all-orders" @click="router.push('/m/orders')">
        {{ t("mobile.home.allOrders") }}
      </button>

      <button type="button" class="all-orders" @click="router.push('/m/department')">
        {{ t("mobile.home.department") }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.handoff-banner {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin: 12px 12px 0;
  padding: 10px 12px;
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-bg);
  border-radius: 10px;
  font-size: 12px;
  color: #6b625a;
}
.handoff-banner strong {
  color: var(--color-warning);
}
.home-view {
  min-height: 100%;
  background: var(--color-surface-alt);
}

.queue-greeting {
  margin: 0;
  padding: 10px 16px 2px;
  font-size: 13px;
  color: var(--color-text-secondary);
  background: #fff;
}

.greeting-card {
  margin: 12px 12px 0;
  background: linear-gradient(135deg, var(--color-primary), #ff9d3f);
  color: #fff;
  border-radius: 12px;
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.greeting-card strong {
  font-size: 17px;
}

.greeting-card span {
  font-size: 12px;
  opacity: 0.9;
}

.todo-card {
  margin: 12px;
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
}

.todo-card header {
  padding: 12px 16px 4px;
  font-size: 13px;
  color: var(--color-text-muted);
}

.state {
  padding: 24px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 13px;
}

.count {
  color: var(--color-primary);
  font-size: 16px;
}

.all-orders {
  display: block;
  width: calc(100% - 24px);
  margin: 0 12px 12px;
  border: 0;
  background: #fff;
  border-radius: 12px;
  padding: 14px;
  color: var(--color-primary);
  font-size: 14px;
}
</style>
