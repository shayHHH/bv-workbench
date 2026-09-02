<script setup lang="ts">
import {
  leaveCoversDay,
  leaveFullLabel,
  leaveTimeLabel,
  LeaveType,
  LeaveTypeLabel,
  ROLE_FOCUS,
  DONE_PERIODS,
  type DonePeriod,
  type DepartmentMemberVO,
  type LeaveRecordVO,
} from "@bv/shared";
import { Plus } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
import { fetchDepartmentOverview, revokeLeaveHandoff } from "@/api/department";
import { formatRelative } from "@/utils/format";
import HandoffPickerDialog from "./HandoffPickerDialog.vue";
import LeaveDetailDrawer from "./LeaveDetailDrawer.vue";
import LeaveFormDialog from "./LeaveFormDialog.vue";

const { t } = useI18n();

const loading = ref(false);
const members = ref<DepartmentMemberVO[]>([]);
const leaves = ref<LeaveRecordVO[]>([]);
const initialLoading = computed(() => loading.value && !members.value.length && !leaves.value.length);
const tab = ref<"overview" | "calendar" | "handoff">("calendar");
/** 员工概览「已处理」列统计范围 */
const donePeriod = ref<DonePeriod>("today");
const weekOffset = ref(0);

/* ---- 日期工具（本地时区，按 YYYY-MM-DD 字符串比对，口径与后端一致） ---- */

function isoDate(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

const todayIso = isoDate(new Date());

const WEEK_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** 当前展示周（周一起始）的 7 天 */
const weekDays = computed(() => {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + weekOffset.value * 7);
  const day = base.getDay() || 7;
  base.setDate(base.getDate() - day + 1);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(base);
    date.setDate(base.getDate() + index);
    return {
      iso: isoDate(date),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      week: t(`department.view.week.${WEEK_KEYS[index]}`),
    };
  });
});

let loadSeq = 0;
async function load() {
  const seq = ++loadSeq;
  loading.value = true;
  try {
    // 范围取「展示周 ∪ 今天起 60 天」：日历用展示周，任务交接需要今天之后的请假
    const future = new Date();
    future.setDate(future.getDate() + 60);
    const start = weekDays.value[0].iso < todayIso ? weekDays.value[0].iso : todayIso;
    const endCandidate = isoDate(future);
    const end = weekDays.value[6].iso > endCandidate ? weekDays.value[6].iso : endCandidate;
    const data = await fetchDepartmentOverview(start, end, donePeriod.value);
    if (seq !== loadSeq) return;
    members.value = data.members;
    leaves.value = data.leaves;
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

watch(weekOffset, load);
watch(donePeriod, load);
onMounted(load);

/* ---- 出勤状态与调度建议（对齐 demo 部门管理逻辑） ---- */

function memberLeaves(userId: string): LeaveRecordVO[] {
  return leaves.value.filter(leave => leave.user_id === userId);
}

function memberStatus(member: DepartmentMemberVO, iso = todayIso) {
  const leave = memberLeaves(member.user_id).find(item => leaveCoversDay(item, iso));
  if (!leave) return { label: t("department.view.onDuty"), tone: "success" as const, leave: null };
  const typeText = localizeText(LeaveTypeLabel[leave.leave_type]);
  const label = leave.part === "FULL_DAY" ? typeText : `${localizeText(leaveTimeLabel(leave))} ${typeText}`;
  return { label, tone: leave.leave_type === LeaveType.SICK ? ("danger" as const) : ("warning" as const), leave };
}

const focusOf = (member: DepartmentMemberVO) => {
  const focus = ROLE_FOCUS[member.role_code];
  return focus ? localizeText(focus) : member.role_name;
};

const LEAVE_TONE: Record<string, string> = {
  ANNUAL: "annual",
  SICK: "sick",
  PERSONAL: "personal",
  REST: "rest",
  OUTING: "outing",
  TRAINING: "training",
  OTHER: "other",
};

/* ---- 指标 ---- */

const unavailableToday = computed(() => members.value.filter(m => memberStatus(m).leave).length);
const doneToday = computed(() => members.value.reduce((sum, m) => sum + m.today_done, 0));
/** 有未结束请假记录的员工名下待办 */
const handoffPending = computed(() =>
  members.value
    .filter(m => memberLeaves(m.user_id).some(leave => leave.end_date >= todayIso))
    .reduce((sum, m) => sum + m.pending, 0),
);

/* ---- 任务交接（每条未结束请假一行） ---- */

const activeLeaves = computed(() => leaves.value.filter(leave => leave.end_date >= todayIso));

const memberById = (id: string) => members.value.find(m => m.user_id === id) ?? null;
const leavePendingCount = (leave: LeaveRecordVO) => memberById(leave.user_id)?.pending ?? 0;

/* 交接接手人由经理在弹窗里从系统全部启用账号中指定（不做系统推荐） */
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
    ElMessage.success(t("department.view.handoffRevoked", { name: leave.user_name }));
    await load();
  } finally {
    handoffSubmitting.value = "";
  }
}

/* ---- 请假登记 / 详情 ---- */

const formVisible = ref(false);
const formPrefill = ref<{ user_id?: string; date?: string }>({});

function openForm(prefill: { user_id?: string; date?: string } = {}) {
  formPrefill.value = prefill;
  formVisible.value = true;
}

const detailLeaveId = ref("");
const detailLeave = computed(() => leaves.value.find(leave => leave.id === detailLeaveId.value) ?? null);

function leaveTooltip(leave: LeaveRecordVO): string {
  return `${leave.user_name} · ${localizeText(LeaveTypeLabel[leave.leave_type])}\n${localizeText(leaveFullLabel(leave))}\n${t("department.view.sourceLine", { source: leave.source })}${leave.note ? `\n${t("department.view.noteLine", { note: leave.note })}` : ""}`;
}

/* ---- 日历分组（按岗位） ---- */

const calendarGroups = computed(() => {
  const groups = new Map<string, DepartmentMemberVO[]>();
  members.value.forEach(member => {
    const list = groups.get(member.role_name) ?? [];
    list.push(member);
    groups.set(member.role_name, list);
  });
  return [...groups.entries()].map(([name, list]) => ({ name, members: list }));
});

const weekLeaves = computed(() =>
  leaves.value.filter(
    leave => leave.end_date >= weekDays.value[0].iso && leave.start_date <= weekDays.value[6].iso,
  ),
);
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <p class="eyebrow">TEAM AVAILABILITY</p>
        <h1>{{ t("department.view.title") }}</h1>
        <p class="subtitle">{{ t("department.view.subtitle") }}</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openForm()">{{ t("department.view.registerLeave") }}</el-button>
    </header>

    <div class="metric-strip">
      <div class="metric">
        <strong>{{ members.length - unavailableToday }}</strong>
        <span>{{ t("department.view.onDutyToday") }}</span><small>{{ t("department.view.onDutyHint") }}</small>
      </div>
      <div class="metric" :class="{ warn: unavailableToday }">
        <strong>{{ unavailableToday }}</strong>
        <span>{{ t("department.view.unavailableToday") }}</span><small>{{ t("department.view.unavailableHint") }}</small>
      </div>
      <div class="metric">
        <strong>{{ doneToday }}</strong>
        <span>{{ t("department.common.todayDone") }}</span><small>{{ t("department.view.doneHint") }}</small>
      </div>
      <div class="metric" :class="{ danger: handoffPending }">
        <strong>{{ handoffPending }}</strong>
        <span>{{ t("department.view.handoffPendingLabel") }}</span><small>{{ t("department.view.handoffPendingHint") }}</small>
      </div>
    </div>

    <el-card shadow="never" v-loading="initialLoading">
      <div class="todo-tabs">
        <button type="button" :class="{ active: tab === 'overview' }" @click="tab = 'overview'">{{ t("department.view.tabOverview") }}</button>
        <button type="button" :class="{ active: tab === 'calendar' }" @click="tab = 'calendar'">{{ t("department.view.tabCalendar") }}</button>
        <button type="button" :class="{ active: tab === 'handoff' }" @click="tab = 'handoff'">
          {{ t("department.view.tabHandoff") }}<em v-if="activeLeaves.length">{{ activeLeaves.length }}</em>
        </button>
        <el-radio-group v-if="tab === 'overview'" v-model="donePeriod" size="small" class="period-picker">
          <el-radio-button v-for="p in DONE_PERIODS" :key="p" :value="p">
            {{ t(`department.view.donePeriodOpt.${p}`) }}
          </el-radio-button>
        </el-radio-group>
      </div>

      <!-- 员工概览 -->
      <template v-if="tab === 'overview'">
        <el-table :data="members" row-key="user_id">
          <el-table-column :label="t('department.view.colMember')" min-width="180">
            <template #default="{ row }">
              <strong>{{ row.display_name }}</strong>
              <div class="muted">{{ row.username }}{{ row.title ? ` · ${row.title}` : "" }}</div>
            </template>
          </el-table-column>
          <el-table-column :label="t('department.view.colRole')" width="110">
            <template #default="{ row }">{{ row.role_name }}</template>
          </el-table-column>
          <el-table-column :label="t('department.view.colTodayStatus')" width="130">
            <template #default="{ row }">
              <el-tag :type="memberStatus(row).tone" size="small" effect="light">{{ memberStatus(row).label }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="t(`department.view.donePeriodCol.${donePeriod}`)" width="110" align="center">
            <template #default="{ row }"><strong>{{ row.period_done }}</strong></template>
          </el-table-column>
          <el-table-column :label="t('department.view.colPending')" width="90" align="center">
            <template #default="{ row }">{{ row.pending }}</template>
          </el-table-column>
          <el-table-column :label="t('department.view.colFocus')" min-width="160">
            <template #default="{ row }">{{ focusOf(row) }}</template>
          </el-table-column>
          <el-table-column :label="t('department.view.colAdvice')" min-width="150">
            <template #default="{ row }">
              <el-button v-if="memberStatus(row).leave" link type="primary" @click="tab = 'handoff'">
                {{ t("department.view.goArrangeHandoff") }}
              </el-button>
              <span v-else class="muted">{{ t("department.view.lastActive", { time: formatRelative(row.last_login_at) }) }}</span>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loading && !members.length" :description="t('department.view.emptyMembers')" />
      </template>

      <!-- 出勤日历 -->
      <template v-if="tab === 'calendar'">
        <div class="calendar-toolbar">
          <span class="muted">{{ t("department.view.weekRangeHint", { start: weekDays[0].iso, end: weekDays[6].iso }) }}</span>
          <div class="calendar-nav">
            <el-button size="small" @click="weekOffset -= 1">{{ t("department.view.prevWeek") }}</el-button>
            <el-button size="small" :disabled="weekOffset === 0" @click="weekOffset = 0">{{ t("department.view.thisWeek") }}</el-button>
            <el-button size="small" @click="weekOffset += 1">{{ t("department.view.nextWeek") }}</el-button>
          </div>
        </div>
        <div class="calendar-layout">
          <div class="team-schedule">
            <div class="schedule-head person-head">{{ t("department.view.colMemberDate") }}</div>
            <div v-for="day in weekDays" :key="day.iso" class="schedule-head" :class="{ today: day.iso === todayIso }">
              <strong>{{ day.week }}<em v-if="day.iso === todayIso">{{ t("department.view.today") }}</em></strong>
              <span>{{ day.label }}</span>
            </div>
            <template v-for="group in calendarGroups" :key="group.name">
              <div class="schedule-group-row">{{ group.name }}<span>{{ t("department.view.memberCount", { count: group.members.length }) }}</span></div>
              <template v-for="member in group.members" :key="member.user_id">
                <div class="schedule-person">
                  <strong>{{ member.display_name }}</strong>
                  <small>{{ member.role_name }} · {{ t("department.view.pendingCount", { count: member.pending }) }}</small>
                </div>
                <template v-for="day in weekDays" :key="member.user_id + day.iso">
                  <button
                    v-if="!memberLeaves(member.user_id).some(l => leaveCoversDay(l, day.iso))"
                    class="schedule-cell available"
                    :class="{ today: day.iso === todayIso }"
                    type="button"
                    @click="openForm({ user_id: member.user_id, date: day.iso })"
                  >
                    {{ t("department.view.onDuty") }}
                  </button>
                  <div v-else class="schedule-cell" :class="{ today: day.iso === todayIso }">
                    <button
                      v-for="leave in memberLeaves(member.user_id).filter(l => leaveCoversDay(l, day.iso))"
                      :key="leave.id"
                      class="leave-chip"
                      :class="LEAVE_TONE[leave.leave_type]"
                      type="button"
                      :title="leaveTooltip(leave)"
                      @click="detailLeaveId = leave.id"
                    >
                      <strong>{{ localizeText(LeaveTypeLabel[leave.leave_type]) }}</strong>
                      <span>{{ localizeText(leaveTimeLabel(leave)) }}</span>
                    </button>
                  </div>
                </template>
              </template>
            </template>
          </div>
          <aside class="week-side">
            <h3>{{ t("department.view.weekSideTitle") }}</h3>
            <p class="muted">{{ t("department.view.weekSideHint") }}</p>
            <el-empty v-if="!weekLeaves.length" :description="t('department.view.weekEmpty')" :image-size="60" />
            <article v-for="leave in weekLeaves" :key="leave.id" class="handoff-card" @click="detailLeaveId = leave.id">
              <header>
                <span class="leave-dot" :class="LEAVE_TONE[leave.leave_type]" />
                <div>
                  <strong>{{ leave.user_name }} · {{ localizeText(LeaveTypeLabel[leave.leave_type]) }}</strong>
                  <small>{{ localizeText(leaveFullLabel(leave)) }}</small>
                </div>
              </header>
              <p>{{ leave.note || t("department.view.noNote") }}</p>
              <footer>
                <span>{{ t("department.view.pendingHandoffCount", { count: leavePendingCount(leave) }) }}</span>
                <b>{{
                  leave.handoff_done
                    ? (leave.handoff_target ? t("department.view.handoffDoneTo", { name: leave.handoff_target }) : t("department.common.handoffDone"))
                    : t("department.view.pendingAssign")
                }}</b>
              </footer>
            </article>
          </aside>
        </div>
      </template>

      <!-- 任务交接 -->
      <template v-if="tab === 'handoff'">
        <p class="muted handoff-hint">{{ t("department.view.handoffHint") }}</p>
        <el-table :data="activeLeaves" row-key="id">
          <el-table-column :label="t('department.view.colLeaveMember')" min-width="150">
            <template #default="{ row }">
              <strong>{{ row.user_name }}</strong>
              <div class="muted">{{ row.role_name }}</div>
            </template>
          </el-table-column>
          <el-table-column :label="t('department.view.colAbsence')" min-width="220">
            <template #default="{ row }">
              {{ localizeText(LeaveTypeLabel[row.leave_type as LeaveType]) }} {{ localizeText(leaveFullLabel(row)) }}
            </template>
          </el-table-column>
          <el-table-column :label="t('department.view.colImpact')" width="120" align="center">
            <template #default="{ row }">
              <strong>{{ memberById(row.user_id)?.pending ?? 0 }}</strong> {{ t("department.common.itemsUnit") }}
            </template>
          </el-table-column>
          <el-table-column :label="t('department.view.colTakeover')" min-width="180">
            <template #default="{ row }">
              <template v-if="row.handoff_done">
                <strong>{{ row.handoff_target || t("department.common.arranged") }}</strong>
                <div class="muted">{{ t("department.view.handoffAtDone", { time: formatRelative(row.handoff_at) }) }}</div>
              </template>
              <span v-else class="muted">{{ t("department.view.pendingShort") }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('department.view.colActions')" width="190" align="right">
            <template #default="{ row }">
              <template v-if="row.handoff_done">
                <el-button size="small" @click="openPicker(row)">{{ t("department.common.reassign") }}</el-button>
                <el-button
                  size="small"
                  text
                  type="danger"
                  :loading="handoffSubmitting === row.id"
                  @click="revokeHandoff(row)"
                >
                  {{ t("department.common.revokeHandoff") }}
                </el-button>
              </template>
              <el-button v-else size="small" type="primary" @click="openPicker(row)">
                {{ t("department.common.markHandoff") }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loading && !activeLeaves.length" :description="t('department.view.emptyHandoff')" />
      </template>
    </el-card>

    <LeaveFormDialog
      v-model="formVisible"
      :members="members"
      :prefill="formPrefill"
      @saved="load"
    />
    <LeaveDetailDrawer
      :leave="detailLeave"
      :member="detailLeave ? memberById(detailLeave.user_id) : null"
      @close="detailLeaveId = ''"
      @changed="load"
      @go-handoff="tab = 'handoff'; detailLeaveId = ''"
      @pick-target="leave => { detailLeaveId = ''; openPicker(leave); }"
    />
    <HandoffPickerDialog :leave="pickerLeave" @close="pickerLeaveId = ''" @saved="load" />
  </div>
</template>

<style scoped>
.page-header {
  margin-bottom: 16px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.eyebrow {
  color: #ff7a00;
  font-size: 12px;
  letter-spacing: 0.12em;
  margin: 0 0 4px;
}

h1 {
  margin: 0 0 4px;
  font-size: 22px;
}

.subtitle {
  color: #909399;
  margin: 0;
}

.metric-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}

.metric {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 12px 14px;
}

.metric strong {
  font-size: 20px;
  display: block;
}

.metric.warn strong {
  color: #e6a23c;
}

.metric.danger strong {
  color: #f56c6c;
}

.metric span {
  color: #303133;
  font-size: 13px;
}

.metric small {
  display: block;
  color: #909399;
  font-size: 11px;
}

.todo-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 12px;
}

.period-picker {
  margin-left: auto;
}

.todo-tabs button {
  border: 1px solid #e4e7ed;
  background: #fff;
  border-radius: 999px;
  padding: 5px 14px;
  cursor: pointer;
  font-size: 13px;
  color: #606266;
}

.todo-tabs button.active {
  background: #ff7a00;
  border-color: #ff7a00;
  color: #fff;
}

.todo-tabs em {
  font-style: normal;
  margin-left: 6px;
  opacity: 0.8;
}

.muted {
  color: #909399;
  font-size: 12px;
}

.handoff-hint {
  margin: 0 0 10px;
}

/* ---- 出勤日历 ---- */

.calendar-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.calendar-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 14px;
  align-items: start;
}

.team-schedule {
  display: grid;
  grid-template-columns: 170px repeat(7, minmax(84px, 1fr));
  gap: 4px;
  overflow-x: auto;
}

.schedule-head {
  background: #f5f7fa;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  color: #606266;
}

.schedule-head strong {
  display: block;
  color: #303133;
}

.schedule-head strong em {
  font-style: normal;
  color: #ff7a00;
  margin-left: 4px;
  font-size: 11px;
}

.schedule-head.today {
  background: #fff4e8;
}

.schedule-group-row {
  grid-column: 1 / -1;
  background: #fafafa;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 600;
  color: #606266;
  margin-top: 6px;
}

.schedule-group-row span {
  font-weight: 400;
  color: #909399;
  margin-left: 8px;
}

.schedule-person {
  padding: 8px 10px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  min-height: 46px;
}

.schedule-person strong {
  display: block;
  font-size: 13px;
}

.schedule-person small {
  color: #909399;
  font-size: 11px;
}

.schedule-cell {
  border: 1px dashed #e4e7ed;
  border-radius: 8px;
  min-height: 46px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px;
  background: #fff;
}

.schedule-cell.today {
  border-color: #ffd6ad;
  background: #fffaf5;
}

button.schedule-cell.available {
  align-items: center;
  justify-content: center;
  color: #c0c4cc;
  font-size: 12px;
  cursor: pointer;
}

button.schedule-cell.available:hover {
  color: #ff7a00;
  border-color: #ff7a00;
}

.leave-chip {
  border: 0;
  border-radius: 6px;
  padding: 4px 6px;
  text-align: left;
  cursor: pointer;
  font-size: 11px;
  line-height: 1.3;
  color: #fff;
}

.leave-chip strong {
  display: block;
  font-size: 12px;
}

.leave-chip span {
  opacity: 0.85;
}

.leave-chip.annual,
.leave-dot.annual {
  background: #409eff;
}

.leave-chip.sick,
.leave-dot.sick {
  background: #f56c6c;
}

.leave-chip.personal,
.leave-dot.personal {
  background: #e6a23c;
}

.leave-chip.rest,
.leave-dot.rest {
  background: #67c23a;
}

.leave-chip.outing,
.leave-dot.outing {
  background: #9c27b0;
}

.leave-chip.training,
.leave-dot.training {
  background: #00acc1;
}

.leave-chip.other,
.leave-dot.other {
  background: #909399;
}

/* ---- 本周交接提醒 ---- */

.week-side {
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 12px 14px;
}

.week-side h3 {
  margin: 0 0 2px;
  font-size: 14px;
}

.week-side > p {
  margin: 0 0 10px;
}

.handoff-card {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 8px;
  cursor: pointer;
}

.handoff-card:hover {
  border-color: #ffd6ad;
}

.handoff-card header {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.leave-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 5px;
  flex: none;
}

.handoff-card header strong {
  display: block;
  font-size: 13px;
}

.handoff-card header small {
  color: #909399;
  font-size: 11px;
}

.handoff-card p {
  margin: 6px 0;
  color: #606266;
  font-size: 12px;
}

.handoff-card footer {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #909399;
}

.handoff-card footer b {
  color: #ff7a00;
}

@media (max-width: 1100px) {
  .calendar-layout {
    grid-template-columns: 1fr;
  }
}
</style>
