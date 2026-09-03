<script setup lang="ts">
/**
 * 报价监测阈值配置（ADMIN）：T1-T5 时效阈值，供快速/批量报价复制拦截使用。
 * 单例配置，读写走 /quote/settings。
 */
import { DEFAULT_QUOTE_MONITOR_SETTINGS, type QuoteMonitorSettingsVO } from "@bv/shared";
import { ElMessage } from "element-plus";
import { onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { fetchQuoteSettings, saveQuoteSettings } from "@/api/quote";

const { t } = useI18n();

const loading = ref(true);
const saving = ref(false);
const form = reactive<QuoteMonitorSettingsVO>({ ...DEFAULT_QUOTE_MONITOR_SETTINGS });

/** 字段定义：key + 标签 + 说明，驱动表单渲染 */
const fields: { key: keyof QuoteMonitorSettingsVO; label: string; hint: string }[] = [
  { key: "benchmark_hours", label: "admin.quoteMonitor.benchmark", hint: "admin.quoteMonitor.benchmarkHint" },
  { key: "channel_hours", label: "admin.quoteMonitor.channel", hint: "admin.quoteMonitor.channelHint" },
  { key: "broker_hours", label: "admin.quoteMonitor.broker", hint: "admin.quoteMonitor.brokerHint" },
  { key: "quote_item_hours", label: "admin.quoteMonitor.quoteItem", hint: "admin.quoteMonitor.quoteItemHint" },
  { key: "result_hours", label: "admin.quoteMonitor.result", hint: "admin.quoteMonitor.resultHint" },
];

async function load() {
  loading.value = true;
  try {
    Object.assign(form, await fetchQuoteSettings());
  } finally {
    loading.value = false;
  }
}

function valid(): boolean {
  return fields.every(f => {
    const v = form[f.key];
    return Number.isInteger(v) && v >= 1 && v <= 720;
  });
}

async function save() {
  if (!valid()) {
    ElMessage.error(t("admin.quoteMonitor.rangeError"));
    return;
  }
  saving.value = true;
  try {
    Object.assign(form, await saveQuoteSettings({ ...form }));
    ElMessage.success(t("admin.quoteMonitor.saved"));
  } finally {
    saving.value = false;
  }
}

function resetDefaults() {
  Object.assign(form, DEFAULT_QUOTE_MONITOR_SETTINGS);
}

onMounted(load);
</script>

<template>
  <div>
    <header class="page-header">
      <p class="eyebrow">SYSTEM ADMIN</p>
      <h1>{{ t("admin.quoteMonitor.title") }}</h1>
      <p class="subtitle">{{ t("admin.quoteMonitor.subtitle") }}</p>
    </header>

    <el-card v-loading="loading" shadow="never" class="settings-card">
      <h3 class="section-title">{{ t("admin.quoteMonitor.thresholdTitle") }}</h3>
      <el-form label-position="top">
        <el-form-item v-for="f in fields" :key="f.key" :label="t(f.label)">
          <div class="field-row">
            <el-input-number
              v-model="form[f.key]"
              :min="1"
              :max="720"
              :step="1"
              step-strictly
              controls-position="right"
            />
            <span class="unit">{{ t("admin.quoteMonitor.unit") }}</span>
          </div>
          <p class="field-hint">{{ t(f.hint) }}</p>
        </el-form-item>
      </el-form>

      <div class="actions">
        <el-button @click="resetDefaults">{{ t("admin.quoteMonitor.reset") }}</el-button>
        <el-button type="primary" :loading="saving" @click="save">
          {{ t("admin.quoteMonitor.save") }}
        </el-button>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.settings-card {
  max-width: 640px;
}
.section-title {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
}
.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.unit {
  color: #909399;
  font-size: 13px;
}
.field-hint {
  margin: 6px 0 0;
  color: #909399;
  font-size: 12px;
  line-height: 1.5;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
</style>
