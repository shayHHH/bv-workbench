<script setup lang="ts">
/**
 * 发起出款排单底部弹层（高级交易员）。逻辑对齐桌面 DispatchDialog：
 * 通道选择 + VA 收款要素复制 + 排单文案提交。
 */
import {
  DispatchChannel,
  FundingKind,
  fundingKindOf,
  type TradeOrderVO,
  type VaAccountVO,
} from "@bv/shared";
import {
  Button as VanButton,
  Field as VanField,
  Popup as VanPopup,
  showSuccessToast,
  showToast,
} from "vant";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { createDispatch, fetchDispatchContext } from "@/api/order";
import { fmtMoney } from "../orderMeta";

const visible = defineModel<boolean>({ required: true });
const props = defineProps<{ order: TradeOrderVO | null }>();
const emit = defineEmits<{ done: [order: TradeOrderVO] }>();

const { t } = useI18n();

const submitting = ref(false);
const vaAccounts = ref<VaAccountVO[]>([]);
const form = reactive({ channel: DispatchChannel.SGB as DispatchChannel, text: "" });

const channelOptions = computed(() => {
  const options: DispatchChannel[] = [DispatchChannel.SGB, DispatchChannel.SINO];
  if (props.order && fundingKindOf(props.order, "outflow") === FundingKind.CHAIN) options.push(DispatchChannel.WALLET);
  return options;
});
const channelLabel = (channel: DispatchChannel) => (channel === DispatchChannel.WALLET ? "钱包" : channel);

watch(visible, async open => {
  if (!open || !props.order) return;
  const context = await fetchDispatchContext(props.order.id);
  vaAccounts.value = context.va_accounts;
  form.channel =
    fundingKindOf(props.order, "outflow") === FundingKind.CHAIN
      ? DispatchChannel.WALLET
      : vaAccounts.value.length
        ? DispatchChannel.SGB
        : DispatchChannel.SINO;
  form.text = "";
});

/** 一键复制 VA 收款要素（排单文案沿用 demo 繁体口径） */
async function copyVa(va: VaAccountVO) {
  const block = [
    `出款帳戶：${va.label}`,
    "Account 1：",
    `Virtual Account Number：${va.virtual_account_number}`,
    `IBAN：${va.iban}`,
    `Currency：${va.currency}`,
  ].join("\n");
  try {
    await navigator.clipboard.writeText(block);
  } catch {
    const el = document.createElement("textarea");
    el.value = block;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }
  showToast(t("orders.dispatch.vaCopied", { label: va.label }));
}

async function copyDispatchText() {
  const text = form.text.trim();
  if (!text) return showToast(t("orders.dispatch.warnEmptyText"));
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement("textarea");
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }
  showSuccessToast(t("orders.dispatch.textCopied"));
}

async function submit() {
  const order = props.order!;
  const text = form.text.trim();
  if (!text) return showToast(t("orders.dispatch.warnEmptyText"));
  submitting.value = true;
  try {
    const updated = await createDispatch(order.id, { channel: form.channel, text });
    showSuccessToast(t("orders.dispatch.submitted", { orderNo: order.order_no }));
    visible.value = false;
    emit("done", updated);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <van-popup v-model:show="visible" position="bottom" round safe-area-inset-bottom>
    <div class="dispatch-sheet">
      <h3>{{ t("orders.common.startDispatch") }}</h3>
      <p class="brief mono">{{ order?.order_no }}</p>

      <div class="channel-strip">
        <div>
          <span>{{ t("orders.dispatch.payableAmount") }}</span>
          <strong>{{ order ? fmtMoney(order.buy_currency, order.buy_amount) : "—" }}</strong>
        </div>
      </div>

      <div class="section-label">{{ t("orders.dispatch.channel") }}</div>
      <div class="channel-options">
        <button
          v-for="channel in channelOptions"
          :key="channel"
          type="button"
          :class="{ active: form.channel === channel }"
          @click="form.channel = channel"
        >
          {{ channelLabel(channel) }}
        </button>
      </div>

      <template v-if="form.channel === 'SGB'">
        <div class="section-label">{{ t("orders.dispatch.vaAccount") }}</div>
        <div v-if="vaAccounts.length" class="va-list">
          <div v-for="va in vaAccounts" :key="va.id" class="va-card">
            <div class="va-lines">
              <div><span>{{ t("orders.dispatch.vaLabel") }}</span><code>{{ va.label }}</code></div>
              <div><span>VA Number</span><code>{{ va.virtual_account_number }}</code></div>
              <div><span>IBAN</span><code>{{ va.iban }}</code></div>
              <div><span>Currency</span><code>{{ va.currency }}</code></div>
            </div>
            <van-button size="small" @click="copyVa(va)">{{ t("orders.dispatch.vaCopy") }}</van-button>
          </div>
        </div>
        <p v-else class="va-empty">{{ t("orders.dispatch.noVa") }}</p>
      </template>

      <div class="section-label text-label-row">
        <span>{{ t("orders.dispatch.textLabel") }}</span>
        <button type="button" @click="copyDispatchText">{{ t("orders.dispatch.copyText") }}</button>
      </div>
      <van-field
        v-model="form.text"
        type="textarea"
        :rows="6"
        :autosize="{ minHeight: 120, maxHeight: 220 }"
        :placeholder="t('orders.dispatch.textPlaceholder')"
        class="text-input mono"
      />

      <div class="buttons">
        <van-button block @click="visible = false">{{ t("orders.common.cancel") }}</van-button>
        <van-button block type="primary" :loading="submitting" @click="submit">
          {{ t("orders.dispatch.submitReview") }}
        </van-button>
      </div>
    </div>
  </van-popup>
</template>

<style scoped>
.dispatch-sheet {
  padding: 20px 16px 16px;
  max-height: 86vh;
  overflow-y: auto;
}

h3 {
  margin: 0 0 2px;
  font-size: 16px;
  text-align: center;
}

.brief {
  color: var(--color-text-muted);
  font-size: 12px;
  text-align: center;
  margin: 0 0 12px;
}

.channel-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}

.channel-strip div {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px 10px;
  min-width: 0;
}

.channel-strip span {
  display: block;
  color: var(--color-text-muted);
  font-size: 11px;
  margin-bottom: 2px;
}

.channel-strip strong {
  font-size: 13px;
  word-break: break-all;
}

.section-label {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin: 12px 0 8px;
}

.text-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.text-label-row button {
  border: 0;
  background: transparent;
  color: var(--color-primary);
  font-size: 13px;
  padding: 0;
}

.channel-options {
  display: flex;
  gap: 8px;
}

.channel-options button {
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 6px;
  padding: 7px 18px;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.channel-options button.active {
  border-color: var(--color-primary);
  color: var(--color-accent);
  background: var(--color-primary-light);
}

.va-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
}

.va-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--color-surface-alt);
}

.va-lines {
  display: grid;
  gap: 2px;
  font-size: 12px;
  min-width: 0;
}

.va-lines span {
  color: var(--color-text-muted);
  margin-right: 8px;
}

.va-lines code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
}

.va-empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.text-input {
  background: var(--color-surface-alt);
  border-radius: 8px;
}

.text-input :deep(textarea) {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.7;
}

.buttons {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}

.mono {
  font-family: ui-monospace, monospace;
}
</style>
