<script setup lang="ts">
import {
  AccessStatus,
  AccessStatusLabel,
  ApplicationMaterialStatus,
  ApplicationMaterialStatusLabel,
  CustomerKindLabel,
  CustomerSubTypeLabel,
  KycItemValidityLabel,
  LEGACY_DECISION_ACTION_LABEL,
  MaterialSource,
  MaterialSourceLabel,
  ReviewDecisionActionLabel,
  ReviewType,
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
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
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
const { t } = useI18n();
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
  onboard_company: "" as string,
  business_note: "" as string,
  materials: [] as ApplicationMaterialVO[],
});

const application = ref<Awaited<ReturnType<typeof fetchApplication>> | null>(null);

function customerTypeText() {
  const snapshot = application.value?.customer_snapshot;
  if (!snapshot) return "—";
  return localizeText(CustomerKindLabel[snapshot.customer_kind as keyof typeof CustomerKindLabel] ?? snapshot.customer_kind);
}

function subjectTypeText() {
  const subType = application.value?.customer_snapshot.customer_sub_type;
  if (!subType) return "—";
  return localizeText(CustomerSubTypeLabel[subType as keyof typeof CustomerSubTypeLabel] ?? subType);
}

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

/** 当前渠道的材料模块（demo 四层结构：材料清单挂在渠道下） */
const applicableSections = computed(() => {
  if (!currentChannel.value) return [];
  return currentChannel.value.sections.filter(section => section.items.length);
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
    draft.onboard_company = app.form.onboard_company ?? "";
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
        onboard_company: draft.onboard_company || null,
        business_note: draft.business_note || null,
      },
      materials: draft.materials.map(m => ({
        material_key: m.material_key,
        requirement_item_id: m.requirement_item_id,
        custom_item_name: m.custom_item_name,
        name: m.name,
        source: m.source,
        file: m.file,
        library_material_id: m.library_material_id,
      })),
    });
    application.value = app;
    draft.materials = app.materials.map(m => ({ ...m }));
    if (!silent) ElMessage.success(t("access.wizard.draftSaved"));
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
  const validIds = new Set(
    scenario.channels.flatMap(c => c.sections.flatMap(s => s.items.map(i => i.item_id))),
  );
  for (const material of draft.materials) {
    if (material.requirement_item_id && !validIds.has(material.requirement_item_id)) {
      material.requirement_item_id = null;
    }
  }
}

async function goStep(target: number) {
  if (target > 1 && !draft.scenario_id) {
    ElMessage.warning(t("access.wizard.needScenario"));
    return;
  }
  if (target > 2 && !draft.channel_code) {
    ElMessage.warning(t("access.wizard.needChannel"));
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
    ElMessage.error(t("access.wizard.fileTooLarge"));
    return;
  }
  uploadingItemId.value = pendingItemId ?? "__other__";
  try {
    const fileRef = await uploadFile(file);
    draft.materials.push({
      material_key: crypto.randomUUID(),
      requirement_item_id: pendingItemId,
      custom_item_name: null,
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
      custom_item_name: null,
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
    ElMessage.warning(t("access.wizard.nothingToArchive"));
    return;
  }
  await ElMessageBox.confirm(
    t("access.wizard.archiveConfirm", {
      count: candidates.length,
      name: application.value?.customer_snapshot.name,
    }),
    t("access.wizard.archiveTitle"),
    { type: "info", confirmButtonText: t("access.wizard.archiveOk"), cancelButtonText: t("access.common.cancel") },
  );
  await archiveCustomerMaterials(application.value!.customer_id, {
    items: candidates.map(m => ({
      name: m.name,
      category:
        applicableItems.value.find(i => i.item_id === m.requirement_item_id)?.item_name ??
        m.custom_item_name ??
        null,
      file: m.file!,
    })),
  });
  ElMessage.success(t("access.wizard.archived"));
}

/* ---------------- 提交 ---------------- */

async function submit() {
  await persistDraft(true);
  if (returnedMaterials.value.length) {
    ElMessage.warning(t("access.wizard.returnedRemain"));
    return;
  }
  if (!draft.materials.length) {
    ElMessage.warning(t("access.wizard.needOneMaterial"));
    return;
  }
  const isResubmit = application.value?.status !== AccessStatus.DRAFT;
  await ElMessageBox.confirm(
    isResubmit ? t("access.wizard.submitConfirmResubmit") : t("access.wizard.submitConfirmFirst"),
    t("access.wizard.submitTitle"),
    { type: "warning", confirmButtonText: t("access.wizard.submitOk"), cancelButtonText: t("access.wizard.submitCancel") },
  );
  submitting.value = true;
  try {
    // 沿用上次提交模式；首次提交默认找换（提交模式的主入口在「材料上传」页）
    const reviewType = (application.value?.review_type as ReviewType) || ReviewType.FX;
    await submitApplication(applicationId, reviewType);
    ElMessage.success(t("access.wizard.submittedMsg"));
    router.push("/access/documents");
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
  return localizeText(
    ReviewDecisionActionLabel[action as ReviewDecisionAction] ??
      LEGACY_DECISION_ACTION_LABEL[action] ??
      action,
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
            {{ application.customer_snapshot.name }} · {{ t("access.wizard.titleSuffix") }}
            <el-tag :type="STATUS_TAG[application.status] || 'info'" size="small" class="status-tag">
              {{ localizeText(AccessStatusLabel[application.status]) }}
            </el-tag>
          </h1>
          <p class="subtitle">
            {{ application.application_no }}
            <span v-if="application.customer_snapshot.customer_code">
              · {{ t("access.wizard.customerCodeLine", { code: application.customer_snapshot.customer_code }) }}
            </span>
            · {{ t("access.wizard.ownerLine", { name: application.owner_name }) }}
          </p>
        </div>
        <el-button :icon="ArrowLeft" @click="router.push('/access/materials')">{{ t("access.wizard.backToList") }}</el-button>
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
          {{ t("access.wizard.returnedList", { names: returnedMaterials.map(m => m.name).join("、") }) }}
        </p>
      </el-alert>

      <div class="wizard-layout">
        <el-card shadow="never" class="wizard-main">
          <el-steps :active="step - 1" align-center class="steps">
            <el-step :title="t('access.wizard.stepScenario')" />
            <el-step :title="t('access.wizard.stepChannel')" />
            <el-step :title="t('access.wizard.stepCustomer')" />
            <el-step :title="t('access.wizard.stepMaterials')" />
            <el-step :title="t('access.wizard.stepConfirm')" />
          </el-steps>

          <!-- 步骤 1：业务类型 -->
          <section v-show="step === 1" class="step-body">
            <h3>{{ t("access.wizard.chooseScenario") }}</h3>
            <p class="step-hint">{{ t("access.wizard.chooseScenarioHint") }}</p>
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
            <el-empty v-if="!scenarios.length" :description="t('access.wizard.noScenarios')" />
          </section>

          <!-- 步骤 2：渠道 -->
          <section v-show="step === 2" class="step-body">
            <h3>{{ t("access.wizard.chooseChannel") }}</h3>
            <p class="step-hint">{{ t("access.wizard.chooseChannelHint") }}</p>
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
                <p>{{ channel.restrictions.length ? channel.restrictions.map(r => r.content).join("；") : t("access.wizard.noRestrictions") }}</p>
              </button>
            </div>
          </section>

          <!-- 步骤 3：客户信息 -->
          <section v-show="step === 3" class="step-body">
            <h3>{{ t("access.wizard.customerInfoTitle") }}</h3>
            <el-form label-position="top" class="info-form">
              <div class="form-grid">
                <el-form-item :label="t('access.wizard.customerType')">
                  <el-input :model-value="customerTypeText()" disabled />
                </el-form-item>
                <el-form-item :label="t('access.wizard.subjectType')">
                  <el-input :model-value="subjectTypeText()" disabled />
                </el-form-item>
                <el-form-item :label="t('access.wizard.cnName')">
                  <el-input v-model="draft.customer_cn_name" :disabled="!editable" maxlength="100" />
                </el-form-item>
                <el-form-item :label="t('access.wizard.enName')">
                  <el-input v-model="draft.customer_en_name" :disabled="!editable" maxlength="100" />
                </el-form-item>
              </div>
              <el-form-item :label="t('access.wizard.onboardCompany')">
                <el-input
                  v-model="draft.onboard_company"
                  :disabled="!editable"
                  maxlength="200"
                  :placeholder="t('access.wizard.onboardCompanyPh')"
                />
              </el-form-item>
              <el-form-item :label="t('access.wizard.noteField')">
                <el-input
                  v-model="draft.business_note"
                  type="textarea"
                  :rows="4"
                  :disabled="!editable"
                  maxlength="1000"
                  show-word-limit
                  :placeholder="t('access.wizard.notePh')"
                />
              </el-form-item>
            </el-form>
          </section>

          <!-- 步骤 4：上传材料 -->
          <section v-show="step === 4" class="step-body">
            <div class="materials-head">
              <div>
                <h3>{{ t("access.wizard.uploadByItem") }}</h3>
                <p class="step-hint">{{ t("access.wizard.uploadHint") }}</p>
              </div>
              <el-button :icon="FolderOpened" :disabled="!editable" @click="openLibrary">
                {{ t("access.wizard.addFromLibrary") }}
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
                    <template v-if="item.validity !== 'NONE'"> · {{ localizeText(KycItemValidityLabel[item.validity]) }}</template>
                  </small>
                  <ul v-if="materialsOf(item).length" class="file-list">
                    <li v-for="material in materialsOf(item)" :key="material.material_key">
                      <el-tag :type="MATERIAL_TAG[material.status]" size="small">
                        {{ localizeText(ApplicationMaterialStatusLabel[material.status]) }}
                      </el-tag>
                      <span class="file-name">{{ material.name }}</span>
                      <span class="muted" v-if="material.file">{{ formatSize(material.file.size) }} · {{ localizeText(MaterialSourceLabel[material.source]) }}</span>
                      <span v-if="material.return_reason" class="return-reason">{{ t("access.common.returnReason", { reason: material.return_reason }) }}</span>
                      <span class="file-actions">
                        <el-button v-if="material.file" size="small" link type="primary" @click="openFilePreview(material.file)">{{ t("access.common.preview") }}</el-button>
                        <el-button
                          v-if="editable && material.status === 'RETURNED'"
                          size="small"
                          link
                          type="warning"
                          @click="replaceMaterial(material)"
                        >{{ t("access.wizard.reupload") }}</el-button>
                        <el-button v-if="editable" size="small" link type="danger" @click="removeMaterial(material)">{{ t("access.wizard.remove") }}</el-button>
                      </span>
                    </li>
                  </ul>
                </div>
                <el-button
                  size="small"
                  type="primary"
                  plain
                  :icon="Upload"
                  :disabled="!editable"
                  :loading="uploadingItemId === item.item_id"
                  @click="triggerUpload(item.item_id)"
                >
                  {{ materialsOf(item).length ? t("access.wizard.uploadMore") : t("access.wizard.upload") }}
                </el-button>
              </article>
            </div>

            <div class="material-section">
              <h4>{{ t("access.wizard.otherMaterials") }}</h4>
              <article v-for="material in unlinkedMaterials" :key="material.material_key" class="material-item">
                <div class="material-copy">
                  <strong>{{ material.name }}</strong>
                  <small class="muted">
                    <el-tag v-if="material.custom_item_name" size="small" type="info" effect="plain">
                      {{ material.custom_item_name }}
                    </el-tag>
                    {{ localizeText(MaterialSourceLabel[material.source]) }}<template v-if="material.file"> · {{ formatSize(material.file.size) }}</template>
                  </small>
                  <div class="link-row">
                    <span class="muted">{{ t("access.wizard.linkItemLabel") }}</span>
                    <el-select
                      v-model="material.requirement_item_id"
                      size="small"
                      clearable
                      :placeholder="t('access.wizard.unlinked')"
                      class="link-select"
                      :disabled="!editable"
                      @change="material.custom_item_name = material.requirement_item_id ? null : material.custom_item_name"
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
                  <el-button v-if="material.file" size="small" link type="primary" @click="openFilePreview(material.file)">{{ t("access.common.preview") }}</el-button>
                  <el-button v-if="editable" size="small" link type="danger" @click="removeMaterial(material)">{{ t("access.wizard.remove") }}</el-button>
                </span>
              </article>
              <div class="other-upload">
                <el-button
                  size="small"
                  :disabled="!editable"
                  :loading="uploadingItemId === '__other__'"
                  @click="triggerUpload(null)"
                >
                  {{ t("access.wizard.uploadOther") }}
                </el-button>
              </div>
            </div>
          </section>

          <!-- 步骤 5：确认提交 -->
          <section v-show="step === 5" class="step-body">
            <h3>{{ t("access.wizard.confirmTitle") }}</h3>
            <el-descriptions :column="2" border class="summary">
              <el-descriptions-item :label="t('access.wizard.customerLabel')">
                {{ application.customer_snapshot.name }}
                <span v-if="application.customer_snapshot.customer_code" class="muted">
                  · {{ application.customer_snapshot.customer_code }}
                </span>
              </el-descriptions-item>
              <el-descriptions-item :label="t('access.common.scenarioChannel')">
                {{ currentScenario?.scenario_name || t("access.wizard.notSelected") }}
                <span v-if="currentChannel" class="muted"> · {{ currentChannel.channel_name }}</span>
              </el-descriptions-item>
              <el-descriptions-item :label="t('access.wizard.customerType')">{{ customerTypeText() }}</el-descriptions-item>
              <el-descriptions-item :label="t('access.wizard.subjectType')">{{ subjectTypeText() }}</el-descriptions-item>
              <el-descriptions-item :label="t('access.wizard.cnName')">{{ draft.customer_cn_name || "—" }}</el-descriptions-item>
              <el-descriptions-item :label="t('access.wizard.enName')">{{ draft.customer_en_name || "—" }}</el-descriptions-item>
              <el-descriptions-item :label="t('access.wizard.onboardCompany')" :span="2">{{ draft.onboard_company || "—" }}</el-descriptions-item>
              <el-descriptions-item :label="t('access.wizard.noteShort')" :span="2">{{ draft.business_note || "—" }}</el-descriptions-item>
              <el-descriptions-item :label="t('access.common.completeness')" :span="2">
                <el-progress
                  :percentage="completeness.total ? Math.round((completeness.done / completeness.total) * 100) : 0"
                  :status="completeness.done >= completeness.total && completeness.total > 0 ? 'success' : undefined"
                  class="progress"
                />
                <span class="muted">{{ t("access.wizard.completenessSummary", { done: completeness.done, total: completeness.total, count: draft.materials.length }) }}</span>
              </el-descriptions-item>
            </el-descriptions>
            <div v-if="editable" class="submit-actions">
              <el-button :loading="saving" @click="archiveToLibrary">{{ t("access.wizard.archiveTitle") }}</el-button>
              <el-button type="primary" :loading="submitting" @click="submit">
                {{ application.status === "DRAFT" ? t("access.wizard.submitTitle") : t("access.wizard.resubmitReview") }}
              </el-button>
            </div>
          </section>

          <footer class="wizard-footer">
            <el-button :disabled="step === 1" @click="goStep(step - 1)">{{ t("access.wizard.prevStep") }}</el-button>
            <div class="footer-right">
              <el-button v-if="editable" :loading="saving" @click="persistDraft()">{{ t("access.wizard.saveDraft") }}</el-button>
              <el-button v-if="step < 5" type="primary" @click="goStep(step + 1)">{{ t("access.wizard.nextStep") }}</el-button>
            </div>
          </footer>
        </el-card>

        <!-- KYC 规则助手 -->
        <aside class="assistant">
          <el-card shadow="never">
            <h4 class="assistant-title">{{ t("access.wizard.assistantTitle") }}</h4>
            <template v-if="currentScenario">
              <p class="assistant-block">
                <strong>{{ currentScenario.scenario_name }}</strong><br />
                <span class="muted">{{ currentScenario.process_description || t("access.wizard.noProcessDesc") }}</span>
              </p>
              <p v-if="currentChannel" class="assistant-block restriction">
                <strong>{{ t("access.wizard.channelRestriction", { name: currentChannel.channel_name }) }}</strong><br />
                <span>{{ currentChannel.restrictions.length ? currentChannel.restrictions.map(r => r.content).join("；") : t("access.wizard.noRestrictions") }}</span>
              </p>
              <template v-if="draft.channel_code">
                <div class="assistant-block">
                  <strong>{{ t("access.wizard.completenessLine", { done: completeness.done, total: completeness.total }) }}</strong>
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
              <p v-else class="muted">{{ t("access.wizard.pickChannelHint") }}</p>
            </template>
            <p v-else class="muted">{{ t("access.wizard.pickScenarioHint") }}</p>
          </el-card>

          <el-card v-if="application.timeline.length" shadow="never" class="timeline-card">
            <h4 class="assistant-title">{{ t("access.wizard.timelineTitle") }}</h4>
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
      <el-dialog v-model="libraryVisible" :title="t('access.wizard.libraryDialogTitle')" width="640px">
        <el-table
          v-loading="libraryLoading"
          :data="libraryList"
          @selection-change="(rows: CustomerMaterialVO[]) => (librarySelection = rows)"
        >
          <el-table-column type="selection" width="46" />
          <el-table-column prop="name" :label="t('access.wizard.colMaterial')" min-width="180" />
          <el-table-column prop="category" :label="t('access.wizard.colLinkedItem')" width="140">
            <template #default="{ row }">{{ row.category || "—" }}</template>
          </el-table-column>
          <el-table-column :label="t('access.wizard.colVersion')" width="70">
            <template #default="{ row }">v{{ row.version }}</template>
          </el-table-column>
          <el-table-column :label="t('access.wizard.colArchivedAt')" width="120">
            <template #default="{ row }">{{ new Date(row.created_at).toLocaleDateString() }}</template>
          </el-table-column>
          <el-table-column :label="t('access.common.colActions')" width="80">
            <template #default="{ row }">
              <el-button size="small" link type="primary" @click="openFilePreview(row.file)">{{ t("access.common.preview") }}</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!libraryLoading && !libraryList.length" :description="t('access.wizard.libraryEmpty')" />
        <template #footer>
          <el-button @click="libraryVisible = false">{{ t("access.common.cancel") }}</el-button>
          <el-button type="primary" :disabled="!librarySelection.length" @click="addFromLibrary">
            {{ t("access.wizard.addSelected") }} {{ librarySelection.length ? `（${librarySelection.length}）` : "" }}
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
