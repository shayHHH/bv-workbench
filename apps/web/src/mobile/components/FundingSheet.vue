<script setup lang="ts">
/**
 * 链上出入款登记底部弹层（钱包运营）。
 * 移动端三角色中只有 WALLET 是资金责任人，且必为链上形态，
 * 因此这里只实现 CHAIN 表单；法币/现金登记仍走桌面端（财务/出款员）。
 */
import {
  type FileRef,
  FundingKindLabel,
  isValidTxHash,
  TX_HASH_FORMAT_HINTS,
  type FundingSide,
  type TradeOrderVO,
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
import { localizeText } from "@/i18n";
import { uploadFile } from "@/api/access";
import { inflowConfirm, outflowExecute } from "@/api/order";
import { fmtMoney } from "../orderMeta";

const visible = defineModel<boolean>({ required: true });
const props = defineProps<{ order: TradeOrderVO | null; side: FundingSide }>();
const emit = defineEmits<{ done: [order: TradeOrderVO] }>();

const { t } = useI18n();

const submitting = ref(false);
const uploadingVoucher = ref(false);
const fileInputRef = ref<HTMLInputElement>();
const form = reactive({
  amount: "",
  chain: "TRC20",
  hash: "",
  confirms: "",
  voucher: null as FileRef | null,
  note: "",
});

const currency = computed(() =>
  props.order ? (props.side === "inflow" ? props.order.sell_currency : props.order.buy_currency) : "",
);

const title = computed(() =>
  props.side === "inflow" ? t("orders.common.markChainInflow") : t("orders.common.registerChainTransfer"),
);

watch(visible, open => {
  if (!open || !props.order) return;
  form.amount = String(props.side === "inflow" ? props.order.sell_amount : props.order.buy_amount);
  form.hash = "";
  form.confirms = "";
  form.voucher = null;
  form.note = "";
});

/** 交易哈希实时校验：提示所选网络的位数/前缀要求 */
const hashError = computed(() => {
  if (!form.hash.trim()) return "";
  return isValidTxHash(form.chain, form.hash) ? "" : localizeText(TX_HASH_FORMAT_HINTS[form.chain] ?? "");
});

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function chooseVoucherFile() {
  fileInputRef.value?.click();
}

async function handleVoucherFile(file?: File | null) {
  if (!file) return;
  uploadingVoucher.value = true;
  try {
    form.voucher = await uploadFile(file);
    showSuccessToast(t("orders.funding.voucherUploaded"));
  } catch {
    /* 具体错误信息由 http 拦截器提示 */
  } finally {
    uploadingVoucher.value = false;
    if (fileInputRef.value) fileInputRef.value.value = "";
  }
}

function onVoucherInput(event: Event) {
  const target = event.target as HTMLInputElement;
  void handleVoucherFile(target.files?.[0]);
}

function onVoucherDrop(event: DragEvent) {
  void handleVoucherFile(event.dataTransfer?.files?.[0]);
}

function onVoucherPaste(event: ClipboardEvent) {
  void handleVoucherFile(event.clipboardData?.files?.[0]);
}

async function submit() {
  const order = props.order!;
  if (!form.hash.trim()) return showToast(t("orders.funding.warnHash"));
  if (!isValidTxHash(form.chain, form.hash))
    return showToast(localizeText(TX_HASH_FORMAT_HINTS[form.chain] ?? t("orders.funding.warnHash")));
  if (!form.confirms.trim()) return showToast(t("orders.funding.warnConfirms"));
  submitting.value = true;
  try {
    const payload = {
      amount: Number(form.amount) || 0,
      account: null,
      voucher: form.voucher,
      chain: form.chain,
      hash: form.hash.trim(),
      confirms: form.confirms.trim(),
      place: null,
      handler: null,
      token: null,
      method: "链上收款",
      note: form.note.trim() || null,
    };
    const updated =
      props.side === "inflow" ? await inflowConfirm(order.id, payload) : await outflowExecute(order.id, payload);
    showSuccessToast(
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
  <van-popup v-model:show="visible" position="bottom" round safe-area-inset-bottom>
    <div class="funding-sheet">
      <h3>{{ title }}</h3>
      <p class="brief">
        {{ order?.customer_name }} ·
        {{ side === "inflow" ? t("orders.common.receivable") : t("orders.common.payable") }}
        <strong>{{ order ? fmtMoney(currency, side === "inflow" ? order.sell_amount : order.buy_amount) : "" }}</strong>
        · {{ localizeText(FundingKindLabel.CHAIN) }}
      </p>

      <div class="form">
        <van-field
          v-model="form.amount"
          type="number"
          :label="side === 'inflow' ? t('orders.funding.actualInflowAmount') : t('orders.funding.actualOutflowAmount')"
          label-align="top"
          required
        >
          <template #extra>{{ currency }}</template>
        </van-field>
        <div class="field-row">
          <div class="chain-picker">
            <span class="field-label">{{ t("orders.funding.chain") }}</span>
            <div class="chain-options">
              <button
                v-for="chain in ['TRC20', 'ERC20']"
                :key="chain"
                type="button"
                :class="{ active: form.chain === chain }"
                @click="form.chain = chain"
              >
                {{ chain }}
              </button>
            </div>
          </div>
          <van-field
            v-model="form.confirms"
            type="digit"
            :label="t('orders.funding.confirms')"
            label-align="top"
            required
            class="confirms"
          />
        </div>
        <van-field
          v-model="form.hash"
          label="Transaction Hash"
          label-align="top"
          required
          :placeholder="t('orders.funding.hashPlaceholder')"
          :error-message="hashError"
        />
        <div class="voucher-field">
          <span class="field-label">
            {{ side === "inflow" ? t("orders.funding.inflowVoucher") : t("orders.funding.outflowVoucher") }}
          </span>
          <button
            type="button"
            class="voucher-upload"
            :class="{ filled: form.voucher }"
            @click="chooseVoucherFile"
            @dragover.prevent
            @drop.prevent="onVoucherDrop"
            @paste="onVoucherPaste"
          >
            <input
              ref="fileInputRef"
              class="file-input"
              type="file"
              accept=".jpg,.jpeg,.png,.pdf,.doc,.docx"
              @change="onVoucherInput"
            />
            <span class="upload-mark">↑</span>
            <span class="voucher-copy">
              <strong>{{ form.voucher?.original_name || t("orders.funding.dropVoucherTitle") }}</strong>
              <small>
                {{
                  form.voucher
                    ? `${form.voucher.mime_type} · ${formatFileSize(form.voucher.size)}`
                    : t("orders.funding.dropVoucherHint")
                }}
              </small>
            </span>
            <span class="upload-action">
              {{ uploadingVoucher ? t("orders.funding.uploadingVoucher") : form.voucher ? t("orders.funding.replaceVoucher") : t("orders.funding.chooseVoucher") }}
            </span>
          </button>
          <button v-if="form.voucher" type="button" class="remove-voucher" @click="form.voucher = null">
            {{ t("orders.funding.removeVoucher") }}
          </button>
        </div>
        <van-field
          v-model="form.note"
          :label="t('orders.common.note')"
          label-align="top"
          :placeholder="t('orders.funding.optional')"
          maxlength="300"
        />
      </div>

      <div class="buttons">
        <van-button block @click="visible = false">{{ t("orders.common.cancel") }}</van-button>
        <van-button block type="primary" :loading="submitting" @click="submit">{{ title }}</van-button>
      </div>
    </div>
  </van-popup>
</template>

<style scoped>
.funding-sheet {
  padding: 20px 16px 16px;
  max-height: 82vh;
  overflow-y: auto;
}

h3 {
  margin: 0 0 6px;
  font-size: 16px;
  text-align: center;
}

.brief {
  color: var(--color-text-secondary);
  font-size: 13px;
  text-align: center;
  margin: 0 0 12px;
}

.form {
  background: var(--color-surface-alt);
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 14px;
}

.form :deep(.van-field) {
  background: transparent;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.chain-picker {
  padding: 10px 16px;
}

.field-label {
  display: block;
  color: #646566;
  font-size: 14px;
  margin-bottom: 8px;
}

.chain-options {
  display: flex;
  gap: 8px;
}

.chain-options button {
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.chain-options button.active {
  border-color: var(--color-primary);
  color: var(--color-accent);
  background: var(--color-primary-light);
}

.voucher-field {
  padding: 10px 16px 12px;
}

.voucher-upload {
  width: 100%;
  border: 1.5px dashed var(--color-border);
  background: #fff;
  border-radius: 10px;
  padding: 12px;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  text-align: left;
  color: #323233;
}

.voucher-upload.filled {
  border-style: solid;
}

.file-input {
  display: none;
}

.upload-mark {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--color-primary-light);
  color: var(--color-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}

.voucher-copy {
  min-width: 0;
}

.voucher-copy strong,
.voucher-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voucher-copy strong {
  font-size: 13px;
}

.voucher-copy small {
  color: #969799;
  margin-top: 2px;
}

.upload-action {
  color: var(--color-accent);
  font-size: 12px;
  white-space: nowrap;
}

.remove-voucher {
  margin-top: 8px;
  border: none;
  background: transparent;
  color: #969799;
  padding: 0;
  font-size: 12px;
}

.buttons {
  display: flex;
  gap: 10px;
}
</style>
