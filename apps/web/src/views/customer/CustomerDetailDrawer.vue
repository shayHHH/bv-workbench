<script setup lang="ts">
import {
  AccessStatusLabel,
  CustomerKind,
  CustomerKindLabel,
  CustomerStatus,
  CustomerStatusLabel,
  CustomerSubTypeLabel,
  RegionLabel,
  RiskLevelLabel,
  type AccessApplicationVO,
  type AccessStatus,
  type CustomerEventVO,
  type CustomerMaterialVO,
  type CustomerVO,
} from "@bv/shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, ref, watch } from "vue";
import { fetchApplications, fetchCustomerMaterials, openFilePreview } from "@/api/access";
import { fetchCustomer, fetchCustomerEvents, updateCustomer } from "@/api/customer";
import { formatDateTime, formatRelative } from "@/utils/format";

const visible = defineModel<boolean>({ required: true });
const props = defineProps<{ customer: CustomerVO | null }>();
const emit = defineEmits<{ edit: [customer: CustomerVO]; changed: [] }>();

const current = ref<CustomerVO | null>(null);
const activeTab = ref("overview");
const events = ref<CustomerEventVO[]>([]);
const eventsLoading = ref(false);
const statusSubmitting = ref(false);
/* 材料库 / 准入申请页签（数据来自业务准入模块，按需加载） */
const materials = ref<CustomerMaterialVO[]>([]);
const materialsLoading = ref(false);
const materialsLoaded = ref(false);
const applications = ref<AccessApplicationVO[]>([]);
const applicationsLoading = ref(false);
const applicationsLoaded = ref(false);

const isSub = computed(() => current.value?.customer_kind === CustomerKind.SUB_CUSTOMER);
const isIntermediary = computed(() => current.value?.customer_kind === CustomerKind.INTERMEDIARY);
const suspended = computed(() => current.value?.customer_status === CustomerStatus.SUSPENDED);

const eyebrow = computed(() => {
  switch (current.value?.customer_kind) {
    case CustomerKind.INTERMEDIARY:
      return "INTERMEDIARY CUSTOMER";
    case CustomerKind.SUB_CUSTOMER:
      return "INTERMEDIARY SUB CUSTOMER";
    default:
      return "DIRECT CUSTOMER";
  }
});

const statusTagType: Record<CustomerStatus, "primary" | "success" | "warning" | "info"> = {
  NEW: "primary",
  ACTIVE: "success",
  DORMANT: "warning",
  SUSPENDED: "info",
};

async function loadEvents() {
  if (!current.value) return;
  eventsLoading.value = true;
  try {
    events.value = await fetchCustomerEvents(current.value.id);
  } finally {
    eventsLoading.value = false;
  }
}

async function loadMaterials() {
  if (!current.value) return;
  materialsLoading.value = true;
  try {
    materials.value = await fetchCustomerMaterials(current.value.id);
    materialsLoaded.value = true;
  } finally {
    materialsLoading.value = false;
  }
}

async function loadApplications() {
  if (!current.value) return;
  applicationsLoading.value = true;
  try {
    const result = await fetchApplications({ customer_id: current.value.id, page: 1, page_size: 50 });
    applications.value = result.items;
    applicationsLoaded.value = true;
  } finally {
    applicationsLoading.value = false;
  }
}

function resetTabData() {
  events.value = [];
  materials.value = [];
  materialsLoaded.value = false;
  applications.value = [];
  applicationsLoaded.value = false;
}

/** 切换抽屉主体（查看下级客户 / 上级中介） */
async function switchTo(target: CustomerVO | string) {
  try {
    current.value = typeof target === "string" ? await fetchCustomer(target) : target;
    resetTabData();
    onTabActivated(activeTab.value);
  } catch {
    /* 错误提示由 http 拦截器统一处理 */
  }
}

watch(visible, open => {
  if (!open) return;
  current.value = props.customer;
  activeTab.value = "overview";
  resetTabData();
});

/* 抽屉未关时切换目标客户（如列表再次点击其它客户名）也要刷新内容 */
watch(
  () => props.customer,
  customer => {
    if (!visible.value || !customer || customer.id === current.value?.id) return;
    current.value = customer;
    activeTab.value = "overview";
    resetTabData();
  },
);

function onTabActivated(tab: string) {
  if (tab === "timeline" && !events.value.length) loadEvents();
  if (tab === "documents" && !materialsLoaded.value) loadMaterials();
  if (tab === "applications" && !applicationsLoaded.value) loadApplications();
}

watch(activeTab, onTabActivated);

/** 暂停 / 恢复合作：真实状态变更 + 备注写入档案事件 */
async function toggleCooperation() {
  const c = current.value;
  if (!c) return;
  const pausing = !suspended.value;
  try {
    const { value } = await ElMessageBox.prompt(
      pausing
        ? `暂停与 ${c.name} 的合作？客户明确不合作、风险原因或长期失联时使用，列表状态将显示「暂停合作」。`
        : `恢复与 ${c.name} 的合作？风险解除或客户重新确认合作后，状态回到「活跃」。`,
      pausing ? "暂停合作" : "恢复合作",
      {
        inputPlaceholder: pausing ? "暂停原因（会写入档案时间线）" : "恢复说明（会写入档案时间线）",
        confirmButtonText: pausing ? "确认暂停" : "确认恢复",
        cancelButtonText: "取消",
      },
    );
    statusSubmitting.value = true;
    const updated = await updateCustomer(c.id, {
      customer_status: pausing ? CustomerStatus.SUSPENDED : CustomerStatus.ACTIVE,
      change_note: value?.trim() || null,
    });
    current.value = { ...c, ...updated };
    ElMessage.success(pausing ? `${c.name} 已暂停合作` : `${c.name} 已恢复合作`);
    events.value = [];
    if (activeTab.value === "timeline") await loadEvents();
    emit("changed");
  } catch {
    /* 用户取消或接口错误 */
  } finally {
    statusSubmitting.value = false;
  }
}

const accessStatusTagType: Record<AccessStatus, "primary" | "success" | "warning" | "info" | "danger"> = {
  DRAFT: "info",
  PENDING_REVIEW: "warning",
  SUPPLEMENT_REQUIRED: "warning",
  REJECTED: "danger",
  APPROVED: "success",
  EXPIRED: "info",
  SUSPENDED: "info",
  CANCELLED: "info",
};

function fileSizeText(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function docIcon(mime: string): string {
  if (mime.includes("pdf")) return "PDF";
  if (mime.startsWith("image/")) return "图";
  return "档";
}

async function previewMaterial(material: CustomerMaterialVO, download = false) {
  try {
    await openFilePreview(material.file, download);
  } catch {
    /* 错误提示由 http 拦截器统一处理 */
  }
}

const kindText = (c: CustomerVO) => CustomerKindLabel[c.customer_kind];
const statusText = (c: CustomerVO) => CustomerStatusLabel[c.customer_status];
const riskText = (c: CustomerVO) => RiskLevelLabel[c.risk_level];
const regionText = (c: CustomerVO) => (c.region ? RegionLabel[c.region] : "未填写");
const subTypeText = (c: CustomerVO) => (c.sub_type ? CustomerSubTypeLabel[c.sub_type] : "未定义");
</script>

<template>
  <el-drawer v-model="visible" size="520px" :with-header="false">
    <div v-if="current" class="drawer">
      <header class="drawer-head">
        <div>
          <p class="eyebrow">{{ eyebrow }}</p>
          <h2>
            {{ current.name }}
            <el-tag :type="statusTagType[current.customer_status]" effect="light">
              {{ statusText(current) }}
            </el-tag>
          </h2>
          <p class="sub-line">
            {{ current.customer_code || "无编号" }} · {{ kindText(current) }}
            <template v-if="current.parent_name"> · 上级中介 {{ current.parent_name }}</template>
          </p>
        </div>
        <div class="head-actions">
          <el-button size="small" @click="emit('edit', current)">编辑信息</el-button>
          <button class="drawer-close" type="button" aria-label="关闭" @click="visible = false">×</button>
        </div>
      </header>

      <el-tabs v-model="activeTab">
        <el-tab-pane label="概览" name="overview">
          <el-descriptions :column="2" class="overview-grid">
            <el-descriptions-item label="客户编号">{{ current.customer_code || "无编号" }}</el-descriptions-item>
            <el-descriptions-item label="客户类型">{{ kindText(current) }}</el-descriptions-item>
            <template v-if="isSub">
              <el-descriptions-item label="上级中介">
                <el-button
                  v-if="current.parent_id"
                  link
                  type="primary"
                  @click="switchTo(current.parent_id!)"
                >
                  {{ current.parent_name || "查看" }}
                </el-button>
                <span v-else>-</span>
              </el-descriptions-item>
              <el-descriptions-item label="下级主体类型">{{ subTypeText(current) }}</el-descriptions-item>
            </template>
            <el-descriptions-item label="风险等级">{{ riskText(current) }}</el-descriptions-item>
            <el-descriptions-item label="地区">{{ regionText(current) }}</el-descriptions-item>
            <el-descriptions-item label="所属交易员">{{ current.agent_name || "待分配" }}</el-descriptions-item>
            <el-descriptions-item label="跟进交易员">{{ current.follow_trader || "-" }}</el-descriptions-item>
            <el-descriptions-item label="联系电话">{{ current.phone || "-" }}</el-descriptions-item>
            <el-descriptions-item label="最后更新">{{ formatRelative(current.updated_at) }}</el-descriptions-item>
            <el-descriptions-item label="创建时间" :span="2">{{ formatDateTime(current.created_at) }}</el-descriptions-item>
            <el-descriptions-item label="备注" :span="2">{{ current.remark || "-" }}</el-descriptions-item>
          </el-descriptions>

          <section v-if="!isSub" class="section">
            <h3>状态管理</h3>
            <div class="lifecycle-row">
              <span>合作生命周期</span>
              <el-tag :type="statusTagType[current.customer_status]" effect="light">
                {{ statusText(current) }}
              </el-tag>
              <el-button
                size="small"
                :type="suspended ? 'primary' : 'default'"
                :loading="statusSubmitting"
                @click="toggleCooperation"
              >
                {{ suspended ? "恢复合作" : "暂停合作" }}
              </el-button>
            </div>
            <p class="hint">暂停/恢复会记录操作人、时间与原因，可在「时间线」页签查看。</p>
          </section>

          <section v-if="isIntermediary && current.sub_customers?.length" class="section">
            <h3>下级客户（{{ current.sub_customers.length }}）</h3>
            <div v-for="sub in current.sub_customers" :key="sub.id" class="sub-row">
              <div class="sub-main">
                <strong>{{ sub.name }}</strong>
                <small>{{ sub.customer_code || "无编号" }}{{ sub.sub_type ? ` · ${subTypeText(sub)}` : "" }}</small>
              </div>
              <el-tag :type="statusTagType[sub.customer_status]" effect="light" size="small">
                {{ statusText(sub) }}
              </el-tag>
              <el-button size="small" link type="primary" @click="switchTo(sub)">查看 →</el-button>
            </div>
          </section>
        </el-tab-pane>

        <el-tab-pane label="时间线" name="timeline">
          <div v-loading="eventsLoading" class="timeline-pane">
            <el-timeline v-if="events.length">
              <el-timeline-item
                v-for="event in events"
                :key="event.id"
                :timestamp="`${event.operator_name ? `${event.operator_name} · ` : ''}${formatDateTime(event.created_at)}`"
              >
                <strong>{{ event.title }}</strong>
                <p class="event-detail">{{ event.detail }}</p>
              </el-timeline-item>
            </el-timeline>
            <el-empty v-else-if="!eventsLoading" description="暂无档案事件" />
          </div>
        </el-tab-pane>

        <el-tab-pane label="材料" name="documents">
          <div v-loading="materialsLoading" class="tab-pane-body">
            <template v-if="materials.length">
              <div v-for="material in materials" :key="material.id" class="doc-row">
                <span class="doc-icon">{{ docIcon(material.file.mime_type) }}</span>
                <div class="doc-main">
                  <strong>{{ material.name }}</strong>
                  <small>
                    {{ material.category ? `${material.category} · ` : "" }}v{{ material.version }} ·
                    {{ fileSizeText(material.file.size) }}
                    {{ material.uploader_name ? ` · ${material.uploader_name}` : "" }} ·
                    {{ formatRelative(material.created_at) }}
                  </small>
                </div>
                <el-button size="small" @click="previewMaterial(material)">预览</el-button>
                <el-button size="small" @click="previewMaterial(material, true)">下载</el-button>
              </div>
            </template>
            <el-empty
              v-else-if="!materialsLoading"
              description="暂无归档材料，在材料上传模块归档后会同步到这里"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane label="准入记录" name="applications">
          <div v-loading="applicationsLoading" class="tab-pane-body">
            <template v-if="applications.length">
              <div v-for="app in applications" :key="app.id" class="app-card">
                <div class="app-head">
                  <strong>{{ app.application_no }}</strong>
                  <el-tag :type="accessStatusTagType[app.status]" effect="light" size="small">
                    {{ AccessStatusLabel[app.status] }}
                  </el-tag>
                </div>
                <small class="app-meta">
                  {{ app.scenario_name || "未选业务类型" }}
                  {{ app.channel_code ? ` · ${app.channel_code}` : "" }}
                  · 必填材料 {{ app.completeness.done }}/{{ app.completeness.total }}
                  {{ app.owner_name ? ` · ${app.owner_name}` : "" }}
                  · {{ formatRelative(app.submitted_at || app.updated_at) }}
                </small>
                <p v-if="app.latest_review?.reason" class="app-reason">
                  最近结论：{{ app.latest_review.reason }}
                </p>
              </div>
            </template>
            <el-empty v-else-if="!applicationsLoading" description="暂无准入申请" />
          </div>
        </el-tab-pane>

        <el-tab-pane label="交易与凭证" name="funding" disabled />
      </el-tabs>
      <p class="tabs-hint">「交易与凭证」将随交易订单模块迁移后开放。</p>
    </div>
  </el-drawer>
</template>

<style scoped>
.drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #ebeef5;
  margin-bottom: 8px;
}

.eyebrow {
  color: #ff7a00;
  font-size: 11px;
  letter-spacing: 0.12em;
  margin: 0 0 6px;
}

.drawer-head h2 {
  margin: 0 0 6px;
  font-size: 19px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.sub-line {
  color: #909399;
  margin: 0;
  font-size: 13px;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.drawer-close {
  border: none;
  background: transparent;
  font-size: 22px;
  color: #909399;
  cursor: pointer;
  line-height: 1;
  padding: 2px 6px;
}

.drawer-close:hover {
  color: #303133;
}

.overview-grid :deep(.el-descriptions__label) {
  color: #909399;
}

.section {
  margin-top: 20px;
}

.section h3 {
  font-size: 14px;
  margin: 0 0 10px;
}

.lifecycle-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: #f7f8fa;
  border-radius: 8px;
}

.lifecycle-row > span:first-child {
  color: #606266;
  font-size: 13px;
}

.lifecycle-row .el-button {
  margin-left: auto;
}

.hint {
  color: #909399;
  font-size: 12px;
  margin: 8px 2px 0;
}

.sub-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  margin-bottom: 8px;
}

.sub-main {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.sub-main small {
  color: #909399;
}

.timeline-pane {
  min-height: 160px;
  padding-top: 6px;
}

.tab-pane-body {
  min-height: 160px;
  padding-top: 4px;
}

.doc-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  margin-bottom: 8px;
}

.doc-icon {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: #fff3e6;
  color: #ff7a00;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.doc-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.doc-main strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-main small {
  color: #909399;
}

.app-card {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 8px;
}

.app-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.app-meta {
  color: #909399;
}

.app-reason {
  margin: 6px 0 0;
  font-size: 12px;
  color: #c45656;
}

.event-detail {
  margin: 4px 0 0;
  color: #606266;
  font-size: 13px;
}

.tabs-hint {
  margin: auto 0 0;
  padding-top: 10px;
  color: #c0c4cc;
  font-size: 12px;
}
</style>
