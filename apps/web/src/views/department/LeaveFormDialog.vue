<script setup lang="ts">
import {
  LEAVE_PART_DEFAULT_TIMES,
  LeavePart,
  LeavePartLabel,
  LeaveType,
  LeaveTypeLabel,
  type DepartmentMemberVO,
} from "@bv/shared";
import { ElMessage } from "element-plus";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
import { createLeave } from "@/api/department";

const props = defineProps<{
  members: DepartmentMemberVO[];
  prefill: { user_id?: string; date?: string };
  recommend: (member: DepartmentMemberVO) => DepartmentMemberVO | null;
}>();

const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [] }>();
const { t } = useI18n();

function todayIso(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

const form = reactive({
  user_id: "",
  leave_type: LeaveType.ANNUAL as LeaveType,
  part: LeavePart.FULL_DAY as LeavePart,
  start_date: todayIso(),
  end_date: todayIso(),
  start_time: "09:00",
  end_time: "18:00",
  note: "",
  handoff: true,
});

watch(visible, open => {
  if (!open) return;
  const date = props.prefill.date ?? todayIso();
  form.user_id = props.prefill.user_id ?? props.members[0]?.user_id ?? "";
  form.leave_type = LeaveType.ANNUAL;
  form.part = LeavePart.FULL_DAY;
  form.start_date = date;
  form.end_date = date;
  form.start_time = LEAVE_PART_DEFAULT_TIMES.FULL_DAY.start;
  form.end_time = LEAVE_PART_DEFAULT_TIMES.FULL_DAY.end;
  form.note = "";
  form.handoff = true;
});

watch(
  () => form.part,
  part => {
    form.start_time = LEAVE_PART_DEFAULT_TIMES[part].start;
    form.end_time = LEAVE_PART_DEFAULT_TIMES[part].end;
  },
);

watch(
  () => form.start_date,
  start => {
    if (form.end_date < start) form.end_date = start;
  },
);

const selectedMember = computed(() => props.members.find(m => m.user_id === form.user_id) ?? null);
const target = computed(() => (selectedMember.value ? props.recommend(selectedMember.value) : null));

const submitting = ref(false);
async function submit() {
  if (!form.user_id) {
    ElMessage.warning(t("department.leaveForm.memberRequired"));
    return;
  }
  submitting.value = true;
  try {
    await createLeave({
      user_id: form.user_id,
      leave_type: form.leave_type,
      part: form.part,
      start_date: form.start_date,
      end_date: form.end_date < form.start_date ? form.start_date : form.end_date,
      start_time: form.start_time,
      end_time: form.end_time,
      note: form.note || null,
      handoff: form.handoff,
    });
    ElMessage.success(t("department.leaveForm.saved", { name: selectedMember.value?.display_name ?? "" }));
    visible.value = false;
    emit("saved");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="t('department.leaveForm.title')" width="520px">
    <p class="hint">{{ t("department.leaveForm.hint") }}</p>
    <el-form label-width="80px" @submit.prevent>
      <el-form-item :label="t('department.leaveForm.member')">
        <el-select v-model="form.user_id" filterable :placeholder="t('department.leaveForm.memberPh')">
          <el-option
            v-for="member in members"
            :key="member.user_id"
            :value="member.user_id"
            :label="`${member.display_name} · ${member.role_name}`"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('department.leaveForm.type')">
        <el-select v-model="form.leave_type">
          <el-option
            v-for="(label, value) in LeaveTypeLabel"
            :key="value"
            :value="value"
            :label="localizeText(label)"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('department.leaveForm.part')">
        <el-select v-model="form.part">
          <el-option
            v-for="(label, value) in LeavePartLabel"
            :key="value"
            :value="value"
            :label="localizeText(label)"
          />
        </el-select>
      </el-form-item>
      <el-form-item v-if="form.part !== 'FULL_DAY'" :label="t('department.leaveForm.timeRange')">
        <div class="time-row">
          <el-time-select v-model="form.start_time" start="07:00" step="00:30" end="21:00" :placeholder="t('department.leaveForm.startPh')" />
          <span>—</span>
          <el-time-select v-model="form.end_time" start="07:00" step="00:30" end="21:30" :placeholder="t('department.leaveForm.endPh')" />
        </div>
      </el-form-item>
      <el-form-item :label="t('department.leaveForm.dateRange')">
        <div class="time-row">
          <el-date-picker v-model="form.start_date" type="date" value-format="YYYY-MM-DD" :placeholder="t('department.leaveForm.startDatePh')" />
          <span>{{ t("department.leaveForm.to") }}</span>
          <el-date-picker v-model="form.end_date" type="date" value-format="YYYY-MM-DD" :placeholder="t('department.leaveForm.endDatePh')" />
        </div>
      </el-form-item>
      <el-form-item :label="t('department.leaveForm.note')">
        <el-input
          v-model="form.note"
          type="textarea"
          :rows="2"
          maxlength="500"
          :placeholder="t('department.leaveForm.notePh')"
        />
      </el-form-item>
      <el-form-item label-width="0">
        <el-checkbox v-model="form.handoff">{{ t("department.leaveForm.handoffReminder") }}</el-checkbox>
      </el-form-item>
    </el-form>

    <div v-if="selectedMember" class="impact">
      <strong>{{ t("department.leaveForm.impactTitle") }}</strong>
      <p>{{ t("department.leaveForm.impactLine", { name: selectedMember.display_name, pending: selectedMember.pending, done: selectedMember.today_done }) }}</p>
      <span>{{ target ? t("department.leaveForm.suggestLine", { name: target.display_name, count: target.pending }) : t("department.leaveForm.noSuggest") }}</span>
    </div>

    <template #footer>
      <el-button @click="visible = false">{{ t("department.common.cancel") }}</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">{{ t("department.leaveForm.save") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  margin: 0 0 14px;
  color: #909399;
  font-size: 12px;
}

.time-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.time-row span {
  color: #909399;
}

.impact {
  background: #fffaf5;
  border: 1px solid #ffe2c4;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12px;
}

.impact strong {
  display: block;
  margin-bottom: 4px;
  color: #303133;
}

.impact p {
  margin: 0 0 4px;
  color: #606266;
}

.impact span {
  color: #ff7a00;
}
</style>
