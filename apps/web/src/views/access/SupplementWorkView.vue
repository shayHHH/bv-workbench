<script setup lang="ts">
import {
  AccessStatusLabel,
  ApplicationMaterialStatus,
  ReviewType,
  ReviewTypeLabel,
  type AccessApplicationVO,
  type FileRef,
} from "@bv/shared";
import { ElMessage } from "element-plus";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  fetchApplication,
  openFilePreview,
  saveApplicationDraft,
  submitApplication,
  uploadFile,
} from "@/api/access";
import { formatDateTime, formatRelative } from "@/utils/format";

const route = useRoute();
const router = useRouter();

const application = ref<AccessApplicationVO | null>(null);
const loading = ref(false);
const submitting = ref(false);
const fileInput = ref<HTMLInputElement>();
const dragActive = ref(false);

interface SupplementRow {
  key: string;
  name: string;
  size: number;
  file: FileRef | null;
  /** 匹配的被退回材料 material_key */
  targetKey: string;
  uploading: boolean;
}

const uploads = ref<SupplementRow[]>([]);

const returnedMaterials = computed(
  () =>
    application.value?.materials.filter(
      material => material.status === ApplicationMaterialStatus.RETURNED,
    ) ?? [],
);

const keptMaterials = computed(
  () =>
    application.value?.materials.filter(
      material => material.status !== ApplicationMaterialStatus.RETURNED,
    ) ?? [],
);

const allMatched = computed(
  () => uploads.value.length > 0 && uploads.value.every(row => row.targetKey && !row.uploading),
);

const footerHint = computed(() => {
  if (!uploads.value.length) return "请先上传至少 1 份补件文件";
  if (uploads.value.some(row => !row.targetKey)) return "还有文件未选择匹配材料项";
  return "提交后工单返回合规复核";
});

async function load() {
  loading.value = true;
  try {
    application.value = await fetchApplication(route.params.id as string);
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
    ElMessage.warning("部分文件未添加：仅支持 JPG、JPEG、PNG 和 PDF");
  }
  const usedTargets = new Set(uploads.value.map(row => row.targetKey).filter(Boolean));
  for (const file of accepted) {
    // 自动预猜匹配：取第一个尚未被占用的被退回材料（demo 行为）
    const target = returnedMaterials.value.find(m => !usedTargets.has(m.material_key));
    if (target) usedTargets.add(target.material_key);
    const row: SupplementRow = {
      key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      size: file.size,
      file: null,
      targetKey: target?.material_key ?? "",
      uploading: true,
    };
    uploads.value.push(row);
    try {
      row.file = await uploadFile(file);
    } catch {
      uploads.value = uploads.value.filter(item => item.key !== row.key);
    } finally {
      row.uploading = false;
    }
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

async function submitSupplement() {
  const app = application.value;
  if (!app || !allMatched.value) return;
  submitting.value = true;
  try {
    const replacement = new Map(uploads.value.map(row => [row.targetKey, row]));
    await saveApplicationDraft(app.id, {
      materials: app.materials.map(material => {
        const replaced = replacement.get(material.material_key);
        return {
          material_key: material.material_key,
          requirement_item_id: material.requirement_item_id,
          name: replaced ? replaced.name : material.name,
          source: material.source,
          file: replaced ? replaced.file : material.file,
          library_material_id: replaced ? null : material.library_material_id,
        };
      }),
    });
    await submitApplication(app.id, (app.review_type as ReviewType) || ReviewType.FX);
    ElMessage.success(`补件材料已提交：${app.application_no} 已返回合规复核`);
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
          <h1>{{ application.customer_snapshot.name }} · 补件处理</h1>
          <p class="subtitle">
            {{ application.application_no }} ·
            {{ application.customer_snapshot.customer_code || "无编号" }}
            {{ application.review_type ? ` · ${ReviewTypeLabel[application.review_type]}` : "" }}
          </p>
        </div>
        <el-button @click="router.push('/access/documents')">← 返回工单列表</el-button>
      </header>

      <div class="strip">
        <div class="strip-item"><span>当前状态</span><strong>{{ AccessStatusLabel[application.status] }}</strong></div>
        <div class="strip-item">
          <span>业务类型 / 渠道</span>
          <strong>{{ application.scenario_name || "-" }} · {{ application.channel_name || "-" }}</strong>
        </div>
        <div class="strip-item">
          <span>材料完整度</span>
          <strong>{{ application.completeness.done }} / {{ application.completeness.total }}</strong>
        </div>
        <div class="strip-item">
          <span>退回时间</span>
          <strong>{{ application.latest_review ? formatRelative(application.latest_review.reviewed_at) : "-" }}</strong>
        </div>
      </div>

      <div class="layout">
        <div class="main-col">
          <el-card shadow="never" class="reject-card">
            <div class="reject-head">
              <el-tag type="danger" effect="light">{{ AccessStatusLabel[application.status] }}</el-tag>
              <strong>本次驳回说明</strong>
              <span class="muted">
                合规退回{{ application.latest_review ? ` · ${application.latest_review.reviewer_name ?? ""} ${formatDateTime(application.latest_review.reviewed_at)}` : "" }}
              </span>
            </div>
            <p class="reject-note">{{ application.latest_review?.reason || "请根据退回意见补充材料。" }}</p>
            <div v-if="returnedMaterials.length" class="target-chips">
              <span class="chips-label">需补交材料项：</span>
              <el-tag v-for="material in returnedMaterials" :key="material.material_key" type="warning" effect="plain">
                {{ material.name }}
              </el-tag>
            </div>
          </el-card>

          <el-card shadow="never">
            <template #header>
              <strong>补交材料</strong>
              <span class="head-sub">拖拽文件或点击选择，每份文件需匹配一个被退回材料项。支持 JPG、PNG、PDF。</span>
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
              <strong>拖拽文件到这里上传</strong>
              <small>或点击选择文件 · 可一次选择多份</small>
            </div>
            <input ref="fileInput" type="file" multiple accept=".jpg,.jpeg,.png,.pdf" hidden @change="onFileChange" />

            <div v-for="row in uploads" :key="row.key" class="file-row">
              <span class="doc-icon">{{ /pdf$/i.test(row.name) ? "PDF" : "IMG" }}</span>
              <span class="file-main">
                <strong>{{ row.name }}</strong>
                <small>{{ sizeText(row.size) }} · 待提交</small>
              </span>
              <el-select v-model="row.targetKey" class="map-select" placeholder="匹配材料项" size="small">
                <el-option
                  v-for="material in returnedMaterials"
                  :key="material.material_key"
                  :value="material.material_key"
                  :label="`${material.name}（需补件）`"
                />
              </el-select>
              <button class="remove" type="button" @click="removeRow(row.key)">×</button>
            </div>

            <footer class="submit-footer">
              <span class="muted">{{ footerHint }}</span>
              <el-button type="primary" :disabled="!allMatched" :loading="submitting" @click="submitSupplement">
                提交补件材料
              </el-button>
            </footer>
          </el-card>
        </div>

        <div class="side-col">
          <el-card shadow="never">
            <template #header>
              <strong>已有材料</strong>
              <span class="head-sub">补件前快照，无需重复上传</span>
            </template>
            <div v-for="material in keptMaterials" :key="material.material_key" class="kept-row">
              <strong>{{ material.name }}</strong>
              <el-button
                v-if="material.file"
                size="small"
                link
                type="primary"
                @click="openFilePreview(material.file!)"
              >
                预览
              </el-button>
            </div>
            <el-empty v-if="!keptMaterials.length" description="暂无其他材料" :image-size="60" />
          </el-card>

          <el-card shadow="never">
            <template #header><strong>工单记录</strong><span class="head-sub">最近处理动态</span></template>
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

.kept-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px dashed #ebeef5;
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
</style>
