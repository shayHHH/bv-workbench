<script setup lang="ts">
import {
  ORDER_CURRENCIES,
  TRADE_TYPE_PRESETS,
  type CustomBusinessTypeVO,
  type AccessApplicationVO,
  type CustomerVO,
  type KycScenarioVO,
  type QuoteCandidateVO,
  type TradeOrderVO,
} from "@bv/shared";
import { Delete } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { fetchApplications } from "@/api/access";
import { fetchCustomers } from "@/api/customer";
import { fetchActiveScenarios } from "@/api/kyc";
import {
  createCustomBusinessType,
  createOrder,
  deleteCustomBusinessType,
  deleteOrder,
  fetchCustomBusinessTypes,
  fetchQuoteCandidates,
  updateOrder,
} from "@/api/order";
import { formatDateTime } from "@/utils/format";

const visible = defineModel<boolean>({ required: true });
/** 传入 order 即进入编辑模式（排单审核前可改），不传为新建 */
const props = defineProps<{ order?: TradeOrderVO | null }>();
const emit = defineEmits<{ created: [order: TradeOrderVO]; updated: [order: TradeOrderVO]; deleted: [orderId: string] }>();

const { t } = useI18n();

const isEdit = computed(() => !!props.order);

const submitting = ref(false);
const deleting = ref(false);

/** 删除订单：可编辑场景同口径；冻结资金由服务端释放后软删除 */
async function doDelete() {
  const order = props.order;
  if (!order) return;
  try {
    await ElMessageBox.confirm(
      t("orders.edit.deleteConfirmBody", {
        customer: order.customer_name,
        sell: `${order.sell_currency} ${order.sell_amount.toLocaleString("en-US")}`,
        buy: `${order.buy_currency} ${order.buy_amount.toLocaleString("en-US")}`,
      }),
      t("orders.edit.deleteConfirmTitle", { orderNo: order.order_no }),
      { type: "warning", confirmButtonText: t("orders.edit.confirmDelete"), cancelButtonText: t("orders.common.cancel") },
    );
  } catch {
    return;
  }
  deleting.value = true;
  try {
    await deleteOrder(order.id);
    ElMessage.success(t("orders.edit.deleted", { orderNo: order.order_no }));
    visible.value = false;
    emit("deleted", order.id);
  } finally {
    deleting.value = false;
  }
}
const customerLoading = ref(false);
const customerOptions = ref<CustomerVO[]>([]);
const scenarios = ref<KycScenarioVO[]>([]);
const quotes = ref<QuoteCandidateVO[]>([]);

const customTypes = ref<CustomBusinessTypeVO[]>([]);

/**
 * 准入业务类型下拉同时容纳两类来源：
 * `scenario:<id>` — KYC 配置的业务类型（带渠道与材料清单）
 * 名称原文        — 交易员手填的自定义类型（无材料清单，建单时 business_scenario_id 留空）
 * 自定义项的 value 刻意与 allow-create 生成的临时选项一致，避免选中后还要改值导致输入框显示为空。
 */
const SCENARIO_PREFIX = "scenario:";

const form = reactive({
  customer_id: "",
  business_option: "",
  trade_type: "转账换U",
  custom_trade_type: "",
  sell_currency: "USD",
  sell_amount: "",
  buy_currency: "USDT",
  buy_amount: "",
  rate: "1.0020",
  pay_method: "银行转账",
  quote_record_id: "",
  remark: "",
});

const PAY_METHODS = ["银行转账", "现金", "USDT 转入"];

/* 金额输入千分位：展示层加 ","，模型值保持纯数字字符串 */
const fmtThousands = (value: string) => {
  if (!value) return "";
  const [int, dec] = String(value).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec !== undefined ? `${grouped}.${dec}` : grouped;
};
const parseAmount = (value: string) =>
  value
    .replace(/[^\d.]/g, "")
    .replace(/^\./, "")
    .replace(/(\.\d*)\./g, "$1");
const amountNumber = (value: string) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
};

/**
 * 金额与汇率三向联动（买入 = 卖出 × 汇率；卖出 = 买入 ÷ 汇率）。
 * autoCalc 开时联动，关时买入/卖出可独立手动录入（对不规则收付、含手续费差额等场景）。
 * lastEdited 记录用户最近手动改的是哪一腿，汇率变化时按它反推另一腿，避免互相覆盖成环。
 * 联动写回走程序化赋值，不触发 @input，天然不会二次循环。
 */
const autoCalc = ref(true);
const lastEdited = ref<"sell" | "buy">("sell");
const rateNumber = () => {
  const num = Number(form.rate);
  return Number.isFinite(num) && num > 0 ? num : null;
};
const round2 = (num: number) => String(Math.round(num * 100) / 100);

function recalcBuy() {
  const sell = amountNumber(form.sell_amount);
  const rate = rateNumber();
  if (sell && rate) form.buy_amount = round2(sell * rate);
}
function recalcSell() {
  const buy = amountNumber(form.buy_amount);
  const rate = rateNumber();
  if (buy && rate) form.sell_amount = round2(buy / rate);
}
function recalcByLast() {
  if (!autoCalc.value) return;
  if (lastEdited.value === "buy") recalcSell();
  else recalcBuy();
}
function onSellInput() {
  lastEdited.value = "sell";
  if (autoCalc.value) recalcBuy();
}
function onBuyInput() {
  lastEdited.value = "buy";
  if (autoCalc.value) recalcSell();
}
function onRateInput() {
  recalcByLast();
}
/** 从手动切回自动时，立即按最近编辑腿补算一次，避免两腿不自洽 */
function onAutoCalcChange(on: boolean) {
  if (on) recalcByLast();
}

/** 弹窗内展示的计算式：跟随最近编辑腿显示方向与实时代入值 */
const calcExpr = computed(() => {
  const rate = form.rate?.trim() || "汇率";
  if (lastEdited.value === "buy") {
    const buy = form.buy_amount ? fmtThousands(form.buy_amount) : "买入";
    const sell = form.sell_amount ? fmtThousands(form.sell_amount) : "—";
    return `卖出 = 买入 ÷ 汇率 = ${buy} ÷ ${rate} = ${sell} ${form.sell_currency}`;
  }
  const sell = form.sell_amount ? fmtThousands(form.sell_amount) : "卖出";
  const buy = form.buy_amount ? fmtThousands(form.buy_amount) : "—";
  return `买入 = 卖出 × 汇率 = ${sell} × ${rate} = ${buy} ${form.buy_currency}`;
});

async function searchCustomers(keyword: string) {
  customerLoading.value = true;
  try {
    const page = await fetchCustomers({ keyword: keyword || undefined, page: 1, page_size: 20 });
    customerOptions.value = page.items.flatMap(item => [item, ...(item.sub_customers ?? [])]);
  } finally {
    customerLoading.value = false;
  }
}

watch(visible, open => {
  if (!open) return;
  const order = props.order;
  /* 每次打开复位联动态：默认自动计算；编辑模式两腿金额已定，不主动重算以免覆盖历史值 */
  autoCalc.value = !order;
  lastEdited.value = "sell";
  searchCustomers(order?.customer_name ?? "");
  fetchActiveScenarios().then(list => {
    scenarios.value = list;
    /* 编辑模式回填订单已选业务类型：有 scenario_id 走 KYC 配置，否则按自定义类型名称回填 */
    if (order) {
      form.business_option = order.business_scenario_id
        ? `${SCENARIO_PREFIX}${order.business_scenario_id}`
        : (order.business_type ?? "");
      return;
    }
    if (!form.business_option && list.length) form.business_option = `${SCENARIO_PREFIX}${list[0].id}`;
  });
  loadCustomTypes();
  if (order) prefillFromOrder(order);
});

/** 编辑模式：把订单值回填进表单（业务类型在 scenarios 加载后单独回填） */
function prefillFromOrder(order: TradeOrderVO) {
  const preset = Object.keys(TRADE_TYPE_PRESETS).includes(order.trade_type);
  Object.assign(form, {
    customer_id: order.customer_id,
    trade_type: preset ? order.trade_type : "自定义",
    custom_trade_type: preset ? "" : order.trade_type,
    sell_currency: order.sell_currency,
    sell_amount: String(order.sell_amount),
    buy_currency: order.buy_currency,
    buy_amount: String(order.buy_amount),
    rate: order.rate,
    pay_method: order.pay_method,
    quote_record_id: "",
    remark: order.remark ?? "",
  });
}

async function loadCustomTypes() {
  customTypes.value = await fetchCustomBusinessTypes();
}

/** 已选业务类型解析为建单入参：自定义类型只留名称，不带 scenario_id */
const pickedBusiness = computed<{ business_type: string | null; business_scenario_id: string | null }>(() => {
  const value = form.business_option.trim();
  if (!value) return { business_type: null, business_scenario_id: null };
  if (value.startsWith(SCENARIO_PREFIX)) {
    const id = value.slice(SCENARIO_PREFIX.length);
    const scenario = scenarios.value.find(item => item.id === id) ?? null;
    return { business_type: scenario?.scenario_name ?? null, business_scenario_id: scenario ? id : null };
  }
  return { business_type: value, business_scenario_id: null };
});

/* 条件性放行提醒（提示性，不阻断建单）：该客户+业务类型存在附条件通过/逾期受限的准入申请时展示 */
const deferralNotice = ref<AccessApplicationVO | null>(null);

watch(
  () => [form.customer_id, form.business_option],
  async () => {
    deferralNotice.value = null;
    const scenarioId = pickedBusiness.value.business_scenario_id;
    if (!form.customer_id || !scenarioId) return;
    try {
      const page = await fetchApplications({ customer_id: form.customer_id, page_size: 50 });
      deferralNotice.value =
        page.items.find(
          app =>
            app.scenario_id === scenarioId &&
            (app.status === "APPROVED_CONDITIONAL" || app.status === "DEFERRAL_OVERDUE") &&
            app.deferral,
        ) ?? null;
    } catch {
      deferralNotice.value = null;
    }
  },
);

const deferralNoticeText = computed(() => {
  const app = deferralNotice.value;
  if (!app?.deferral) return "";
  const key = app.status === "DEFERRAL_OVERDUE" ? "orders.create.deferralOverdue" : "orders.create.deferralConditional";
  return t(key, {
    due: formatDateTime(app.deferral.due_at),
    missing: app.deferral.missing_item_names.join("、"),
    limit: app.deferral.limit_amount
      ? t("orders.create.deferralLimit", { limit: `${app.deferral.limit_currency} ${app.deferral.limit_amount.toLocaleString("en-US")}` })
      : "",
  });
});

/** allow-create：选中值不是 KYC 业务类型、也不在已有自定义列表里时，落库为新的自定义类型 */
async function onBusinessOptionChange(value: string) {
  const name = (value ?? "").trim();
  if (!name || name.startsWith(SCENARIO_PREFIX)) return;
  if (customTypes.value.some(item => item.name === name)) return;
  try {
    const created = await createCustomBusinessType(name);
    customTypes.value = [created, ...customTypes.value];
    ElMessage.success(t("orders.create.customBizAdded", { name: created.name }));
  } catch {
    /* 重名等错误由 http 拦截器提示，回退到未选中 */
    form.business_option = "";
  }
}

async function removeCustomType(item: CustomBusinessTypeVO) {
  try {
    await ElMessageBox.confirm(
      item.order_count > 0
        ? t("orders.create.customBizDeleteInUse", { name: item.name, count: item.order_count })
        : t("orders.create.customBizDeleteBody", { name: item.name }),
      t("orders.create.customBizDeleteTitle"),
      { confirmButtonText: t("orders.create.customBizDeleteOk"), cancelButtonText: t("orders.common.cancel"), type: "warning" },
    );
  } catch {
    return;
  }
  await deleteCustomBusinessType(item.id);
  customTypes.value = customTypes.value.filter(row => row.id !== item.id);
  if (form.business_option === item.name) form.business_option = "";
  ElMessage.success(t("orders.create.customBizDeleted", { name: item.name }));
}

watch(() => form.customer_id, id => {
  quotes.value = [];
  form.quote_record_id = "";
  if (id) fetchQuoteCandidates(id).then(list => (quotes.value = list));
});

function applyTradeTypePreset(type: string) {
  /* 审计 1.2.3：切换交易类型会重置币种与预设汇率，与已选报价冲突，先清除关联 */
  if (form.quote_record_id) {
    form.quote_record_id = "";
    ElMessage.info(t("orders.create.typeChangedQuoteCleared"));
  }
  const preset = TRADE_TYPE_PRESETS[type];
  if (preset) {
    form.sell_currency = preset[0];
    form.buy_currency = preset[1];
    form.rate = preset[2];
    form.pay_method = preset[0] === "USDT" ? "USDT 转入" : type.includes("现金") ? "现金" : "银行转账";
    recalcByLast();
  }
}

function pickQuote(id: string) {
  const quote = quotes.value.find(item => item.quote_record_id === id);
  if (!quote) return;
  form.rate = quote.result;
  /* 审计 1.2.4：带出汇率后按最近编辑腿联动金额（买入=卖出×汇率 / 卖出=买入÷汇率） */
  recalcByLast();
}

async function submit() {
  const tradeType = form.trade_type === "自定义" ? form.custom_trade_type.trim() : form.trade_type;
  if (!form.customer_id) return ElMessage.warning(t("orders.create.selectCustomer"));
  if (!tradeType) return ElMessage.warning(t("orders.create.selectTradeType"));
  const sellAmount = amountNumber(form.sell_amount);
  const buyAmount = amountNumber(form.buy_amount);
  if (!sellAmount) return ElMessage.warning(t("orders.create.fillSellAmount"));
  if (!buyAmount) return ElMessage.warning(t("orders.create.fillBuyAmount"));
  /* 审计 1.2.6：执行汇率与关联报价不一致时要求确认 */
  const pickedQuote = form.quote_record_id
    ? quotes.value.find(item => item.quote_record_id === form.quote_record_id)
    : null;
  if (pickedQuote && form.rate.trim() !== pickedQuote.result) {
    try {
      await ElMessageBox.confirm(
        t("orders.create.rateMismatchConfirm", { rate: form.rate, quoteRate: pickedQuote.result }),
        t("orders.create.rateMismatchTitle"),
        { confirmButtonText: t("orders.create.confirmCreate"), cancelButtonText: t("orders.create.backToEdit") },
      );
    } catch {
      return;
    }
  }
  submitting.value = true;
  try {
    const payload = {
      business_type: pickedBusiness.value.business_type,
      business_scenario_id: pickedBusiness.value.business_scenario_id,
      trade_type: tradeType,
      sell_currency: form.sell_currency,
      sell_amount: sellAmount,
      buy_currency: form.buy_currency,
      buy_amount: buyAmount,
      rate: form.rate,
      pay_method: form.pay_method,
      remark: form.remark.trim() || null,
    };
    if (props.order) {
      const order = await updateOrder(props.order.id, payload);
      ElMessage.success(t("orders.edit.saved", { orderNo: order.order_no }));
      visible.value = false;
      emit("updated", order);
      return;
    }
    const order = await createOrder({ ...payload, customer_id: form.customer_id, quote_record_id: form.quote_record_id || null });
    ElMessage.success(t("orders.create.createdSuccess", {
      orderNo: order.order_no,
      next: order.status === "PENDING_KYC" ? t("orders.create.createdNextPendingKyc") : t("orders.create.createdNextInflow"),
    }));
    visible.value = false;
    emit("created", order);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? t('orders.edit.title', { orderNo: props.order?.order_no }) : t('orders.create.title')"
    width="640px"
    :close-on-click-modal="false"
  >
    <el-alert
      v-if="isEdit && props.order?.freeze?.state === 'FROZEN'"
      type="warning"
      :closable="false"
      show-icon
      class="edit-freeze-tip"
      :title="t('orders.edit.frozenTip', { amount: `${props.order.freeze.currency} ${Number(props.order.freeze.amount).toLocaleString('en-US')}` })"
    />
    <el-alert
      v-if="deferralNotice"
      :type="deferralNotice.status === 'DEFERRAL_OVERDUE' ? 'error' : 'warning'"
      :closable="false"
      show-icon
      class="deferral-alert"
      :title="deferralNoticeText"
    />
    <el-form label-position="top">
      <div class="grid">
        <el-form-item :label="t('orders.create.customer')" required>
          <!-- 编辑模式锁定客户：客户是订单主体，换客户请删除后重建 -->
          <el-select
            v-model="form.customer_id"
            filterable
            remote
            :remote-method="searchCustomers"
            :loading="customerLoading"
            :placeholder="t('orders.create.customerPlaceholder')"
            :disabled="isEdit"
            style="width: 100%"
          >
            <el-option
              v-for="customer in customerOptions"
              :key="customer.id"
              :value="customer.id"
              :label="customer.customer_code ? `${customer.name}（${customer.customer_code}）` : customer.name"
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('orders.create.bizScenario')">
          <el-select
            v-model="form.business_option"
            clearable
            filterable
            allow-create
            default-first-option
            :placeholder="t('orders.create.bizScenarioPlaceholder')"
            style="width: 100%"
            @change="onBusinessOptionChange"
          >
            <el-option
              v-for="s in scenarios"
              :key="s.id"
              :value="`scenario:${s.id}`"
              :label="`#${s.scenario_code} · ${s.scenario_name}`"
            />
            <el-option
              v-for="item in customTypes"
              :key="item.id"
              :value="item.name"
              :label="item.name"
            >
              <span class="custom-option">
                <span class="custom-name">
                  {{ item.name }}
                  <em>{{ t("orders.create.customBizTag") }}</em>
                </span>
                <el-button
                  :icon="Delete"
                  link
                  size="small"
                  :title="t('orders.create.customBizDeleteTitle')"
                  @click.stop="removeCustomType(item)"
                />
              </span>
            </el-option>
          </el-select>
          <div class="biz-hint">{{ t("orders.create.bizScenarioHint") }}</div>
        </el-form-item>
      </div>
      <div class="grid">
        <el-form-item :label="t('orders.create.tradeType')" required>
          <el-select v-model="form.trade_type" style="width: 100%" @change="applyTradeTypePreset">
            <el-option v-for="type in Object.keys(TRADE_TYPE_PRESETS)" :key="type" :value="type" :label="type" />
            <el-option value="自定义" :label="t('orders.create.customTypeOption')" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.trade_type === '自定义'" :label="t('orders.create.customType')" required>
          <el-input v-model="form.custom_trade_type" maxlength="30" />
        </el-form-item>
        <el-form-item v-else :label="t('orders.create.payMethod')">
          <el-select v-model="form.pay_method" style="width: 100%">
            <el-option v-for="method in PAY_METHODS" :key="method" :value="method" :label="method" />
          </el-select>
        </el-form-item>
      </div>
      <div class="legs-head">
        <span class="legs-title">{{ t("orders.common.customerSell") }} / {{ t("orders.common.customerBuy") }}</span>
        <el-switch
          v-model="autoCalc"
          inline-prompt
          active-text="自动计算"
          inactive-text="手动录入"
          style="--el-switch-on-color: #ff7a00"
          @change="onAutoCalcChange"
        />
      </div>
      <div class="grid legs">
        <el-form-item :label="t('orders.common.customerSell')" required>
          <el-input
            v-model="form.sell_amount"
            inputmode="decimal"
            :formatter="fmtThousands"
            :parser="parseAmount"
            :placeholder="t('orders.create.amountPlaceholder')"
            @input="onSellInput"
          >
            <template #prepend>
              <el-select v-model="form.sell_currency" style="width: 90px">
                <el-option v-for="c in ORDER_CURRENCIES" :key="c" :value="c" :label="c" />
              </el-select>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item :label="t('orders.common.customerBuy')" required>
          <el-input
            v-model="form.buy_amount"
            inputmode="decimal"
            :formatter="fmtThousands"
            :parser="parseAmount"
            :placeholder="t('orders.create.amountPlaceholder')"
            @input="onBuyInput"
          >
            <template #prepend>
              <el-select v-model="form.buy_currency" style="width: 90px">
                <el-option v-for="c in ORDER_CURRENCIES" :key="c" :value="c" :label="c" />
              </el-select>
            </template>
          </el-input>
        </el-form-item>
      </div>
      <div v-if="autoCalc" class="calc-expr">
        <span class="calc-icon">∑</span>{{ calcExpr }}
      </div>
      <div v-else class="calc-expr manual">
        手动录入模式：买入 / 卖出金额独立填写，不随汇率联动。
      </div>
      <div class="grid">
        <el-form-item :label="t('orders.common.execRate')" required>
          <el-input v-model="form.rate" maxlength="20" @input="onRateInput" />
        </el-form-item>
        <!-- 关联报价是建单时的一次性留档，编辑时不再改动 -->
        <el-form-item v-if="!isEdit" :label="t('orders.create.quoteLink')">
          <el-select v-model="form.quote_record_id" clearable :placeholder="t('orders.create.quoteLinkPlaceholder')" style="width: 100%" @change="pickQuote">
            <el-option
              v-for="quote in quotes"
              :key="quote.quote_record_id"
              :value="quote.quote_record_id"
              :label="`${quote.trade_type}${quote.prefix ? `（${quote.prefix}）` : ''} · ${quote.result} · ${formatDateTime(quote.quoted_at)}`"
            />
          </el-select>
        </el-form-item>
      </div>
      <el-form-item :label="t('orders.common.remark')">
        <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="500" :placeholder="t('orders.create.remarkPlaceholder')" />
      </el-form-item>
    </el-form>
    <template #footer>
      <div class="footer-row">
        <!-- 可编辑的订单同样可删除（同一状态口径，服务端二次校验） -->
        <el-button v-if="isEdit" type="danger" plain :loading="deleting" @click="doDelete">
          {{ t("orders.edit.deleteAction") }}
        </el-button>
        <span class="footer-spacer" />
        <el-button @click="visible = false">{{ t("orders.common.cancel") }}</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">
          {{ isEdit ? t("orders.edit.submit") : t("orders.create.submit") }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 14px;
}

.legs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.legs-title {
  font-size: 13px;
  color: #606266;
  font-weight: 500;
}

.calc-expr {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #fff8f1;
  border: 1px solid #ffe1c4;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 14px;
  font-size: 13px;
  color: #c2660a;
  font-variant-numeric: tabular-nums;
}

.calc-expr.manual {
  background: #f5f7fa;
  border-color: #e4e7ed;
  color: #909399;
}

.calc-icon {
  font-weight: 700;
}

.biz-hint {
  color: #909399;
  font-size: 12px;
  line-height: 1.5;
  margin-top: 2px;
}

.custom-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.custom-name em {
  font-style: normal;
  color: #ff7a00;
  background: #fff4e8;
  border-radius: 4px;
  padding: 0 5px;
  font-size: 11px;
  margin-left: 6px;
}

.footer-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.footer-spacer {
  flex: 1;
}
.deferral-alert {
  margin-bottom: 12px;
}
</style>
