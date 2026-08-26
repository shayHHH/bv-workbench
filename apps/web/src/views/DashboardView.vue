<script setup lang="ts">
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
</script>

<template>
  <div>
    <header class="page-header">
      <p class="eyebrow">{{ auth.user?.role?.code || "WORKBENCH" }}</p>
      <h1>{{ auth.user?.role?.name || "" }}工作台</h1>
      <p class="subtitle">欢迎，{{ auth.user?.display_name }}。工作台指标看板将随交易订单模块迁移后上线。</p>
    </header>
    <el-card shadow="never">
      <el-empty description="指标看板依赖交易订单数据，将在订单模块迁移后开放" />
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
</style>
