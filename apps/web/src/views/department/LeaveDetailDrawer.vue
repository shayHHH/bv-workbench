<script setup lang="ts">
import {
  leaveFullLabel,
  LeaveTypeLabel,
  type DepartmentMemberVO,
  type LeaveRecordVO,
} from "@bv/shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
import { cancelLeave, markLeaveHandoff } from "@/api/department";
import { formatDateTime } from "@/utils/format";

const props = defineProps<{
  leave: LeaveRecordVO | null;
  member: DepartmentMemberVO | null;
  target: DepartmentMemberVO | null;
}>();

const emit = defineEmits<{ close: []; changed: []; "go-handoff": [] }>();
const { t } = useI18n();

const visible = computed({
  get: () => !!props.leave,
  set: value => {
    if (!value) emit("close");
  },
});

const handoffSubmitting = ref(false);
async function markHandoff() {
  if (!props.leave) return;
  handoffSubmitting.value = true;
  try {
    await markLeaveHandoff(props.leave.id, props.target?.display_name ?? null);
    ElMessage.success(t("department.leaveDrawer.handoffMarked"));
    emit("changed");
  } finally {
    handoffSubmitting.value = false;
  }
}

const cancelSubmitting = ref(false);
async function cancelRecord() {
  if (!props.leave) return;
  try {
    await ElMessageBox.confirm(
      t("department.leaveDrawer.cancelConfirm", { name: props.leave.user_name }),
      t("department.leaveDrawer.cancelTitle"),
      { type: "warning", confirmButtonText: t("department.leaveDrawer.cancelOk"), cancelButtonText: t("department.leaveDrawer.cancelKeep") },
    );
  } catch {
    return;
  }
  cancelSubmitting.value = true;
  try {
    await cancelLeave(props.leave.id);
    ElMessage.success(t("department.leaveDrawer.cancelled"));
    emit("changed");
    emit("close");
  } finally {
    cancelSubmitting.value = false;
  }
}
</script>

<template>
  <el-drawer v-model="visible" size="420px" :with-header="false">
    <template v-if="leave">
      <header class="drawer-head">
        <p class="eyebrow">LEAVE RECORD · {{ leave.leave_no }}</p>
        <div class="title-row">
          <h2>{{ leave.user_name }} · {{ localizeText(LeaveTypeLabel[leave.leave_type]) }}</h2>
          <el-tag :type="leave.leave_type === 'SICK' ? 'danger' : 'warning'" size="small" effect="light">
            {{ leave.part === "FULL_DAY" ? t("department.leaveDrawer.fullDayUnavailable") : t("department.leaveDrawer.partialUnavailable") }}
          </el-tag>
        </div>
        <p class="hint">{{ t("department.leaveDrawer.hint") }}</p>
      </header>

      <el-descriptions :column="1" class="attrs">
        <el-descriptions-item :label="t('department.leaveDrawer.member')">
          {{ leave.user_name }}{{ leave.role_name ? ` · ${leave.role_name}` : "" }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('department.leaveDrawer.timeRange')">{{ localizeText(leaveFullLabel(leave)) }}</el-descriptions-item>
        <el-descriptions-item :label="t('department.leaveDrawer.source')">{{ leave.source }}</el-descriptions-item>
        <el-descriptions-item :label="t('department.leaveDrawer.registeredBy')">
          {{ leave.registered_by }} · {{ formatDateTime(leave.registered_at) }}
        </el-descriptions-item>
        <el-descriptions-item v-if="leave.note" :label="t('department.leaveDrawer.note')">{{ leave.note }}</el-descriptions-item>
      </el-descriptions>

      <section class="section">
        <h3>{{ t("department.leaveDrawer.impactTitle") }}</h3>
        <el-descriptions :column="1" class="attrs">
          <el-descriptions-item :label="t('department.leaveDrawer.pendingTasks')">
            <strong>{{ member?.pending ?? 0 }}</strong> {{ t("department.common.itemsUnit") }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('department.common.todayDone')">{{ member?.today_done ?? 0 }} {{ t("department.common.itemsUnit") }}</el-descriptions-item>
          <el-descriptions-item :label="t('department.leaveDrawer.suggestLabel')">
            <template v-if="leave.handoff_done">
              {{ leave.handoff_target || t("department.common.arranged") }}
              <el-tag type="success" size="small" effect="light" class="done-tag">{{ t("department.common.handoffDone") }}</el-tag>
            </template>
            <template v-else-if="target">
              <strong>{{ target.display_name }}</strong> · {{ target.role_name }} · {{ t("department.common.currentPending", { count: target.pending }) }}
            </template>
            <span v-else>{{ t("department.leaveDrawer.pendingNoSameRole") }}</span>
          </el-descriptions-item>
        </el-descriptions>
        <div v-if="!leave.handoff_done" class="advice" :class="{ warn: !target }">
          {{
            target
              ? t(
                  target.role_code === member?.role_code
                    ? "department.leaveDrawer.adviceSameRole"
                    : "department.leaveDrawer.adviceAnyRole",
                  { target: target.display_name, name: leave.user_name, count: member?.pending ?? 0 },
                )
              : t("department.leaveDrawer.adviceNone")
          }}
        </div>
      </section>

      <footer class="actions">
        <el-button
          v-if="!leave.handoff_done"
          type="primary"
          :loading="handoffSubmitting"
          @click="markHandoff"
        >
          {{ t("department.common.markHandoff") }}
        </el-button>
        <el-button @click="emit('go-handoff')">{{ t("department.leaveDrawer.goHandoff") }}</el-button>
        <el-button type="danger" plain :loading="cancelSubmitting" @click="cancelRecord">{{ t("department.leaveDrawer.cancelTitle") }}</el-button>
      </footer>
    </template>
  </el-drawer>
</template>

<style scoped>
.drawer-head {
  margin-bottom: 14px;
}

.eyebrow {
  color: #ff7a00;
  font-size: 12px;
  letter-spacing: 0.12em;
  margin: 0 0 4px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.title-row h2 {
  margin: 0;
  font-size: 18px;
}

.hint {
  color: #909399;
  font-size: 12px;
  margin: 6px 0 0;
}

.attrs {
  margin-bottom: 4px;
}

.section {
  margin-top: 16px;
}

.section h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.done-tag {
  margin-left: 6px;
}

.advice {
  background: #f0f9eb;
  border: 1px solid #d8ecc5;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12px;
  color: #529b2e;
  margin-top: 8px;
}

.advice.warn {
  background: #fdf6ec;
  border-color: #f5dcb8;
  color: #b88230;
}

.actions {
  margin-top: 18px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
