<script setup lang="ts">
/**
 * 统一页头（前端统一化）：眉标（品牌点缀色）+ 标题 + 副题 + 右侧操作位。
 * 替代各页面手写的 .page-header/.eyebrow 三段式。
 */
defineProps<{
  eyebrow?: string;
  title: string;
  subtitle?: string;
}>();
</script>

<template>
  <header class="page-header">
    <div class="page-header-copy">
      <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
      <h1>{{ title }}</h1>
      <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.extra" class="page-header-extra">
      <slot name="extra" />
    </div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.eyebrow {
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin: 0 0 4px;
}

h1 {
  margin: 0 0 4px;
  font-size: 22px;
  color: var(--color-text-primary);
}

.subtitle {
  color: var(--color-text-muted);
  margin: 0;
  font-size: 13px;
}

.page-header-extra {
  flex: none;
  display: flex;
  gap: 8px;
}
</style>
