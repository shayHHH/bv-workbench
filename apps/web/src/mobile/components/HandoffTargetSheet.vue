<script setup lang="ts">
/**
 * 移动端指定接手人：候选为系统全部启用账号（含 Admin），不做推荐、不按在岗过滤。
 * 确认后接手人在请假区间内获得请假人岗位的待办与操作权限。
 */
import { leaveFullLabel, LeaveTypeLabel, type HandoffCandidateVO, type LeaveRecordVO } from "@bv/shared";
import {
  Loading as VanLoading,
  Popup as VanPopup,
  Search as VanSearch,
  showFailToast,
  showSuccessToast,
} from "vant";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
import { fetchHandoffCandidates, markLeaveHandoff } from "@/api/department";

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
const keyword = ref("");
const submitting = ref("");

watch(
  () => props.leave?.id,
  async id => {
    if (!id) return;
    keyword.value = "";
    if (candidates.value.length) return;
    loading.value = true;
    try {
      candidates.value = await fetchHandoffCandidates();
    } finally {
      loading.value = false;
    }
  },
);

const options = computed(() => {
  const word = keyword.value.trim().toLowerCase();
  return candidates.value
    .filter(item => item.user_id !== props.leave?.user_id)
    .filter(
      item =>
        !word ||
        item.display_name.toLowerCase().includes(word) ||
        item.username.toLowerCase().includes(word) ||
        item.role_name.toLowerCase().includes(word),
    );
});

async function pick(candidate: HandoffCandidateVO) {
  const leave = props.leave;
  if (!leave || submitting.value) return;
  submitting.value = candidate.user_id;
  try {
    await markLeaveHandoff(leave.id, candidate.user_id);
    showSuccessToast(
      t("department.handoffPicker.saved", { name: leave.user_name, target: candidate.display_name }),
    );
    emit("saved");
    emit("close");
  } catch {
    showFailToast(t("department.handoffPicker.failed"));
  } finally {
    submitting.value = "";
  }
}
</script>

<template>
  <van-popup v-model:show="visible" position="bottom" round :style="{ height: '72%' }">
    <div v-if="leave" class="sheet">
      <header class="sheet-head">
        <strong>{{ t("department.handoffPicker.title") }}</strong>
        <small>
          {{ leave.user_name }} · {{ localizeText(LeaveTypeLabel[leave.leave_type]) }} ·
          {{ localizeText(leaveFullLabel(leave)) }}
        </small>
      </header>
      <van-search v-model="keyword" :placeholder="t('department.handoffPicker.searchPh')" />
      <div class="list">
        <div v-if="loading" class="state"><van-loading size="20" /></div>
        <button
          v-for="item in options"
          :key="item.user_id"
          type="button"
          class="row"
          :class="{ current: item.user_id === leave.handoff_user_id }"
          :disabled="!!submitting"
          @click="pick(item)"
        >
          <span class="name">
            {{ item.display_name }}
            <em v-if="item.on_leave_today">{{ t("department.handoffPicker.onLeave") }}</em>
          </span>
          <span class="role">{{ item.role_name }}</span>
        </button>
        <p v-if="!loading && !options.length" class="state">{{ t("department.handoffPicker.noMatch") }}</p>
      </div>
      <p class="hint">{{ t("department.handoffPicker.grantHint", { end: leave.end_date }) }}</p>
    </div>
  </van-popup>
</template>

<style scoped>
.sheet {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.sheet-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 16px 8px;
}
.sheet-head strong {
  font-size: 16px;
}
.sheet-head small {
  color: var(--color-text-muted);
  font-size: 12px;
}
.list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 13px 8px;
  background: none;
  border: none;
  border-bottom: 1px solid #f0f1f3;
  font-size: 14px;
  text-align: left;
}
.row.current {
  color: var(--bv-primary, var(--color-accent));
}
.row:disabled {
  opacity: 0.6;
}
.name em {
  margin-left: 6px;
  font-style: normal;
  font-size: 11px;
  color: var(--color-warning);
}
.role {
  color: var(--color-text-muted);
  font-size: 12px;
}
.state {
  padding: 24px 0;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 13px;
}
.hint {
  margin: 0;
  padding: 10px 16px calc(12px + env(safe-area-inset-bottom));
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.6;
}
</style>
