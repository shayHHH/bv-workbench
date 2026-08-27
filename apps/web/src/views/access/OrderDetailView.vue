<script setup lang="ts">
import {
  AccessStatusLabel,
  ApplicationMaterialStatusLabel,
  MaterialSourceLabel,
  ReviewTypeLabel,
  type AccessApplicationVO,
  type ApplicationMaterialVO,
} from "@bv/shared";
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
import { useRoute, useRouter } from "vue-router";
import { fetchApplication, openFilePreview } from "@/api/access";
import { formatDateTime, formatRelative } from "@/utils/format";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const application = ref<AccessApplicationVO | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    application.value = await fetchApplication(route.params.id as string);
  } finally {
    loading.value = false;
  }
}

const materialTagType: Record<string, "success" | "warning" | "danger"> = {
  PENDING: "warning",
  ACCEPTED: "success",
  RETURNED: "danger",
};

async function preview(material: ApplicationMaterialVO, download = false) {
  if (!material.file) return;
  try {
    await openFilePreview(material.file, download);
  } catch {
    /* 提示由拦截器处理 */
  }
}

onMounted(load);
</script>

<template>
  <div v-loading="loading">
    <template v-if="application">
      <header class="page-header">
        <div>
          <p class="eyebrow">WORK ORDER DETAIL</p>
          <h1>{{ application.customer_snapshot.name }} · {{ t("access.detail.titleSuffix") }}</h1>
          <p class="subtitle">
            {{ application.application_no }} ·
            {{ application.customer_snapshot.customer_code || t("access.common.noCode") }}
            {{ application.review_type ? ` · ${localizeText(ReviewTypeLabel[application.review_type])}` : "" }}
          </p>
        </div>
        <el-button @click="router.push('/access/documents')">{{ t("access.common.backToOrders") }}</el-button>
      </header>

      <div class="strip">
        <div class="strip-item">
          <span>{{ t("access.common.currentStatus") }}</span><strong>{{ localizeText(AccessStatusLabel[application.status]) }}</strong>
        </div>
        <div class="strip-item">
          <span>{{ t("access.common.scenarioChannel") }}</span>
          <strong>{{ application.scenario_name || "-" }} · {{ application.channel_name || "-" }}</strong>
        </div>
        <div class="strip-item">
          <span>{{ t("access.common.completeness") }}</span>
          <strong>{{ application.completeness.done }} / {{ application.completeness.total }}</strong>
        </div>
        <div class="strip-item">
          <span>{{ t("access.common.lastUpdated") }}</span><strong>{{ formatRelative(application.updated_at) }}</strong>
        </div>
      </div>

      <div class="layout">
        <el-card shadow="never" class="main-card">
          <template #header>
            <strong>{{ t("access.detail.materialsTitle") }}</strong>
            <span class="head-sub">{{ t("access.detail.readonlySnapshot") }}</span>
          </template>
          <div v-for="material in application.materials" :key="material.material_key" class="doc-row">
            <span class="doc-icon">
              {{ (material.file?.original_name.split(".").pop() || t("access.common.extFallback")).toUpperCase().slice(0, 4) }}
            </span>
            <span class="doc-main">
              <strong>{{ material.name }}</strong>
              <small>
                {{ localizeText(MaterialSourceLabel[material.source]) }}
                {{ material.return_reason ? ` · ${t("access.common.returnReason", { reason: material.return_reason })}` : "" }}
              </small>
            </span>
            <el-tag :type="materialTagType[material.status]" effect="light" size="small">
              {{ localizeText(ApplicationMaterialStatusLabel[material.status]) }}
            </el-tag>
            <el-button size="small" :disabled="!material.file" @click="preview(material)">{{ t("access.common.preview") }}</el-button>
            <el-button size="small" :disabled="!material.file" @click="preview(material, true)">{{ t("access.detail.download") }}</el-button>
          </div>
          <el-empty v-if="!application.materials.length" :description="t('access.detail.noMaterials')" />
        </el-card>

        <el-card shadow="never" class="side-card">
          <template #header>
            <strong>{{ t("access.common.orderLog") }}</strong>
            <span class="head-sub">{{ application.latest_review?.reason || t("access.common.recentActivity") }}</span>
          </template>
          <el-timeline>
            <el-timeline-item
              v-for="(entry, index) in [...application.timeline].reverse()"
              :key="index"
              :timestamp="`${entry.by_name ? `${entry.by_name} · ` : ''}${formatDateTime(entry.at)}`"
            >
              <strong>{{ entry.action }}</strong>
              <p v-if="entry.note" class="entry-note">{{ entry.note }}</p>
            </el-timeline-item>
          </el-timeline>
        </el-card>
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
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 16px;
  align-items: start;
}

.head-sub {
  margin-left: 10px;
  color: #909399;
  font-size: 12px;
}

.doc-row {
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
  width: 38px;
  height: 38px;
  border-radius: 8px;
  background: #fff3e6;
  color: #ff7a00;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.doc-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.doc-main strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-main small {
  color: #909399;
}

.entry-note {
  margin: 4px 0 0;
  color: #606266;
  font-size: 13px;
}
</style>
