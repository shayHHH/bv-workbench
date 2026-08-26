<script setup lang="ts">
import {
  CustomerKind,
  CustomerStatusLabel,
  KycItemTypeLabel,
  KycItemValidity,
  MaterialSource,
  ReviewType,
  type CustomerMaterialVO,
  type CustomerStatus,
  type CustomerVO,
  type FileRef,
  type KycItem,
  type KycScenarioVO,
} from "@bv/shared";
import { ElMessage } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
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

/* ---------------- 数据 ---------------- */

const scenarios = ref<KycScenarioVO[]>([]);

/** 本地文件行（demo：本地上传与材料库复用混排，仅保留来源标记） */
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
  customerQuery: "",
  customer: null as CustomerVO | null,
  candidates: [] as CustomerVO[],
  searching: false,
  scenarioId: "",
  channelIndex: 0,
  cnName: "",
  enName: "",
  note: "",
  files: [] as UploadRow[],
  libraryOpen: false,
  libraryItems: [] as CustomerMaterialVO[],
  libraryLoading: false,
  destination: "library" as "library" | "complianceFx" | "complianceU",
  submitting: false,
});

const createCustomerVisible = ref(false);
const fileInput = ref<HTMLInputElement>();
const dragActive = ref(false);

/* ---------------- 客户选择（STEP 1） ---------------- */

async function searchCustomers(query: string) {
  state.customerQuery = query;
  state.searching = true;
  try {
    const result = await fetchCustomers({ keyword: query || undefined, page: 1, page_size: 8 });
    // 中介的下级客户拍平进候选（demo uploadCustomerEntries 行为）
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

function selectCustomer(id: string) {
  const found = state.candidates.find(item => item.id === id) ?? null;
  state.customer = found;
  state.libraryItems = [];
  // 切换客户清空已复用的材料库文件（demo clearQuickLibrarySelections）
  state.files = state.files.filter(row => row.source !== "library");
  if (state.libraryOpen && found) loadLibrary();
}

function onCustomerCreated(customer: CustomerVO) {
  createCustomerVisible.value = false;
  state.candidates = [customer, ...state.candidates];
  state.customer = customer;
  ElMessage.success(`已选入新客户：${customer.name}`);
}

const customerStatusText = computed(() =>
  state.customer ? CustomerStatusLabel[state.customer.customer_status as CustomerStatus] : "",
);

/* ---------------- 业务类型 / 渠道（STEP 2/3） ---------------- */

const selectedScenario = computed(
  () => scenarios.value.find(item => item.id === state.scenarioId) ?? null,
);
const selectedChannel = computed(
  () => selectedScenario.value?.channels[state.channelIndex] ?? null,
);

function onScenarioChange() {
  state.channelIndex = 0;
  // 渠道清单变化后，清理失效的材料项关联
  const valid = new Set(flatItems.value.map(item => item.item_id));
  for (const row of state.files) {
    if (row.mappedItemId && !valid.has(row.mappedItemId)) row.mappedItemId = "";
  }
}

function pickChannel(index: number) {
  state.channelIndex = index;
  const valid = new Set(flatItems.value.map(item => item.item_id));
  for (const row of state.files) {
    if (row.mappedItemId && !valid.has(row.mappedItemId)) row.mappedItemId = "";
  }
}

/** 当前渠道全部材料项拍平（文件行"关联材料类型"下拉与 KYC 助手共用） */
const flatItems = computed<KycItem[]>(
  () => selectedChannel.value?.sections.flatMap(section => section.items) ?? [],
);

/* ---------------- 文件（STEP 5） ---------------- */

const ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx";
const ACCEPT_RE = /\.(pdf|jpe?g|png|webp|docx?)$/i;

/** demo detectQuickMaterialType 的正则口径 */
function detectType(name: string): string {
  const text = name.toLowerCase();
  if (/水单|receipt|slip/.test(text)) return "水单";
  if (/流水|statement|bank/.test(text)) return "银行流水";
  if (/地址|address|utility|账单/.test(text)) return "地址证明";
  if (/身份|id|passport|护照|证件/.test(text)) return "身份证明";
  if (/凭证|voucher|proof/.test(text)) return "凭证";
  return "未分类";
}

function sizeText(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function extIcon(row: UploadRow): string {
  if (row.source === "library") return "LIB";
  const match = row.name.match(/\.([a-zA-Z0-9]+)$/);
  return (match?.[1] ?? "FILE").toUpperCase().slice(0, 4);
}

async function addFiles(list: FileList | File[]) {
  const files = [...list];
  const accepted = files.filter(file => ACCEPT_RE.test(file.name));
  if (accepted.length < files.length) {
    ElMessage.warning("部分文件未加入：仅支持图片、PDF 和 Word 文件");
  }
  for (const file of accepted) {
    if (file.size > 20 * 1024 * 1024) {
      ElMessage.warning(`${file.name} 超过 20MB，未加入`);
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
    state.files.push(row);
    try {
      row.file = await uploadFile(file);
    } catch {
      state.files = state.files.filter(item => item.key !== row.key);
    } finally {
      row.uploading = false;
    }
  }
  if (accepted.length) ElMessage.success(`本批次新增 ${accepted.length} 个文件`);
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
  state.files.push({
    key: `lib-${item.id}`,
    name: item.name,
    source: "library",
    file: item.file,
    libraryMaterialId: item.id,
    libraryMeta: `${item.category ?? "未分类"} · v${item.version}`,
    size: item.file.size,
    mime: item.file.mime_type,
    detected: detectType(item.name),
    mappedItemId: "",
    uploading: false,
  });
  ElMessage.success("已添加材料库材料");
}

const libraryHint = computed(() => {
  if (!state.customer) return "先选择客户后可查看材料库。";
  const used = state.files.filter(row => row.source === "library").length;
  if (used) return `已复用 ${used} 份，可在下方调整关联材料项。`;
  return `从 ${state.customer.name} 的历史材料中复用，加入后可预览、删除并关联当前 KYC 材料项。`;
});

/* ---------------- KYC 助手 ---------------- */

const processLines = computed(() => {
  const text = selectedScenario.value?.process_description ?? "";
  return text
    .split(/\n+/)
    .map(line => line.replace(/^\s*\d+[.、]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
});

/** demo itemReady：已关联该项，或识别类型被材料项名称/补充要求包含 */
function itemReady(item: KycItem): boolean {
  return state.files.some(row => {
    if (row.mappedItemId === item.item_id) return true;
    if (row.detected === "未分类") return false;
    return (
      item.item_name.includes(row.detected) ||
      (item.item_description ?? "").includes(row.detected)
    );
  });
}

const readyCount = computed(() => flatItems.value.filter(itemReady).length);

function validityText(item: KycItem): string {
  if (item.validity === KycItemValidity.ONE_MONTH) return "1个月内有效";
  if (item.validity === KycItemValidity.THREE_MONTHS) return "3个月内有效";
  return "";
}

/* ---------------- 提交坞 ---------------- */

const hasDraft = computed(
  () =>
    !!state.files.length ||
    !!state.customer ||
    !!state.note ||
    !!state.cnName ||
    !!state.enName ||
    state.libraryOpen,
);

const canSubmit = computed(() => !!state.customer && state.files.length > 0 && !state.submitting);

function clearAll() {
  Object.assign(state, {
    customerQuery: "",
    customer: null,
    scenarioId: scenarios.value[0]?.id ?? "",
    channelIndex: 0,
    cnName: "",
    enName: "",
    note: "",
    files: [],
    libraryOpen: false,
    libraryItems: [],
    destination: "library",
  });
}

async function submitAll() {
  if (!state.customer || !state.files.length) return;
  const uploading = state.files.some(row => row.uploading);
  if (uploading) {
    ElMessage.warning("仍有文件在上传中，请稍候");
    return;
  }
  const itemNameById = new Map(flatItems.value.map(item => [item.item_id, item.item_name]));
  state.submitting = true;
  try {
    const localRows = state.files.filter(row => row.source === "upload" && row.file);
    // demo：本地上传的文件一律归档进客户材料库（材料库复用的不重复归档）
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
        `已保存到客户材料库：${state.customer.name} · ${localRows.length} 个文件，可在客户管理查看归档`,
      );
      clearAll();
      return;
    }

    if (!selectedScenario.value || !selectedChannel.value) {
      ElMessage.warning("提交合规前请选择业务类型和渠道");
      return;
    }
    const reviewType = state.destination === "complianceU" ? ReviewType.USDT : ReviewType.FX;
    const application = await createApplication(state.customer.id);
    await saveApplicationDraft(application.id, {
      scenario_id: selectedScenario.value.id,
      channel_code: selectedChannel.value.channel_code,
      form: {
        customer_cn_name: state.cnName || null,
        customer_en_name: state.enName || null,
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
      `已提交到合规（${reviewType === ReviewType.USDT ? "U相关" : "找换"}）：${submitted.application_no} · ${state.customer.name}，可在「材料与补件」跟进`,
    );
    clearAll();
  } catch {
    /* 错误提示由拦截器处理；已建的草稿会出现在工单列表可继续处理 */
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
        <h1>准入材料与合规单据上传</h1>
        <p class="subtitle">按五步完成：选择客户 → 业务类型 → 渠道 → 客户信息 → 上传材料，右侧同步校验 KYC 清单。</p>
      </div>
      <el-tag type="success" effect="light">合规通道状态：双向通畅</el-tag>
    </header>

    <div class="workspace">
      <main class="steps">
        <!-- STEP 1 选择客户 -->
        <section class="step">
          <header>
            <div>
              <h3><i>1</i>选择客户</h3>
              <small>输入客户编号或名称，从下拉列表中选择</small>
            </div>
            <div class="step-aside">
              <template v-if="state.customer">
                <el-tag size="small" effect="light">{{ customerStatusText }}</el-tag>
                <el-button link type="primary" @click="viewCustomer">查看客户 →</el-button>
              </template>
              <el-tag v-else-if="state.customerQuery && !state.candidates.length" type="danger" size="small">
                未匹配到记录
              </el-tag>
              <el-button v-else link type="primary" @click="createCustomerVisible = true">
                ＋ 新建客户
              </el-button>
            </div>
          </header>
          <el-select
            :model-value="state.customer?.id ?? ''"
            filterable
            remote
            clearable
            :remote-method="searchCustomers"
            :loading="state.searching"
            placeholder="输入客户编号如 20001 或公司名"
            style="width: 100%"
            @change="selectCustomer"
            @clear="state.customer = null"
          >
            <el-option
              v-for="candidate in state.candidates"
              :key="candidate.id"
              :value="candidate.id"
              :label="`${candidate.name} (${candidate.customer_code || '无编号'})`"
            >
              <span>{{ candidate.name }}</span>
              <span class="option-meta">
                {{ candidate.customer_code || "无编号" }}
                {{ candidate.customer_kind === CustomerKind.SUB_CUSTOMER ? ` · 中介下级${candidate.parent_name ? `（${candidate.parent_name}）` : ""}` : "" }}
              </span>
            </el-option>
          </el-select>
        </section>

        <!-- STEP 2 业务类型 -->
        <section class="step">
          <header>
            <div>
              <h3><i>2</i>选择业务类型</h3>
              <small>决定适用的 KYC 规则与材料清单</small>
            </div>
          </header>
          <el-select v-model="state.scenarioId" style="width: 100%" @change="onScenarioChange">
            <el-option
              v-for="scenario in scenarios"
              :key="scenario.id"
              :value="scenario.id"
              :label="`#${scenario.scenario_code} · ${scenario.scenario_name}`"
            />
          </el-select>
        </section>

        <!-- STEP 3 渠道 -->
        <section class="step">
          <header>
            <div>
              <h3><i>3</i>选择渠道</h3>
              <small>该业务类型绑定 {{ selectedScenario?.channels.length ?? 0 }} 个渠道</small>
            </div>
          </header>
          <div v-if="selectedScenario?.channels.length" class="channel-chips">
            <button
              v-for="(channel, index) in selectedScenario.channels"
              :key="channel.channel_code"
              type="button"
              class="chip"
              :class="[{ active: index === state.channelIndex }, `theme-${channel.theme}`]"
              @click="pickChannel(index)"
            >
              {{ channel.channel_name }}
            </button>
          </div>
          <p v-else class="channel-empty">该业务类型暂无绑定渠道</p>
        </section>

        <!-- STEP 4 客户信息 -->
        <section class="step">
          <header>
            <div>
              <h3><i>4</i>客户信息与业务说明</h3>
              <small>选填，用于合规审核参考</small>
            </div>
          </header>
          <div class="field-grid">
            <div class="field">
              <label>客户中文姓名</label>
              <el-input v-model="state.cnName" placeholder="例如 郑凯文" maxlength="100" />
            </div>
            <div class="field">
              <label>客户英文姓名</label>
              <el-input v-model="state.enName" placeholder="例如 KAIVEN CHENG" maxlength="100" />
            </div>
            <div class="field">
              <label>业务说明 / 风险备注</label>
              <el-input v-model="state.note" placeholder="填写本次材料说明或合规关注事项" maxlength="1000" />
            </div>
          </div>
        </section>

        <!-- STEP 5 上传材料 -->
        <section class="step">
          <header>
            <div>
              <h3><i>5</i>上传材料</h3>
              <small>支持图片、PDF 和 Word，可拖拽</small>
            </div>
            <div class="step-aside muted">
              {{ state.files.length ? `${state.files.length} 个文件已就绪` : "等待选择文件" }}
            </div>
          </header>

          <div
            class="dropzone"
            :class="{ active: dragActive }"
            @click="fileInput?.click()"
            @dragover.prevent="dragActive = true"
            @dragleave.prevent="dragActive = false"
            @drop.prevent="onDrop"
          >
            <span class="dz-icon">⇧</span>
            <strong>把文件拖拽到这里，或点击选择文件</strong>
            <small>文件上传后可预览，并可关联 KYC 材料项</small>
          </div>
          <input ref="fileInput" type="file" multiple :accept="ACCEPT" hidden @change="onFileChange" />

          <!-- 客户材料库 -->
          <div class="library">
            <button class="library-toggle" type="button" :disabled="!state.customer" @click="toggleLibrary">
              <span class="lib-icon">▦</span>
              <span class="lib-main">
                <strong>客户材料库</strong>
                <small>{{ libraryHint }}</small>
              </span>
              <span class="lib-meta">
                {{
                  state.customer
                    ? `已选 ${state.files.filter(row => row.source === "library").length} · ${state.libraryItems.length} 份可选`
                    : "未选择客户"
                }}
              </span>
              <span class="lib-action">{{ state.libraryOpen ? "收起材料库" : "从材料库添加" }}</span>
            </button>
            <div v-if="state.libraryOpen" v-loading="state.libraryLoading" class="library-list">
              <div v-for="item in state.libraryItems" :key="item.id" class="library-row">
                <span class="doc-icon">{{ (item.file.original_name.split(".").pop() || "LIB").toUpperCase().slice(0, 4) }}</span>
                <span class="lib-row-main">
                  <strong>{{ item.name }}</strong>
                  <small>{{ item.category ?? "未分类" }} · v{{ item.version }} · {{ sizeText(item.file.size) }}</small>
                </span>
                <el-button size="small" :disabled="libraryAdded(item)" @click="addLibraryItem(item)">
                  {{ libraryAdded(item) ? "已添加" : "添加" }}
                </el-button>
              </div>
              <el-empty
                v-if="!state.libraryLoading && !state.libraryItems.length"
                description="该客户暂无归档材料"
                :image-size="60"
              />
            </div>
          </div>

          <!-- 文件列表 -->
          <div v-for="row in state.files" :key="row.key" class="file-row">
            <span class="doc-icon">{{ extIcon(row) }}</span>
            <span class="file-main">
              <strong>{{ row.name }}</strong>
              <small>
                <el-tag size="small" :type="row.source === 'library' ? 'warning' : 'info'" effect="plain">
                  {{ row.source === "library" ? "材料库" : "本地上传" }}
                </el-tag>
                {{ row.source === "library" ? row.libraryMeta : `${sizeText(row.size)} · ${row.mime}` }}
                · {{ row.detected }}
              </small>
            </span>
            <el-button size="small" :loading="row.uploading" @click="previewRow(row)">预览</el-button>
            <el-select
              v-model="row.mappedItemId"
              class="map-select"
              placeholder="关联材料类型"
              clearable
              size="small"
            >
              <el-option
                v-for="(item, index) in flatItems"
                :key="item.item_id"
                :value="item.item_id"
                :label="`${index + 1}. ${item.item_name}`"
              />
            </el-select>
            <button class="remove" type="button" @click="removeFile(row.key)">×</button>
          </div>
        </section>
      </main>

      <!-- 右侧 KYC 助手 -->
      <aside class="assistant">
        <section class="panel">
          <header class="panel-head">
            <strong>KYC 规则与清单</strong>
            <span>{{ selectedScenario?.scenario_name ?? "暂无可用业务类型配置" }}</span>
            <small v-if="selectedScenario">
              #{{ selectedScenario.scenario_code }} ·
              {{ selectedChannel ? `${selectedChannel.channel_name} 渠道` : "未绑定" }}
            </small>
          </header>

          <div v-if="processLines.length" class="rule-card flow">
            <header><strong>业务审核要点</strong><em>规范</em></header>
            <ol>
              <li v-for="line in processLines.slice(0, 3)" :key="line">{{ line }}</li>
            </ol>
            <details v-if="processLines.length > 3">
              <summary>展开完整流程（共 {{ processLines.length }} 步）</summary>
              <ol start="4">
                <li v-for="line in processLines.slice(3)" :key="line">{{ line }}</li>
              </ol>
            </details>
          </div>

          <div v-if="selectedChannel?.restrictions.length" class="rule-card danger">
            <header>
              <strong>{{ selectedChannel.channel_name }} 渠道限制提醒</strong>
              <em>严格拦截</em>
            </header>
            <ul>
              <li v-for="restriction in selectedChannel.restrictions" :key="restriction.content">
                {{ restriction.content }}
              </li>
            </ul>
          </div>

          <div class="rule-card checklist">
            <header>
              <strong>材料完整度动态核验</strong>
              <em>{{ readyCount }}/{{ flatItems.length }}</em>
            </header>
            <el-progress
              :percentage="flatItems.length ? Math.round((readyCount / flatItems.length) * 100) : 0"
              :show-text="false"
            />
            <div v-for="(item, index) in flatItems" :key="item.item_id" class="check-item">
              <div class="check-head">
                <strong>{{ index + 1 }}. {{ item.item_name }}</strong>
                <el-tag
                  size="small"
                  effect="light"
                  :type="itemReady(item) ? 'success' : item.required ? 'warning' : 'info'"
                >
                  {{ itemReady(item) ? "已就绪" : item.required ? "必须" : "选填" }}
                </el-tag>
              </div>
              <small>{{ item.item_description || "按渠道要求提交清晰完整资料。" }}</small>
              <small class="check-type">
                {{ KycItemTypeLabel[item.item_type] }}{{ validityText(item) ? ` · ${validityText(item)}` : "" }}
              </small>
            </div>
            <p v-if="!flatItems.length" class="check-empty">当前渠道暂无材料要求</p>
          </div>
        </section>
      </aside>
    </div>

    <!-- 底部提交坞 -->
    <footer class="submit-dock">
      <div class="modes">
        <span class="mode-label">选择提交模式：</span>
        <el-radio-group v-model="state.destination">
          <el-radio value="library">
            <strong>保存客户材料库</strong><small>仅归档文件</small>
          </el-radio>
          <el-radio value="complianceFx">
            <strong>提交到合规（找换）</strong><small>生成合规审核记录</small>
          </el-radio>
          <el-radio value="complianceU">
            <strong>提交到合规（U相关）</strong><small>生成 U 相关审核记录</small>
          </el-radio>
        </el-radio-group>
      </div>
      <div class="dock-actions">
        <el-button :disabled="!hasDraft" @click="clearAll">取消</el-button>
        <el-button type="primary" :disabled="!canSubmit" :loading="state.submitting" @click="submitAll">
          确认并提交
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
  min-height: 100%;
}

.titlebar {
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

.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 16px;
  align-items: start;
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.step {
  background: #fff;
  border-radius: 10px;
  padding: 16px 18px;
  border: 1px solid #ebeef5;
}

.step > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}

.step h3 {
  margin: 0 0 2px;
  font-size: 15px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.step h3 i {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff3e6;
  color: #ff7a00;
  font-style: normal;
  font-size: 13px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.step small {
  color: #909399;
}

.step-aside {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.step-aside.muted {
  color: #909399;
  font-size: 13px;
}

.option-meta {
  float: right;
  color: #909399;
  font-size: 12px;
}

.channel-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  border: 1px solid #dcdfe6;
  background: #fff;
  border-radius: 999px;
  padding: 6px 16px;
  cursor: pointer;
  font-size: 13px;
  color: #606266;
}

.chip.active {
  border-color: #ff7a00;
  color: #c2660a;
  background: #fff3e6;
  font-weight: 600;
}

.channel-empty {
  color: #909399;
  margin: 0;
  font-size: 13px;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.field label {
  display: block;
  font-size: 13px;
  color: #606266;
  margin-bottom: 6px;
}

.dropzone {
  border: 1.5px dashed #dcdfe6;
  border-radius: 10px;
  padding: 26px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  margin-bottom: 12px;
  transition: border-color 0.15s, background 0.15s;
}

.dropzone.active,
.dropzone:hover {
  border-color: #ff7a00;
  background: #fffaf5;
}

.dz-icon {
  font-size: 22px;
  color: #ff7a00;
}

.dropzone small {
  color: #909399;
}

.library {
  border: 1px solid #ebeef5;
  border-radius: 10px;
  margin-bottom: 12px;
  overflow: hidden;
}

.library-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: #fafbfc;
  border: none;
  cursor: pointer;
  text-align: left;
}

.library-toggle:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.lib-icon {
  color: #ff7a00;
  font-size: 16px;
}

.lib-main {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.lib-main small {
  color: #909399;
}

.lib-meta {
  color: #909399;
  font-size: 12px;
}

.lib-action {
  color: #ff7a00;
  font-size: 13px;
  font-weight: 600;
}

.library-list {
  padding: 8px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 60px;
}

.library-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.lib-row-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.lib-row-main small {
  color: #909399;
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

.file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  margin-bottom: 8px;
}

.file-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.file-main strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-main small {
  color: #909399;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.map-select {
  width: 190px;
  flex: none;
}

.remove {
  border: none;
  background: transparent;
  font-size: 18px;
  color: #909399;
  cursor: pointer;
  padding: 2px 6px;
}

.remove:hover {
  color: #c45656;
}

/* 右侧助手 */
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

.check-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.check-item small {
  color: #909399;
  line-height: 1.5;
}

.check-type {
  color: #c2660a !important;
}

.check-empty {
  color: #909399;
  margin: 8px 0 0;
}

/* 提交坞 */
.submit-dock {
  position: sticky;
  bottom: 0;
  margin-top: 16px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 12px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  box-shadow: 0 -4px 16px rgba(31, 36, 48, 0.06);
}

.modes {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.mode-label {
  color: #606266;
  font-size: 13px;
}

.modes :deep(.el-radio) {
  margin-right: 18px;
  height: auto;
}

.modes :deep(.el-radio__label) {
  display: inline-flex;
  flex-direction: column;
  line-height: 1.3;
}

.modes small {
  color: #909399;
  font-weight: normal;
}

.dock-actions {
  flex: none;
  display: flex;
  gap: 8px;
}
</style>
