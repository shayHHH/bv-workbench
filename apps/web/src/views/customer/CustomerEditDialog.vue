<script setup lang="ts">
import {
  CustomerKind,
  CustomerKindLabel,
  CustomerStatusLabel,
  CustomerSubTypeLabel,
  RegionLabel,
  type CustomerVO,
} from "@bv/shared";
import { ElMessage } from "element-plus";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
import { fetchCustomers, updateCustomer } from "@/api/customer";

const { t } = useI18n();
const visible = defineModel<boolean>({ required: true });
const props = defineProps<{ customer: CustomerVO | null }>();
const emit = defineEmits<{ updated: [customer: CustomerVO] }>();

const submitting = ref(false);
const brokerLoading = ref(false);
const brokerOptions = ref<CustomerVO[]>([]);

const form = reactive({
  customer_kind: CustomerKind.DIRECT as CustomerKind,
  customer_code: "",
  name: "",
  parent_id: "",
  sub_type: "",
  region: "",
  phone: "",
  remark: "",
  customer_status: "NEW",
});

const isSub = computed(() => form.customer_kind === CustomerKind.SUB_CUSTOMER);
/** 名下有下级客户的中介不能变更类型（与后端校验一致） */
const kindLocked = computed(
  () =>
    props.customer?.customer_kind === CustomerKind.INTERMEDIARY &&
    (props.customer?.sub_customers?.length ?? 0) > 0,
);

const kindHint = computed<Record<CustomerKind, string>>(() => ({
  DIRECT: t("customer.edit.kindHint.DIRECT"),
  INTERMEDIARY: t("customer.edit.kindHint.INTERMEDIARY"),
  SUB_CUSTOMER: t("customer.edit.kindHint.SUB_CUSTOMER"),
}));

async function searchBrokers(keyword: string) {
  brokerLoading.value = true;
  try {
    const result = await fetchCustomers({
      keyword: keyword || undefined,
      customer_kind: CustomerKind.INTERMEDIARY,
      page: 1,
      page_size: 20,
    });
    brokerOptions.value = result.items.filter(item => item.id !== props.customer?.id);
  } finally {
    brokerLoading.value = false;
  }
}

watch(visible, open => {
  const c = props.customer;
  if (!open || !c) return;
  Object.assign(form, {
    customer_kind: c.customer_kind,
    customer_code: c.customer_code || "",
    name: c.name,
    parent_id: c.parent_id || "",
    sub_type: c.sub_type || "",
    region: c.region || "",
    phone: c.phone || "",
    remark: c.remark || "",
    customer_status: c.customer_status,
  });
  if (c.customer_kind === CustomerKind.SUB_CUSTOMER) {
    searchBrokers("");
    if (c.parent_id && c.parent_name) {
      brokerOptions.value = [
        { id: c.parent_id, name: c.parent_name, customer_code: null } as CustomerVO,
      ];
    }
  }
});

watch(
  () => form.customer_kind,
  kind => {
    if (kind === CustomerKind.SUB_CUSTOMER) searchBrokers("");
  },
);

async function submit() {
  const c = props.customer;
  if (!c) return;
  if (!form.name.trim()) {
    ElMessage.warning(t("customer.edit.nameRequired"));
    return;
  }
  if (isSub.value && !form.parent_id) {
    ElMessage.warning(t("customer.edit.brokerRequired"));
    return;
  }
  if (!isSub.value && !/^\d{5}$/.test(form.customer_code)) {
    ElMessage.warning(t("customer.edit.codeInvalid"));
    return;
  }
  submitting.value = true;
  try {
    const updated = await updateCustomer(c.id, {
      name: form.name.trim(),
      customer_kind: form.customer_kind,
      customer_code: form.customer_code.trim() || null,
      parent_id: isSub.value ? form.parent_id : null,
      sub_type: form.sub_type ? (form.sub_type as never) : null,
      region: form.region ? (form.region as never) : null,
      phone: form.phone || null,
      remark: form.remark || null,
      customer_status: form.customer_status as never,
    });
    ElMessage.success(
      t("customer.edit.saveSuccess", {
        code: updated.customer_code || t("customer.common.noCode"),
        name: updated.name,
      }),
    );
    emit("updated", updated);
  } catch {
    /* 错误提示由 http 拦截器统一处理 */
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="t('customer.edit.title')" width="640px" :close-on-click-modal="false">
    <p class="subtitle">
      {{ customer?.name }} · {{ customer ? localizeText(CustomerKindLabel[customer.customer_kind]) : "" }} · {{ t("customer.edit.currentCode") }}
      {{ customer?.customer_code || t("customer.common.noCode") }}
    </p>
    <el-form label-position="top">
      <el-form-item :label="t('customer.edit.stepKind')">
        <div v-if="kindLocked" class="kind-locked">
          <strong>{{ t("customer.edit.kindIntermediary") }}</strong>
          <span>{{ t("customer.edit.kindLockedHint") }}</span>
        </div>
        <el-radio-group v-else v-model="form.customer_kind" class="kind-group">
          <el-radio-button v-for="(label, value) in CustomerKindLabel" :key="value" :value="value">
            <div class="kind-option">
              <strong>{{ label }}</strong>
              <small>{{ kindHint[value] }}</small>
            </div>
          </el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-form-item v-if="isSub" :label="t('customer.edit.parentBroker')" required>
        <el-select
          v-model="form.parent_id"
          filterable
          remote
          :remote-method="searchBrokers"
          :loading="brokerLoading"
          :placeholder="t('customer.edit.brokerSearchPh')"
          style="width: 100%"
        >
          <el-option
            v-for="broker in brokerOptions"
            :key="broker.id"
            :value="broker.id"
            :label="`${broker.name}${broker.customer_code ? ` (${broker.customer_code})` : ''}`"
          />
        </el-select>
      </el-form-item>

      <div class="grid">
        <el-form-item :label="isSub ? t('customer.edit.subCodeOptional') : t('customer.common.customerCode')" :required="!isSub">
          <el-input v-model="form.customer_code" maxlength="5" placeholder="20001-29999" />
        </el-form-item>
        <el-form-item :label="t('customer.edit.name')" required>
          <el-input v-model="form.name" maxlength="100" />
        </el-form-item>

        <el-form-item :label="t('customer.edit.subjectType')">
          <el-select v-model="form.sub_type" clearable :placeholder="t('customer.edit.subjectTypePh')" style="width: 100%">
            <el-option v-for="(label, value) in CustomerSubTypeLabel" :key="value" :label="localizeText(label)" :value="value" />
          </el-select>
        </el-form-item>

        <el-form-item :label="t('customer.common.phone')">
          <el-input v-model="form.phone" maxlength="50" :placeholder="t('customer.edit.phonePh')" />
        </el-form-item>
        <el-form-item :label="t('customer.common.region')">
          <el-select v-model="form.region" clearable :placeholder="t('customer.edit.regionPh')" style="width: 100%">
            <el-option v-for="(label, value) in RegionLabel" :key="value" :label="label" :value="value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('customer.common.currentStatus')">
          <el-select v-model="form.customer_status" style="width: 100%">
            <el-option v-for="(label, value) in CustomerStatusLabel" :key="value" :label="label" :value="value" />
          </el-select>
        </el-form-item>
      </div>

      <el-form-item :label="t('customer.common.remark')">
        <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="500" :placeholder="t('customer.edit.remarkPh')" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">{{ t("customer.common.cancel") }}</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">{{ t("customer.edit.save") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.subtitle {
  margin: 0 0 16px;
  color: var(--color-text-muted);
}

.kind-group :deep(.el-radio-button__inner) {
  padding: 10px 18px;
}

.kind-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.4;
}

.kind-option small {
  font-weight: normal;
  opacity: 0.75;
}

.kind-locked {
  display: flex;
  flex-direction: column;
  padding: 8px 14px;
  background: var(--color-surface-alt);
  border-radius: 8px;
  line-height: 1.5;
}

.kind-locked span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 16px;
}
</style>
