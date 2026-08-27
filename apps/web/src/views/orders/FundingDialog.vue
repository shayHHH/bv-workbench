<script setup lang="ts">
import {
  FundingKind,
  FundingKindLabel,
  fundingKindOf,
  type FundingSide,
  type TradeOrderVO,
} from "@bv/shared";
import { ElMessage } from "element-plus";
import { computed, reactive, watch } from "vue";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
import { inflowConfirm, outflowExecute } from "@/api/order";

const visible = defineModel<boolean>({ required: true });
const props = defineProps<{ order: TradeOrderVO | null; side: FundingSide }>();
const emit = defineEmits<{ done: [order: TradeOrderVO] }>();

const { t } = useI18n();

const submitting = ref(false);
const form = reactive({
  amount: 0,
  account: "",
  voucher: "",
  chain: "TRC20",
  hash: "",
  confirms: "",
  place: "",
  handler: "",
  token: "",
  method: "电汇转账",
  note: "",
});

const kind = computed(() => (props.order ? fundingKindOf(props.order, props.side) : FundingKind.BANK));
const currency = computed(() =>
  props.order ? (props.side === "inflow" ? props.order.sell_currency : props.order.buy_currency) : "",
);

watch(visible, open => {
  if (!open || !props.order) return;
  form.amount = props.side === "inflow" ? props.order.sell_amount : props.order.buy_amount;
  form.account = "";
  form.voucher = "";
  form.hash = "";
  form.confirms = "";
  form.place = "";
  form.handler = "";
  form.token = "";
  form.note = "";
  form.method = kind.value === FundingKind.CHAIN ? "链上收款" : "电汇转账";
});

const title = computed(() => {
  if (!props.order) return "";
  if (props.side === "inflow") {
    return kind.value === FundingKind.CHAIN
      ? t("orders.common.markChainInflow")
      : kind.value === FundingKind.CASH
        ? t("orders.common.confirmCashSettle")
        : t("orders.common.registerFiatInflow");
  }
  return kind.value === FundingKind.CHAIN
    ? t("orders.common.registerChainTransfer")
    : kind.value === FundingKind.CASH
      ? t("orders.common.registerCashDelivery")
      : t("orders.common.payoutRegister");
});

async function submit() {
  const order = props.order!;
  if (kind.value === FundingKind.CHAIN && !form.hash.trim()) return ElMessage.warning(t("orders.funding.warnHash"));
  if (kind.value === FundingKind.CHAIN && !form.confirms.trim()) return ElMessage.warning(t("orders.funding.warnConfirms"));
  if (kind.value === FundingKind.CASH && !form.place.trim()) return ElMessage.warning(t("orders.funding.warnPlace"));
  if (kind.value === FundingKind.BANK && props.side === "outflow" && !form.account.trim()) return ElMessage.warning(t("orders.funding.warnAccount"));
  submitting.value = true;
  try {
    const payload = {
      amount: form.amount,
      account: form.account.trim() || null,
      voucher: form.voucher.trim() || null,
      chain: form.chain,
      hash: form.hash.trim() || null,
      confirms: form.confirms,
      place: form.place.trim() || null,
      handler: form.handler.trim() || null,
      token: form.token.trim() || null,
      method: form.method,
      note: form.note.trim() || null,
    };
    const updated =
      props.side === "inflow" ? await inflowConfirm(order.id, payload) : await outflowExecute(order.id, payload);
    ElMessage.success(
      props.side === "inflow"
        ? t("orders.funding.inflowDone", { orderNo: order.order_no })
        : t("orders.funding.outflowDone", { orderNo: order.order_no }),
    );
    visible.value = false;
    emit("done", updated);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="`${title} · ${order?.order_no ?? ''}`" width="520px" :close-on-click-modal="false">
    <p class="brief">
      {{ order?.customer_name }} · {{ side === "inflow" ? t("orders.common.receivable") : t("orders.common.payable") }}
      <strong>{{ currency }} {{ (side === "inflow" ? order?.sell_amount : order?.buy_amount)?.toLocaleString("en-US") }}</strong>
      · {{ localizeText(FundingKindLabel[kind]) }}
    </p>
    <el-form label-position="top">
      <el-form-item :label="side === 'inflow' ? t('orders.funding.actualInflowAmount') : t('orders.funding.actualOutflowAmount')" required>
        <el-input v-model.number="form.amount" type="number">
          <template #prepend>{{ currency }}</template>
        </el-input>
      </el-form-item>

      <template v-if="kind === FundingKind.CHAIN">
        <div class="grid">
          <el-form-item :label="t('orders.funding.chain')">
            <el-select v-model="form.chain" style="width: 100%">
              <el-option value="TRC20" label="TRC20" />
              <el-option value="ERC20" label="ERC20" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('orders.funding.confirms')">
            <el-input v-model="form.confirms" />
          </el-form-item>
        </div>
        <el-form-item label="Transaction Hash" required>
          <el-input v-model="form.hash" :placeholder="t('orders.funding.hashPlaceholder')" />
        </el-form-item>
      </template>

      <template v-else-if="kind === FundingKind.CASH">
        <el-form-item :label="t('orders.common.settlePlace')" required>
          <el-input v-model="form.place" :placeholder="t('orders.funding.placePlaceholder')" />
        </el-form-item>
        <div class="grid">
          <el-form-item :label="t('orders.funding.handler')">
            <el-input v-model="form.handler" />
          </el-form-item>
          <el-form-item :label="t('orders.funding.token')">
            <el-input v-model="form.token" />
          </el-form-item>
        </div>
      </template>

      <template v-else>
        <el-form-item :label="side === 'inflow' ? t('orders.funding.inflowAccount') : t('orders.common.payoutAccount')" :required="side === 'outflow'">
          <el-input v-model="form.account" :placeholder="t('orders.funding.accountPlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('orders.common.method')">
          <el-select v-model="form.method" style="width: 100%">
            <el-option value="电汇转账" label="电汇转账" />
            <el-option value="CHATS" label="CHATS" />
            <el-option value="本地转账" label="本地转账" />
          </el-select>
        </el-form-item>
      </template>

      <el-form-item :label="side === 'inflow' ? t('orders.funding.inflowVoucher') : t('orders.funding.outflowVoucher')">
        <el-input v-model="form.voucher" :placeholder="t('orders.funding.voucherPlaceholder')" />
      </el-form-item>
      <el-form-item :label="t('orders.common.note')">
        <el-input v-model="form.note" maxlength="300" :placeholder="t('orders.funding.optional')" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ t("orders.common.cancel") }}</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">{{ title }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.brief {
  margin: 0 0 12px;
  color: #606266;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
}
</style>
