<script setup lang="ts">
/**
 * 统一筛选条（前端统一化）：搜索区靠左、筛选与重置靠右。
 * 用法：<FilterBar><template #search>…</template><template #filters>…</template></FilterBar>
 */
</script>

<template>
  <div class="filter-bar">
    <div class="filter-bar-search">
      <slot name="search" />
    </div>
    <div class="filter-bar-filters">
      <slot name="filters" />
    </div>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin: 4px 0 14px;
}

.filter-bar-search,
.filter-bar-filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
</style>
