<script setup lang="ts">
import { ReviewAuditTypeLabel, type ReviewCaseVO, type ReviewStatsVO } from "@bv/shared";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { fetchReviewCases, fetchReviewStats } from "@/api/access";
import { localizeText } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { formatRelative } from "@/utils/format";

const { t } = useI18n();
const router = useRouter();
const auth = useAuthStore();

const loading = ref(true);
const stats = ref<ReviewStatsVO | null>(null);
const pendingCases = ref<ReviewCaseVO[]>([]);

async function load() {
  loading.value = true;
  try {
    const [statsData, pendingPage] = await Promise.all([
      fetchReviewStats(),
      fetchReviewCases({ status: "PENDING", page: 1, page_size: 5 }),
    ]);
    stats.value = statsData;
    pendingCases.value = pendingPage.items;
  } finally {
    loading.value = false;
  }
}

/** 等待最久的待处理工单已等待时长，如 "3h" / "2d 4h" */
const oldestWaiting = computed(() => {
  const iso = stats.value?.oldest_pending_submitted_at;
  if (!iso) return "--";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 3_600_000) return `${Math.max(1, Math.floor(diffMs / 60_000))}m`;
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
});

const metrics = computed(() => [
  {
    label: t("dashboard.compliance.mPending"),
    value: String(stats.value?.pending_total ?? 0),
    sub: t("dashboard.compliance.mPendingSub"),
    icon: "◌",
  },
  {
    label: t("dashboard.compliance.mOldest"),
    value: oldestWaiting.value,
    sub: stats.value?.oldest_pending_submitted_at
      ? t("dashboard.compliance.mOldestSub", { time: formatRelative(stats.value.oldest_pending_submitted_at) })
      : t("dashboard.compliance.mOldestEmpty"),
    icon: "!",
  },
  {
    label: t("dashboard.compliance.mApproved"),
    value: String(stats.value?.approved_today ?? 0),
    sub: t("dashboard.compliance.mApprovedSub"),
    icon: "✓",
  },
  {
    label: t("dashboard.compliance.mRejected"),
    value: String(stats.value?.rejected_today ?? 0),
    sub: t("dashboard.compliance.mRejectedSub"),
    icon: "◇",
  },
]);

function openReview(row: ReviewCaseVO) {
  router.push(`/compliance/review/${row.id}`);
}

onMounted(load);
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <p class="eyebrow">{{ t("dashboard.compliance.eyebrow") }}</p>
        <h1>{{ t("dashboard.compliance.title") }}</h1>
        <p class="subtitle">{{ t("dashboard.compliance.subtitle") }}</p>
      </div>
      <el-button type="primary" @click="router.push('/compliance/review')">{{ t("dashboard.compliance.enterQueue") }}</el-button>
    </header>

    <div class="role-context">
      <span class="avatar">{{ auth.initials }}</span>
      <div>
        <strong>{{ auth.user?.display_name }}</strong>
        <span class="muted">{{ auth.user?.title || localizeText(auth.user?.role?.name || "") }} · {{ t("dashboard.compliance.roleNote") }}</span>
      </div>
      <el-tag v-if="stats?.pending_resubmit" type="warning" effect="light" class="resubmit-tag">
        {{ t("dashboard.compliance.resubmitTag", { n: stats.pending_resubmit }) }}
      </el-tag>
    </div>

    <section v-loading="loading" class="metric-strip">
      <el-card v-for="m in metrics" :key="m.label" shadow="never" class="metric">
        <div class="metric-head">
          <span>{{ m.label }}</span>
          <i>{{ m.icon }}</i>
        </div>
        <strong class="metric-value">{{ m.value }}</strong>
        <small class="muted">{{ m.sub }}</small>
      </el-card>
    </section>

    <el-card shadow="never">
      <div class="section-header">
        <div>
          <h2>{{ t("dashboard.compliance.requestsTitle") }}</h2>
          <p class="muted">{{ t("dashboard.compliance.requestsSub") }}</p>
        </div>
        <el-button link type="primary" @click="router.push('/compliance/review')">{{ t("dashboard.compliance.viewAll") }}</el-button>
      </div>
      <div v-loading="loading" class="request-list">
        <div v-for="row in pendingCases" :key="row.id" class="request-row">
          <span class="task-icon">{{ t("dashboard.compliance.taskIcon") }}</span>
          <div class="request-main">
            <strong>{{ row.customer_name }} · {{ row.case_no }}</strong>
            <span class="muted">
              {{ t("dashboard.compliance.reviewLabel") }} · {{ localizeText(ReviewAuditTypeLabel[row.audit_type]) }}
              {{ row.scenario_name ? ` · ${row.scenario_name}` : "" }}
              · {{ t("dashboard.compliance.submittedAt", { time: formatRelative(row.submitted_at) }) }}
            </span>
          </div>
          <el-tag type="warning" size="small" effect="light">{{ t("dashboard.compliance.statusPending") }}</el-tag>
          <el-button type="primary" size="small" @click="openReview(row)">{{ t("dashboard.compliance.goReview") }}</el-button>
        </div>
        <el-empty
          v-if="!loading && !pendingCases.length"
          :description="t('dashboard.compliance.empty')"
        />
      </div>
    </el-card>
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

.muted {
  color: #909399;
}

.role-context {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 12px 16px;
  margin-bottom: 14px;
}

.role-context strong {
  display: block;
}

.role-context .muted {
  font-size: 13px;
}

.avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: #ff7a00;
  color: #fff;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.resubmit-tag {
  margin-left: auto;
}

.metric-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 14px;
}

.metric-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #909399;
  font-size: 13px;
}

.metric-head i {
  font-style: normal;
  color: #ff7a00;
}

.metric-value {
  display: block;
  font-size: 26px;
  margin: 6px 0 2px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.section-header h2 {
  margin: 0 0 2px;
  font-size: 16px;
}

.section-header p {
  margin: 0;
  font-size: 13px;
}

.request-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 80px;
}

.request-row {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 12px 14px;
}

.task-icon {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: #fff4ea;
  color: #ff7a00;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.request-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.request-main .muted {
  font-size: 13px;
}

@media (max-width: 1100px) {
  .metric-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
