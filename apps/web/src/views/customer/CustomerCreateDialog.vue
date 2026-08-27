<script setup lang="ts">
import {
  CustomerKind,
  CustomerKindLabel,
  CustomerSubTypeLabel,
  RegionLabel,
  type CustomerVO,
} from "@bv/shared";
import { ElMessage } from "element-plus";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
import { createCustomer, fetchCustomers, fetchNextCustomerCode } from "@/api/customer";

const { t } = useI18n();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ created: [customer: CustomerVO] }>();

const submitting = ref(false);
const brokerLoading = ref(false);
const brokerOptions = ref<CustomerVO[]>([]);

const form = reactive({
  customer_kind: CustomerKind.DIRECT as CustomerKind,
  customer_code: "",
  generate_code: true,
  name: "",
  parent_id: "",
  sub_type: "",
  region: "",
  phone: "",
  remark: "",
});

const isSub = computed(() => form.customer_kind === CustomerKind.SUB_CUSTOMER);
const needsCode = computed(() => !isSub.value || form.generate_code);

const kindHint = computed<Record<CustomerKind, string>>(() => ({
  DIRECT: t("customer.create.kindHint.DIRECT"),
  INTERMEDIARY: t("customer.create.kindHint.INTERMEDIARY"),
  SUB_CUSTOMER: t("customer.create.kindHint.SUB_CUSTOMER"),
}));

async function assignNextCode() {
  try {
    form.customer_code = await fetchNextCustomerCode();
  } catch {
    /* 错误提示由 http 拦截器统一处理 */
  }
}

async function searchBrokers(keyword: string) {
  brokerLoading.value = true;
  try {
    const result = await fetchCustomers({
      keyword: keyword || undefined,
      customer_kind: CustomerKind.INTERMEDIARY,
      page: 1,
      page_size: 20,
    });
    brokerOptions.value = result.items;
  } finally {
    brokerLoading.value = false;
  }
}

watch(visible, open => {
  if (!open) return;
  Object.assign(form, {
    customer_kind: CustomerKind.DIRECT,
    customer_code: "",
    generate_code: true,
    name: "",
    parent_id: "",
    sub_type: "",
    region: "",
    phone: "",
    remark: "",
  });
  assignNextCode();
});

watch(
  () => form.customer_kind,
  () => {
    form.parent_id = "";
    if (needsCode.value && !form.customer_code) assignNextCode();
    if (isSub.value) searchBrokers("");
  },
);

watch(
  () => form.generate_code,
  generate => {
    if (generate && !form.customer_code) assignNextCode();
  },
);

async function submit() {
  if (!form.name.trim()) {
    ElMessage.warning(t("customer.create.nameRequired"));
    return;
  }
  if (isSub.value && !form.parent_id) {
    ElMessage.warning(t("customer.create.brokerRequired"));
    return;
  }
  if (needsCode.value && !/^\d{5}$/.test(form.customer_code)) {
    ElMessage.warning(t("customer.create.codeInvalid"));
    return;
  }
  submitting.value = true;
  try {
    const customer = await createCustomer({
      name: form.name.trim(),
      customer_kind: form.customer_kind,
      customer_code: needsCode.value ? form.customer_code : null,
      parent_id: isSub.value ? form.parent_id : null,
      sub_type: isSub.value && form.sub_type ? (form.sub_type as never) : null,
      region: form.region ? (form.region as never) : null,
      phone: form.phone || null,
      remark: form.remark || null,
    });
    ElMessage.success(
      t("customer.create.success", {
        code: customer.customer_code || t("customer.common.noCode"),
        name: customer.name,
      }),
    );
    emit("created", customer);
  } catch {
    /* 错误提示由 http 拦截器统一处理 */
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="t('customer.create.title')" width="640px" :close-on-click-modal="false">
    <p class="subtitle">{{ t("customer.create.subtitle") }}</p>
    <el-form label-position="top">
      <el-form-item :label="t('customer.create.stepKind')" required>
        <el-radio-group v-model="form.customer_kind" class="kind-group">
          <el-radio-button
            v-for="(label, value) in CustomerKindLabel"
            :key="value"
            :value="value"
          >
            <div class="kind-option">
              <strong>{{ localizeText(label) }}</strong>
              <small>{{ kindHint[value] }}</small>
            </div>
          </el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-form-item v-if="isSub" :label="t('customer.create.parentBroker')" required>
        <el-select
          v-model="form.parent_id"
          filterable
          remote
          :remote-method="searchBrokers"
          :loading="brokerLoading"
          :placeholder="t('customer.create.brokerSearchPh')"
          style="width: 100%"
        >
          <el-option
            v-for="broker in brokerOptions"
            :key="broker.id"
            :value="broker.id"
            :label="`${broker.name} (${broker.customer_code || t('customer.common.noCode')})`"
          />
        </el-select>
      </el-form-item>

      <div class="grid">
        <el-form-item :required="needsCode">
          <template #label>
            <span class="code-label">
              {{ isSub ? t("customer.create.subCode") : t("customer.common.customerCode") }}
              <el-checkbox v-if="isSub" v-model="form.generate_code">{{ t("customer.create.generateCode") }}</el-checkbox>
            </span>
          </template>
          <el-input
            v-model="form.customer_code"
            :disabled="!needsCode"
            maxlength="5"
            :placeholder="t('customer.create.codePh')"
          />
          <div class="hint">
            {{ needsCode ? t("customer.create.codeHintAssigned") : t("customer.create.codeHintNoCode") }}
          </div>
        </el-form-item>

        <el-form-item :label="t('customer.create.name')" required>
          <el-input v-model="form.name" :placeholder="t('customer.create.namePh')" maxlength="100" />
        </el-form-item>

        <el-form-item v-if="isSub" :label="t('customer.create.subTypeOptional')">
          <el-select v-model="form.sub_type" clearable :placeholder="t('customer.create.subTypePh')" style="width: 100%">
            <el-option
              v-for="(label, value) in CustomerSubTypeLabel"
              :key="value"
              :label="localizeText(label)"
              :value="value"
            />
          </el-select>
        </el-form-item>

        <el-form-item :label="t('customer.common.phone')">
          <el-input v-model="form.phone" :placeholder="t('customer.create.phonePh')" maxlength="50" />
        </el-form-item>

        <el-form-item :label="t('customer.common.region')">
          <el-select v-model="form.region" clearable :placeholder="t('customer.create.regionPh')" style="width: 100%">
            <el-option
              v-for="(label, value) in RegionLabel"
              :key="value"
              :label="localizeText(label)"
              :value="value"
            />
          </el-select>
        </el-form-item>
      </div>

      <el-form-item :label="t('customer.common.remark')">
        <el-input
          v-model="form.remark"
          type="textarea"
          :rows="3"
          maxlength="500"
          :placeholder="t('customer.create.remarkPh')"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">{{ t("customer.common.cancel") }}</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">{{ t("customer.create.submit") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.subtitle {
  margin: 0 0 16px;
  color: #909399;
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

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 16px;
}

.code-label {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
</style>
