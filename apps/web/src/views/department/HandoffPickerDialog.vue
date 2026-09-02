<script setup lang="ts">
import { leaveFullLabel, LeaveTypeLabel, type HandoffCandidateVO, type LeaveRecordVO } from "@bv/shared";
import { ElMessage } from "element-plus";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
import { fetchHandoffCandidates, markLeaveHandoff } from "@/api/department";

/**
 * 指定接手人：候选为系统全部启用账号（含 Admin），不做岗位推荐、不按在岗过滤，
 * 由运营经理自行决定；确认后接手人在请假区间内获得请假人岗位的待办与操作权限。
 */
const props = defineProps<{ leave: LeaveRecordVO | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const { t } = useI18n();

const visible = computed({
  get: () => !!props.leave,
  set: value => {
    if (!value) emit("close");
  },
});

const candidates = ref<HandoffCandidateVO[]>([]);
const loading = ref(false);
const targetId = ref("");
const submitting = ref(false);

async function loadCandidates() {
  loading.value = true;
  try {
    candidates.value = await fetchHandoffCandidates();
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.leave?.id,
  id => {
    if (!id) return;
    targetId.value = props.leave?.handoff_user_id ?? "";
    if (!candidates.value.length) loadCandidates();
  },
);

/** 请假人本人不可作为接手人 */
const options = computed(() =>
  candidates.value.filter(item => item.user_id !== props.leave?.user_id),
);

const leaveSummary = computed(() => {
  const leave = props.leave;
  if (!leave) return "";
  return `${localizeText(LeaveTypeLabel[leave.leave_type])} · ${localizeText(leaveFullLabel(leave))}`;
});

async function submit() {
  const leave = props.leave;
  if (!leave) return;
  if (!targetId.value) {
    ElMessage.warning(t("department.handoffPicker.required"));
    return;
  }
  submitting.value = true;
  try {
    const target = options.value.find(item => item.user_id === targetId.value);
    await markLeaveHandoff(leave.id, targetId.value);
    ElMessage.success(
      t("department.handoffPicker.saved", {
        name: leave.user_name,
        target: target?.display_name ?? "",
      }),
    );
    emit("saved");
    emit("close");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="t('department.handoffPicker.title')" width="460px">
    <template v-if="leave">
      <div class="summary">
        <strong>{{ leave.user_name }}</strong>
        <span class="muted">{{ leave.role_name }}</span>
        <div class="muted">{{ leaveSummary }}</div>
      </div>
      <el-form label-width="76px" @submit.prevent>
        <el-form-item :label="t('department.handoffPicker.target')">
          <el-select
            v-model="targetId"
            filterable
            clearable
            :loading="loading"
            :placeholder="t('department.handoffPicker.targetPh')"
            class="picker"
          >
            <el-option
              v-for="item in options"
              :key="item.user_id"
              :value="item.user_id"
              :label="`${item.display_name}（${item.role_name}）`"
            >
              <span>{{ item.display_name }}</span>
              <span class="option-meta">
                {{ item.role_name }}
                <em v-if="item.on_leave_today">· {{ t("department.handoffPicker.onLeave") }}</em>
              </span>
            </el-option>
          </el-select>
        </el-form-item>
      </el-form>
      <p class="hint">{{ t("department.handoffPicker.grantHint", { end: leave.end_date }) }}</p>
    </template>
    <template #footer>
      <el-button @click="emit('close')">{{ t("department.common.cancel") }}</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">
        {{ t("department.common.confirmHandoff") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.summary {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  margin-bottom: 14px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}
.summary strong {
  font-size: 15px;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.picker {
  width: 100%;
}
.option-meta {
  float: right;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.option-meta em {
  font-style: normal;
  color: var(--el-color-warning);
}
.hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
