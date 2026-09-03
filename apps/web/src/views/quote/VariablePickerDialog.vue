<script setup lang="ts">
import type { FormulaToken, QuoteVariablesVO, VariableOptionVO } from "@bv/shared";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

const visible = defineModel<boolean>({ required: true });
const props = defineProps<{
  variables: QuoteVariablesVO | null;
  /** 已报价结果（当前客户各报价项实时计算值，由父组件提供） */
  quotedOptions: VariableOptionVO[];
}>();
const emit = defineEmits<{ pick: [token: Extract<FormulaToken, { type: "var" }>] }>();

const { t } = useI18n();
const activeTab = ref<"channel" | "base" | "quoted" | "broker">("channel");

const tabs = computed(() => [
  { key: "channel" as const, label: t("quote.variable.tabChannel"), help: t("quote.variable.helpChannel"), options: props.variables?.channels ?? [] },
  { key: "base" as const, label: t("quote.variable.tabBase"), help: t("quote.variable.helpBase"), options: props.variables?.benchmarks ?? [] },
  { key: "quoted" as const, label: t("quote.variable.tabQuoted"), help: t("quote.variable.helpQuoted"), options: props.quotedOptions },
  { key: "broker" as const, label: t("quote.variable.tabBroker"), help: t("quote.variable.helpBroker"), options: props.variables?.broker_items ?? [] },
]);

const activeOptions = computed(
  () => tabs.value.find(tab => tab.key === activeTab.value)?.options ?? [],
);

function pick(option: VariableOptionVO) {
  emit("pick", { type: "var", source: option.source, code: option.code, label: option.label });
  visible.value = false;
}
</script>

<template>
  <el-dialog v-model="visible" :title="t('quote.variable.title')" width="520px" append-to-body>
    <el-tabs v-model="activeTab">
      <el-tab-pane v-for="tab in tabs" :key="tab.key" :name="tab.key">
        <template #label>
          <el-tooltip :content="tab.help" placement="top">
            <span>{{ tab.label }}</span>
          </el-tooltip>
        </template>
        <div class="variable-list">
          <el-empty v-if="!tab.options.length" :description="t('quote.variable.empty')" :image-size="60" />
          <button
            v-for="option in activeOptions"
            v-else
            :key="option.code"
            class="variable-row"
            type="button"
            @click="pick(option)"
          >
            <span class="variable-label">{{ option.label }}</span>
            <code class="variable-value">{{ option.value ?? t("quote.variable.noValue") }}</code>
          </button>
        </div>
      </el-tab-pane>
    </el-tabs>
    <template #footer>
      <el-button @click="visible = false">{{ t("quote.variable.cancel") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.variable-list {
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.variable-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  text-align: left;
}

.variable-row:hover {
  border-color: var(--color-primary-light);
  background: var(--color-primary-light);
}

.variable-label {
  font-size: 13px;
  color: var(--color-text-primary);
}

.variable-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: var(--color-primary);
}
</style>
