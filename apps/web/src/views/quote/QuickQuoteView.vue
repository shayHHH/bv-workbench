<script setup lang="ts">
/**
 * 快速报价：按客户维护报价项（结构化公式 token），实时求值预览，
 * 一键计算走后端（落 last_result 与 quote_records）；配置改动防抖自动保存。
 * 对齐原型 quote/index02.html 的 quickQuote 视图（差异见 docs/db/quotes.md）。
 */
import {
  Close,
  CopyDocument,
  Delete,
  Plus,
  Refresh,
  Setting,
} from "@element-plus/icons-vue";
import type {
  BenchmarkStateVO,
  ChannelRateVO,
  FormulaToken,
  QuoteConfigVO,
  QuoteItemVO,
  QuoteVariablesVO,
  VariableOptionVO,
} from "@bv/shared";
import { RoundMode, RoundModeLabel } from "@bv/shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import {
  fetchBenchmarks,
  fetchChannelRates,
  fetchQuoteConfig,
  fetchQuoteVariables,
  recalculateQuote,
  saveBenchmarks,
  saveQuoteConfig,
  syncChannelRates,
} from "@/api/quote";
import CustomerCreateDialog from "@/views/customer/CustomerCreateDialog.vue";
import FormulaEditor from "./FormulaEditor.vue";
import VariablePickerDialog from "./VariablePickerDialog.vue";
import {
  buildClientResolver,
  customerDisplayLabel,
  evalItem,
  fetchAllQuoteCustomers,
  formatQuoteTime,
  matchCustomers,
  type QuoteCustomerOption,
} from "./quote-utils";

const { t } = useI18n();
const route = useRoute();

/* ---------- 客户选择 ---------- */
const customers = ref<QuoteCustomerOption[]>([]);
const query = ref("");
const dropdownOpen = ref(false);
const highlight = ref(0);
const selected = ref<QuoteCustomerOption | null>(null);
const searchBoxRef = ref<HTMLElement>();
const createDialogVisible = ref(false);

const matches = computed(() => matchCustomers(customers.value, query.value, 20));

/* ---------- 配置与变量 ---------- */
const config = ref<QuoteConfigVO | null>(null);
const variables = ref<QuoteVariablesVO | null>(null);
const loadingConfig = ref(false);
const expanded = reactive<Record<string, boolean>>({});
let tempIdSeq = 0;

/* ---------- 右侧面板 ---------- */
const sideCollapsed = ref(false);

/* 面板级收起/展开（记忆在本浏览器；点标题行切换，收起时标题栏保留并显示条目数） */
const PANEL_STORE_KEY = "bv-quick-side-panels";
const panelCollapsed = reactive<{ benchmark: boolean; channel: boolean }>(
  (() => {
    try {
      return { benchmark: false, channel: false, ...JSON.parse(localStorage.getItem(PANEL_STORE_KEY) || "{}") };
    } catch {
      return { benchmark: false, channel: false };
    }
  })(),
);

function togglePanel(key: "benchmark" | "channel") {
  panelCollapsed[key] = !panelCollapsed[key];
  try {
    localStorage.setItem(PANEL_STORE_KEY, JSON.stringify(panelCollapsed));
  } catch {
    /* 私密窗口等场景忽略 */
  }
}
const benchmark = ref<BenchmarkStateVO | null>(null);
const benchmarkEditing = ref(false);
const benchmarkDraft = ref<{ id?: string; label: string; value: string }[]>([]);
const channels = ref<ChannelRateVO[]>([]);
const channelFlash = ref(false);

/* ---------- 文本格式 ---------- */
const groupByType = ref(true);
const includeSuffix = ref(true);

/* ---------- 变量弹窗 ---------- */
const variableDialogVisible = ref(false);
const variableTargetItem = ref<string | null>(null);
const editorRefs = new Map<string, InstanceType<typeof FormulaEditor>>();

function setEditorRef(id: string, el: unknown) {
  if (el) editorRefs.set(id, el as InstanceType<typeof FormulaEditor>);
  else editorRefs.delete(id);
}

/* ---------- 求值 ---------- */
const resolver = computed(() =>
  buildClientResolver(variables.value, () => config.value?.items ?? []),
);

const results = computed(() => {
  const map = new Map<string, ReturnType<typeof evalItem>>();
  for (const item of config.value?.items ?? []) {
    map.set(item.id, evalItem(item, resolver.value));
  }
  return map;
});

const quotedOptions = computed<VariableOptionVO[]>(() =>
  (config.value?.items ?? [])
    .filter(item => !item.id.startsWith("tmp_") && item.id !== variableTargetItem.value)
    .map(item => ({
      source: "QUOTE_ITEM" as const,
      code: item.id,
      label: `${selected.value?.name ?? ""}${item.trade_type}${item.prefix}`,
      value: results.value.get(item.id)?.value ?? item.last_result,
    })),
);

/* ---------- 报价文本 ---------- */
const quoteBody = computed(() => {
  const items = (config.value?.items ?? []).filter(item => item.output_checked);
  const lines: string[] = [];
  const line = (item: QuoteItemVO) => {
    const value = results.value.get(item.id)?.value ?? item.last_result ?? "-";
    const suffix = includeSuffix.value && item.suffix ? ` ${item.suffix}` : "";
    return `${item.prefix || item.trade_type}: ${value}${suffix}`;
  };
  if (groupByType.value) {
    const groups = new Map<string, QuoteItemVO[]>();
    for (const item of items) {
      const key = item.trade_type || t("quote.batch.uncategorized");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    for (const [type, list] of groups) {
      lines.push(`${type}--`);
      for (const item of list) lines.push(line(item));
      lines.push("");
    }
    if (lines[lines.length - 1] === "") lines.pop();
  } else {
    for (const item of items) lines.push(`${item.trade_type} ${line(item)}`);
  }
  return lines.join("\n");
});

async function copyQuoteText() {
  const cfg = config.value;
  if (!cfg) return;
  const parts = [cfg.text.opening, quoteBody.value, cfg.text.ending];
  if (cfg.text.include_quote_time) {
    parts.push(`${t("quote.quick.quoteTimePrefix")}${formatQuoteTime(new Date())}`);
  }
  const text = parts.map(part => part.trim()).filter(Boolean).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(t("quote.quick.copySuccess"));
  } catch {
    ElMessage.error(t("quote.quick.copyFail"));
  }
}

/* ---------- 自动保存 ---------- */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedPayload = "";
const saving = ref(false);

function buildPayload() {
  const cfg = config.value!;
  return {
    items: cfg.items.map(item => ({
      ...(item.id.startsWith("tmp_") ? {} : { id: item.id }),
      trade_type: item.trade_type,
      prefix: item.prefix,
      suffix: item.suffix,
      formula: item.formula,
      broker_point: item.broker_point || "0",
      bv_point: item.bv_point || "0",
      digits: item.digits,
      round_mode: item.round_mode,
      output_checked: item.output_checked,
    })),
    text: cfg.text,
    common_notes: cfg.common_notes,
  };
}

async function saveNow() {
  const cfg = config.value;
  const customer = selected.value;
  if (!cfg || !customer || saving.value) return;
  const payload = buildPayload();
  const serialized = JSON.stringify(payload);
  if (serialized === lastSavedPayload) return;
  saving.value = true;
  try {
    const saved = await saveQuoteConfig(customer.id, payload);
    /* 只回填 id / 计算结果，避免整体替换打断输入焦点 */
    saved.items.forEach((remote, index) => {
      const local = cfg.items[index];
      if (!local) return;
      if (local.id !== remote.id) {
        if (expanded[local.id] !== undefined) {
          expanded[remote.id] = expanded[local.id];
          delete expanded[local.id];
        }
        local.id = remote.id;
      }
      local.last_result = remote.last_result;
      local.last_quoted_at = remote.last_quoted_at;
    });
    lastSavedPayload = JSON.stringify(buildPayload());
  } catch {
    /* 具体错误信息由 http 拦截器提示 */
  } finally {
    saving.value = false;
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow(), 800);
}

watch(
  () => (config.value ? JSON.stringify(buildPayload()) : ""),
  serialized => {
    if (!serialized || loadingConfig.value || serialized === lastSavedPayload) return;
    scheduleSave();
  },
);

/* ---------- 客户切换 ---------- */
async function selectCustomer(option: QuoteCustomerOption) {
  if (saveTimer) clearTimeout(saveTimer);
  await saveNow();
  selected.value = option;
  query.value = customerDisplayLabel(option);
  dropdownOpen.value = false;
  loadingConfig.value = true;
  try {
    const [cfg, vars] = await Promise.all([
      fetchQuoteConfig(option.id),
      fetchQuoteVariables(option.id),
    ]);
    config.value = cfg;
    variables.value = vars;
    lastSavedPayload = JSON.stringify(buildPayload());
    for (const key of Object.keys(expanded)) delete expanded[key];
    cfg.items.forEach(item => {
      expanded[item.id] = true;
    });
  } finally {
    /* watch 在同一 tick 读取序列化值，延后一拍再解除加载态 */
    await nextTick();
    loadingConfig.value = false;
  }
}

function handleSearchKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    dropdownOpen.value = true;
    const count = matches.value.length;
    if (!count) return;
    highlight.value =
      (highlight.value + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
    void nextTick(() => {
      searchBoxRef.value
        ?.querySelector(".dropdown-item.active")
        ?.scrollIntoView({ block: "nearest" });
    });
  } else if (event.key === "Enter") {
    const target = matches.value[highlight.value] ?? matches.value[0];
    if (target) void selectCustomer(target);
    else ElMessage.warning(t("quote.common.noMatchedCustomer"));
  } else if (event.key === "Escape") {
    dropdownOpen.value = false;
  }
}

function handleDocumentClick(event: MouseEvent) {
  if (!searchBoxRef.value?.contains(event.target as Node)) dropdownOpen.value = false;
}

async function onCustomerCreated(customer: { id: string }) {
  customers.value = await fetchAllQuoteCustomers();
  const option = customers.value.find(item => item.id === customer.id);
  if (option) await selectCustomer(option);
}

/* ---------- 报价项操作 ---------- */
function addItem() {
  const cfg = config.value;
  if (!cfg) return;
  const id = `tmp_${++tempIdSeq}`;
  cfg.items.push({
    id,
    trade_type: "",
    prefix: "",
    suffix: "",
    formula: [],
    broker_point: "0",
    bv_point: "0",
    digits: 4,
    round_mode: RoundMode.HALF_UP,
    output_checked: true,
    last_result: null,
    last_quoted_at: null,
  });
  expanded[id] = true;
  ElMessage.success(t("quote.quick.itemAdded"));
}

async function removeItem(index: number) {
  const cfg = config.value;
  if (!cfg || cfg.items.length <= 1) return;
  const item = cfg.items[index];
  const name = `${item.trade_type || t("quote.batch.uncategorized")} / ${item.prefix || t("quote.batch.unnamed")}`;
  try {
    await ElMessageBox.confirm(
      t("quote.quick.removeConfirmText", { name }),
      t("quote.quick.removeConfirmTitle"),
      {
        type: "warning",
        confirmButtonText: t("quote.batch.confirmDelete"),
        cancelButtonText: t("quote.batch.cancel"),
      },
    );
  } catch {
    return; // 用户取消
  }
  cfg.items.splice(index, 1);
  ElMessage.success(t("quote.quick.itemRemoved"));
}

function moveItem(index: number, direction: -1 | 1) {
  const cfg = config.value;
  if (!cfg) return;
  const target = index + direction;
  if (target < 0 || target >= cfg.items.length) return;
  const [item] = cfg.items.splice(index, 1);
  cfg.items.splice(target, 0, item);
}

function openVariableDialog(itemId: string) {
  variableTargetItem.value = itemId;
  variableDialogVisible.value = true;
}

function onVariablePicked(token: Extract<FormulaToken, { type: "var" }>) {
  const target = variableTargetItem.value;
  if (target) editorRefs.get(target)?.insertVariable(token);
}

async function recalculate() {
  const customer = selected.value;
  if (!customer) return;
  if (saveTimer) clearTimeout(saveTimer);
  await saveNow();
  const result = await recalculateQuote(customer.id);
  const cfg = config.value;
  if (cfg) {
    result.config.items.forEach((remote, index) => {
      const local = cfg.items[index];
      if (!local) return;
      local.last_result = remote.last_result;
      local.last_quoted_at = remote.last_quoted_at;
    });
    lastSavedPayload = JSON.stringify(buildPayload());
  }
  if (result.errors.length) {
    ElMessage.warning(`${t("quote.quick.calcPartialFail")}：${result.errors[0].error}`);
  } else {
    ElMessage.success(t("quote.quick.recalculated"));
  }
}

/* ---------- 常用备注 ---------- */
function applyNote(note: string) {
  if (config.value) config.value.text.ending = note;
}

function removeNote(note: string) {
  const cfg = config.value;
  if (cfg) cfg.common_notes = cfg.common_notes.filter(item => item !== note);
}

function rememberEnding() {
  const cfg = config.value;
  const text = cfg?.text.ending.trim();
  if (!cfg || !text || text.length < 4 || cfg.common_notes.includes(text)) return;
  cfg.common_notes = [text, ...cfg.common_notes].slice(0, 8);
}

/* ---------- 平台基准价 ---------- */
function enterBenchmarkEdit() {
  benchmarkDraft.value = (benchmark.value?.items ?? []).map(item => ({
    id: item.id,
    label: item.label,
    value: item.value,
  }));
  benchmarkEditing.value = true;
  if (panelCollapsed.benchmark) togglePanel("benchmark");
  ElMessage.info(t("quote.benchmark.editEntered"));
}

function cancelBenchmarkEdit() {
  benchmarkEditing.value = false;
  ElMessage.info(t("quote.benchmark.editCancelled"));
}

function addBenchmarkRow() {
  benchmarkDraft.value.push({ label: "", value: "" });
}

function removeBenchmarkRow(index: number) {
  benchmarkDraft.value.splice(index, 1);
}

async function saveBenchmarkDraft() {
  const state = await saveBenchmarks({ items: benchmarkDraft.value });
  benchmark.value = state;
  benchmarkEditing.value = false;
  /* 服务端已全量自动重算引用基准价的报价，取回当前客户的最新落库结果 */
  await reloadCurrentResults();
  ElMessage.success(
    state.refreshed?.items
      ? t("quote.benchmark.savedRefreshed", {
          customers: state.refreshed.customers,
          items: state.refreshed.items,
        })
      : t("quote.benchmark.saved"),
  );
}

/** 变量与当前客户各报价项的 last_result / last_quoted_at 拉新（不整体替换避免打断输入） */
async function reloadCurrentResults() {
  const customer = selected.value;
  if (!customer) return;
  const [vars, remoteConfig] = await Promise.all([
    fetchQuoteVariables(customer.id),
    fetchQuoteConfig(customer.id),
  ]);
  variables.value = vars;
  const cfg = config.value;
  if (!cfg) return;
  for (const remote of remoteConfig.items) {
    const local = cfg.items.find(item => item.id === remote.id);
    if (local) {
      local.last_result = remote.last_result;
      local.last_quoted_at = remote.last_quoted_at;
    }
  }
}

/* ---------- 渠道汇率 ---------- */
async function refreshChannels() {
  /* 配置了 XE 行情源时走真实同步（同步成功后服务端全量刷新引用渠道汇率的报价） */
  const result = await syncChannelRates();
  channels.value = result.rates;
  await reloadCurrentResults();
  channelFlash.value = true;
  setTimeout(() => {
    channelFlash.value = false;
  }, 650);
  ElMessage.success(t(result.synced ? "quote.channel.synced" : "quote.channel.refreshed"));
}

/* ---------- 初始化 ---------- */
onMounted(async () => {
  document.addEventListener("click", handleDocumentClick);
  const [options, benchmarkState, channelRates] = await Promise.all([
    fetchAllQuoteCustomers(),
    fetchBenchmarks(),
    fetchChannelRates(),
  ]);
  customers.value = options;
  benchmark.value = benchmarkState;
  channels.value = channelRates;
  /* 只在带 ?customer=（如从交易订单跳转报价）时预选客户；直接进入页面不默认选中，避免误改到别人的报价配置 */
  const preferred = route.query.customer
    ? (options.find(option => option.id === route.query.customer) ?? null)
    : null;
  if (preferred) await selectCustomer(preferred);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", handleDocumentClick);
  if (saveTimer) clearTimeout(saveTimer);
  void saveNow();
});

const roundModeOptions = Object.values(RoundMode).map(mode => ({
  value: mode,
  label: RoundModeLabel[mode],
}));
</script>

<template>
  <div>
    <header class="page-header">
      <p class="eyebrow">{{ t("quote.common.eyebrow") }}</p>
      <h1>{{ t("quote.quick.title") }}</h1>
      <p class="subtitle">{{ t("quote.quick.subtitle") }}</p>
    </header>

    <div class="quote-shell" :class="{ 'side-collapsed': sideCollapsed }">
      <div class="main-col">
        <!-- 目标客户 / 中介对象 -->
        <el-card shadow="never" class="customer-card quote-step-card">
          <div class="customer-step-content">
            <div class="step-copy">
              <strong>{{ t("quote.quick.targetStepTitle") }}</strong>
              <span>{{ t("quote.quick.targetStepHint") }}</span>
            </div>
            <div class="customer-control-row">
              <div ref="searchBoxRef" class="search-box">
                <el-input
                  v-model="query"
                  :placeholder="t('quote.common.customerPlaceholder')"
                  clearable
                  @focus="dropdownOpen = true"
                  @input="dropdownOpen = true; highlight = 0"
                  @keydown="handleSearchKeydown"
                />
                <div v-if="dropdownOpen" class="dropdown">
                  <button
                    v-for="(option, index) in matches"
                    :key="option.id"
                    type="button"
                    class="dropdown-item"
                    :class="{ active: index === highlight }"
                    @mouseenter="highlight = index"
                    @click="selectCustomer(option)"
                  >
                    <strong>{{ customerDisplayLabel(option) }}</strong>
                    <span>{{ option.broker_label ?? t("quote.common.direct") }}</span>
                  </button>
                  <div v-if="!matches.length" class="dropdown-empty">
                    {{ t("quote.common.noMatchedCustomer") }}
                  </div>
                </div>
              </div>
              <el-button :icon="Plus" @click="createDialogVisible = true">
                {{ t("quote.quick.newCustomer") }}
              </el-button>
            </div>
          </div>
        </el-card>

        <!-- 对客报价文本与配置 -->
        <div v-if="config && selected" class="config-card quote-config-area">
          <!-- 文本预览 -->
          <section class="output-box step-section">
            <header class="output-head">
              <div class="section-title">
                <div>
                  <strong>{{ t("quote.quick.outputPreview") }}</strong>
                </div>
              </div>
              <div class="output-actions">
                <el-popover placement="bottom-end" trigger="click" width="240">
                  <template #reference>
                    <el-button text :icon="Setting">{{ t("quote.quick.formatSettings") }}</el-button>
                  </template>
                  <p class="format-title">{{ t("quote.quick.exportFormatTitle") }}</p>
                  <el-checkbox v-model="groupByType">{{ t("quote.quick.groupByType") }}</el-checkbox>
                  <el-checkbox v-model="includeSuffix">{{ t("quote.quick.includeSuffix") }}</el-checkbox>
                  <el-checkbox
                    v-if="config"
                    v-model="config.text.include_quote_time"
                  >
                    {{ t("quote.quick.includeQuoteTime") }}
                  </el-checkbox>
                </el-popover>
                <el-button type="primary" plain :icon="CopyDocument" @click="copyQuoteText">
                  {{ t("quote.quick.copyText") }}
                </el-button>
              </div>
            </header>

            <!-- 抬头 / 落款并排一行，预览正文在下 -->
            <div class="output-header-row">
              <div class="output-field">
                <div class="field-label">
                  <span>{{ t("quote.quick.opening") }}</span>
                </div>
                <el-input v-model="config.text.opening" />
              </div>
              <div class="output-field">
                <div class="field-label">
                  <span>{{ t("quote.quick.ending") }}</span>
                </div>
                <el-input
                  v-model="config.text.ending"
                  :placeholder="t('quote.quick.endingPlaceholder')"
                  @blur="rememberEnding"
                />
              </div>
            </div>

            <pre class="output-body">{{ quoteBody }}</pre>

            <div v-if="config.common_notes.length" class="notes-row">
              <span class="notes-label">{{ t("quote.quick.commonNotes") }}</span>
              <el-tag
                v-for="note in config.common_notes"
                :key="note"
                closable
                size="small"
                @click="applyNote(note)"
                @close="removeNote(note)"
              >
                {{ note }}
              </el-tag>
            </div>

            <div class="check-list">
              <small>{{ t("quote.quick.checkHint") }}</small>
              <el-checkbox
                v-for="item in config.items"
                :key="item.id"
                v-model="item.output_checked"
              >
                {{ item.trade_type || t("quote.batch.uncategorized") }} / {{ item.prefix || t("quote.batch.unnamed") }}
              </el-checkbox>
            </div>
          </section>

          <div class="config-head">
            <div class="section-title">
              <div>
                <h2>{{ t("quote.quick.configTitle") }}</h2>
                <p class="config-sub">{{ t("quote.quick.configSubtitle") }}</p>
              </div>
            </div>
            <el-button type="primary" @click="recalculate">
              ⚡ {{ t("quote.quick.calc") }}
            </el-button>
          </div>

          <!-- 报价项 -->
          <div class="item-list">
            <article
              v-for="(item, index) in config.items"
              :key="item.id"
              class="item-card"
              :class="{ collapsed: !expanded[item.id] }"
            >
              <template v-if="!expanded[item.id]">
                <div class="summary-row">
                  <button type="button" class="summary-main" @click="expanded[item.id] = true">
                    <span class="summary-type">
                      <i class="dot" />
                      <strong>{{ item.trade_type || t("quote.quick.itemTitle", { n: index + 1 }) }}</strong>
                    </span>
                    <b>{{ item.prefix || "-" }}</b>
                    <code>{{
                      item.formula.length
                        ? item.formula.map(tk => (tk.type === "var" ? tk.label : tk.value)).join(" ")
                        : t("quote.quick.unconfigured")
                    }}</code>
                    <strong class="summary-result">{{ results.get(item.id)?.value ?? "--" }}</strong>
                  </button>
                  <div class="summary-actions">
                    <el-button text size="small" class="move-arrow" :disabled="index === 0" :title="t('quote.quick.moveUp')" @click="moveItem(index, -1)">
                      ↑
                    </el-button>
                    <el-button
                      text
                      size="small"
                      class="move-arrow"
                      :disabled="index === config.items.length - 1"
                      :title="t('quote.quick.moveDown')"
                      @click="moveItem(index, 1)"
                    >
                      ↓
                    </el-button>
                    <el-button
                      text
                      size="small"
                      :icon="Delete"
                      :disabled="config.items.length <= 1"
                      :title="t('quote.quick.removeItem')"
                      @click="removeItem(index)"
                    />
                  </div>
                </div>
              </template>
              <template v-else>
                <header class="item-head">
                  <div class="item-title">
                    <i class="dot" />
                    <strong>{{ t("quote.quick.itemTitle", { n: index + 1 }) }}</strong>
                    <small>{{ t("quote.quick.updatedAt", { time: formatQuoteTime(item.last_quoted_at) }) }}</small>
                  </div>
                  <div class="item-actions">
                    <el-button text class="move-arrow" :disabled="index === 0" :title="t('quote.quick.moveUp')" @click="moveItem(index, -1)">
                      ↑
                    </el-button>
                    <el-button
                      text
                      class="move-arrow"
                      :disabled="index === config.items.length - 1"
                      :title="t('quote.quick.moveDown')"
                      @click="moveItem(index, 1)"
                    >
                      ↓
                    </el-button>
                    <el-button
                      text
                      :icon="Delete"
                      :disabled="config.items.length <= 1"
                      :title="t('quote.quick.removeItem')"
                      @click="removeItem(index)"
                    />
                    <el-button text @click="expanded[item.id] = false">
                      {{ t("quote.quick.collapse") }} ⌃
                    </el-button>
                  </div>
                </header>

                <div class="field-grid">
                  <label>
                    <span>{{ t("quote.quick.tradeType") }}</span>
                    <el-input v-model="item.trade_type" :placeholder="t('quote.quick.tradeTypePh')" />
                  </label>
                  <label>
                    <span>{{ t("quote.quick.prefix") }}</span>
                    <el-input v-model="item.prefix" :placeholder="t('quote.quick.prefixPh')" />
                  </label>
                  <label>
                    <span>{{ t("quote.quick.suffix") }}</span>
                    <el-input v-model="item.suffix" :placeholder="t('quote.quick.suffixPh')" />
                  </label>
                </div>

                <section class="formula-box">
                  <div class="formula-toolbar">
                    <div class="toolbar-left">
                      <el-button size="small" type="primary" plain @click="openVariableDialog(item.id)">
                        ＋ {{ t("quote.quick.insertVariable") }}
                      </el-button>
                      <span class="ops-label">{{ t("quote.quick.quickOps") }}</span>
                      <button
                        v-for="op in ['+', '-', '*', '/', '(', ')']"
                        :key="op"
                        type="button"
                        class="op-chip"
                        @click="editorRefs.get(item.id)?.insertOperator(op)"
                      >
                        {{ op }}
                      </button>
                    </div>
                    <div class="toolbar-right">
                      <span class="result-hint">{{ t("quote.quick.resultEquals") }}</span>
                      <button type="button" class="op-chip" @click="editorRefs.get(item.id)?.clear()">
                        {{ t("quote.quick.clear") }}
                      </button>
                    </div>
                  </div>
                  <FormulaEditor
                    :ref="el => setEditorRef(item.id, el)"
                    v-model="item.formula"
                    :error="item.formula.length ? results.get(item.id)?.error : null"
                    :placeholder="t('quote.quick.formulaPlaceholder')"
                  />
                  <p v-if="item.formula.length && results.get(item.id)?.error" class="formula-error">
                    ⚠ {{ results.get(item.id)?.error }}
                  </p>

                  <div class="param-grid">
                    <label>
                      <span>{{ t("quote.quick.brokerPoint") }}</span>
                      <el-input v-model="item.broker_point" inputmode="decimal" />
                    </label>
                    <label>
                      <span>{{ t("quote.quick.bvPoint") }}</span>
                      <el-input v-model="item.bv_point" inputmode="decimal" />
                    </label>
                    <label>
                      <span>{{ t("quote.quick.digits") }}</span>
                      <el-input-number v-model="item.digits" :min="0" :max="8" controls-position="right" />
                    </label>
                    <label>
                      <span>{{ t("quote.quick.roundModeLabel") }}</span>
                      <el-select v-model="item.round_mode">
                        <el-option
                          v-for="mode in roundModeOptions"
                          :key="mode.value"
                          :value="mode.value"
                          :label="t(`quote.roundMode.${mode.value}`)"
                        />
                      </el-select>
                    </label>
                    <div class="result-box" :class="{ error: item.formula.length && !results.get(item.id)?.ok }">
                      <span>{{ t("quote.quick.result") }}</span>
                      <strong>{{ results.get(item.id)?.value ?? "--" }}</strong>
                    </div>
                  </div>
                </section>
              </template>
            </article>
          </div>

          <div class="add-row">
            <el-button :icon="Plus" @click="addItem">{{ t("quote.quick.addItem") }}</el-button>
          </div>
        </div>
        <el-card v-else-if="loadingConfig" v-loading="true" shadow="never" class="config-card loading-card" />
        <el-card v-else shadow="never" class="config-card empty-card">
          <el-empty :description="t('quote.quick.pickCustomerFirst')" />
        </el-card>
      </div>

      <!-- 右侧辅助面板 -->
      <aside class="side-col">
        <button
          type="button"
          class="side-toggle"
          @click="sideCollapsed = !sideCollapsed"
        >
          {{ sideCollapsed ? "‹" : "›" }}
        </button>
        <template v-if="!sideCollapsed">
          <el-card shadow="never" class="assist-card">
            <header class="assist-head clickable" @click="togglePanel('benchmark')">
              <h3>
                <i class="panel-chevron" :class="{ collapsed: panelCollapsed.benchmark }">⌄</i>
                ▥ {{ t("quote.benchmark.title") }}
                <em v-if="panelCollapsed.benchmark" class="panel-count">{{ (benchmark?.items ?? []).length }}</em>
              </h3>
              <div class="assist-actions" @click.stop>
                <template v-if="benchmarkEditing">
                  <el-button size="small" @click="cancelBenchmarkEdit">{{ t("quote.benchmark.cancel") }}</el-button>
                  <el-button size="small" type="primary" @click="saveBenchmarkDraft">
                    {{ t("quote.benchmark.save") }}
                  </el-button>
                </template>
                <el-button v-else size="small" @click="enterBenchmarkEdit">
                  {{ t("quote.benchmark.edit") }}
                </el-button>
              </div>
            </header>
            <el-collapse-transition>
            <div v-show="!panelCollapsed.benchmark">
            <p class="assist-meta">
              {{
                benchmark?.saved_at
                  ? t("quote.benchmark.lastSaved", { time: formatQuoteTime(benchmark.saved_at) })
                  : t("quote.benchmark.neverSaved")
              }}
            </p>
            <div class="bench-table">
              <div class="bench-row bench-head">
                <span>{{ t("quote.benchmark.typeCol") }}</span>
                <span class="right">{{ t("quote.benchmark.valueCol") }}</span>
              </div>
              <template v-if="benchmarkEditing">
                <div v-for="(row, index) in benchmarkDraft" :key="index" class="bench-row">
                  <el-input v-model="row.label" size="small" :placeholder="t('quote.benchmark.labelPh')" />
                  <el-input v-model="row.value" size="small" class="bench-value" inputmode="decimal" />
                  <el-button
                    text
                    size="small"
                    :icon="Close"
                    :title="t('quote.benchmark.removeRow')"
                    @click="removeBenchmarkRow(index)"
                  />
                </div>
                <el-button text size="small" :icon="Plus" @click="addBenchmarkRow">
                  {{ t("quote.benchmark.addItem") }}
                </el-button>
              </template>
              <template v-else>
                <div v-for="row in benchmark?.items ?? []" :key="row.id" class="bench-row">
                  <span>{{ row.label }}</span>
                  <code class="right">{{ row.value }}</code>
                </div>
              </template>
            </div>
            </div>
            </el-collapse-transition>
          </el-card>

          <el-card shadow="never" class="assist-card">
            <header class="assist-head clickable" @click="togglePanel('channel')">
              <h3>
                <i class="panel-chevron" :class="{ collapsed: panelCollapsed.channel }">⌄</i>
                ⇄ {{ t("quote.channel.title") }}
                <em v-if="panelCollapsed.channel" class="panel-count">{{ channels.length }}</em>
              </h3>
              <el-button size="small" :icon="Refresh" @click.stop="refreshChannels">
                {{ t("quote.channel.refresh") }}
              </el-button>
            </header>
            <el-collapse-transition>
            <div v-show="!panelCollapsed.channel">
            <p class="assist-meta">
              {{ t("quote.channel.source") }}
              <span class="online-pill">● {{ t("quote.channel.online") }}</span>
            </p>
            <div class="channel-list" :class="{ updating: channelFlash }">
              <div v-for="rate in channels" :key="rate.id" class="channel-row">
                <span class="channel-name">{{ rate.label }}</span>
                <code>{{ rate.value }}</code>
              </div>
            </div>
            </div>
            </el-collapse-transition>
          </el-card>
        </template>
      </aside>
    </div>

    <VariablePickerDialog
      v-model="variableDialogVisible"
      :variables="variables"
      :quoted-options="quotedOptions"
      @pick="onVariablePicked"
    />
    <CustomerCreateDialog v-model="createDialogVisible" @created="onCustomerCreated" />
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

.quote-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 350px;
  gap: 16px;
  align-items: start;
  transition: grid-template-columns 0.25s ease;
}

.quote-shell.side-collapsed {
  grid-template-columns: minmax(0, 1fr) 16px;
}

.main-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

/* el-card 默认 overflow:hidden 会裁掉下拉浮层，此卡放开并抬高层级 */
.customer-card {
  overflow: visible;
  position: relative;
  z-index: 20;
}

.customer-card :deep(.el-card__body) {
  overflow: visible;
}

.quote-step-card :deep(.el-card__body) {
  padding: 14px 16px;
}

.customer-step-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.step-copy {
  min-width: 0;
}

.step-copy strong {
  display: block;
  font-size: 14px;
  color: #303133;
}

.step-copy span {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.customer-control-row {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.search-box {
  position: relative;
  flex: 1;
  min-width: 0;
}

.dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 100;
  max-height: 320px;
  overflow-y: auto;
  padding: 4px;
}

.dropdown-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
}

.dropdown-item.active,
.dropdown-item:hover {
  background: #fff4ed;
}

.dropdown-item span {
  color: #909399;
  font-size: 12px;
}

.dropdown-empty {
  padding: 12px;
  color: #909399;
  font-size: 13px;
  text-align: center;
}

.config-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid #e8ebf0;
  padding-top: 20px;
  margin: 0 0 12px;
}

.config-head h2 {
  margin: 0;
  font-size: 16px;
}

.config-sub {
  margin: 4px 0 0;
  color: #909399;
  font-size: 12px;
}

.quote-config-area {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px 20px;
  box-shadow: 0 1px 2px rgba(24, 39, 75, 0.04);
}

.output-box {
  padding: 2px 0 20px;
  margin-bottom: 0;
}

.step-section {
  background: #fff;
}

.output-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
  gap: 16px;
}

.section-title {
  display: flex;
  align-items: center;
  min-width: 0;
}

.section-title p {
  margin: 3px 0 0;
  color: #909399;
  font-size: 12px;
}

.output-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.format-title {
  margin: 0 0 8px;
  font-size: 12px;
  color: #909399;
}

/* 抬头（Header）与落款（Footer）并排一行 */
.output-header-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.output-field {
  margin-bottom: 12px;
  min-width: 0;
}

.field-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 4px;
}

.field-label span {
  font-size: 13px;
  font-weight: 600;
}

.field-label small {
  color: #c0c4cc;
  font-size: 12px;
}

.output-body {
  background: #fbfcfe;
  border: 1px dashed #dfe5ee;
  border-radius: 8px;
  padding: 14px 16px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  white-space: pre-wrap;
  min-height: 72px;
  margin: 4px 0 14px;
}

.notes-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.notes-row .el-tag {
  cursor: pointer;
}

.notes-label {
  color: #909399;
  font-size: 12px;
}

.check-list {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 16px;
  border-top: 1px dashed #ebeef5;
  padding-top: 10px;
}

.check-list small {
  width: 100%;
  color: #c0c4cc;
}

.item-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.item-card {
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 14px 16px;
}

.item-card.collapsed {
  padding: 0;
}

.summary-row {
  display: flex;
  align-items: center;
  width: 100%;
}

.summary-main {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: 110px 84px minmax(0, 1fr) 120px;
  align-items: center;
  gap: 10px;
  border: none;
  background: transparent;
  padding: 7px 12px;
  cursor: pointer;
  text-align: left;
  font-size: 12.5px;
}

.summary-actions {
  display: flex;
  align-items: center;
  flex: none;
  padding-right: 8px;
  border-left: 1px solid #f0f2f5;
}

.summary-actions .el-button {
  margin: 0;
  padding: 4px 5px;
}

.move-arrow {
  min-width: 24px;
  font-size: 14px;
  line-height: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.summary-row code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #606266;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-result {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #d9531e;
}

.summary-type {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff7a00;
  display: inline-block;
}

.item-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.item-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.item-title small {
  color: #c0c4cc;
}

.item-actions {
  display: flex;
  align-items: center;
}

.field-grid {
  display: grid;
  grid-template-columns: 0.8fr 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}

.field-grid label span,
.param-grid label span {
  display: block;
  font-size: 12px;
  color: #909399;
  margin-bottom: 4px;
}

.formula-box {
  background: #fafbfc;
  border: 1px solid #f0f2f5;
  border-radius: 8px;
  padding: 10px 12px;
}

.formula-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  flex-wrap: wrap;
  gap: 8px;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ops-label,
.result-hint {
  color: #909399;
  font-size: 12px;
}

.op-chip {
  border: 1px solid #dcdfe6;
  background: #fff;
  border-radius: 6px;
  min-width: 28px;
  height: 26px;
  cursor: pointer;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  padding: 0 8px;
}

.op-chip:hover {
  border-color: #ff7a00;
  color: #ff7a00;
}

.formula-error {
  color: #f56c6c;
  font-size: 12px;
  margin: 6px 0 0;
}

.param-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  margin-top: 8px;
  align-items: end;
}

.param-grid :deep(.el-input-number) {
  width: 100%;
}

.result-box {
  background: #fff4ed;
  border: 1px solid #f6b895;
  border-radius: 8px;
  padding: 6px 12px;
}

.result-box.error {
  background: #fef2f2;
  border-color: #fca5a5;
}

.result-box span {
  display: block;
  font-size: 12px;
  color: #909399;
}

.result-box strong {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #d9531e;
  font-size: 15px;
}

.add-row {
  margin-top: 14px;
}

.loading-card,
.empty-card {
  min-height: 320px;
}

.empty-card {
  display: flex;
  align-items: center;
  justify-content: center;
}

.side-col {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.side-toggle {
  position: absolute;
  left: -12px;
  top: 12px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid #dcdfe6;
  background: #fff;
  cursor: pointer;
  z-index: 5;
  line-height: 1;
}

.assist-card :deep(.el-card__body) {
  padding: 14px 16px;
}

.assist-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.assist-head.clickable {
  cursor: pointer;
  user-select: none;
}

.assist-head.clickable:hover h3 {
  color: #ff7a00;
}

.panel-chevron {
  display: inline-block;
  font-style: normal;
  color: #909399;
  transition: transform 0.2s ease;
  margin-right: 2px;
}

.panel-chevron.collapsed {
  transform: rotate(-90deg);
}

.panel-count {
  font-style: normal;
  font-weight: normal;
  font-size: 11px;
  color: #909399;
  background: #f0f2f5;
  border-radius: 999px;
  padding: 1px 8px;
  margin-left: 6px;
  vertical-align: middle;
}

.assist-head h3 {
  margin: 0;
  font-size: 14px;
}

.assist-actions {
  display: flex;
  gap: 6px;
}

.assist-meta {
  color: #909399;
  font-size: 12px;
  margin: 6px 0 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.online-pill {
  color: #67c23a;
  font-size: 12px;
}

.bench-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bench-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.bench-row > span:first-child {
  flex: 1;
}

.bench-head {
  color: #909399;
  font-size: 12px;
  border-bottom: 1px solid #f0f2f5;
  padding-bottom: 4px;
}

.bench-value {
  width: 110px;
}

.right {
  margin-left: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.channel-list {
  max-height: 420px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: opacity 0.3s;
}

.channel-list.updating {
  opacity: 0.45;
}

.channel-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fff8f3;
  border: 1px solid #ffe4d1;
  border-radius: 6px;
  padding: 5px 10px;
}

.channel-name {
  color: #d9531e;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.channel-row code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  font-weight: 600;
}
</style>
