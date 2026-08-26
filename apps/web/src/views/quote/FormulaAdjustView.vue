<script setup lang="ts">
/**
 * 批量调整公式：按公式片段查找/替换全部客户的报价配置。
 * 预览与应用都在后端完成（token 级匹配）；本视图在原型中是 embedded 模式下
 * 不可达的隐藏视图，迁移后作为报价管理的独立子页。
 */
import { Refresh } from "@element-plus/icons-vue";
import type { FormulaReplaceMatchVO } from "@bv/shared";
import { FormulaReplaceStatus } from "@bv/shared";
import { ElMessage } from "element-plus";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { applyFormulaReplace, previewFormulaReplace } from "@/api/quote";

const { t } = useI18n();

const search = ref("");
const replace = ref("");
const customerKeyword = ref("");
const matches = ref<FormulaReplaceMatchVO[]>([]);
const selected = ref(new Set<string>());
const loading = ref(false);
const confirmVisible = ref(false);
const applying = ref(false);
const previewedOnce = ref(false);

function matchKey(match: FormulaReplaceMatchVO) {
  return `${match.customer_id}::${match.item_id}`;
}

const appliable = computed(() =>
  matches.value.filter(match => match.status === FormulaReplaceStatus.OK),
);

const selectedMatches = computed(() =>
  appliable.value.filter(match => selected.value.has(matchKey(match))),
);

const selectedCustomerCount = computed(
  () => new Set(selectedMatches.value.map(match => match.customer_id)).size,
);

const allChecked = computed(
  () => appliable.value.length > 0 && selectedMatches.value.length === appliable.value.length,
);
const someChecked = computed(
  () => selectedMatches.value.length > 0 && selectedMatches.value.length < appliable.value.length,
);

let previewTimer: ReturnType<typeof setTimeout> | null = null;

async function runPreview() {
  if (!search.value.trim()) {
    matches.value = [];
    selected.value = new Set();
    previewedOnce.value = false;
    return;
  }
  loading.value = true;
  try {
    matches.value = await previewFormulaReplace({
      search: search.value,
      replace: replace.value,
      customer_keyword: customerKeyword.value.trim() || undefined,
    });
    previewedOnce.value = true;
    /* 默认全选可应用项（对齐原型） */
    selected.value = new Set(
      matches.value.filter(m => m.status === FormulaReplaceStatus.OK).map(matchKey),
    );
  } catch {
    matches.value = [];
    selected.value = new Set();
  } finally {
    loading.value = false;
  }
}

watch([search, replace, customerKeyword], () => {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => void runPreview(), 500);
});

function toggle(match: FormulaReplaceMatchVO, checked: boolean) {
  const next = new Set(selected.value);
  if (checked) next.add(matchKey(match));
  else next.delete(matchKey(match));
  selected.value = next;
}

function toggleAll(checked: boolean) {
  selected.value = checked ? new Set(appliable.value.map(matchKey)) : new Set();
}

function statusLabel(status: FormulaReplaceMatchVO["status"], error: string | null) {
  if (status === FormulaReplaceStatus.OK) return t("quote.adjust.statusOk");
  if (status === FormulaReplaceStatus.NEED_REPLACE) return t("quote.adjust.statusNeedReplace");
  return error || t("quote.adjust.statusInvalid");
}

function openConfirm() {
  if (!replace.value.trim()) {
    ElMessage.warning(t("quote.adjust.needReplaceFirst"));
    return;
  }
  if (!selectedMatches.value.length) {
    ElMessage.warning(t("quote.adjust.needSelectFirst"));
    return;
  }
  confirmVisible.value = true;
}

async function confirmApply() {
  applying.value = true;
  try {
    const result = await applyFormulaReplace({
      search: search.value,
      replace: replace.value,
      targets: selectedMatches.value.map(match => ({
        customer_id: match.customer_id,
        item_id: match.item_id,
      })),
    });
    confirmVisible.value = false;
    ElMessage.success(
      t("quote.adjust.applied", { customers: result.customers, items: result.items }),
    );
    if (result.errors.length) {
      ElMessage.warning(`${t("quote.adjust.partialErrors")}：${result.errors[0]}`);
    }
    await runPreview();
  } finally {
    applying.value = false;
  }
}
</script>

<template>
  <div>
    <header class="page-header">
      <p class="eyebrow">{{ t("quote.common.eyebrow") }}</p>
      <h1>{{ t("quote.adjust.title") }}</h1>
      <p class="subtitle">{{ t("quote.adjust.subtitle") }}</p>
    </header>

    <el-card shadow="never">
      <div class="card-head">
        <div>
          <h2>{{ t("quote.adjust.cardTitle") }}</h2>
          <p class="card-desc">{{ t("quote.adjust.cardDesc") }}</p>
        </div>
        <div class="head-actions">
          <el-button :icon="Refresh" @click="runPreview">{{ t("quote.adjust.refresh") }}</el-button>
          <el-button type="primary" :loading="applying" @click="openConfirm">
            {{ t("quote.adjust.saveSync") }}
          </el-button>
        </div>
      </div>

      <div class="controls">
        <label>
          <span>{{ t("quote.adjust.searchLabel") }}</span>
          <el-input v-model="search" :placeholder="t('quote.adjust.searchPh')" clearable />
        </label>
        <label>
          <span>{{ t("quote.adjust.replaceLabel") }}</span>
          <el-input v-model="replace" :placeholder="t('quote.adjust.replacePh')" clearable />
        </label>
        <label>
          <span>{{ t("quote.adjust.customerLabel") }}</span>
          <el-input v-model="customerKeyword" :placeholder="t('quote.adjust.customerPh')" clearable />
        </label>
      </div>
      <p class="hint">{{ t("quote.adjust.hint") }}</p>

      <div class="summary-bar">
        <span>
          {{
            !search.trim()
              ? t("quote.adjust.inputFirst")
              : previewedOnce
                ? t("quote.adjust.summary", {
                    total: matches.length,
                    appliable: appliable.length,
                    selected: selectedMatches.length,
                  })
                : t("quote.adjust.waiting")
          }}
        </span>
        <el-checkbox
          :model-value="allChecked"
          :indeterminate="someChecked"
          :disabled="!appliable.length"
          @change="toggleAll"
        >
          {{ t("quote.adjust.selectAll") }}
        </el-checkbox>
      </div>

      <el-table v-loading="loading" :data="matches" size="small" class="match-table">
        <el-table-column :label="t('quote.adjust.colSelect')" width="52" align="center">
          <template #default="{ row }">
            <el-checkbox
              :model-value="selected.has(`${row.customer_id}::${row.item_id}`)"
              :disabled="row.status !== 'OK'"
              @change="(checked: boolean) => toggle(row, checked)"
            />
          </template>
        </el-table-column>
        <el-table-column :label="t('quote.adjust.colCustomer')" min-width="140">
          <template #default="{ row }">
            {{ row.customer_name }}
            <span class="code-tag">{{ row.customer_code ? `#${row.customer_code}` : "" }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('quote.adjust.colTradeType')" prop="trade_type" width="100" />
        <el-table-column :label="t('quote.adjust.colPrefix')" prop="prefix" width="100" />
        <el-table-column :label="t('quote.adjust.colCurrent')" min-width="180">
          <template #default="{ row }">
            <code>{{ row.current_formula }}</code>
          </template>
        </el-table-column>
        <el-table-column :label="t('quote.adjust.colNext')" min-width="180">
          <template #default="{ row }">
            <code>{{ row.next_formula ?? "-" }}</code>
          </template>
        </el-table-column>
        <el-table-column :label="t('quote.adjust.colCurrentResult')" width="110" align="right">
          <template #default="{ row }">
            <code>{{ row.current_result ?? "--" }}</code>
          </template>
        </el-table-column>
        <el-table-column :label="t('quote.adjust.colNextResult')" width="110" align="right">
          <template #default="{ row }">
            <code>{{ row.next_result ?? "--" }}</code>
          </template>
        </el-table-column>
        <el-table-column :label="t('quote.adjust.colStatus')" min-width="140">
          <template #default="{ row }">
            <el-tag :type="row.status === 'OK' ? 'success' : row.status === 'NEED_REPLACE' ? 'info' : 'danger'" size="small">
              {{ statusLabel(row.status, row.error) }}
            </el-tag>
          </template>
        </el-table-column>
        <template #empty>
          <span>{{ search.trim() ? t("quote.adjust.emptyNoMatch") : t("quote.adjust.emptyNoInput") }}</span>
        </template>
      </el-table>
    </el-card>

    <el-dialog v-model="confirmVisible" :title="t('quote.adjust.confirmTitle')" width="480px">
      <p>{{ t("quote.adjust.confirmDesc") }}</p>
      <div class="confirm-rows">
        <div>
          <span>{{ t("quote.adjust.confirmScope") }}</span>
          <strong>
            {{ t("quote.adjust.scopeValue", { customers: selectedCustomerCount, items: selectedMatches.length }) }}
          </strong>
        </div>
        <div>
          <span>{{ t("quote.adjust.confirmSearch") }}</span>
          <code>{{ search }}</code>
        </div>
        <div>
          <span>{{ t("quote.adjust.confirmReplace") }}</span>
          <code>{{ replace }}</code>
        </div>
      </div>
      <p class="confirm-foot">{{ t("quote.adjust.confirmFoot") }}</p>
      <template #footer>
        <el-button @click="confirmVisible = false">{{ t("quote.batch.cancel") }}</el-button>
        <el-button type="primary" :loading="applying" @click="confirmApply">
          {{ t("quote.adjust.confirmApply") }}
        </el-button>
      </template>
    </el-dialog>
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

.card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 14px;
}

.card-head h2 {
  margin: 0;
  font-size: 16px;
}

.card-desc {
  margin: 4px 0 0;
  color: #909399;
  font-size: 12px;
}

.head-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.controls {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.controls label span {
  display: block;
  font-size: 12px;
  color: #909399;
  margin-bottom: 4px;
}

.hint {
  color: #c0c4cc;
  font-size: 12px;
  margin: 8px 0 12px;
}

.summary-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f7f8fa;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 10px;
  font-size: 13px;
  color: #606266;
}

.match-table code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.code-tag {
  color: #909399;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.confirm-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #f7f8fa;
  border-radius: 8px;
  padding: 12px;
  margin: 12px 0;
}

.confirm-rows > div {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}

.confirm-rows span {
  color: #909399;
}

.confirm-foot {
  color: #c0c4cc;
  font-size: 12px;
  margin: 0;
}
</style>
