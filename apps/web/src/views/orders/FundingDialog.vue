<script setup lang="ts">
import {
  FundingKind,
  FundingKindLabel,
  fundingKindOf,
  type FileRef,
  isValidTxHash,
  TX_HASH_FORMAT_HINTS,
  type FundingSide,
  type TradeOrderVO,
} from "@bv/shared";
import { UploadFilled } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { computed, reactive, watch } from "vue";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
import { inflowConfirm, outflowExecute } from "@/api/order";
import { uploadFile } from "@/api/access";

const visible = defineModel<boolean>({ required: true });
const props = defineProps<{ order: TradeOrderVO | null; side: FundingSide }>();
const emit = defineEmits<{ done: [order: TradeOrderVO] }>();

const { t } = useI18n();

const submitting = ref(false);
const uploadingVoucher = ref(false);
const draggingVoucher = ref(false);
const fileInputRef = ref<HTMLInputElement>();
const form = reactive({
  amount: 0,
  account: "",
  voucher: null as FileRef | null,
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
  form.voucher = null;
  form.hash = "";
  form.confirms = "";
  form.place = "";
  form.handler = "";
  form.token = "";
  form.note = "";
  form.method = kind.value === FundingKind.CHAIN ? "链上收款" : "电汇转账";
});

/** 交易哈希实时校验：输入过程中即提示所选网络的位数/前缀要求 */
const hashError = computed(() => {
  if (kind.value !== FundingKind.CHAIN || !form.hash.trim()) return "";
  return isValidTxHash(form.chain, form.hash) ? "" : localizeText(TX_HASH_FORMAT_HINTS[form.chain] ?? "");
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
    ElMessage.success(t("orders.funding.voucherUploaded"));
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
  draggingVoucher.value = false;
  void handleVoucherFile(event.dataTransfer?.files?.[0]);
}

function onVoucherPaste(event: ClipboardEvent) {
  void handleVoucherFile(event.clipboardData?.files?.[0]);
}

async function submit() {
  const order = props.order!;
  if (kind.value === FundingKind.CHAIN && !form.hash.trim()) return ElMessage.warning(t("orders.funding.warnHash"));
  if (kind.value === FundingKind.CHAIN && !isValidTxHash(form.chain, form.hash))
    return ElMessage.warning(localizeText(TX_HASH_FORMAT_HINTS[form.chain] ?? t("orders.funding.warnHash")));
  if (kind.value === FundingKind.CHAIN && !form.confirms.trim()) return ElMessage.warning(t("orders.funding.warnConfirms"));
  if (kind.value === FundingKind.CASH && !form.place.trim()) return ElMessage.warning(t("orders.funding.warnPlace"));
  if (kind.value === FundingKind.BANK && props.side === "outflow" && !form.account.trim()) return ElMessage.warning(t("orders.funding.warnAccount"));
  submitting.value = true;
  try {
    const payload = {
      amount: form.amount,
      account: form.account.trim() || null,
      voucher: form.voucher,
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
        <el-form-item :label="t('orders.funding.txHash')" required :error="hashError || undefined">
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
        <div
          class="voucher-upload"
          :class="{ dragging: draggingVoucher, filled: form.voucher }"
          tabindex="0"
          @click="chooseVoucherFile"
          @keydown.enter.prevent="chooseVoucherFile"
          @keydown.space.prevent="chooseVoucherFile"
          @dragover.prevent="draggingVoucher = true"
          @dragleave.prevent="draggingVoucher = false"
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
          <el-icon class="upload-icon"><UploadFilled /></el-icon>
          <template v-if="form.voucher">
            <div class="voucher-file">
              <strong>{{ form.voucher.original_name }}</strong>
              <small>{{ form.voucher.mime_type }} · {{ formatFileSize(form.voucher.size) }}</small>
            </div>
            <div class="voucher-actions">
              <el-button size="small" :loading="uploadingVoucher" @click.stop="chooseVoucherFile">
                {{ t("orders.funding.replaceVoucher") }}
              </el-button>
              <el-button size="small" text @click.stop="form.voucher = null">
                {{ t("orders.funding.removeVoucher") }}
              </el-button>
            </div>
          </template>
          <template v-else>
            <div class="voucher-file">
              <strong>{{ t("orders.funding.dropVoucherTitle") }}</strong>
              <small>{{ t("orders.funding.dropVoucherHint") }}</small>
            </div>
            <el-button size="small" :loading="uploadingVoucher" @click.stop="chooseVoucherFile">
              {{ t("orders.funding.chooseVoucher") }}
            </el-button>
          </template>
        </div>
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
  color: var(--color-text-secondary);
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
}

.voucher-upload {
  width: 100%;
  min-height: 82px;
  border: 1.5px dashed var(--color-border);
  border-radius: 10px;
  background: var(--color-surface-alt);
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 14px;
  cursor: pointer;
  transition: border-color 0.18s ease, background-color 0.18s ease;
}

.voucher-upload:hover,
.voucher-upload:focus,
.voucher-upload.dragging {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
  outline: none;
}

.voucher-upload.filled {
  border-style: solid;
  background: #fff;
}

.file-input {
  display: none;
}

.upload-icon {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: #fff;
  color: var(--color-primary);
  font-size: 18px;
}

.voucher-file {
  min-width: 0;
}

.voucher-file strong {
  display: block;
  color: var(--color-text-primary);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voucher-file small {
  display: block;
  color: var(--color-text-muted);
  margin-top: 3px;
}

.voucher-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
