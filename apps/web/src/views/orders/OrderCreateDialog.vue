<script setup lang="ts">
import {
  ORDER_CURRENCIES,
  TRADE_TYPE_PRESETS,
  type CustomerVO,
  type KycScenarioVO,
  type QuoteCandidateVO,
  type TradeOrderVO,
} from "@bv/shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { fetchCustomers } from "@/api/customer";
import { fetchActiveScenarios } from "@/api/kyc";
import { createOrder, fetchQuoteCandidates } from "@/api/order";
import { formatDateTime } from "@/utils/format";

const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ created: [order: TradeOrderVO] }>();

const { t } = useI18n();

const submitting = ref(false);
const customerLoading = ref(false);
const customerOptions = ref<CustomerVO[]>([]);
const scenarios = ref<KycScenarioVO[]>([]);
const quotes = ref<QuoteCandidateVO[]>([]);

const form = reactive({
  customer_id: "",
  business_scenario_id: "",
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
  searchCustomers("");
  fetchActiveScenarios().then(list => {
    scenarios.value = list;
    if (!form.business_scenario_id && list.length) form.business_scenario_id = list[0].id;
  });
});

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
  }
}

function pickQuote(id: string) {
  const quote = quotes.value.find(item => item.quote_record_id === id);
  if (!quote) return;
  form.rate = quote.result;
  /* 审计 1.2.4：带出汇率后联动金额（仅在买入额未填时按 卖出×汇率 预填，可修改） */
  const rate = Number(quote.result);
  const sell = amountNumber(form.sell_amount);
  if (sell && !form.buy_amount && Number.isFinite(rate) && rate > 0) {
    form.buy_amount = String(Math.round(sell * rate * 100) / 100);
  }
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
  const pickedScenario = scenarios.value.find(item => item.id === form.business_scenario_id) ?? null;
  submitting.value = true;
  try {
    const order = await createOrder({
      customer_id: form.customer_id,
      business_type: pickedScenario?.scenario_name ?? null,
      business_scenario_id: form.business_scenario_id || null,
      trade_type: tradeType,
      sell_currency: form.sell_currency,
      sell_amount: sellAmount,
      buy_currency: form.buy_currency,
      buy_amount: buyAmount,
      rate: form.rate,
      pay_method: form.pay_method,
      remark: form.remark.trim() || null,
      quote_record_id: form.quote_record_id || null,
    });
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
  <el-dialog v-model="visible" :title="t('orders.create.title')" width="640px" :close-on-click-modal="false">
    <el-form label-position="top">
      <div class="grid">
        <el-form-item :label="t('orders.create.customer')" required>
          <el-select
            v-model="form.customer_id"
            filterable
            remote
            :remote-method="searchCustomers"
            :loading="customerLoading"
            :placeholder="t('orders.create.customerPlaceholder')"
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
          <el-select v-model="form.business_scenario_id" clearable :placeholder="t('orders.create.bizScenarioPlaceholder')" style="width: 100%">
            <el-option v-for="s in scenarios" :key="s.id" :value="s.id" :label="`#${s.scenario_code} · ${s.scenario_name}`" />
          </el-select>
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
      <div class="grid legs">
        <el-form-item :label="t('orders.common.customerSell')" required>
          <el-input
            v-model="form.sell_amount"
            inputmode="decimal"
            :formatter="fmtThousands"
            :parser="parseAmount"
            :placeholder="t('orders.create.amountPlaceholder')"
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
          >
            <template #prepend>
              <el-select v-model="form.buy_currency" style="width: 90px">
                <el-option v-for="c in ORDER_CURRENCIES" :key="c" :value="c" :label="c" />
              </el-select>
            </template>
          </el-input>
        </el-form-item>
      </div>
      <div class="grid">
        <el-form-item :label="t('orders.common.execRate')" required>
          <el-input v-model="form.rate" maxlength="20" />
        </el-form-item>
        <el-form-item :label="t('orders.create.quoteLink')">
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
      <el-button @click="visible = false">{{ t("orders.common.cancel") }}</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">{{ t("orders.create.submit") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 14px;
}
</style>
