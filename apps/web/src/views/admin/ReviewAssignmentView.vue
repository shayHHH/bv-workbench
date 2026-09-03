<script setup lang="ts">
import {
  ReviewType,
  ReviewTypeLabel,
  type ReviewAssignmentBoardVO,
  type ReviewAssignmentVO,
} from "@bv/shared";
import { ElMessage } from "element-plus";
import { onMounted, reactive, ref } from "vue";
import { fetchReviewAssignments, saveReviewAssignment } from "@/api/assignment";

const loading = ref(true);
const board = ref<ReviewAssignmentBoardVO | null>(null);
/** 各类型编辑中的负责人选择（review_type -> user ids） */
const drafts = reactive<Record<string, string[]>>({});
const savingType = ref<string | null>(null);

const TYPE_DESC: Record<ReviewType, string> = {
  FX: "材料上传页「提交到合规（找换）」生成的审核工单",
  USDT: "材料上传页「提交到合规（U相关）」生成的审核工单",
};

async function load() {
  loading.value = true;
  try {
    board.value = await fetchReviewAssignments();
    for (const assignment of board.value.assignments) {
      drafts[assignment.review_type] = assignment.assignees.map(user => user.id);
    }
  } finally {
    loading.value = false;
  }
}

function isDirty(assignment: ReviewAssignmentVO): boolean {
  const current = assignment.assignees.map(user => user.id).sort().join(",");
  const draft = [...(drafts[assignment.review_type] ?? [])].sort().join(",");
  return current !== draft;
}

async function save(assignment: ReviewAssignmentVO) {
  savingType.value = assignment.review_type;
  try {
    board.value = await saveReviewAssignment(
      assignment.review_type,
      drafts[assignment.review_type] ?? [],
    );
    for (const item of board.value.assignments) {
      drafts[item.review_type] = item.assignees.map(user => user.id);
    }
    ElMessage.success(
      `${ReviewTypeLabel[assignment.review_type]} 审核分配已更新`,
    );
  } finally {
    savingType.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <header class="page-header">
      <p class="eyebrow">SYSTEM ADMIN</p>
      <h1>审核分配</h1>
      <p class="subtitle">
        按审核类型指定负责的合规官：负责人以外的合规官对该类型工单能看不能办；此处随时可改派（顶班）。
      </p>
    </header>

    <div v-loading="loading" class="assignment-grid">
      <el-card v-for="assignment in board?.assignments ?? []" :key="assignment.review_type" shadow="never">
        <div class="card-head">
          <div>
            <h3>提交到合规（{{ ReviewTypeLabel[assignment.review_type] }}）</h3>
            <p class="muted">{{ TYPE_DESC[assignment.review_type] }}</p>
          </div>
          <el-tag :type="assignment.assignees.length ? 'success' : 'info'" effect="light">
            {{ assignment.assignees.length ? `${assignment.assignees.length} 名负责人` : "未配置" }}
          </el-tag>
        </div>

        <el-alert
          v-if="!assignment.assignees.length"
          type="info"
          :closable="false"
          class="fallback-alert"
          title="未配置负责人：兜底放开为全体合规官可处理，避免该类型审核卡死"
        />
        <el-alert
          v-else-if="assignment.assignees.some(user => !user.is_active)"
          type="warning"
          :closable="false"
          class="fallback-alert"
          title="有负责人账号已停用或角色变更，请及时改派"
        />

        <el-form label-position="top">
          <el-form-item label="负责的合规官（可多选）">
            <el-select
              v-model="drafts[assignment.review_type]"
              multiple
              clearable
              placeholder="不选 = 全体合规官可处理"
              class="assignee-select"
            >
              <el-option
                v-for="user in board?.compliance_users ?? []"
                :key="user.id"
                :value="user.id"
                :label="`${user.display_name}（${user.username}）${user.is_active ? '' : ' · 已停用'}`"
                :disabled="!user.is_active"
              />
            </el-select>
          </el-form-item>
        </el-form>

        <div class="card-foot">
          <span class="muted">
            <template v-if="assignment.updated_at">
              最近改派：{{ assignment.updated_by_name || "—" }} ·
              {{ new Date(assignment.updated_at).toLocaleString() }}
            </template>
            <template v-else>尚未配置过</template>
          </span>
          <el-button
            type="primary"
            :disabled="!isDirty(assignment)"
            :loading="savingType === assignment.review_type"
            @click="save(assignment)"
          >
            保存改派
          </el-button>
        </div>
      </el-card>
    </div>

    <el-card shadow="never" class="rules-card">
      <h4>分配规则说明</h4>
      <ul class="rules">
        <li>交易员在材料上传页选择「提交到合规（找换）」或「提交到合规（U相关）」，工单自动进入对应类型队列。</li>
        <li>配置了负责人的类型：仅负责人可出具结论（通过/驳回/终止），其他合规官仍可查看工单详情。</li>
        <li>未配置负责人（含负责人账号被停用后未改派）：该类型放开为全体合规官可处理。</li>
        <li>需要顶班时，admin 在本页把顶班账号临时加入负责人即可，事后移除。</li>
      </ul>
      <p v-if="!(board?.compliance_users ?? []).length" class="muted">
        当前还没有合规官账号——请先在「用户管理」创建角色为"合规官"的账号。
      </p>
    </el-card>
  </div>
</template>

<style scoped>
.page-header {
  margin-bottom: 16px;
}

.eyebrow {
  color: var(--color-accent);
  font-size: 12px;
  letter-spacing: 0.12em;
  margin: 0 0 4px;
}

h1 {
  margin: 0 0 4px;
  font-size: 22px;
}

.subtitle {
  color: var(--color-text-muted);
  margin: 0;
}

.assignment-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 14px;
  margin-bottom: 14px;
}

.card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.card-head h3 {
  margin: 0 0 4px;
}

.muted {
  color: var(--color-text-muted);
  font-size: 13px;
}

.fallback-alert {
  margin-bottom: 12px;
}

.assignee-select {
  width: 100%;
}

.card-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.rules-card h4 {
  margin: 0 0 8px;
}

.rules {
  margin: 0;
  padding-left: 18px;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.9;
}
</style>
