<script setup lang="ts">
/**
 * 移动端部门管理（运营经理）：员工在岗/请假概览 + 任务交接，简化自桌面 DepartmentView
 * （去掉出勤日历——周历格子在手机宽度下不可用；核心动作保留：登记缺席、标记交接）。
 */
import {
  LeaveTypeLabel,
  ROLE_FOCUS,
  leaveCoversDay,
  leaveFullLabel,
  type DepartmentMemberVO,
  type LeaveRecordVO,
} from "@bv/shared";
import { Empty as VanEmpty, Loading as VanLoading, showSuccessToast, Tab as VanTab, Tabs as VanTabs } from "vant";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
import { fetchDepartmentOverview, revokeLeaveHandoff } from "@/api/department";
import { formatRelative } from "@/utils/format";
import HandoffTargetSheet from "../../components/HandoffTargetSheet.vue";
import LeaveFormSheet from "../../components/LeaveFormSheet.vue";

const { t } = useI18n();

const loading = ref(true);
const members = ref<DepartmentMemberVO[]>([]);
const leaves = ref<LeaveRecordVO[]>([]);
const tab = ref<"overview" | "handoff">("overview");

function todayIso(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}
const today = todayIso();

async function load() {
  loading.value = true;
  try {
    const future = new Date();
    future.setDate(future.getDate() + 60);
    const data = await fetchDepartmentOverview(today, todayIsoOf(future));
    members.value = data.members;
    leaves.value = data.leaves;
  } finally {
    loading.value = false;
  }
}

function todayIsoOf(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

onMounted(load);

function memberLeaves(userId: string): LeaveRecordVO[] {
  return leaves.value.filter(leave => leave.user_id === userId);
}

function memberStatus(member: DepartmentMemberVO) {
  const leave = memberLeaves(member.user_id).find(item => leaveCoversDay(item, today));
  if (!leave) return { label: t("department.view.onDuty"), leave: null as LeaveRecordVO | null };
  return { label: localizeText(LeaveTypeLabel[leave.leave_type]), leave };
}

const focusOf = (member: DepartmentMemberVO) => {
  const focus = ROLE_FOCUS[member.role_code];
  return focus ? localizeText(focus) : member.role_name;
};

const unavailableToday = computed(() => members.value.filter(m => memberStatus(m).leave).length);
const doneToday = computed(() => members.value.reduce((sum, m) => sum + m.today_done, 0));
const activeLeaves = computed(() => leaves.value.filter(leave => leave.end_date >= today));
const handoffPendingCount = computed(() =>
  members.value
    .filter(m => memberLeaves(m.user_id).some(leave => leave.end_date >= today))
    .reduce((sum, m) => sum + m.pending, 0),
);

const memberById = (id: string) => members.value.find(m => m.user_id === id) ?? null;

/* 接手人由经理在选人面板里从系统全部启用账号中指定（不做系统推荐） */
const pickerLeaveId = ref("");
const pickerLeave = computed(() => leaves.value.find(leave => leave.id === pickerLeaveId.value) ?? null);
function openPicker(leave: LeaveRecordVO) {
  pickerLeaveId.value = leave.id;
}

const handoffSubmitting = ref("");
async function revokeHandoff(leave: LeaveRecordVO) {
  handoffSubmitting.value = leave.id;
  try {
    await revokeLeaveHandoff(leave.id);
    showSuccessToast(t("department.view.handoffRevoked", { name: leave.user_name }));
    await load();
  } finally {
    handoffSubmitting.value = "";
  }
}

const formVisible = ref(false);
function openForm() {
  formVisible.value = true;
}
</script>

<template>
  <div class="department-view">
    <div class="metric-grid">
      <div class="metric">
        <strong>{{ members.length - unavailableToday }}</strong>
        <span>{{ t("department.view.onDutyToday") }}</span>
      </div>
      <div class="metric" :class="{ warn: unavailableToday }">
        <strong>{{ unavailableToday }}</strong>
        <span>{{ t("department.view.unavailableToday") }}</span>
      </div>
      <div class="metric">
        <strong>{{ doneToday }}</strong>
        <span>{{ t("department.common.todayDone") }}</span>
      </div>
      <div class="metric" :class="{ danger: handoffPendingCount }">
        <strong>{{ handoffPendingCount }}</strong>
        <span>{{ t("department.view.handoffPendingLabel") }}</span>
      </div>
    </div>

    <button type="button" class="register-btn" @click="openForm">{{ t("department.view.registerLeave") }}</button>

    <van-tabs v-model:active="tab" sticky swipeable>
      <van-tab :title="t('department.view.tabOverview')" name="overview" />
      <van-tab :title="`${t('department.view.tabHandoff')}${activeLeaves.length ? ` (${activeLeaves.length})` : ''}`" name="handoff" />
    </van-tabs>

    <div class="list-body">
      <div v-if="loading" class="state"><van-loading size="20" /></div>

      <template v-else-if="tab === 'overview'">
        <article v-for="member in members" :key="member.user_id" class="member-card">
          <header>
            <div>
              <strong>{{ member.display_name }}</strong>
              <small>{{ member.username }}{{ member.title ? ` · ${member.title}` : "" }}</small>
            </div>
            <span class="badge" :class="{ leave: memberStatus(member).leave }">{{ memberStatus(member).label }}</span>
          </header>
          <p class="focus">{{ member.role_name }} · {{ focusOf(member) }}</p>
          <footer>
            <span>{{ t("department.common.todayDone") }} {{ member.today_done }} · {{ t("department.view.colPending") }} {{ member.pending }}</span>
            <span v-if="memberStatus(member).leave" class="suggest">
              {{ t("department.view.pendingAssign") }}
            </span>
            <span v-else class="muted">{{ t("department.view.lastActive", { time: formatRelative(member.last_login_at) }) }}</span>
          </footer>
        </article>
        <van-empty v-if="!members.length" :description="t('department.view.emptyMembers')" />
      </template>

      <template v-else>
        <p class="handoff-hint">{{ t("department.view.handoffHint") }}</p>
        <article v-for="leave in activeLeaves" :key="leave.id" class="leave-card">
          <header>
            <strong>{{ leave.user_name }}</strong>
            <small>{{ leave.role_name }}</small>
          </header>
          <p>{{ localizeText(LeaveTypeLabel[leave.leave_type]) }} · {{ localizeText(leaveFullLabel(leave)) }}</p>
          <p v-if="leave.note" class="note">{{ leave.note }}</p>
          <footer>
            <span>{{ t("department.common.currentPending", { count: memberById(leave.user_id)?.pending ?? 0 }) }}</span>
            <template v-if="leave.handoff_done">
              <span class="done">{{ leave.handoff_target ? t("department.view.handoffDoneTo", { name: leave.handoff_target }) : t("department.common.handoffDone") }}</span>
              <span class="row-actions">
                <button type="button" class="link-btn" @click="openPicker(leave)">{{ t("department.common.reassign") }}</button>
                <button
                  type="button"
                  class="link-btn danger"
                  :disabled="handoffSubmitting === leave.id"
                  @click="revokeHandoff(leave)"
                >
                  {{ t("department.common.revokeHandoff") }}
                </button>
              </span>
            </template>
            <button v-else type="button" class="handoff-btn" @click="openPicker(leave)">
              {{ t("department.common.markHandoff") }}
            </button>
          </footer>
        </article>
        <van-empty v-if="!activeLeaves.length" :description="t('department.view.emptyHandoff')" />
      </template>
    </div>

    <LeaveFormSheet v-model="formVisible" :members="members" :prefill="{}" @saved="load" />
    <HandoffTargetSheet :leave="pickerLeave" @close="pickerLeaveId = ''" @saved="load" />
  </div>
</template>

<style scoped>
.department-view {
  min-height: 100%;
  background: var(--color-surface-alt);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  padding: 12px 12px 0;
}

.metric {
  background: #fff;
  border-radius: 10px;
  padding: 10px 12px;
}

.metric strong {
  display: block;
  font-size: 18px;
}

.metric.warn strong {
  color: var(--color-warning);
}

.metric.danger strong {
  color: var(--color-danger);
}

.metric span {
  font-size: 12px;
  color: var(--color-text-muted);
}

.register-btn {
  display: block;
  width: calc(100% - 24px);
  margin: 10px 12px;
  border: 1px dashed var(--color-primary);
  background: var(--color-primary-light);
  color: var(--color-accent);
  border-radius: 10px;
  padding: 10px;
  font-size: 13px;
}

.list-body {
  padding: 10px 12px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.state {
  padding: 24px;
  text-align: center;
}

.handoff-hint {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.member-card,
.leave-card {
  background: #fff;
  border-radius: 12px;
  padding: 12px 14px;
}

.member-card header,
.leave-card header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.member-card strong,
.leave-card strong {
  font-size: 14px;
}

.member-card header small,
.leave-card header small {
  display: block;
  color: var(--color-text-muted);
  font-size: 12px;
  margin-top: 2px;
}

.badge {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #e7f6ec;
  color: #3e8e52;
}

.badge.leave {
  background: #fdf3e3;
  color: var(--color-warning);
}

.focus {
  margin: 8px 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.member-card footer,
.leave-card footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.leave-card p {
  margin: 6px 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.leave-card .note {
  color: var(--color-text-muted);
}

.suggest {
  color: var(--color-accent);
}

.done {
  color: #3e8e52;
}

.row-actions {
  display: inline-flex;
  gap: 12px;
  margin-left: 10px;
}
.link-btn {
  padding: 0;
  background: none;
  border: none;
  color: var(--bv-primary, var(--color-accent));
  font-size: 12px;
}
.link-btn.danger {
  color: #e45b5b;
}
.link-btn:disabled {
  opacity: 0.5;
}
.handoff-btn {
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
  color: var(--color-text-secondary);
}
</style>
