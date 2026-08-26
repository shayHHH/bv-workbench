<script setup lang="ts">
import {
  AccessStatus,
  AccessStatusLabel,
  ApplicationMaterialStatus,
  ApplicationMaterialStatusLabel,
  LEGACY_DECISION_ACTION_LABEL,
  MaterialSource,
  MaterialSourceLabel,
  ReviewDecisionActionLabel,
  UPLOAD_ACCEPT_EXTS,
  UPLOAD_MAX_SIZE,
  type ApplicationMaterialVO,
  type CustomerMaterialVO,
  type KycItem,
  type KycScenarioVO,
  type ReviewDecisionAction,
} from "@bv/shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft, FolderOpened, Upload } from "@element-plus/icons-vue";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  archiveCustomerMaterials,
  fetchApplication,
  fetchCustomerMaterials,
  openFilePreview,
  saveApplicationDraft,
  submitApplication,
  uploadFile,
} from "@/api/access";
import { fetchActiveScenarios } from "@/api/kyc";

const route = useRoute();
const router = useRouter();
const applicationId = route.params.id as string;

const loading = ref(true);
const saving = ref(false);
const submitting = ref(false);
const step = ref(1);
const scenarios = ref<KycScenarioVO[]>([]);

/** 本地可编辑草稿状态 */
const draft = reactive({
  scenario_id: "" as string,
  channel_code: "" as string,
  customer_cn_name: "" as string,
  customer_en_name: "" as string,
  business_note: "" as string,
  materials: [] as ApplicationMaterialVO[],
});

const application = ref<Awaited<ReturnType<typeof fetchApplication>> | null>(null);

const EDITABLE_STATUSES: AccessStatus[] = [
  AccessStatus.DRAFT,
  AccessStatus.SUPPLEMENT_REQUIRED,
  AccessStatus.REJECTED,
];

const editable = computed(() =>
  application.value ? EDITABLE_STATUSES.includes(application.value.status) : false,
);

const currentScenario = computed(
  () => scenarios.value.find(s => s.id === draft.scenario_id) ?? null,
);
const currentChannel = computed(
  () => currentScenario.value?.channels.find(c => c.channel_code === draft.channel_code) ?? null,
);

/** 当前渠道适用的材料模块（KYC 清单） */
const applicableSections = computed(() => {
  if (!currentScenario.value || !draft.channel_code) return [];
  return currentScenario.value.sections
    .map(section => ({
      section_name: section.section_name,
      items: section.items.filter(
        item => !item.channel_codes?.length || item.channel_codes.includes(draft.channel_code),
      ),
    }))
    .filter(section => section.items.length);
});

const applicableItems = computed(() => applicableSections.value.flatMap(s => s.items));

function materialsOf(item: KycItem) {
  return draft.materials.filter(m => m.requirement_item_id === item.item_id);
}

const unlinkedMaterials = computed(() =>
  draft.materials.filter(
    m => !m.requirement_item_id || !applicableItems.value.some(i => i.item_id === m.requirement_item_id),
  ),
);

/** 必填完整度（与后端同口径） */
const completeness = computed(() => {
  const required = applicableItems.value.filter(item => item.required);
  const done = required.filter(item =>
    materialsOf(item).some(m => m.status !== ApplicationMaterialStatus.RETURNED),
  ).length;
  return { done, total: required.length };
});

const returnedMaterials = computed(() =>
  draft.materials.filter(m => m.status === ApplicationMaterialStatus.RETURNED),
);

/* ---------------- 加载与保存 ---------------- */

async function load() {
  loading.value = true;
  try {
    const [app, list] = await Promise.all([fetchApplication(applicationId), fetchActiveScenarios()]);
    application.value = app;
    scenarios.value = list;
    draft.scenario_id = app.scenario_id ?? "";
    draft.channel_code = app.channel_code ?? "";
    draft.customer_cn_name = app.form.customer_cn_name ?? app.customer_snapshot.name;
    draft.customer_en_name = app.form.customer_en_name ?? "";
    draft.business_note = app.form.business_note ?? "";
    draft.materials = app.materials.map(m => ({ ...m }));
    // 补件/驳回状态直接跳到材料步骤
    if (
      app.status === AccessStatus.SUPPLEMENT_REQUIRED ||
      app.status === AccessStatus.REJECTED
    ) {
      step.value = 4;
    }
  } finally {
    loading.value = false;
  }
}

async function persistDraft(silent = false) {
  if (!editable.value) return;
  saving.value = true;
  try {
    const app = await saveApplicationDraft(applicationId, {
      scenario_id: draft.scenario_id || null,
      channel_code: draft.channel_code || null,
      form: {
        customer_cn_name: draft.customer_cn_name || null,
        customer_en_name: draft.customer_en_name || null,
        business_note: draft.business_note || null,
      },
      materials: draft.materials.map(m => ({
        material_key: m.material_key,
        requirement_item_id: m.requirement_item_id,
        name: m.name,
        source: m.source,
        file: m.file,
        library_material_id: m.library_material_id,
      })),
    });
    application.value = app;
    draft.materials = app.materials.map(m => ({ ...m }));
    if (!silent) ElMessage.success("草稿已保存");
  } finally {
    saving.value = false;
  }
}

function onScenarioChange() {
  const scenario = currentScenario.value;
  if (!scenario) return;
  if (!scenario.channels.some(c => c.channel_code === draft.channel_code)) {
    draft.channel_code = scenario.channels.length === 1 ? scenario.channels[0].channel_code : "";
  }
  // 清掉新模板中不存在的材料项关联
  const validIds = new Set(scenario.sections.flatMap(s => s.items.map(i => i.item_id)));
  for (const material of draft.materials) {
    if (material.requirement_item_id && !validIds.has(material.requirement_item_id)) {
      material.requirement_item_id = null;
    }
  }
}

async function goStep(target: number) {
  if (target > 1 && !draft.scenario_id) {
    ElMessage.warning("请先选择业务类型");
    return;
  }
  if (target > 2 && !draft.channel_code) {
    ElMessage.warning("请先选择渠道");
    return;
  }
  if (editable.value) await persistDraft(true);
  step.value = target;
}

/* ---------------- 材料上传 ---------------- */

const uploadingItemId = ref<string | null>(null);
const fileInput = ref<HTMLInputElement>();
let pendingItemId: string | null = null;

function triggerUpload(itemId: string | null) {
  pendingItemId = itemId;
  fileInput.value?.click();
}

async function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > UPLOAD_MAX_SIZE) {
    ElMessage.error("文件超过 20MB 限制");
    return;
  }
  uploadingItemId.value = pendingItemId ?? "__other__";
  try {
    const fileRef = await uploadFile(file);
    draft.materials.push({
      material_key: crypto.randomUUID(),
      requirement_item_id: pendingItemId,
      name: fileRef.original_name,
      source: MaterialSource.LOCAL_UPLOAD,
      file: fileRef,
      library_material_id: null,
      status: ApplicationMaterialStatus.PENDING,
      return_reason: null,
      uploaded_at: new Date().toISOString(),
    });
    await persistDraft(true);
  } finally {
    uploadingItemId.value = null;
  }
}

/** 替换被退回的材料：删除原条目，用同一材料项重新上传 */
function replaceMaterial(material: ApplicationMaterialVO) {
  removeMaterial(material);
  triggerUpload(material.requirement_item_id);
}

function removeMaterial(material: ApplicationMaterialVO) {
  draft.materials = draft.materials.filter(m => m.material_key !== material.material_key);
}

/* ---------------- 客户材料库 ---------------- */

const libraryVisible = ref(false);
const libraryLoading = ref(false);
const libraryList = ref<CustomerMaterialVO[]>([]);
const librarySelection = ref<CustomerMaterialVO[]>([]);

async function openLibrary() {
  libraryVisible.value = true;
  libraryLoading.value = true;
  try {
    libraryList.value = await fetchCustomerMaterials(application.value!.customer_id);
  } finally {
    libraryLoading.value = false;
  }
}

async function addFromLibrary() {
  const usedKeys = new Set(draft.materials.map(m => m.library_material_id));
  for (const item of librarySelection.value) {
    if (usedKeys.has(item.id)) continue;
    draft.materials.push({
      material_key: crypto.randomUUID(),
      requirement_item_id: null,
      name: item.name,
      source: MaterialSource.LIBRARY,
      file: item.file,
      library_material_id: item.id,
      status: ApplicationMaterialStatus.PENDING,
      return_reason: null,
      uploaded_at: new Date().toISOString(),
    });
  }
  libraryVisible.value = false;
  await persistDraft(true);
}

async function archiveToLibrary() {
  const candidates = draft.materials.filter(
    m => m.source === MaterialSource.LOCAL_UPLOAD && m.file,
  );
  if (!candidates.length) {
    ElMessage.warning("没有本地上传的材料可归档（材料库复用的材料无需重复归档）");
    return;
  }
  await ElMessageBox.confirm(
    `将 ${candidates.length} 份本地上传材料归档到「${application.value?.customer_snapshot.name}」的材料库？仅归档，不进入审核队列。`,
    "保存客户材料库",
    { type: "info", confirmButtonText: "归档", cancelButtonText: "取消" },
  );
  await archiveCustomerMaterials(application.value!.customer_id, {
    items: candidates.map(m => ({
      name: m.name,
      category: applicableItems.value.find(i => i.item_id === m.requirement_item_id)?.item_name ?? null,
      file: m.file!,
    })),
  });
  ElMessage.success("已归档到客户材料库");
}

/* ---------------- 提交 ---------------- */

async function submit() {
  await persistDraft(true);
  if (completeness.value.done < completeness.value.total) {
    ElMessage.warning(
      `必填材料未集齐（${completeness.value.done}/${completeness.value.total}），请先补齐`,
    );
    return;
  }
  if (returnedMaterials.value.length) {
    ElMessage.warning("仍有被退回的材料未替换");
    return;
  }
  const isResubmit = application.value?.status !== AccessStatus.DRAFT;
  await ElMessageBox.confirm(
    `${isResubmit ? "补件后重新提交" : "提交"}合规审核后材料将进入审核队列，期间不可修改。确认提交？`,
    "提交合规审核",
    { type: "warning", confirmButtonText: "提交", cancelButtonText: "再检查一下" },
  );
  submitting.value = true;
  try {
    await submitApplication(applicationId);
    ElMessage.success("已提交合规审核");
    router.push("/access/materials");
  } finally {
    submitting.value = false;
  }
}

/* ---------------- 展示辅助 ---------------- */

const STATUS_TAG: Record<string, string> = {
  DRAFT: "info",
  PENDING_REVIEW: "warning",
  SUPPLEMENT_REQUIRED: "danger",
  REJECTED: "danger",
  APPROVED: "success",
  CANCELLED: "info",
};

const MATERIAL_TAG: Record<string, string> = {
  PENDING: "info",
  ACCEPTED: "success",
  RETURNED: "danger",
};

const acceptAttr = UPLOAD_ACCEPT_EXTS.join(",");

function formatSize(size: number) {
  if (size > 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

const latestReviewActionLabel = computed(() => {
  const action = application.value?.latest_review?.action as string | undefined;
  if (!action) return "";
  return (
    ReviewDecisionActionLabel[action as ReviewDecisionAction] ??
    LEGACY_DECISION_ACTION_LABEL[action] ??
    action
  );
});

onMounted(load);
</script>

<template>
  <div v-loading="loading">
    <template v-if="application">
      <header class="page-header">
        <div>
          <p class="eyebrow">BUSINESS ACCESS</p>
          <h1>
            {{ application.customer_snapshot.name }} · 材料申报
            <el-tag :type="STATUS_TAG[application.status] || 'info'" size="small" class="status-tag">
              {{ AccessStatusLabel[application.status] }}
            </el-tag>
          </h1>
          <p class="subtitle">
            {{ application.application_no }}
            <span v-if="application.customer_snapshot.customer_code">
              · 客户编号 {{ application.customer_snapshot.customer_code }}
            </span>
            · 负责人 {{ application.owner_name }}
          </p>
        </div>
        <el-button :icon="ArrowLeft" @click="router.push('/access/materials')">返回列表</el-button>
      </header>

      <el-alert
        v-if="application.latest_review && (application.status === 'SUPPLEMENT_REQUIRED' || application.status === 'REJECTED')"
        type="error"
        :closable="false"
        class="review-alert"
      >
        <template #title>
          {{ latestReviewActionLabel }}（{{ application.latest_review.reviewer_name }} ·
          {{ new Date(application.latest_review.reviewed_at).toLocaleString() }}）
        </template>
        <p class="alert-reason">{{ application.latest_review.reason }}</p>
        <p v-if="returnedMaterials.length" class="alert-returned">
          被退回材料：{{ returnedMaterials.map(m => m.name).join("、") }}
        </p>
      </el-alert>

      <div class="wizard-layout">
        <el-card shadow="never" class="wizard-main">
          <el-steps :active="step - 1" align-center class="steps">
            <el-step title="业务类型" />
            <el-step title="渠道" />
            <el-step title="客户信息" />
            <el-step title="上传材料" />
            <el-step title="确认提交" />
          </el-steps>

          <!-- 步骤 1：业务类型 -->
          <section v-show="step === 1" class="step-body">
            <h3>选择业务类型</h3>
            <p class="step-hint">材料清单由 KYC list 配置按业务类型与渠道自动生成。</p>
            <div class="option-grid">
              <button
                v-for="scenario in scenarios"
                :key="scenario.id"
                type="button"
                class="option-card"
                :class="{ selected: draft.scenario_id === scenario.id }"
                :disabled="!editable"
                @click="(draft.scenario_id = scenario.id), onScenarioChange()"
              >
                <strong>{{ scenario.scenario_name }}</strong>
                <small>{{ scenario.scenario_code }}</small>
                <p>{{ scenario.process_description || "—" }}</p>
              </button>
            </div>
            <el-empty v-if="!scenarios.length" description="暂无已发布的业务类型，请联系合规配置 KYC list" />
          </section>

          <!-- 步骤 2：渠道 -->
          <section v-show="step === 2" class="step-body">
            <h3>选择渠道</h3>
            <p class="step-hint">不同渠道有独立的限制规则与材料要求。</p>
            <div class="option-grid">
              <button
                v-for="channel in currentScenario?.channels ?? []"
                :key="channel.channel_code"
                type="button"
                class="option-card"
                :class="{ selected: draft.channel_code === channel.channel_code }"
                :disabled="!editable"
                @click="draft.channel_code = channel.channel_code"
              >
                <strong>{{ channel.channel_name }}</strong>
                <small>{{ channel.channel_code }}</small>
                <p>{{ channel.restriction_note || "无特殊限制" }}</p>
              </button>
            </div>
          </section>

          <!-- 步骤 3：客户信息 -->
          <section v-show="step === 3" class="step-body">
            <h3>客户信息与业务说明</h3>
            <el-form label-position="top" class="info-form">
              <div class="form-grid">
                <el-form-item label="客户中文姓名">
                  <el-input v-model="draft.customer_cn_name" :disabled="!editable" maxlength="100" />
                </el-form-item>
                <el-form-item label="客户英文姓名">
                  <el-input v-model="draft.customer_en_name" :disabled="!editable" maxlength="100" />
                </el-form-item>
              </div>
              <el-form-item label="业务说明 / 风险备注">
                <el-input
                  v-model="draft.business_note"
                  type="textarea"
                  :rows="4"
                  :disabled="!editable"
                  maxlength="1000"
                  show-word-limit
                  placeholder="业务用途、预计业务量、风险备注等，将随申请提交给合规"
                />
              </el-form-item>
            </el-form>
          </section>

          <!-- 步骤 4：上传材料 -->
          <section v-show="step === 4" class="step-body">
            <div class="materials-head">
              <div>
                <h3>按材料项上传客户文件</h3>
                <p class="step-hint">支持 JPG / PNG / PDF / DOC / DOCX，单个不超过 20MB。</p>
              </div>
              <el-button :icon="FolderOpened" :disabled="!editable" @click="openLibrary">
                从材料库添加
              </el-button>
            </div>

            <div v-for="section in applicableSections" :key="section.section_name" class="material-section">
              <h4>{{ section.section_name }}</h4>
              <article v-for="item in section.items" :key="item.item_id" class="material-item">
                <div class="material-copy">
                  <strong>
                    {{ item.item_name }}<span v-if="item.required" class="required">*</span>
                  </strong>
                  <small>
                    {{ item.item_description || "—" }}
                    <template v-if="item.validity_note"> · {{ item.validity_note }}</template>
                  </small>
                  <ul v-if="materialsOf(item).length" class="file-list">
                    <li v-for="material in materialsOf(item)" :key="material.material_key">
                      <el-tag :type="MATERIAL_TAG[material.status]" size="small">
                        {{ ApplicationMaterialStatusLabel[material.status] }}
                      </el-tag>
                      <span class="file-name">{{ material.name }}</span>
                      <span class="muted" v-if="material.file">{{ formatSize(material.file.size) }} · {{ MaterialSourceLabel[material.source] }}</span>
                      <span v-if="material.return_reason" class="return-reason">退回原因：{{ material.return_reason }}</span>
                      <span class="file-actions">
                        <el-button v-if="material.file" size="small" link type="primary" @click="openFilePreview(material.file)">预览</el-button>
                        <el-button
                          v-if="editable && material.status === 'RETURNED'"
                          size="small"
                          link
                          type="warning"
                          @click="replaceMaterial(material)"
                        >重新上传</el-button>
                        <el-button v-if="editable" size="small" link type="danger" @click="removeMaterial(material)">移除</el-button>
                      </span>
                    </li>
                  </ul>
                </div>
                <el-button
                  size="small"
                  type="primary"
                  plain
                  :icon="Upload"
                  :disabled="!editable || materialsOf(item).length >= item.max_count"
                  :loading="uploadingItemId === item.item_id"
                  @click="triggerUpload(item.item_id)"
                >
                  {{ materialsOf(item).length ? "再传一份" : "上传" }}
                </el-button>
              </article>
            </div>

            <div class="material-section">
              <h4>其他材料</h4>
              <article v-for="material in unlinkedMaterials" :key="material.material_key" class="material-item">
                <div class="material-copy">
                  <strong>{{ material.name }}</strong>
                  <small class="muted">{{ MaterialSourceLabel[material.source] }}<template v-if="material.file"> · {{ formatSize(material.file.size) }}</template></small>
                  <div class="link-row">
                    <span class="muted">关联材料项：</span>
                    <el-select
                      v-model="material.requirement_item_id"
                      size="small"
                      clearable
                      placeholder="未关联"
                      class="link-select"
                      :disabled="!editable"
                    >
                      <el-option
                        v-for="item in applicableItems"
                        :key="item.item_id"
                        :value="item.item_id"
                        :label="item.item_name"
                      />
                    </el-select>
                  </div>
                </div>
                <span class="file-actions">
                  <el-button v-if="material.file" size="small" link type="primary" @click="openFilePreview(material.file)">预览</el-button>
                  <el-button v-if="editable" size="small" link type="danger" @click="removeMaterial(material)">移除</el-button>
                </span>
              </article>
              <div class="other-upload">
                <el-button
                  size="small"
                  :disabled="!editable"
                  :loading="uploadingItemId === '__other__'"
                  @click="triggerUpload(null)"
                >
                  上传其他材料
                </el-button>
              </div>
            </div>
          </section>

          <!-- 步骤 5：确认提交 -->
          <section v-show="step === 5" class="step-body">
            <h3>确认并提交</h3>
            <el-descriptions :column="2" border class="summary">
              <el-descriptions-item label="客户">
                {{ application.customer_snapshot.name }}
                <span v-if="application.customer_snapshot.customer_code" class="muted">
                  · {{ application.customer_snapshot.customer_code }}
                </span>
              </el-descriptions-item>
              <el-descriptions-item label="业务类型 / 渠道">
                {{ currentScenario?.scenario_name || "未选择" }}
                <span v-if="currentChannel" class="muted"> · {{ currentChannel.channel_name }}</span>
              </el-descriptions-item>
              <el-descriptions-item label="客户中文姓名">{{ draft.customer_cn_name || "—" }}</el-descriptions-item>
              <el-descriptions-item label="客户英文姓名">{{ draft.customer_en_name || "—" }}</el-descriptions-item>
              <el-descriptions-item label="业务说明" :span="2">{{ draft.business_note || "—" }}</el-descriptions-item>
              <el-descriptions-item label="材料完整度" :span="2">
                <el-progress
                  :percentage="completeness.total ? Math.round((completeness.done / completeness.total) * 100) : 0"
                  :status="completeness.done >= completeness.total && completeness.total > 0 ? 'success' : undefined"
                  class="progress"
                />
                <span class="muted">必填 {{ completeness.done }} / {{ completeness.total }} · 共 {{ draft.materials.length }} 份材料</span>
              </el-descriptions-item>
            </el-descriptions>
            <div v-if="editable" class="submit-actions">
              <el-button :loading="saving" @click="archiveToLibrary">保存客户材料库</el-button>
              <el-button type="primary" :loading="submitting" @click="submit">
                {{ application.status === "DRAFT" ? "提交合规审核" : "重新提交合规审核" }}
              </el-button>
            </div>
          </section>

          <footer class="wizard-footer">
            <el-button :disabled="step === 1" @click="goStep(step - 1)">← 上一步</el-button>
            <div class="footer-right">
              <el-button v-if="editable" :loading="saving" @click="persistDraft()">保存草稿</el-button>
              <el-button v-if="step < 5" type="primary" @click="goStep(step + 1)">下一步 →</el-button>
            </div>
          </footer>
        </el-card>

        <!-- KYC 规则助手 -->
        <aside class="assistant">
          <el-card shadow="never">
            <h4 class="assistant-title">KYC 规则助手</h4>
            <template v-if="currentScenario">
              <p class="assistant-block">
                <strong>{{ currentScenario.scenario_name }}</strong><br />
                <span class="muted">{{ currentScenario.process_description || "无流程说明" }}</span>
              </p>
              <p v-if="currentChannel" class="assistant-block restriction">
                <strong>渠道限制 · {{ currentChannel.channel_name }}</strong><br />
                <span>{{ currentChannel.restriction_note || "无特殊限制" }}</span>
              </p>
              <template v-if="draft.channel_code">
                <div class="assistant-block">
                  <strong>材料完整度 {{ completeness.done }} / {{ completeness.total }}</strong>
                  <ul class="check-list">
                    <li
                      v-for="item in applicableItems.filter(i => i.required)"
                      :key="item.item_id"
                      :class="{ ok: materialsOf(item).some(m => m.status !== 'RETURNED') }"
                    >
                      <span class="check-dot"></span>{{ item.item_name }}
                    </li>
                  </ul>
                </div>
              </template>
              <p v-else class="muted">选择渠道后显示材料清单。</p>
            </template>
            <p v-else class="muted">选择业务类型后显示规则说明。</p>
          </el-card>

          <el-card v-if="application.timeline.length" shadow="never" class="timeline-card">
            <h4 class="assistant-title">处理时间线</h4>
            <el-timeline>
              <el-timeline-item
                v-for="(entry, index) in [...application.timeline].reverse()"
                :key="index"
                :timestamp="new Date(entry.at).toLocaleString()"
              >
                {{ entry.action }}<span v-if="entry.by_name" class="muted"> · {{ entry.by_name }}</span>
                <p v-if="entry.note" class="timeline-note">{{ entry.note }}</p>
              </el-timeline-item>
            </el-timeline>
          </el-card>
        </aside>
      </div>

      <input ref="fileInput" type="file" class="hidden-input" :accept="acceptAttr" @change="onFileChosen" />

      <!-- 材料库选择 -->
      <el-dialog v-model="libraryVisible" title="从客户材料库添加" width="640px">
        <el-table
          v-loading="libraryLoading"
          :data="libraryList"
          @selection-change="(rows: CustomerMaterialVO[]) => (librarySelection = rows)"
        >
          <el-table-column type="selection" width="46" />
          <el-table-column prop="name" label="材料" min-width="180" />
          <el-table-column prop="category" label="关联材料项" width="140">
            <template #default="{ row }">{{ row.category || "—" }}</template>
          </el-table-column>
          <el-table-column label="版本" width="70">
            <template #default="{ row }">v{{ row.version }}</template>
          </el-table-column>
          <el-table-column label="归档时间" width="120">
            <template #default="{ row }">{{ new Date(row.created_at).toLocaleDateString() }}</template>
          </el-table-column>
          <el-table-column label="操作" width="80">
            <template #default="{ row }">
              <el-button size="small" link type="primary" @click="openFilePreview(row.file)">预览</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!libraryLoading && !libraryList.length" description="该客户材料库为空" />
        <template #footer>
          <el-button @click="libraryVisible = false">取消</el-button>
          <el-button type="primary" :disabled="!librarySelection.length" @click="addFromLibrary">
            加入 {{ librarySelection.length ? `（${librarySelection.length}）` : "" }}
          </el-button>
        </template>
      </el-dialog>
    </template>
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
  display: flex;
  align-items: center;
  gap: 10px;
}

.subtitle {
  color: #909399;
  margin: 0;
}

.status-tag {
  vertical-align: middle;
}

.review-alert {
  margin-bottom: 14px;
}

.alert-reason {
  margin: 4px 0 0;
}

.alert-returned {
  margin: 4px 0 0;
  font-size: 12px;
}

.wizard-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 14px;
  align-items: start;
}

.steps {
  margin-bottom: 22px;
}

.step-body h3 {
  margin: 0 0 4px;
}

.step-hint {
  color: #909399;
  font-size: 13px;
  margin: 0 0 16px;
}

.option-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.option-card {
  text-align: left;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
  padding: 14px;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.option-card:hover:not(:disabled) {
  border-color: #ff7a00;
}

.option-card.selected {
  border-color: #ff7a00;
  box-shadow: 0 0 0 2px rgba(255, 122, 0, 0.15);
}

.option-card:disabled {
  cursor: not-allowed;
  opacity: 0.8;
}

.option-card strong {
  display: block;
}

.option-card small {
  color: #909399;
}

.option-card p {
  margin: 8px 0 0;
  font-size: 12px;
  color: #606266;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.info-form .form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 16px;
}

.materials-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.material-section {
  margin-top: 18px;
}

.material-section h4 {
  margin: 0 0 8px;
  color: #606266;
}

.material-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 8px;
}

.material-copy {
  flex: 1;
  min-width: 0;
}

.material-copy small {
  color: #909399;
  display: block;
  margin-top: 2px;
}

.required {
  color: #f56c6c;
  margin-left: 2px;
}

.file-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}

.file-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 4px 0;
  font-size: 13px;
}

.file-name {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.return-reason {
  color: #f56c6c;
  font-size: 12px;
  width: 100%;
}

.file-actions {
  display: inline-flex;
  gap: 2px;
}

.link-row {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.link-select {
  width: 180px;
}

.other-upload {
  margin-top: 4px;
}

.muted {
  color: #909399;
}

.summary {
  margin-bottom: 16px;
}

.progress {
  width: 260px;
  display: inline-flex;
  margin-right: 10px;
  vertical-align: middle;
}

.submit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.wizard-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 22px;
  padding-top: 14px;
  border-top: 1px solid #ebeef5;
}

.footer-right {
  display: flex;
  gap: 10px;
}

.assistant {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.assistant-title {
  margin: 0 0 10px;
}

.assistant-block {
  font-size: 13px;
  margin: 0 0 12px;
  line-height: 1.6;
}

.restriction {
  background: #fdf6ec;
  border-radius: 8px;
  padding: 10px;
  color: #b88230;
}

.check-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  font-size: 13px;
}

.check-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  color: #909399;
}

.check-list li.ok {
  color: #67c23a;
}

.check-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  flex: none;
}

.timeline-note {
  color: #909399;
  font-size: 12px;
  margin: 2px 0 0;
}

.hidden-input {
  display: none;
}

@media (max-width: 1100px) {
  .wizard-layout {
    grid-template-columns: 1fr;
  }
}
</style>
