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
const form = reactive({ channel: DispatchChannel.SGB as DispatchChannel, text: "" });

const sgb = computed(() => treasury.value.find(item => item.key.startsWith("bank-SGB-")));
const sino = computed(() => treasury.value.find(item => item.key.startsWith("bank-SINO-")));

watch(visible, async open => {
  if (!open || !props.order) return;
  const context = await fetchDispatchContext(props.order.id);
  vaAccounts.value = context.va_accounts;
  treasury.value = context.treasury;
  form.channel = vaAccounts.value.length ? DispatchChannel.SGB : DispatchChannel.SINO;
  form.text = "";
});

/** 一键复制 VA 收款要素，供排单文案粘贴（排单文案沿用 demo 繁体口径） */
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
  ElMessage.success(t("orders.dispatch.vaCopied", { label: va.label }));
}

async function submit() {
  const order = props.order!;
  const text = form.text.trim();
  if (!text) return ElMessage.warning(t("orders.dispatch.warnEmptyText"));
  submitting.value = true;
  try {
    const updated = await createDispatch(order.id, { channel: form.channel, text });
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
      <el-form-item :label="t('orders.dispatch.channel')">
        <el-radio-group v-model="form.channel">
          <el-radio-button :value="DispatchChannel.SGB">SGB</el-radio-button>
          <el-radio-button :value="DispatchChannel.SINO">SINO</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <div v-if="form.channel === 'SGB'" class="va-panel">
        <div class="va-head">
          {{ t("orders.dispatch.vaAccount") }}
          <span>{{ t("orders.dispatch.vaBrowseHint") }}</span>
        </div>
        <div v-if="vaAccounts.length" class="va-list">
          <div v-for="va in vaAccounts" :key="va.id" class="va-card">
            <div class="va-lines">
              <div><span>{{ t("orders.dispatch.vaLabel") }}</span><code>{{ va.label }}</code></div>
              <div><span>Virtual Account Number</span><code>{{ va.virtual_account_number }}</code></div>
              <div><span>IBAN</span><code>{{ va.iban }}</code></div>
              <div><span>Currency</span><code>{{ va.currency }}</code></div>
            </div>
            <el-button size="small" @click="copyVa(va)">{{ t("orders.dispatch.vaCopy") }}</el-button>
          </div>
        </div>
        <p v-else class="va-empty">{{ t("orders.dispatch.noVa") }}</p>
      </div>

      <el-form-item :label="t('orders.dispatch.textLabel')">
        <el-input
          v-model="form.text"
          type="textarea"
          :rows="10"
          resize="none"
          class="mono-text"
          :placeholder="t('orders.dispatch.textPlaceholder')"
        />
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

.va-panel {
  margin-bottom: 14px;
}

.va-head {
  font-size: 13px;
  color: #606266;
  margin-bottom: 8px;
}

.va-head span {
  color: #909399;
  font-size: 12px;
  margin-left: 6px;
}

.va-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 180px;
  overflow-y: auto;
}

.va-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 10px 12px;
  background: #fafbfc;
}

.va-lines {
  display: grid;
  gap: 2px;
  font-size: 12px;
  min-width: 0;
}

.va-lines span {
  color: #909399;
  margin-right: 8px;
}

.va-lines code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
}

.va-empty {
  margin: 0;
  color: #909399;
  font-size: 12px;
}

.mono-text :deep(textarea) {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.7;
  max-height: 300px;
  overflow-y: auto;
}
</style>
