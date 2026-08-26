<script setup lang="ts">
import {
  CustomerKind,
  CustomerKindLabel,
  CustomerStatusLabel,
  CustomerSubTypeLabel,
  RegionLabel,
  RiskLevelLabel,
  type CustomerVO,
} from "@bv/shared";
import { ElMessage } from "element-plus";
import { computed, reactive, ref, watch } from "vue";
import { fetchCustomers, updateCustomer } from "@/api/customer";

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
  agent_name: "",
  follow_trader: "",
  phone: "",
  remark: "",
  customer_status: "NEW",
  risk_level: "PENDING",
});

const isSub = computed(() => form.customer_kind === CustomerKind.SUB_CUSTOMER);
/** 名下有下级客户的中介不能变更类型（与后端校验一致） */
const kindLocked = computed(
  () =>
    props.customer?.customer_kind === CustomerKind.INTERMEDIARY &&
    (props.customer?.sub_customers?.length ?? 0) > 0,
);

const kindHint: Record<CustomerKind, string> = {
  DIRECT: "客户本人直接交易",
  INTERMEDIARY: "可挂载下级客户",
  SUB_CUSTOMER: "归属于指定中介",
};

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
    agent_name: c.agent_name || "",
    follow_trader: c.follow_trader || "",
    phone: c.phone || "",
    remark: c.remark || "",
    customer_status: c.customer_status,
    risk_level: c.risk_level,
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
    ElMessage.warning("请输入客户名称");
    return;
  }
  if (isSub.value && !form.parent_id) {
    ElMessage.warning("请选择所属中介");
    return;
  }
  if (!isSub.value && !/^\d{5}$/.test(form.customer_code)) {
    ElMessage.warning("直客/中介的客户编号必须是五位数字");
    return;
  }
  submitting.value = true;
  try {
    const updated = await updateCustomer(c.id, {
      name: form.name.trim(),
      customer_kind: form.customer_kind,
      customer_code: form.customer_code.trim() || null,
      parent_id: isSub.value ? form.parent_id : null,
      sub_type: isSub.value && form.sub_type ? (form.sub_type as never) : null,
      region: form.region ? (form.region as never) : null,
      agent_name: form.agent_name || null,
      follow_trader: form.follow_trader || null,
      phone: form.phone || null,
      remark: form.remark || null,
      customer_status: form.customer_status as never,
      risk_level: form.risk_level as never,
    });
    ElMessage.success(`客户信息已保存：${updated.customer_code || "无编号"} · ${updated.name}`);
    emit("updated", updated);
  } catch {
    /* 错误提示由 http 拦截器统一处理 */
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="编辑客户信息" width="640px" :close-on-click-modal="false">
    <p class="subtitle">
      {{ customer?.name }} · {{ customer ? CustomerKindLabel[customer.customer_kind] : "" }} · 当前编号
      {{ customer?.customer_code || "无编号" }}
    </p>
    <el-form label-position="top">
      <el-form-item label="STEP 01 客户类型">
        <div v-if="kindLocked" class="kind-locked">
          <strong>中介</strong>
          <span>名下有下级客户，暂不可变更类型</span>
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
            :label="`${broker.name}${broker.customer_code ? ` (${broker.customer_code})` : ''}`"
          />
        </el-select>
      </el-form-item>

      <div class="grid">
        <el-form-item :label="isSub ? '下级客户编号（可留空）' : '客户编号'" :required="!isSub">
          <el-input v-model="form.customer_code" maxlength="5" placeholder="20001-29999" />
        </el-form-item>
        <el-form-item label="客户名称" required>
          <el-input v-model="form.name" maxlength="100" />
        </el-form-item>

        <el-form-item v-if="isSub" label="下级主体类型（可选）">
          <el-select v-model="form.sub_type" clearable placeholder="不定义" style="width: 100%">
            <el-option v-for="(label, value) in CustomerSubTypeLabel" :key="value" :label="label" :value="value" />
          </el-select>
        </el-form-item>

        <el-form-item label="联系电话">
          <el-input v-model="form.phone" maxlength="50" placeholder="输入联系电话（可选）" />
        </el-form-item>
        <el-form-item label="跟进交易员">
          <el-input v-model="form.follow_trader" maxlength="50" placeholder="输入跟进交易员" />
        </el-form-item>
        <el-form-item label="地区">
          <el-select v-model="form.region" clearable placeholder="不填写" style="width: 100%">
            <el-option v-for="(label, value) in RegionLabel" :key="value" :label="label" :value="value" />
          </el-select>
        </el-form-item>
        <el-form-item label="所属交易员">
          <el-select v-model="form.agent_name" clearable placeholder="不指定" style="width: 100%">
            <el-option v-for="name in ['杨澜', '周辰', '陈浩']" :key="name" :label="name" :value="name" />
          </el-select>
        </el-form-item>
        <el-form-item label="当前状态">
          <el-select v-model="form.customer_status" style="width: 100%">
            <el-option v-for="(label, value) in CustomerStatusLabel" :key="value" :label="label" :value="value" />
          </el-select>
        </el-form-item>
        <el-form-item label="风险等级">
          <el-select v-model="form.risk_level" style="width: 100%">
            <el-option v-for="(label, value) in RiskLevelLabel" :key="value" :label="label" :value="value" />
          </el-select>
        </el-form-item>
      </div>

      <el-form-item label="备注">
        <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="500" placeholder="可记录来源、关系、注意事项或内部说明" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">保存信息</el-button>
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

.kind-locked {
  display: flex;
  flex-direction: column;
  padding: 8px 14px;
  background: #f5f6f8;
  border-radius: 8px;
  line-height: 1.5;
}

.kind-locked span {
  color: #909399;
  font-size: 12px;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 16px;
}
</style>
