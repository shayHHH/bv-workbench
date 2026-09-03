<script setup lang="ts">
import { TradeOrderStatusLabel, type TradeOrderVO } from "@bv/shared";
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
import { formatRelative } from "@/utils/format";
import { fmtMoney, KYC_TONE, rowCtaKey, STATUS_TONE } from "../orderMeta";

const props = defineProps<{ order: TradeOrderVO; role: string }>();
const emit = defineEmits<{ open: [order: TradeOrderVO] }>();

const { t } = useI18n();

const tone = (status: string) => STATUS_TONE[status] ?? STATUS_TONE.PENDING_KYC;
const kycTone = (toneKey: string) => KYC_TONE[toneKey] ?? KYC_TONE.neutral;
</script>

<template>
  <article class="order-card" @click="emit('open', props.order)">
    <header>
      <strong class="mono">{{ order.order_no }}</strong>
      <span
        class="badge"
        :style="{ color: tone(order.status).color, background: tone(order.status).bg }"
      >
        {{ localizeText(TradeOrderStatusLabel[order.status]) }}
      </span>
    </header>
    <div class="customer-line">
      <strong>{{ order.customer_name }}</strong>
      <span
        class="badge"
        :style="{ color: kycTone(order.kyc.tone).color, background: kycTone(order.kyc.tone).bg }"
      >
        {{ localizeText(order.kyc.label) }}
      </span>
    </div>
    <div class="pair">
      <b>{{ fmtMoney(order.sell_currency, order.sell_amount) }}</b>
      <i>→</i>
      <b class="buy">{{ fmtMoney(order.buy_currency, order.buy_amount) }}</b>
      <em class="rate mono">@{{ order.rate }}</em>
    </div>
    <p v-if="order.exception" class="flag">
      {{ order.exception.kind }} · {{ order.exception.reason }}
    </p>
    <p v-if="order.dispatch_rejected" class="flag">{{ t("orders.common.dispatchRejectedFlag") }}</p>
    <p v-if="order.payment_rejected" class="flag">{{ t("orders.list.paymentRejected") }}</p>
    <footer>
      <span class="meta">{{ order.trade_type }} · {{ localizeText(order.pay_method) }} · {{ formatRelative(order.updated_at) }}</span>
      <span class="cta" :class="{ primary: rowCtaKey(order, role) !== 'orders.list.cta.view' }">
        {{ t(rowCtaKey(order, role)) }} ›
      </span>
    </footer>
  </article>
</template>

<style scoped>
.order-card {
  background: #fff;
  border-radius: 12px;
  padding: 13px 14px;
  box-shadow: 0 1px 4px rgba(31, 36, 48, 0.05);
}

.order-card:active {
  background: var(--color-surface-alt);
}

header,
.customer-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

header strong {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.customer-line {
  margin-top: 6px;
}

.customer-line strong {
  font-size: 16px;
}

.badge {
  font-size: 11px;
  border-radius: 999px;
  padding: 2px 9px;
  white-space: nowrap;
}

.pair {
  display: flex;
  align-items: baseline;
  gap: 7px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.pair b {
  font-size: 15px;
}

.pair .buy {
  color: #2e7d32;
}

.pair i {
  color: var(--color-accent);
  font-style: normal;
}

.rate {
  color: var(--color-text-muted);
  font-size: 12px;
  font-style: normal;
}

.flag {
  color: var(--color-danger);
  font-size: 12px;
  margin: 6px 0 0;
}

footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 9px;
  padding-top: 9px;
  border-top: 1px solid #f2f3f5;
}

.meta {
  color: var(--color-text-muted);
  font-size: 12px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cta {
  font-size: 13px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.cta.primary {
  color: var(--color-accent);
  font-weight: 600;
}

.mono {
  font-family: ui-monospace, monospace;
}
</style>
