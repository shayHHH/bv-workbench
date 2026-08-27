<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import ComplianceDashboard from "@/views/dashboard/ComplianceDashboard.vue";

const { t } = useI18n();
const auth = useAuthStore();
/* 风控专员（RISK_OFFICER）＝合规官，同样使用合规官工作台 */
const isCompliance = computed(() =>
  ["COMPLIANCE", "RISK_OFFICER"].includes(auth.roleCode),
);
</script>

<template>
  <ComplianceDashboard v-if="isCompliance" />
  <div v-else>
    <header class="page-header">
      <p class="eyebrow">{{ auth.user?.role?.code || "WORKBENCH" }}</p>
      <h1>{{ t("dashboard.title", { role: localizeText(auth.user?.role?.name || "") }) }}</h1>
      <p class="subtitle">{{ t("dashboard.welcome", { name: auth.user?.display_name || "" }) }}</p>
    </header>
    <el-card shadow="never">
      <el-empty :description="t('dashboard.empty')" />
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
