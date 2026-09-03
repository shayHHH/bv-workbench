<script setup lang="ts">
/**
 * 移动端订单队列：页签（按状态筛选）+ 卡片列表 + 分页。
 * 首页（待办队列）与订单列表（全量浏览）共用同一套拉取/翻页逻辑，差异只在页签范围与是否带搜索框。
 */
import type { OrderListStatsVO, TradeOrderVO } from "@bv/shared";
import { Empty as VanEmpty, Loading as VanLoading, Search as VanSearch, Tab as VanTab, Tabs as VanTabs } from "vant";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { fetchOrders } from "@/api/order";
import { useAuthStore } from "@/stores/auth";
import type { MobileTodoTab } from "../orderMeta";
import OrderCard from "./OrderCard.vue";

const props = withDefaults(
  defineProps<{ tabs: MobileTodoTab[]; showSearch?: boolean; initialTab?: number }>(),
  { showSearch: false, initialTab: 0 },
);

const auth = useAuthStore();
const router = useRouter();
const { t } = useI18n();

const activeTab = ref(props.initialTab);
const keyword = ref("");
const loading = ref(false);
const items = ref<TradeOrderVO[]>([]);
const stats = ref<OrderListStatsVO | null>(null);
const page = reactive({ current: 1, pageSize: 10, total: 0 });

const hasMore = computed(() => items.value.length < page.total);

async function load(reset: boolean) {
  if (reset) page.current = 1;
  loading.value = true;
  try {
    const tabDef = props.tabs[activeTab.value] ?? props.tabs[0];
    const result = await fetchOrders({
      keyword: keyword.value.trim() || undefined,
      page: page.current,
      page_size: page.pageSize,
      ...tabDef?.params,
    });
    items.value = reset ? result.items : [...items.value, ...result.items];
    page.total = result.total;
    stats.value = result.stats;
  } finally {
    loading.value = false;
  }
}

function loadMore() {
  page.current += 1;
  load(false);
}

function openOrder(order: TradeOrderVO) {
  router.push(`/m/orders/${order.id}`);
}

watch(activeTab, () => load(true));
watch(keyword, () => load(true));

load(true);
</script>

<template>
  <div class="order-queue">
    <van-search v-if="showSearch" v-model="keyword" :placeholder="t('mobile.orders.searchPh')" />
    <van-tabs v-model:active="activeTab" sticky swipeable :swipe-threshold="1">
      <van-tab v-for="tabDef in tabs" :key="tabDef.labelKey" :title="`${t(tabDef.labelKey)}${stats ? ` (${tabDef.count(stats)})` : ''}`" />
    </van-tabs>

    <div class="list-body">
      <OrderCard
        v-for="order in items"
        :key="order.id"
        :order="order"
        :role="auth.roleCode"
        @open="openOrder"
      />

      <div v-if="loading" class="state"><van-loading size="20" /></div>
      <van-empty v-else-if="!items.length" :description="t('mobile.orders.empty')" />
      <button v-else-if="hasMore" type="button" class="load-more" @click="loadMore">
        {{ t("mobile.orders.loadMore") }}
      </button>
      <p v-else class="no-more">{{ t("mobile.orders.noMore") }}</p>
    </div>
  </div>
</template>

<style scoped>
.list-body {
  padding: 10px 12px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.state {
  padding: 24px;
  text-align: center;
}

.load-more,
.no-more {
  border: 0;
  background: transparent;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 13px;
  padding: 10px;
}

.load-more {
  color: var(--color-primary);
}
</style>
