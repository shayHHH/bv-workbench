<script setup lang="ts">
import {
  CustomerKind,
  CustomerStatus,
  CustomerStatusLabel,
  KycItemTypeLabel,
  KycItemValidity,
  MaterialSource,
  ReviewType,
  RiskLevelLabel,
  type CustomerMaterialVO,
  type CustomerVO,
  type FileRef,
  type KycItem,
  type KycScenarioVO,
} from "@bv/shared";
import { Delete, OfficeBuilding, UploadFilled } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
import { useRouter } from "vue-router";
import {
  archiveCustomerMaterials,
  createApplication,
  fetchCustomerMaterials,
  openFilePreview,
  saveApplicationDraft,
  submitApplication,
  uploadFile,
} from "@/api/access";
import { fetchCustomers } from "@/api/customer";
import { fetchActiveScenarios } from "@/api/kyc";
import CustomerCreateDialog from "@/views/customer/CustomerCreateDialog.vue";

const router = useRouter();
const { t } = useI18n();

/* ---------------- 数据 ---------------- */

const scenarios = ref<KycScenarioVO[]>([]);

/** 文件行（本地上传与材料库复用混排，仅保留来源标记） */
interface UploadRow {
  key: string;
  name: string;
  source: "upload" | "library";
  file: FileRef | null;
  libraryMaterialId: string | null;
  libraryMeta: string | null;
  size: number;
  mime: string;
  detected: string;
  /** 关联材料项 item_id */
  mappedItemId: string;
  uploading: boolean;
}

const state = reactive({
  customer: null as CustomerVO | null,
  candidates: [] as CustomerVO[],
  searching: false,
  scenarioId: "",
  channelIndex: 0,
  note: "",
  files: [] as UploadRow[],
  libraryOpen: false,
  libraryItems: [] as CustomerMaterialVO[],
  libraryLoading: false,
  destination: "complianceFx" as "library" | "complianceFx" | "complianceU",
  submitting: false,
});

const createCustomerVisible = ref(false);
const fileInput = ref<HTMLInputElement>();
const dragActive = ref(false);

/* ---------------- 客户 / 业务类型 / 渠道（第 1 区） ---------------- */

async function searchCustomers(query: string) {
  state.searching = true;
  try {
    const result = await fetchCustomers({ keyword: query || undefined, page: 1, page_size: 8 });
    const flat: CustomerVO[] = [];
    for (const item of result.items) {
      flat.push(item);
      for (const sub of item.sub_customers ?? []) flat.push(sub);
    }
    state.candidates = flat.slice(0, 8);
  } finally {
    state.searching = false;
  }
}

function customerLabel(candidate: CustomerVO): string {
  return `${candidate.customer_code || t("access.common.noCode")} - ${candidate.name}`;
}

function selectCustomer(id: string) {
  const found = state.candidates.find(item => item.id === id) ?? null;
  state.customer = found;
  state.libraryItems = [];
  state.files = state.files.filter(row => row.source !== "library");
  if (state.libraryOpen && found) loadLibrary();
}

function onCustomerCreated(customer: CustomerVO) {
  createCustomerVisible.value = false;
  state.candidates = [customer, ...state.candidates];
  state.customer = customer;
  ElMessage.success(t("access.upload.customerSelected", { name: customer.name }));
}

const statusTagType: Record<CustomerStatus, "primary" | "success" | "warning" | "info"> = {
  NEW: "primary",
  ACTIVE: "success",
  DORMANT: "warning",
  SUSPENDED: "info",
};

function customerInitials(name: string): string {
  return /^[a-zA-Z]/.test(name) ? name.slice(0, 2).toUpperCase() : name.slice(0, 1);
}

const selectedScenario = computed(
  () => scenarios.value.find(item => item.id === state.scenarioId) ?? null,
);
const selectedChannel = computed(
  () => selectedScenario.value?.channels[state.channelIndex] ?? null,
);

function relinkAll() {
  const valid = new Set(flatItems.value.map(item => item.item_id));
  for (const row of state.files) {
    if (row.mappedItemId && !valid.has(row.mappedItemId)) row.mappedItemId = "";
  }
  for (const row of state.files) {
    if (!row.mappedItemId) row.mappedItemId = autoLinkItem(row);
  }
}

function onScenarioChange() {
  state.channelIndex = 0;
  relinkAll();
}

function pickChannel(index: number) {
  state.channelIndex = index;
  relinkAll();
}

function channelLabel(name: string): string {
  return /渠道|供应商|专列/.test(name) ? name : t("access.upload.channelSuffix", { name });
}

const restrictionText = computed(() =>
  (selectedChannel.value?.restrictions ?? []).map(item => item.content).join("；"),
);

/** 当前渠道全部材料项拍平（文件行"关联"下拉与核验清单共用） */
const flatItems = computed<KycItem[]>(
  () => selectedChannel.value?.sections.flatMap(section => section.items) ?? [],
);

/* ---------------- 文件（第 2 区） ---------------- */

const ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx";
const ACCEPT_RE = /\.(pdf|jpe?g|png|webp|docx?)$/i;

/** demo detectQuickMaterialType 的正则口径 */
function detectType(name: string): string {
  const text = name.toLowerCase();
  if (/水单|receipt|slip/.test(text)) return "水单";
  if (/流水|statement|bank/.test(text)) return "银行流水";
  if (/地址|address|utility|账单/.test(text)) return "地址证明";
  if (/身份|id|passport|护照|证件|onboard|表格|form/.test(text)) return "身份证明";
  if (/凭证|voucher|proof/.test(text)) return "凭证";
  return "未分类";
}

/** 自动关联规则：识别类型或文件名 与 材料项名称/补充要求 匹配，取第一个未被占用的材料项 */
function autoLinkItem(row: UploadRow): string {
  const used = new Set(state.files.filter(f => f !== row && f.mappedItemId).map(f => f.mappedItemId));
  const lowerName = row.name.toLowerCase();
  const hit = flatItems.value.find(item => {
    if (used.has(item.item_id)) return false;
    const haystack = `${item.item_name}${item.item_description ?? ""}`;
    if (row.detected !== "未分类" && haystack.includes(row.detected)) return true;
    return haystack.toLowerCase().includes(lowerName.replace(/\.[a-z0-9]+$/i, ""));
  });
  return hit?.item_id ?? "";
}

function sizeText(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function extText(row: UploadRow): string {
  const match = row.name.match(/\.([a-zA-Z0-9]+)$/);
  return (match?.[1] ?? t("access.common.extFallback")).toUpperCase().slice(0, 4);
}

async function addFiles(list: FileList | File[]) {
  const files = [...list];
  const accepted = files.filter(file => ACCEPT_RE.test(file.name));
  if (accepted.length < files.length) {
    ElMessage.warning(t("access.upload.fileTypeRejected"));
  }
  for (const file of accepted) {
    if (file.size > 20 * 1024 * 1024) {
      ElMessage.warning(t("access.upload.fileTooLarge", { name: file.name }));
      continue;
    }
    const row: UploadRow = {
      key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      source: "upload",
      file: null,
      libraryMaterialId: null,
      libraryMeta: null,
      size: file.size,
      mime: file.type || "application/octet-stream",
      detected: detectType(file.name),
      mappedItemId: "",
      uploading: true,
    };
    row.mappedItemId = autoLinkItem(row);
    state.files.push(row);
    try {
      row.file = await uploadFile(file);
    } catch {
      state.files = state.files.filter(item => item.key !== row.key);
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

function removeFile(key: string) {
  state.files = state.files.filter(row => row.key !== key);
}

async function previewRow(row: UploadRow) {
  if (!row.file) return;
  try {
    await openFilePreview(row.file);
  } catch {
    /* 错误提示由拦截器处理 */
  }
}

/* ---------------- 客户材料库 ---------------- */

async function toggleLibrary() {
  if (!state.customer) return;
  state.libraryOpen = !state.libraryOpen;
  if (state.libraryOpen && !state.libraryItems.length) await loadLibrary();
}

async function loadLibrary() {
  if (!state.customer) return;
  state.libraryLoading = true;
  try {
    state.libraryItems = await fetchCustomerMaterials(state.customer.id);
  } finally {
    state.libraryLoading = false;
  }
}

function libraryAdded(item: CustomerMaterialVO): boolean {
  return state.files.some(row => row.libraryMaterialId === item.id);
}

function addLibraryItem(item: CustomerMaterialVO) {
  if (libraryAdded(item)) return;
  const row: UploadRow = {
    key: `lib-${item.id}`,
    name: item.name,
    source: "library",
    file: item.file,
    libraryMaterialId: item.id,
    libraryMeta: `${item.category ?? t("access.upload.uncategorized")} · v${item.version}`,
    size: item.file.size,
    mime: item.file.mime_type,
    detected: detectType(item.name),
    mappedItemId: "",
    uploading: false,
  };
  row.mappedItemId = autoLinkItem(row);
  state.files.push(row);
  ElMessage.success(t("access.upload.libraryItemAdded"));
}

/* ---------------- KYC 核验（第 3 区） ---------------- */

const processLines = computed(() => {
  const text = selectedScenario.value?.process_description ?? "";
  return text
    .split(/\n+/)
    .map(line => line.replace(/^\s*\d+[.、]\s*/, "").trim())
    .filter(Boolean);
});

function linkedFiles(item: KycItem): UploadRow[] {
  return state.files.filter(row => row.mappedItemId === item.item_id);
}

function itemReady(item: KycItem): boolean {
  return linkedFiles(item).length > 0;
}

const readyCount = computed(() => flatItems.value.filter(itemReady).length);

function validityText(item: KycItem): string {
  if (item.validity === KycItemValidity.ONE_MONTH) return t("access.upload.validOneMonth");
  if (item.validity === KycItemValidity.THREE_MONTHS) return t("access.upload.validThreeMonths");
  return "";
}

/* ---------------- 提交 ---------------- */

const hasDraft = computed(
  () => !!state.files.length || !!state.customer || !!state.note || state.libraryOpen,
);

const canSubmit = computed(() => !!state.customer && state.files.length > 0 && !state.submitting);

function clearAll() {
  Object.assign(state, {
    customer: null,
    scenarioId: scenarios.value[0]?.id ?? "",
    channelIndex: 0,
    note: "",
    files: [],
    libraryOpen: false,
    libraryItems: [],
    destination: "complianceFx",
  });
}

async function submitAll() {
  if (!state.customer || !state.files.length) return;
  if (state.files.some(row => row.uploading)) {
    ElMessage.warning(t("access.upload.stillUploading"));
    return;
  }
  const itemNameById = new Map(flatItems.value.map(item => [item.item_id, item.item_name]));
  state.submitting = true;
  try {
    const localRows = state.files.filter(row => row.source === "upload" && row.file);
    // 本地上传的文件一律归档进客户材料库（材料库复用的不重复归档）
    if (localRows.length) {
      await archiveCustomerMaterials(state.customer.id, {
        items: localRows.map(row => ({
          name: row.name,
          category: row.mappedItemId ? (itemNameById.get(row.mappedItemId) ?? null) : row.detected,
          file: row.file as FileRef,
        })),
      });
    }

    if (state.destination === "library") {
      ElMessage.success(
        t("access.upload.savedToLibrary", { name: state.customer.name, count: localRows.length }),
      );
      clearAll();
      return;
    }

    if (!selectedScenario.value || !selectedChannel.value) {
      ElMessage.warning(t("access.upload.needScenarioChannel"));
      return;
    }
    const reviewType = state.destination === "complianceU" ? ReviewType.USDT : ReviewType.FX;
    const application = await createApplication(state.customer.id);
    await saveApplicationDraft(application.id, {
      scenario_id: selectedScenario.value.id,
      channel_code: selectedChannel.value.channel_code,
      form: {
        customer_cn_name: state.customer.name,
        customer_en_name: null,
        business_note: state.note || null,
      },
      materials: state.files.map(row => ({
        material_key: row.key,
        requirement_item_id: row.mappedItemId || null,
        name: row.name,
        source: row.source === "library" ? MaterialSource.LIBRARY : MaterialSource.LOCAL_UPLOAD,
        file: row.file,
        library_material_id: row.libraryMaterialId,
      })),
    });
    const submitted = await submitApplication(application.id, reviewType);
    ElMessage.success(
      t("access.upload.submitted", {
        lane: reviewType === ReviewType.USDT ? t("access.upload.laneU") : t("access.upload.laneFx"),
        no: submitted.application_no,
        name: state.customer.name,
      }),
    );
    clearAll();
  } catch {
    /* 错误提示由拦截器处理；已建草稿会出现在审核跟踪可继续处理 */
  } finally {
    state.submitting = false;
  }
}

function viewCustomer() {
  if (!state.customer) return;
  router.push({ path: "/customers", query: { kw: state.customer.customer_code || state.customer.name } });
}

onMounted(async () => {
  scenarios.value = await fetchActiveScenarios();
  state.scenarioId = scenarios.value[0]?.id ?? "";
  searchCustomers("");
});
</script>

<template>
  <div class="mu-page">
    <header class="titlebar">
      <div>
        <p class="eyebrow">BUSINESS ACCESS</p>
        <h1>{{ t("access.upload.title") }}</h1>
        <p class="subtitle">{{ t("access.upload.subtitle") }}</p>
      </div>
      <el-tag type="success" effect="light">{{ t("access.upload.channelStatus") }}</el-tag>
    </header>

    <div class="mu-layout">
    <main class="mu-main">
    <!-- 1. 交易与客户信息 -->
    <section class="card">
      <header class="card-head">
        <h2><i />{{ t("access.upload.step1Title") }}</h2>
        <el-button type="primary" plain @click="createCustomerVisible = true">{{ t("access.upload.createCustomer") }}</el-button>
      </header>

      <div class="pair-grid">
        <div class="field">
          <label>{{ t("access.upload.customerField") }} <em>*</em></label>
          <el-select
            :model-value="state.customer?.id ?? ''"
            filterable
            remote
            clearable
            :remote-method="searchCustomers"
            :loading="state.searching"
            :placeholder="t('access.upload.customerSearchPh')"
            @change="selectCustomer"
            @clear="state.customer = null"
          >
            <el-option
              v-for="candidate in state.candidates"
              :key="candidate.id"
              :value="candidate.id"
              :label="customerLabel(candidate)"
            >
              <span>{{ customerLabel(candidate) }}</span>
              <span class="option-meta">
                {{ candidate.customer_kind === CustomerKind.SUB_CUSTOMER ? `${t("access.upload.subCustomer")}${candidate.parent_name ? `（${candidate.parent_name}）` : ""}` : "" }}
              </span>
            </el-option>
          </el-select>
        </div>
        <div class="field">
          <label>{{ t("access.upload.scenarioField") }} <em>*</em></label>
          <el-select v-model="state.scenarioId" :placeholder="t('access.upload.scenarioPh')" @change="onScenarioChange">
            <el-option
              v-for="scenario in scenarios"
              :key="scenario.id"
              :value="scenario.id"
              :label="`#${scenario.scenario_code} - ${scenario.scenario_name}`"
            />
          </el-select>
        </div>
      </div>

      <!-- 客户信息摘要条 -->
      <div v-if="state.customer" class="customer-strip">
        <span class="avatar">{{ customerInitials(state.customer.name) }}</span>
        <div class="strip-main">
          <div class="strip-title">
            <strong>{{ state.customer.name }}</strong>
            <span class="muted">{{ state.customer.customer_code || t("access.common.noCode") }}</span>
            <el-tag :type="statusTagType[state.customer.customer_status]" size="small" effect="light">
              {{ localizeText(CustomerStatusLabel[state.customer.customer_status]) }}
            </el-tag>
          </div>
          <small class="muted">
            {{ state.customer.agent_name ? t("access.upload.traderName", { name: state.customer.agent_name }) : t("access.upload.traderUnassigned") }}
            {{ state.customer.phone ? ` · ${state.customer.phone}` : "" }}
            {{ state.customer.parent_name ? ` · ${t("access.upload.parentIntermediary", { name: state.customer.parent_name })}` : "" }}
          </small>
        </div>
        <div class="strip-side">
          <el-tag size="small" effect="plain">{{ localizeText(RiskLevelLabel[state.customer.risk_level]) }}</el-tag>
          <el-button link type="primary" size="small" @click="viewCustomer">{{ t("access.upload.viewCustomer") }}</el-button>
        </div>
      </div>

      <div class="field">
        <label>{{ t("access.upload.channelField") }} <em>*</em></label>
        <div v-if="selectedScenario?.channels.length" class="channel-chips">
          <button
            v-for="(channel, index) in selectedScenario.channels"
            :key="channel.channel_code"
            type="button"
            class="channel-chip"
            :class="{ active: index === state.channelIndex }"
            @click="pickChannel(index)"
          >
            <el-icon><OfficeBuilding /></el-icon>
            {{ channelLabel(channel.channel_name) }}
            <i v-if="index === state.channelIndex" class="dot" />
          </button>
        </div>
        <p v-else class="muted">{{ t("access.upload.noChannels") }}</p>
      </div>

      <div v-if="restrictionText" class="restriction-alert">
        <span class="warn-icon">⚠</span>
        <p>
          <strong>{{ t("access.upload.restrictionTitle", { name: channelLabel(selectedChannel!.channel_name) }) }}</strong>
          {{ restrictionText }}
        </p>
      </div>

      <div class="field">
        <label>{{ t("access.upload.noteField") }} <span class="optional">{{ t("access.upload.optional") }}</span></label>
        <el-input
          v-model="state.note"
          type="textarea"
          :rows="2"
          maxlength="1000"
          :placeholder="t('access.upload.notePh')"
        />
      </div>
    </section>

    <!-- 2. 上传合规材料文件 -->
    <section class="card">
      <header class="card-head">
        <h2><i />{{ t("access.upload.step2Title") }}</h2>
        <span class="muted">{{ t("access.upload.acceptHint") }}</span>
      </header>

      <div
        class="dropzone"
        :class="{ active: dragActive }"
        @click="fileInput?.click()"
        @dragover.prevent="dragActive = true"
        @dragleave.prevent="dragActive = false"
        @drop.prevent="onDrop"
      >
        <span class="dz-icon"><el-icon :size="26"><UploadFilled /></el-icon></span>
        <strong>{{ t("access.upload.dropTitle") }}</strong>
        <small>{{ t("access.upload.dropHint") }}</small>
      </div>
      <input ref="fileInput" type="file" multiple :accept="ACCEPT" hidden @change="onFileChange" />

      <!-- 客户材料库复用 -->
      <div class="library-line">
        <el-button link type="primary" :disabled="!state.customer" @click="toggleLibrary">
          {{ state.libraryOpen ? t("access.upload.libraryCollapse") : t("access.upload.libraryExpand") }}
        </el-button>
        <span class="muted">
          {{ state.customer ? t("access.upload.librarySummary", { selected: state.files.filter(row => row.source === "library").length, total: state.libraryItems.length }) : t("access.upload.libraryNeedCustomer") }}
        </span>
      </div>
      <div v-if="state.libraryOpen" v-loading="state.libraryLoading" class="library-list">
        <div v-for="item in state.libraryItems" :key="item.id" class="library-row">
          <span class="doc-icon small">{{ (item.file.original_name.split(".").pop() || t("access.common.extFallback")).toUpperCase().slice(0, 4) }}</span>
          <span class="lib-main">
            <strong>{{ item.name }}</strong>
            <small class="muted">{{ item.category ?? t("access.upload.uncategorized") }} · v{{ item.version }} · {{ sizeText(item.file.size) }}</small>
          </span>
          <el-button size="small" :disabled="libraryAdded(item)" @click="addLibraryItem(item)">
            {{ libraryAdded(item) ? t("access.upload.added") : t("access.upload.add") }}
          </el-button>
        </div>
        <el-empty v-if="!state.libraryLoading && !state.libraryItems.length" :description="t('access.upload.libraryEmpty')" :image-size="50" />
      </div>

      <template v-if="state.files.length">
        <h3 class="received-title">{{ t("access.upload.receivedTitle", { count: state.files.length }) }}</h3>
        <div v-for="row in state.files" :key="row.key" class="file-row">
          <span class="doc-icon" :class="{ pdf: /pdf/i.test(row.mime) || /\.pdf$/i.test(row.name) }">
            {{ extText(row) }}
          </span>
          <span class="file-main" @click="previewRow(row)">
            <strong>{{ row.name }}</strong>
            <small class="muted">
              {{ sizeText(row.size) }}
              <el-tag v-if="row.source === 'library'" size="small" type="warning" effect="plain">{{ t("access.upload.libraryTag") }}</el-tag>
            </small>
          </span>
          <div class="link-select">
            <span class="link-label">{{ t("access.upload.linkLabel") }}</span>
            <el-select v-model="row.mappedItemId" :placeholder="t('access.upload.selectItemPh')" clearable>
              <el-option
                v-for="(item, index) in flatItems"
                :key="item.item_id"
                :value="item.item_id"
                :label="`${index + 1}. ${item.item_name}`"
              />
            </el-select>
          </div>
          <el-button
            class="trash"
            :icon="Delete"
            text
            :loading="row.uploading"
            @click="removeFile(row.key)"
          />
        </div>
      </template>
    </section>

    </main>

    <!-- 右侧 KYC 规则与清单面板（demo 布局） -->
    <aside class="assistant">
      <section class="panel">
        <header class="panel-head">
          <strong>{{ t("access.upload.kycPanelTitle") }}</strong>
          <span>{{ selectedScenario?.scenario_name ?? t("access.upload.noScenario") }}</span>
          <small v-if="selectedScenario">
            #{{ selectedScenario.scenario_code }} ·
            {{ selectedChannel ? t("access.upload.channelSuffix", { name: selectedChannel.channel_name }) : t("access.upload.channelUnbound") }}
          </small>
        </header>

        <div v-if="processLines.length" class="rule-card flow">
          <header><strong>{{ t("access.upload.processTitle") }}</strong><em>{{ t("access.upload.processTag") }}</em></header>
          <ol>
            <li v-for="line in processLines.slice(0, 3)" :key="line">{{ line }}</li>
          </ol>
          <details v-if="processLines.length > 3">
            <summary>{{ t("access.upload.processExpand", { count: processLines.length }) }}</summary>
            <ol start="4">
              <li v-for="line in processLines.slice(3)" :key="line">{{ line }}</li>
            </ol>
          </details>
        </div>

        <div v-if="selectedChannel?.restrictions.length" class="rule-card danger">
          <header>
            <strong>{{ t("access.upload.restrictionCardTitle", { name: selectedChannel.channel_name }) }}</strong>
            <em>{{ t("access.upload.restrictionTag") }}</em>
          </header>
          <ul>
            <li v-for="restriction in selectedChannel.restrictions" :key="restriction.content">
              {{ restriction.content }}
            </li>
          </ul>
        </div>

        <div class="rule-card checklist">
          <header>
            <strong>{{ t("access.upload.checklistTitle") }}</strong>
            <em>{{ readyCount }}/{{ flatItems.length }}</em>
          </header>
          <el-progress
            :percentage="flatItems.length ? Math.round((readyCount / flatItems.length) * 100) : 0"
            :show-text="false"
            class="check-progress"
          />
          <div v-for="(item, index) in flatItems" :key="item.item_id" class="check-item">
            <div class="check-head">
              <strong>{{ index + 1 }}. {{ item.item_name }}</strong>
              <el-tag
                size="small"
                effect="light"
                :type="itemReady(item) ? 'success' : item.required ? 'warning' : 'info'"
              >
                {{ itemReady(item) ? t("access.upload.tagLinked") : item.required ? t("access.upload.tagRequired") : t("access.upload.tagOptional") }}
              </el-tag>
            </div>
            <small class="muted">{{ item.item_description || t("access.upload.itemDescFallback") }}</small>
            <small class="check-type">
              {{ localizeText(KycItemTypeLabel[item.item_type]) }}{{ validityText(item) ? ` · ${validityText(item)}` : "" }}
              <template v-if="linkedFiles(item).length">
                · {{ t("access.upload.linkedFiles", { names: linkedFiles(item).map(row => row.name).join("、") }) }}
              </template>
            </small>
          </div>
          <p v-if="!flatItems.length" class="check-empty">{{ t("access.upload.noItems") }}</p>
        </div>
      </section>
    </aside>
    </div>

    <!-- 底部提交条 -->
    <footer class="submit-dock">
      <div class="modes">
        <span class="mode-label">{{ t("access.upload.modeLabel") }}</span>
        <el-radio-group v-model="state.destination">
          <el-radio value="library">{{ t("access.upload.modeLibrary") }}</el-radio>
          <el-radio value="complianceFx">{{ t("access.upload.modeFx") }}</el-radio>
          <el-radio value="complianceU">{{ t("access.upload.modeU") }}</el-radio>
        </el-radio-group>
      </div>
      <div class="dock-actions">
        <el-button :disabled="!hasDraft" @click="clearAll">{{ t("access.common.cancel") }}</el-button>
        <el-button type="primary" :disabled="!canSubmit" :loading="state.submitting" @click="submitAll">
          {{ t("access.upload.submitConfirm") }}
        </el-button>
      </div>
    </footer>

    <CustomerCreateDialog v-model="createCustomerVisible" @created="onCustomerCreated" />
  </div>
</template>

<style scoped>
.mu-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 双栏：主流程 + 右侧 KYC 规则与清单（demo 布局） */
.mu-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 16px;
  align-items: start;
}

.mu-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.assistant {
  position: sticky;
  top: 0;
}

.panel {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 14px 16px;
}

.panel-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 12px;
}

.panel-head span {
  font-size: 13px;
  color: #303133;
}

.panel-head small {
  color: #909399;
}

.rule-card {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
  font-size: 13px;
}

.rule-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.rule-card em {
  font-style: normal;
  font-size: 11px;
  color: #909399;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 1px 6px;
}

.rule-card.danger {
  border-color: #fde2e2;
  background: #fef6f6;
}

.rule-card.danger em {
  color: #c45656;
  border-color: #fbc4c4;
}

.rule-card ol,
.rule-card ul {
  margin: 0;
  padding-left: 18px;
  color: #606266;
}

.rule-card li {
  margin-bottom: 4px;
  line-height: 1.5;
}

.rule-card details summary {
  color: #ff7a00;
  cursor: pointer;
  font-size: 12px;
  margin: 4px 0;
}

.checklist .check-item {
  border-top: 1px dashed #ebeef5;
  padding: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.check-empty {
  color: #909399;
  margin: 8px 0 0;
}

@media (max-width: 1100px) {
  .mu-layout {
    grid-template-columns: 1fr;
  }

  .assistant {
    position: static;
  }
}

.titlebar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
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

.card {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 12px;
  padding: 20px 24px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.card-head h2 {
  margin: 0;
  font-size: 17px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.card-head h2 i {
  width: 5px;
  height: 18px;
  border-radius: 3px;
  background: #ff7a00;
}

.pair-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 14px;
}

.field {
  margin-bottom: 14px;
}

.pair-grid .field {
  margin-bottom: 0;
}

.field label {
  display: block;
  font-size: 13px;
  color: #606266;
  margin-bottom: 6px;
}

.field label em {
  color: #c45656;
  font-style: normal;
}

.optional {
  color: #909399;
}

.field :deep(.el-select) {
  width: 100%;
}

.option-meta {
  float: right;
  color: #909399;
  font-size: 12px;
}

/* 客户信息摘要条 */
.customer-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #f7f8fa;
  border-radius: 10px;
  padding: 12px 16px;
  margin-bottom: 14px;
}

.avatar {
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 50%;
  background: #eef1f6;
  color: #4a5261;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.strip-main {
  flex: 1;
  min-width: 0;
}

.strip-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.strip-side {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
}

.muted {
  color: #909399;
  font-size: 13px;
}

/* 渠道卡片 */
.channel-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.channel-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #dcdfe6;
  background: #fff;
  border-radius: 10px;
  padding: 10px 18px;
  cursor: pointer;
  font-size: 14px;
  color: #606266;
}

.channel-chip.active {
  border-color: #ff7a00;
  color: #c2660a;
  background: #fff8f1;
  font-weight: 600;
}

.channel-chip .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ff7a00;
}

/* 渠道限制警示条 */
.restriction-alert {
  display: flex;
  gap: 10px;
  background: #fdf6ec;
  border: 1px solid #faecd8;
  border-radius: 10px;
  padding: 12px 16px;
  margin-bottom: 14px;
}

.warn-icon {
  color: #c2660a;
  flex: none;
}

.restriction-alert p {
  margin: 0;
  color: #8a5a00;
  line-height: 1.7;
  font-size: 13px;
}

.restriction-alert strong {
  color: #c2660a;
}

/* 上传区 */
.dropzone {
  border: 1.5px dashed #dcdfe6;
  border-radius: 12px;
  padding: 44px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.dropzone.active,
.dropzone:hover {
  border-color: #ff7a00;
  background: #fffaf5;
}

.dz-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #fff3e6;
  color: #ff7a00;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 6px;
}

.dropzone strong {
  font-size: 16px;
}

.dropzone small {
  color: #909399;
}

.library-line {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 10px 0 0;
}

.library-list {
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 10px 14px;
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 56px;
}

.library-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.lib-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.received-title {
  font-size: 14px;
  margin: 18px 0 10px;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 14px;
  background: #fafbfc;
  border: 1px solid #f0f2f5;
  border-radius: 10px;
  padding: 12px 16px;
  margin-bottom: 10px;
}

.doc-icon {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #ebeef5;
  color: #909399;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.doc-icon.pdf {
  color: #e0492f;
}

.doc-icon.small {
  width: 34px;
  height: 34px;
  border-radius: 8px;
}

.file-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  cursor: pointer;
}

.file-main strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-main small {
  display: flex;
  align-items: center;
  gap: 6px;
}

.link-select {
  flex: none;
  display: flex;
  align-items: center;
  gap: 0;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.link-select .link-label {
  padding: 0 10px;
  color: #606266;
  font-size: 13px;
  flex: none;
}

.link-select :deep(.el-select) {
  width: 200px;
}

.link-select :deep(.el-select__wrapper) {
  box-shadow: none !important;
  border-radius: 0;
}

.trash {
  color: #909399;
}

.trash:hover {
  color: #c45656;
}

/* KYC 核验 */
.check-progress {
  margin-bottom: 12px;
}

.process-details {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 12px;
  font-size: 13px;
}

.process-details summary {
  color: #ff7a00;
  cursor: pointer;
}

.process-details ol {
  margin: 8px 0 0;
  padding-left: 18px;
  color: #606266;
}

.process-details li {
  margin-bottom: 4px;
  line-height: 1.6;
}

.check-item {
  border-top: 1px dashed #ebeef5;
  padding: 10px 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.check-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.check-type {
  color: #c2660a;
  font-size: 12px;
}

/* 提交条 */
.submit-dock {
  position: sticky;
  bottom: 0;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 12px;
  padding: 14px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  box-shadow: 0 -4px 16px rgba(31, 36, 48, 0.06);
}

.modes {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.mode-label {
  color: #303133;
  font-size: 14px;
  font-weight: 600;
}

.dock-actions {
  flex: none;
  display: flex;
  gap: 8px;
}
</style>
