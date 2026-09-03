<script setup lang="ts">
import {
  AccessStatusLabel,
  ApplicationMaterialStatus,
  MaterialSource,
  type KycItem,
  type KycScenarioVO,
  ReviewType,
  ReviewTypeLabel,
  type AccessApplicationVO,
  type FileRef,
} from "@bv/shared";
import { ElMessage } from "element-plus";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
import { useRoute, useRouter } from "vue-router";
import {
  fetchApplication,
  openFilePreview,
  saveApplicationDraft,
  submitApplication,
  uploadFile,
} from "@/api/access";
import { fetchActiveScenarios } from "@/api/kyc";
import { formatDateTime, formatRelative } from "@/utils/format";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const application = ref<AccessApplicationVO | null>(null);
const scenarios = ref<KycScenarioVO[]>([]);
const loading = ref(false);
const submitting = ref(false);
const fileInput = ref<HTMLInputElement>();
const dragActive = ref(false);

interface SupplementRow {
  key: string;
  name: string;
  size: number;
  file: FileRef | null;
  /** 匹配的当前渠道 KYC 材料项 item_id */
  targetKey: string;
  uploading: boolean;
  uploadTask?: Promise<void>;
}

const uploads = ref<SupplementRow[]>([]);

const returnedMaterials = computed(
  () =>
    application.value?.materials.filter(
      material => material.status === ApplicationMaterialStatus.RETURNED,
    ) ?? [],
);

/** 延期补件模式（条件性放行/逾期受限）：补的是缺失清单项而非被退回材料 */
const deferralMode = computed(
  () =>
    !!application.value &&
    (application.value.status === "APPROVED_CONDITIONAL" || application.value.status === "DEFERRAL_OVERDUE") &&
    !!application.value.deferral,
);

const deferralMissingIds = computed(() => application.value?.deferral?.missing_item_ids ?? []);

const selectedScenario = computed(
  () => scenarios.value.find(item => item.id === application.value?.scenario_id) ?? null,
);

const selectedChannel = computed(
  () =>
    selectedScenario.value?.channels.find(
      channel => channel.channel_code === application.value?.channel_code,
    ) ?? null,
);

const materialOptions = computed<KycItem[]>(
  () => selectedChannel.value?.sections.flatMap(section => section.items) ?? [],
);

const optionNameById = computed(
  () => new Map(materialOptions.value.map(item => [item.item_id, item.item_name])),
);

const hasUploading = computed(() => uploads.value.some(row => row.uploading));
const allMatched = computed(() => uploads.value.length > 0 && uploads.value.every(row => row.targetKey));

const footerHint = computed(() => {
  if (!uploads.value.length) return t("access.supplement.hintNeedFile");
  if (uploads.value.some(row => !row.targetKey)) return t("access.supplement.hintUnmatched");
  if (hasUploading.value) return t("access.supplement.hintUploading");
  return t("access.supplement.hintReady");
});

async function load() {
  loading.value = true;
  try {
    const [app, activeScenarios] = await Promise.all([
      fetchApplication(route.params.id as string),
      fetchActiveScenarios(),
    ]);
    application.value = app;
    scenarios.value = activeScenarios;
  } finally {
    loading.value = false;
  }
}

function sizeText(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(size / 1024)} KB`;
}

async function addFiles(list: FileList | File[]) {
  const accepted = [...list].filter(file => /\.(pdf|jpe?g|png)$/i.test(file.name));
  if (accepted.length < list.length) {
    ElMessage.warning(t("access.supplement.fileTypeRejected"));
  }
  const usedTargets = new Set(uploads.value.map(row => row.targetKey).filter(Boolean));
  for (const file of accepted) {
    const candidates = deferralMode.value
      ? materialOptions.value.filter(m => deferralMissingIds.value.includes(m.item_id))
      : materialOptions.value;
    const target = (candidates.length ? candidates : materialOptions.value).find(m => !usedTargets.has(m.item_id));
    if (target) usedTargets.add(target.item_id);
    const row: SupplementRow = {
      key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      size: file.size,
      file: null,
      targetKey: target?.item_id ?? "",
      uploading: true,
    };
    uploads.value.push(row);
    row.uploadTask = uploadFile(file)
      .then(ref => {
        row.file = ref;
      })
      .catch(() => {
        uploads.value = uploads.value.filter(item => item.key !== row.key);
      })
      .finally(() => {
        row.uploading = false;
      });
  }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files?.length) addFiles(input.files);
  input.value = "";
}

function onDrop(event: DragEvent) {
  dragActive.value = false;
  if (event.dataTransfer?.files.length) addFiles(event.dataTransfer.files);
}

function removeRow(key: string) {
  uploads.value = uploads.value.filter(row => row.key !== key);
}

function displayMaterialName(material: { requirement_item_id: string | null; name: string }) {
  return material.requirement_item_id
    ? (optionNameById.value.get(material.requirement_item_id) ?? material.name)
    : material.name;
}

async function previewMaterial(file: FileRef | null) {
  if (!file) return;
  try {
    await openFilePreview(file);
  } catch {
    /* 提示由拦截器处理 */
  }
}

async function submitSupplement() {
  const app = application.value;
  if (!app || !allMatched.value) return;
  submitting.value = true;
  try {
    await Promise.all(uploads.value.map(row => row.uploadTask).filter(Boolean));
    if (!uploads.value.length || uploads.value.some(row => !row.file)) {
      ElMessage.warning(t("access.supplement.hintNeedFile"));
      return;
    }
    const replacement = new Map<string, SupplementRow[]>();
    for (const row of uploads.value) {
      const rows = replacement.get(row.targetKey) ?? [];
      rows.push(row);
      replacement.set(row.targetKey, rows);
    }
    const nextMaterials = app.materials.map(material => {
      const rows = material.requirement_item_id
        ? replacement.get(material.requirement_item_id)
        : undefined;
      const replaced =
        material.status === ApplicationMaterialStatus.RETURNED && rows?.length ? rows.shift() : null;
      return {
        material_key: material.material_key,
        requirement_item_id: material.requirement_item_id,
        name: replaced ? replaced.name : material.name,
        source: replaced ? MaterialSource.LOCAL_UPLOAD : material.source,
        file: replaced ? replaced.file : material.file,
        library_material_id: replaced ? null : material.library_material_id,
      };
    });
    for (const [itemId, rows] of replacement) {
      for (const row of rows) {
        nextMaterials.push({
          material_key: row.key,
          requirement_item_id: itemId,
          name: row.name,
          source: MaterialSource.LOCAL_UPLOAD,
          file: row.file,
          library_material_id: null,
        });
      }
    }
    await saveApplicationDraft(app.id, {
      materials: nextMaterials,
    });
    await submitApplication(app.id, (app.review_type as ReviewType) || ReviewType.FX);
    ElMessage.success(t("access.supplement.submitted", { no: app.application_no }));
    router.push("/access/documents");
  } catch {
    /* 提示由拦截器处理 */
  } finally {
    submitting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-loading="loading">
    <template v-if="application">
      <header class="page-header">
        <div>
          <p class="eyebrow">SUPPLEMENT WORK</p>
          <h1>{{ application.customer_snapshot.name }} · {{ t("access.supplement.titleSuffix") }}</h1>
          <p class="subtitle">
            {{ application.application_no }} ·
            {{ application.customer_snapshot.customer_code || t("access.common.noCode") }}
            {{ application.review_type ? ` · ${localizeText(ReviewTypeLabel[application.review_type])}` : "" }}
          </p>
        </div>
        <el-button @click="router.push('/access/documents')">{{ t("access.common.backToOrders") }}</el-button>
      </header>

      <div class="strip">
        <div class="strip-item"><span>{{ t("access.common.currentStatus") }}</span><strong>{{ localizeText(AccessStatusLabel[application.status]) }}</strong></div>
        <div class="strip-item">
          <span>{{ t("access.common.scenarioChannel") }}</span>
          <strong>{{ application.scenario_name || "-" }} · {{ application.channel_name || "-" }}</strong>
        </div>
        <div class="strip-item">
          <span>{{ t("access.common.completeness") }}</span>
          <strong>{{ application.completeness.done }} / {{ application.completeness.total }}</strong>
        </div>
        <div class="strip-item">
          <span>{{ t("access.supplement.returnedAt") }}</span>
          <strong>{{ application.latest_review ? formatRelative(application.latest_review.reviewed_at) : "-" }}</strong>
        </div>
      </div>

      <div class="layout">
        <div class="main-col">
          <el-card shadow="never" class="reject-card">
            <div class="reject-head">
              <el-tag :type="deferralMode ? 'warning' : 'danger'" effect="light">{{ localizeText(AccessStatusLabel[application.status]) }}</el-tag>
              <strong>{{ deferralMode ? t("access.supplement.deferralTitle") : t("access.supplement.rejectTitle") }}</strong>
              <span class="muted">
                {{ deferralMode ? t("access.supplement.deferralBy") : t("access.supplement.complianceReturned") }}{{ application.latest_review ? ` · ${application.latest_review.reviewer_name ?? ""} ${formatDateTime(application.latest_review.reviewed_at)}` : "" }}
              </span>
            </div>
            <p v-if="deferralMode && application.deferral" class="deferral-due-line">
              {{ t("access.supplement.deferralDueLine", { time: formatDateTime(application.deferral.due_at) }) }}
              <template v-if="application.deferral.limit_amount">
                · {{ t("access.supplement.deferralLimitLine", { limit: `${application.deferral.limit_currency} ${application.deferral.limit_amount.toLocaleString("en-US")}` }) }}
              </template>
            </p>
            <p class="reject-note">{{ application.latest_review?.reason || t("access.supplement.rejectFallback") }}</p>
            <div v-if="deferralMode && application.deferral" class="target-chips">
              <span class="chips-label">{{ t("access.supplement.deferralNeeded") }}</span>
              <span v-for="name in application.deferral.missing_item_names" :key="name" class="material-chip static">{{ name }}</span>
            </div>
            <div v-if="!deferralMode && returnedMaterials.length" class="target-chips">
              <span class="chips-label">{{ t("access.supplement.neededItems") }}</span>
              <button
                v-for="material in returnedMaterials"
                :key="material.material_key"
                class="material-chip"
                type="button"
                :disabled="!material.file"
                @click="previewMaterial(material.file)"
              >
                {{ displayMaterialName(material) }}
                <span v-if="material.name !== displayMaterialName(material)" class="chip-file-name">
                  {{ material.name }}
                </span>
                <span v-if="material.file" class="chip-preview">{{ t("access.common.preview") }}</span>
              </button>
            </div>
          </el-card>

          <el-card shadow="never">
            <template #header>
              <strong>{{ t("access.supplement.uploadTitle") }}</strong>
              <span class="head-sub">{{ t("access.supplement.uploadHint") }}</span>
            </template>
            <div
              class="dropzone"
              :class="{ active: dragActive }"
              @click="fileInput?.click()"
              @dragover.prevent="dragActive = true"
              @dragleave.prevent="dragActive = false"
              @drop.prevent="onDrop"
            >
              <span class="dz-icon">⇪</span>
              <strong>{{ t("access.supplement.dropTitle") }}</strong>
              <small>{{ t("access.supplement.dropHint") }}</small>
            </div>
            <input ref="fileInput" type="file" multiple accept=".jpg,.jpeg,.png,.pdf" hidden @change="onFileChange" />

            <div v-for="row in uploads" :key="row.key" class="file-row">
              <span class="doc-icon">{{ /pdf$/i.test(row.name) ? "PDF" : "IMG" }}</span>
              <span class="file-main">
                <strong>{{ row.name }}</strong>
                <small>
                  {{ sizeText(row.size) }} ·
                  {{ row.uploading ? t("access.supplement.uploading") : t("access.supplement.pendingSubmit") }}
                </small>
              </span>
              <el-select v-model="row.targetKey" class="map-select" :placeholder="t('access.supplement.matchPh')" size="small">
                <el-option
                  v-for="material in materialOptions"
                  :key="material.item_id"
                  :value="material.item_id"
                  :label="material.item_name"
                />
              </el-select>
              <button class="remove" type="button" @click="removeRow(row.key)">×</button>
            </div>

            <footer class="submit-footer">
              <span class="muted">{{ footerHint }}</span>
              <el-button type="primary" :disabled="!allMatched" :loading="submitting" @click="submitSupplement">
                {{ t("access.supplement.submitBtn") }}
              </el-button>
            </footer>
          </el-card>
        </div>

        <div class="side-col">
          <el-card shadow="never">
            <template #header><strong>{{ t("access.common.orderLog") }}</strong><span class="head-sub">{{ t("access.common.recentActivity") }}</span></template>
            <ol class="history">
              <li v-for="(entry, index) in [...application.timeline].reverse()" :key="index">
                {{ formatDateTime(entry.at) }} · {{ entry.action }}
              </li>
            </ol>
          </el-card>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
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

.strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.strip-item {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.strip-item span {
  color: #909399;
  font-size: 12px;
}

/* 容器不在 EP 组件内，不显式设置会继承浏览器 16px + 700，视觉上过大过黑 */
.strip-item strong {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
  align-items: start;
}

.main-col,
.side-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.reject-card {
  border-color: #fde2e2;
}

.reject-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.reject-note {
  margin: 0 0 10px;
  color: #606266;
  line-height: 1.6;
}

.target-chips {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.chips-label {
  color: #909399;
  font-size: 13px;
}

.material-chip {
  min-height: 32px;
  border: 1px solid #f3c27d;
  border-radius: 6px;
  background: #fffaf2;
  color: #d66b00;
  padding: 4px 10px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  cursor: pointer;
}

.material-chip:disabled {
  cursor: default;
}

.material-chip:not(:disabled):hover {
  border-color: #ff7a00;
  background: #fff4e6;
}

.chip-file-name {
  color: #909399;
  font-size: 12px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip-preview {
  color: #409eff;
  font-size: 12px;
}

.head-sub {
  margin-left: 10px;
  color: #909399;
  font-size: 12px;
}

.dropzone {
  border: 1.5px dashed #dcdfe6;
  border-radius: 10px;
  padding: 22px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  margin-bottom: 12px;
}

.dropzone.active,
.dropzone:hover {
  border-color: #ff7a00;
  background: #fffaf5;
}

.dz-icon {
  font-size: 20px;
  color: #ff7a00;
}

.dropzone small {
  color: #909399;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  margin-bottom: 8px;
}

.doc-icon {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: #fff3e6;
  color: #ff7a00;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.file-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.file-main small {
  color: #909399;
}

.map-select {
  width: 220px;
  flex: none;
}

.remove {
  border: none;
  background: transparent;
  font-size: 18px;
  color: #909399;
  cursor: pointer;
}

.remove:hover {
  color: #c45656;
}

.submit-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}

.muted {
  color: #909399;
  font-size: 13px;
}

.history {
  margin: 0;
  padding-left: 18px;
  color: #606266;
  font-size: 13px;
}

.history li {
  margin-bottom: 6px;
}
.material-chip.static {
  cursor: default;
}

.deferral-due-line {
  margin: 4px 0 6px;
  color: #b88230;
  font-size: 13px;
  font-weight: 600;
}
</style>
