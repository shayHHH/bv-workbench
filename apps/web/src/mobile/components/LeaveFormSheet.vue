<script setup lang="ts">
/**
 * 移动端请假登记底部弹层。逻辑对齐桌面 LeaveFormDialog：类型/时间段/日期 + 交接建议预览。
 */
import {
  LEAVE_PART_DEFAULT_TIMES,
  LeavePart,
  LeavePartLabel,
  LeaveType,
  LeaveTypeLabel,
  type DepartmentMemberVO,
} from "@bv/shared";
import {
  ActionSheet as VanActionSheet,
  Button as VanButton,
  Checkbox as VanCheckbox,
  Field as VanField,
  Popup as VanPopup,
  showSuccessToast,
  showToast,
} from "vant";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
import { createLeave } from "@/api/department";

const visible = defineModel<boolean>({ required: true });
const props = defineProps<{
  members: DepartmentMemberVO[];
  prefill: { user_id?: string; date?: string };
  recommend: (member: DepartmentMemberVO) => DepartmentMemberVO | null;
}>();
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

const memberPickerVisible = ref(false);

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

const memberActions = computed(() =>
  props.members.map(m => ({ name: `${m.display_name} · ${m.role_name}`, user_id: m.user_id })),
);

function pickMember(action: { user_id: string }) {
  form.user_id = action.user_id;
  memberPickerVisible.value = false;
}

const submitting = ref(false);
async function submit() {
  if (!form.user_id) return showToast(t("department.leaveForm.memberRequired"));
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
    showSuccessToast(t("department.leaveForm.saved", { name: selectedMember.value?.display_name ?? "" }));
    visible.value = false;
    emit("saved");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <van-popup v-model:show="visible" position="bottom" round safe-area-inset-bottom>
    <div class="leave-form">
      <h3>{{ t("department.leaveForm.title") }}</h3>
      <p class="hint">{{ t("department.leaveForm.hint") }}</p>

      <span class="field-label">{{ t("department.leaveForm.member") }}</span>
      <van-field
        readonly
        is-link
        :model-value="selectedMember ? `${selectedMember.display_name} · ${selectedMember.role_name}` : ''"
        :placeholder="t('department.leaveForm.memberPh')"
        @click="memberPickerVisible = true"
      />

      <span class="field-label">{{ t("department.leaveForm.type") }}</span>
      <div class="pill-options">
        <button
          v-for="(label, value) in LeaveTypeLabel"
          :key="value"
          type="button"
          :class="{ active: form.leave_type === value }"
          @click="form.leave_type = value as LeaveType"
        >
          {{ localizeText(label) }}
        </button>
      </div>

      <span class="field-label">{{ t("department.leaveForm.part") }}</span>
      <div class="pill-options">
        <button
          v-for="(label, value) in LeavePartLabel"
          :key="value"
          type="button"
          :class="{ active: form.part === value }"
          @click="form.part = value as LeavePart"
        >
          {{ localizeText(label) }}
        </button>
      </div>

      <div v-if="form.part !== 'FULL_DAY'" class="row-2">
        <label>
          <span class="field-label">{{ t("department.leaveForm.startPh") }}</span>
          <input v-model="form.start_time" type="time" class="native-input" />
        </label>
        <label>
          <span class="field-label">{{ t("department.leaveForm.endPh") }}</span>
          <input v-model="form.end_time" type="time" class="native-input" />
        </label>
      </div>

      <div class="row-2">
        <label>
          <span class="field-label">{{ t("department.leaveForm.startDatePh") }}</span>
          <input v-model="form.start_date" type="date" class="native-input" />
        </label>
        <label>
          <span class="field-label">{{ t("department.leaveForm.endDatePh") }}</span>
          <input v-model="form.end_date" type="date" class="native-input" />
        </label>
      </div>

      <span class="field-label">{{ t("department.leaveForm.note") }}</span>
      <van-field v-model="form.note" type="textarea" :rows="2" maxlength="500" :placeholder="t('department.leaveForm.notePh')" class="note-input" />

      <van-checkbox v-model="form.handoff" class="handoff-checkbox">{{ t("department.leaveForm.handoffReminder") }}</van-checkbox>

      <div v-if="selectedMember" class="impact">
        <strong>{{ t("department.leaveForm.impactTitle") }}</strong>
        <p>{{ t("department.leaveForm.impactLine", { name: selectedMember.display_name, pending: selectedMember.pending, done: selectedMember.today_done }) }}</p>
        <span>{{ target ? t("department.leaveForm.suggestLine", { name: target.display_name, count: target.pending }) : t("department.leaveForm.noSuggest") }}</span>
      </div>

      <div class="buttons">
        <van-button block @click="visible = false">{{ t("department.common.cancel") }}</van-button>
        <van-button block type="primary" :loading="submitting" @click="submit">{{ t("department.leaveForm.save") }}</van-button>
      </div>
    </div>

    <van-action-sheet
      v-model:show="memberPickerVisible"
      :actions="memberActions"
      :title="t('department.leaveForm.memberPh')"
      @select="pickMember"
    />
  </van-popup>
</template>

<style scoped>
.leave-form {
  padding: 20px 16px 16px;
  max-height: 86vh;
  overflow-y: auto;
}

h3 {
  margin: 0 0 2px;
  font-size: 16px;
  text-align: center;
}

.hint {
  color: #909399;
  font-size: 12px;
  text-align: center;
  margin: 0 0 14px;
}

.field-label {
  display: block;
  font-size: 13px;
  color: #606266;
  margin: 12px 0 6px;
}

.pill-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pill-options button {
  border: 1px solid #dcdfe6;
  background: #fff;
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  color: #606266;
}

.pill-options button.active {
  border-color: #ff7a00;
  color: #ff7a00;
  background: #fff7f0;
}

.row-2 {
  display: flex;
  gap: 10px;
}

.row-2 label {
  flex: 1;
  min-width: 0;
}

.native-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  background: #fff;
}

.note-input {
  background: #f6f7f9;
  border-radius: 8px;
}

.handoff-checkbox {
  margin-top: 14px;
}

.impact {
  background: #fffaf5;
  border: 1px solid #ffe2c4;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12px;
  margin-top: 14px;
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

.buttons {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}
</style>
