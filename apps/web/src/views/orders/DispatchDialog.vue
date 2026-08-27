<script setup lang="ts">
import {
  DispatchChannel,
  type TradeOrderVO,
  type TreasuryAccountVO,
  type VaAccountVO,
} from "@bv/shared";
import { ElMessage } from "element-plus";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { createDispatch, fetchDispatchContext } from "@/api/order";

const visible = defineModel<boolean>({ required: true });
const props = defineProps<{ order: TradeOrderVO | null }>();
const emit = defineEmits<{ done: [order: TradeOrderVO] }>();

const { t } = useI18n();

const submitting = ref(false);
const vaAccounts = ref<VaAccountVO[]>([]);
const treasury = ref<TreasuryAccountVO[]>([]);
const form = reactive({ channel: DispatchChannel.SGB as DispatchChannel, va_account_id: "", payout_account: "", text: "" });

const sgb = computed(() => treasury.value.find(item => item.key.startsWith("bank-SGB-")));
const sino = computed(() => treasury.value.find(item => item.key.startsWith("bank-SINO-")));
const selectedVa = computed(() => vaAccounts.value.find(item => item.id === form.va_account_id) ?? null);

/** demo composeDispatchText 模板 */
function defaultPayoutAccount(): string {
  const order = props.order!;
  return form.channel === DispatchChannel.SGB
    ? `${(order.person_name || order.customer_name).toUpperCase()} SGB VA`
    : "pobo cq開-開";
}

function templateText(): string {
  const order = props.order!;
  const amount = order.buy_amount.toLocaleString("en-US", { minimumFractionDigits: 2 });
  const title = `補單:${order.customer_code || "无编号"}`;
  const raw = "（在此粘贴客户提供的收款账户资料，或直接编辑）";
  if (form.channel === DispatchChannel.SGB) {
    const va = selectedVa.value;
    return `* sgb（渠道2）\n\n${title}\n\n${raw}\n\n金額：${amount} ${order.buy_currency.toLowerCase()}\n出款帳戶：${form.payout_account || defaultPayoutAccount()}\nAccount 1：\nVirtual Account Number：${va?.virtual_account_number || "未匹配 VA"}\nIBAN：${va?.iban || "未匹配 VA"}\nCurrency：${va?.currency || order.buy_currency}`;
  }
  return `* sino(渠道1) pobo\n\n${title}\n${raw}\n\n金額: ${order.buy_currency}${amount}\n出款賬戶: ${form.payout_account || defaultPayoutAccount()}`;
}

watch(visible, async open => {
  if (!open || !props.order) return;
  const context = await fetchDispatchContext(props.order.id);
  vaAccounts.value = context.va_accounts;
  treasury.value = context.treasury;
  form.channel = vaAccounts.value.length ? DispatchChannel.SGB : DispatchChannel.SINO;
  form.va_account_id = vaAccounts.value[0]?.id ?? "";
  form.payout_account = defaultPayoutAccount();
  form.text = templateText();
});

watch(() => form.channel, () => {
  if (visible.value && props.order) {
    form.payout_account = defaultPayoutAccount();
    form.text = templateText();
  }
});

watch(() => [form.va_account_id, form.payout_account], () => {
  if (visible.value && props.order) form.text = templateText();
});

async function submit() {
  const order = props.order!;
  const text = form.text.trim();
  if (!text) return ElMessage.warning(t("orders.dispatch.warnEmptyText"));
  if (text.includes("（在此粘贴客户提供的收款账户资料，或直接编辑）")) {
    return ElMessage.warning(t("orders.dispatch.warnPlaceholderRemains"));
  }
  submitting.value = true;
  try {
    const updated = await createDispatch(order.id, {
      channel: form.channel,
      text,
      va_account_id: form.channel === DispatchChannel.SGB ? form.va_account_id || null : null,
      payout_account: form.payout_account.trim() || null,
    });
    ElMessage.success(t("orders.dispatch.submitted", { orderNo: order.order_no }));
    visible.value = false;
    emit("done", updated);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="`${t('orders.common.startDispatch')} · ${order?.order_no ?? ''}`" width="640px" :close-on-click-modal="false">
    <div class="channel-strip">
      <div><span>{{ t("orders.dispatch.sgbAvailable") }}</span><strong>{{ sgb ? `${sgb.currency} ${sgb.available.toLocaleString("en-US")}` : "—" }}</strong></div>
      <div><span>{{ t("orders.dispatch.sinoAvailable") }}</span><strong>{{ sino ? `${sino.currency} ${sino.available.toLocaleString("en-US")}` : "—" }}</strong></div>
      <div><span>{{ t("orders.dispatch.payableAmount") }}</span><strong>{{ order ? `${order.buy_currency} ${order.buy_amount.toLocaleString("en-US")}` : "—" }}</strong></div>
    </div>
    <el-form label-position="top">
      <div class="grid">
        <el-form-item :label="t('orders.dispatch.channel')">
          <el-radio-group v-model="form.channel">
            <el-radio-button :value="DispatchChannel.SGB">SGB</el-radio-button>
            <el-radio-button :value="DispatchChannel.SINO">SINO</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="t('orders.common.payoutAccount')">
          <el-input v-model="form.payout_account" maxlength="60" :placeholder="t('orders.dispatch.payoutAccountPlaceholder')" />
        </el-form-item>
        <el-form-item v-if="form.channel === 'SGB'" :label="t('orders.dispatch.vaAccount')">
          <el-select v-model="form.va_account_id" :placeholder="vaAccounts.length ? t('orders.dispatch.selectVa') : t('orders.dispatch.noVa')" style="width: 100%">
            <el-option
              v-for="va in vaAccounts"
              :key="va.id"
              :value="va.id"
              :label="`${va.label} · ${va.virtual_account_number} · ${va.currency}`"
            />
          </el-select>
        </el-form-item>
      </div>
      <el-form-item :label="t('orders.dispatch.textLabel')">
        <el-input v-model="form.text" type="textarea" :rows="12" class="mono-text" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ t("orders.common.cancel") }}</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">{{ t("orders.dispatch.submitReview") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.channel-strip {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 14px;
}

.channel-strip div {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 8px 12px;
}

.channel-strip span {
  display: block;
  color: #909399;
  font-size: 12px;
}

.grid {
  display: grid;
  grid-template-columns: auto 1fr 1fr;
  gap: 0 14px;
}

.mono-text :deep(textarea) {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.7;
}
</style>
