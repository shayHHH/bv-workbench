<script setup lang="ts">
import { useRoute } from "vue-router";

const route = useRoute();
</script>

<template>
  <div>
    <header class="page-header">
      <p class="eyebrow">{{ route.meta.eyebrow || "MODULE" }}</p>
      <h1>{{ route.meta.title }}</h1>
      <p class="subtitle">{{ route.meta.desc }}</p>
    </header>
    <el-card shadow="never">
      <el-empty description="该模块尚未从原型迁移，按迭代路线排期实现中">
        <template #image>
          <span class="placeholder-icon">🚧</span>
        </template>
      </el-empty>
    </el-card>
  </div>
</template>

<style scoped>
.page-header {
  margin-bottom: 16px;
}

.eyebrow {
  color: #ff7a00;
  font-size: 12px;
  letter-spacing: 0.12em;
  margin: 0 0 4px;
}

h1 {
  margin: 0 0 4px;
  font-size: 22px;
}

.subtitle {
  color: #909399;
  margin: 0;
}

.placeholder-icon {
  font-size: 56px;
}
</style>
