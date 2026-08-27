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
import { inflowConfirm, outflowExecute } from "@/api/order";

const visible = defineModel<boolean>({ required: true });
const props = defineProps<{ order: TradeOrderVO | null; side: FundingSide }>();
const emit = defineEmits<{ done: [order: TradeOrderVO] }>();

const submitting = ref(false);
const form = reactive({
  amount: 0,
  account: "",
  voucher: "",
  chain: "TRC20",
  hash: "",
  confirms: "20",
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
  form.place = "";
  form.handler = "";
  form.token = "";
  form.note = "";
  form.method = kind.value === FundingKind.CHAIN ? "链上收款" : "电汇转账";
});

const title = computed(() => {
  if (!props.order) return "";
  if (props.side === "inflow") {
    return kind.value === FundingKind.CHAIN ? "标记链上入款到账" : kind.value === FundingKind.CASH ? "确认现金交收" : "登记法币入账";
  }
  return kind.value === FundingKind.CHAIN ? "登记链上转账" : kind.value === FundingKind.CASH ? "登记现金交付" : "出款登记";
});

async function submit() {
  const order = props.order!;
  if (kind.value === FundingKind.CHAIN && !form.hash.trim()) return ElMessage.warning("请填写 Transaction Hash");
  if (kind.value === FundingKind.CASH && !form.place.trim()) return ElMessage.warning("请填写交收地点");
  if (kind.value === FundingKind.BANK && props.side === "outflow" && !form.account.trim()) return ElMessage.warning("请填写出款账户");
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
    ElMessage.success(props.side === "inflow" ? `入款已登记确认，${order.order_no} 进入待出款排单` : `出款已执行，${order.order_no} 凭证已归档，订单完成`);
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
      {{ order?.customer_name }} · {{ side === "inflow" ? "应收" : "应付" }}
      <strong>{{ currency }} {{ (side === "inflow" ? order?.sell_amount : order?.buy_amount)?.toLocaleString("en-US") }}</strong>
      · {{ FundingKindLabel[kind] }}
    </p>
    <el-form label-position="top">
      <el-form-item :label="side === 'inflow' ? '实际到账金额' : '实际出款金额'" required>
        <el-input v-model.number="form.amount" type="number">
          <template #prepend>{{ currency }}</template>
        </el-input>
      </el-form-item>

      <template v-if="kind === FundingKind.CHAIN">
        <div class="grid">
          <el-form-item label="链">
            <el-select v-model="form.chain" style="width: 100%">
              <el-option value="TRC20" label="TRC20" />
              <el-option value="ERC20" label="ERC20" />
            </el-select>
          </el-form-item>
          <el-form-item label="确认次数">
            <el-input v-model="form.confirms" />
          </el-form-item>
        </div>
        <el-form-item label="Transaction Hash" required>
          <el-input v-model="form.hash" placeholder="链上交易哈希" />
        </el-form-item>
      </template>

      <template v-else-if="kind === FundingKind.CASH">
        <el-form-item label="交收地点" required>
          <el-input v-model="form.place" placeholder="如：中环办公室 / 指定交收点" />
        </el-form-item>
        <div class="grid">
          <el-form-item label="交收人">
            <el-input v-model="form.handler" />
          </el-form-item>
          <el-form-item label="信物编号">
            <el-input v-model="form.token" />
          </el-form-item>
        </div>
      </template>

      <template v-else>
        <el-form-item :label="side === 'inflow' ? '入账账户' : '出款账户'" :required="side === 'outflow'">
          <el-input v-model="form.account" placeholder="如：SGB 银行账户 · USD" />
        </el-form-item>
        <el-form-item label="方式">
          <el-select v-model="form.method" style="width: 100%">
            <el-option value="电汇转账" label="电汇转账" />
            <el-option value="CHATS" label="CHATS" />
            <el-option value="本地转账" label="本地转账" />
          </el-select>
        </el-form-item>
      </template>

      <el-form-item :label="side === 'inflow' ? '凭证文件名' : '回单文件名'">
        <el-input v-model="form.voucher" placeholder="如：transfer-0826.pdf（可选）" />
      </el-form-item>
      <el-form-item label="说明">
        <el-input v-model="form.note" maxlength="300" placeholder="可选" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
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
