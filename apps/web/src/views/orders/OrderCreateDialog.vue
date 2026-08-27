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
import { fetchCustomers } from "@/api/customer";
import { fetchActiveScenarios } from "@/api/kyc";
import { createOrder, fetchQuoteCandidates } from "@/api/order";
import { formatDateTime } from "@/utils/format";

const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ created: [order: TradeOrderVO] }>();

const submitting = ref(false);
const customerLoading = ref(false);
const customerOptions = ref<CustomerVO[]>([]);
const scenarios = ref<KycScenarioVO[]>([]);
const quotes = ref<QuoteCandidateVO[]>([]);

const form = reactive({
  customer_id: "",
  business_scenario_id: "",
  person_name: "",
  trade_type: "转账换U",
  custom_trade_type: "",
  sell_currency: "USD",
  sell_amount: null as number | null,
  buy_currency: "USDT",
  buy_amount: null as number | null,
  rate: "1.0020",
  pay_method: "银行转账",
  quote_record_id: "",
  remark: "",
});

const PAY_METHODS = ["银行转账", "现金", "USDT 转入"];

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
    ElMessage.info("交易类型已变更，已清除关联报价，请重新选择");
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
  if (form.sell_amount && !form.buy_amount && Number.isFinite(rate) && rate > 0) {
    form.buy_amount = Math.round(form.sell_amount * rate * 100) / 100;
  }
}

async function submit() {
  const tradeType = form.trade_type === "自定义" ? form.custom_trade_type.trim() : form.trade_type;
  if (!form.customer_id) return ElMessage.warning("请选择客户");
  if (!tradeType) return ElMessage.warning("请选择或输入交易类型");
  if (!form.sell_amount) return ElMessage.warning("请填写客户卖出金额");
  if (!form.buy_amount) return ElMessage.warning("请填写客户买入金额（两侧金额均需手动填写）");
  /* 审计 1.2.6：执行汇率与关联报价不一致时要求确认 */
  const pickedQuote = form.quote_record_id
    ? quotes.value.find(item => item.quote_record_id === form.quote_record_id)
    : null;
  if (pickedQuote && form.rate.trim() !== pickedQuote.result) {
    try {
      await ElMessageBox.confirm(
        `执行汇率（${form.rate}）与关联报价（${pickedQuote.result}）不一致，确认按执行汇率 ${form.rate} 建单？`,
        "汇率不一致",
        { confirmButtonText: "确认建单", cancelButtonText: "返回修改" },
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
      person_name: form.person_name.trim() || null,
      trade_type: tradeType,
      sell_currency: form.sell_currency,
      sell_amount: form.sell_amount,
      buy_currency: form.buy_currency,
      buy_amount: form.buy_amount,
      rate: form.rate,
      pay_method: form.pay_method,
      remark: form.remark.trim() || null,
      quote_record_id: form.quote_record_id || null,
    });
    ElMessage.success(`订单已创建：${order.order_no} · ${order.status === "PENDING_KYC" ? "进入待KYC" : "KYC已通过，进入待客户入款"}`);
    visible.value = false;
    emit("created", order);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="新建交易订单" width="640px" :close-on-click-modal="false">
    <el-form label-position="top">
      <div class="grid">
        <el-form-item label="客户" required>
          <el-select
            v-model="form.customer_id"
            filterable
            remote
            :remote-method="searchCustomers"
            :loading="customerLoading"
            placeholder="输入客户名称 / 编号搜索"
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
        <el-form-item label="准入业务类型">
          <el-select v-model="form.business_scenario_id" clearable placeholder="决定订单 KYC 校验口径" style="width: 100%">
            <el-option v-for="s in scenarios" :key="s.id" :value="s.id" :label="`#${s.scenario_code} · ${s.scenario_name}`" />
          </el-select>
        </el-form-item>
      </div>
      <div class="grid">
        <el-form-item label="交易类型" required>
          <el-select v-model="form.trade_type" style="width: 100%" @change="applyTradeTypePreset">
            <el-option v-for="type in Object.keys(TRADE_TYPE_PRESETS)" :key="type" :value="type" :label="type" />
            <el-option value="自定义" label="自定义…" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.trade_type === '自定义'" label="自定义类型" required>
          <el-input v-model="form.custom_trade_type" maxlength="30" />
        </el-form-item>
        <el-form-item v-else label="收款方式">
          <el-select v-model="form.pay_method" style="width: 100%">
            <el-option v-for="method in PAY_METHODS" :key="method" :value="method" :label="method" />
          </el-select>
        </el-form-item>
      </div>
      <div class="grid legs">
        <el-form-item label="客户卖出" required>
          <el-input v-model.number="form.sell_amount" type="number" placeholder="金额">
            <template #prepend>
              <el-select v-model="form.sell_currency" style="width: 90px">
                <el-option v-for="c in ORDER_CURRENCIES" :key="c" :value="c" :label="c" />
              </el-select>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="客户买入" required>
          <el-input v-model.number="form.buy_amount" type="number" placeholder="金额">
            <template #prepend>
              <el-select v-model="form.buy_currency" style="width: 90px">
                <el-option v-for="c in ORDER_CURRENCIES" :key="c" :value="c" :label="c" />
              </el-select>
            </template>
          </el-input>
        </el-form-item>
      </div>
      <div class="grid">
        <el-form-item label="执行汇率" required>
          <el-input v-model="form.rate" maxlength="20" />
        </el-form-item>
        <el-form-item label="关联报价（客户近期报价记录）">
          <el-select v-model="form.quote_record_id" clearable placeholder="可选；选择后带入汇率" style="width: 100%" @change="pickQuote">
            <el-option
              v-for="quote in quotes"
              :key="quote.quote_record_id"
              :value="quote.quote_record_id"
              :label="`${quote.trade_type}${quote.prefix ? `（${quote.prefix}）` : ''} · ${quote.result} · ${formatDateTime(quote.quoted_at)}`"
            />
          </el-select>
        </el-form-item>
      </div>
      <el-form-item label="客户英文名 / 收款人名">
        <el-input v-model="form.person_name" maxlength="80" placeholder="用于出款排单收款要素（可选）" />
      </el-form-item>
      <el-form-item label="备注说明">
        <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="500" placeholder="交收要求、渠道约定等（可选）" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">创建订单</el-button>
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
