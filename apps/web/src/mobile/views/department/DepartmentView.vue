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
import { fetchDepartmentOverview, markLeaveHandoff } from "@/api/department";
import { formatRelative } from "@/utils/format";
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

function recommendedHandoff(member: DepartmentMemberVO): DepartmentMemberVO | null {
  const onDuty = (item: DepartmentMemberVO) => item.user_id !== member.user_id && !memberStatus(item).leave;
  const sameRole = members.value
    .filter(item => onDuty(item) && item.role_code === member.role_code)
    .sort((a, b) => a.pending - b.pending);
  if (sameRole.length) return sameRole[0];
  return members.value.filter(onDuty).sort((a, b) => a.pending - b.pending)[0] ?? null;
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
const leaveRecommendedHandoff = (leave: LeaveRecordVO) => {
  const member = memberById(leave.user_id);
  return member ? recommendedHandoff(member) : null;
};

const handoffSubmitting = ref("");
async function markHandoff(leave: LeaveRecordVO) {
  const target = leaveRecommendedHandoff(leave);
  handoffSubmitting.value = leave.id;
  try {
    await markLeaveHandoff(leave.id, target?.display_name ?? null);
    showSuccessToast(
      target
        ? t("department.view.handoffMarkedTo", { name: leave.user_name, target: target.display_name })
        : t("department.view.handoffMarkedPlain", { name: leave.user_name }),
    );
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
              {{ recommendedHandoff(member) ? t("department.view.suggestTakeover", { name: recommendedHandoff(member)!.display_name }) : t("department.view.pendingAssign") }}
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
            </template>
            <button v-else type="button" class="handoff-btn" :disabled="handoffSubmitting === leave.id" @click="markHandoff(leave)">
              {{ t("department.common.markHandoff") }}
            </button>
          </footer>
        </article>
        <van-empty v-if="!activeLeaves.length" :description="t('department.view.emptyHandoff')" />
      </template>
    </div>

    <LeaveFormSheet v-model="formVisible" :members="members" :prefill="{}" :recommend="recommendedHandoff" @saved="load" />
  </div>
</template>

<style scoped>
.department-view {
  min-height: 100%;
  background: #f5f6f8;
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
  color: #e6a23c;
}

.metric.danger strong {
  color: #f56c6c;
}

.metric span {
  font-size: 12px;
  color: #909399;
}

.register-btn {
  display: block;
  width: calc(100% - 24px);
  margin: 10px 12px;
  border: 1px dashed #ff7a00;
  background: #fff7f0;
  color: #ff7a00;
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
  color: #909399;
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
  color: #909399;
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
  color: #b88230;
}

.focus {
  margin: 8px 0;
  font-size: 12px;
  color: #606266;
}

.member-card footer,
.leave-card footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: #909399;
}

.leave-card p {
  margin: 6px 0;
  font-size: 12px;
  color: #606266;
}

.leave-card .note {
  color: #909399;
}

.suggest {
  color: #ff7a00;
}

.done {
  color: #3e8e52;
}

.handoff-btn {
  border: 1px solid #dcdfe6;
  background: #fff;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
  color: #606266;
}
</style>
