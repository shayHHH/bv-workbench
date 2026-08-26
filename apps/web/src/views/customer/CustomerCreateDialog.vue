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
import { createCustomer, fetchCustomers, fetchNextCustomerCode } from "@/api/customer";

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
  agent_name: "",
  follow_trader: "",
  phone: "",
  remark: "",
});

const isSub = computed(() => form.customer_kind === CustomerKind.SUB_CUSTOMER);
const needsCode = computed(() => !isSub.value || form.generate_code);

const kindHint: Record<CustomerKind, string> = {
  DIRECT: "客户本人直接交易",
  INTERMEDIARY: "可挂载下级客户",
  SUB_CUSTOMER: "可选择是否生成编号",
};

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
    agent_name: "",
    follow_trader: "",
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
    ElMessage.warning("请输入客户名称");
    return;
  }
  if (isSub.value && !form.parent_id) {
    ElMessage.warning("请选择所属中介");
    return;
  }
  if (needsCode.value && !/^\d{5}$/.test(form.customer_code)) {
    ElMessage.warning("客户编号必须是五位数字");
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
      agent_name: form.agent_name || null,
      follow_trader: form.follow_trader || null,
      phone: form.phone || null,
      remark: form.remark || null,
    });
    ElMessage.success(`客户已新建：${customer.customer_code || "无编号"} · ${customer.name}`);
    emit("created", customer);
  } catch {
    /* 错误提示由 http 拦截器统一处理 */
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="新建客户" width="640px" :close-on-click-modal="false">
    <p class="subtitle">先选择客户类型，再确认是否使用系统分配编号。</p>
    <el-form label-position="top">
      <el-form-item label="STEP 01 客户类型" required>
        <el-radio-group v-model="form.customer_kind" class="kind-group">
          <el-radio-button
            v-for="(label, value) in CustomerKindLabel"
            :key="value"
            :value="value"
          >
            <div class="kind-option">
              <strong>{{ label }}</strong>
              <small>{{ kindHint[value] }}</small>
            </div>
          </el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-form-item v-if="isSub" label="所属中介" required>
        <el-select
          v-model="form.parent_id"
          filterable
          remote
          :remote-method="searchBrokers"
          :loading="brokerLoading"
          placeholder="输入中介编号或中介名称搜索选择"
          style="width: 100%"
        >
          <el-option
            v-for="broker in brokerOptions"
            :key="broker.id"
            :value="broker.id"
            :label="`${broker.name} (${broker.customer_code || '无编号'})`"
          />
        </el-select>
      </el-form-item>

      <div class="grid">
        <el-form-item :required="needsCode">
          <template #label>
            <span class="code-label">
              {{ isSub ? "下级客户编号" : "客户编号" }}
              <el-checkbox v-if="isSub" v-model="form.generate_code">生成编号</el-checkbox>
            </span>
          </template>
          <el-input
            v-model="form.customer_code"
            :disabled="!needsCode"
            maxlength="5"
            placeholder="20001-29999"
          />
          <div class="hint">
            {{ needsCode ? "系统已分配，可修改为 20001-29999 内未占用编号。" : "该下级客户将以无编号状态创建。" }}
          </div>
        </el-form-item>

        <el-form-item label="客户名称" required>
          <el-input v-model="form.name" placeholder="输入客户名称" maxlength="100" />
        </el-form-item>

        <el-form-item v-if="isSub" label="下级主体类型（可选）">
          <el-select v-model="form.sub_type" clearable placeholder="不定义" style="width: 100%">
            <el-option
              v-for="(label, value) in CustomerSubTypeLabel"
              :key="value"
              :label="label"
              :value="value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="联系电话">
          <el-input v-model="form.phone" placeholder="输入联系电话（可选）" maxlength="50" />
        </el-form-item>

        <el-form-item label="跟进交易员">
          <el-input v-model="form.follow_trader" placeholder="输入跟进交易员" maxlength="50" />
        </el-form-item>

        <el-form-item label="地区">
          <el-select v-model="form.region" clearable placeholder="不填写" style="width: 100%">
            <el-option
              v-for="(label, value) in RegionLabel"
              :key="value"
              :label="label"
              :value="value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="所属交易员">
          <el-select v-model="form.agent_name" clearable placeholder="不指定" style="width: 100%">
            <el-option v-for="name in ['杨澜', '周辰', '陈浩']" :key="name" :label="name" :value="name" />
          </el-select>
        </el-form-item>
      </div>

      <el-form-item label="备注">
        <el-input
          v-model="form.remark"
          type="textarea"
          :rows="3"
          maxlength="500"
          placeholder="可记录来源、关系、注意事项或内部说明"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">建立客户</el-button>
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
