<script setup lang="ts">
import {
  KycChannelTheme,
  KycChannelThemeLabel,
  KycItemType,
  KycItemValidity,
  KycRestrictionType,
  type KycChannel,
  type KycScenarioVO,
} from "@bv/shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import {
  createScenario,
  deleteScenario,
  fetchAllScenarios,
  publishScenario,
  updateScenario,
} from "@/api/kyc";

/** 可编辑草稿（对选中场景的深拷贝，保存时整体提交） */
interface EditableScenario {
  id: string | null;
  scenario_code: string;
  scenario_name: string;
  process_description: string;
  channels: KycChannel[];
}

const scenarios = ref<KycScenarioVO[]>([]);
const loading = ref(false);
const saving = ref(false);
const searchQuery = ref("");
const selectedId = ref<string | null>(null);
const channelIndex = ref(0);
const draft = ref<EditableScenario | null>(null);
const lastSavedAt = ref("");

const filtered = computed(() =>
  scenarios.value.filter(scenario =>
    `${scenario.scenario_code}${scenario.scenario_name}`
      .toLowerCase()
      .includes(searchQuery.value.trim().toLowerCase()),
  ),
);

const metrics = computed(() => ({
  scenarios: scenarios.value.length,
  channels: scenarios.value.reduce((n, s) => n + s.channels.length, 0),
  items: scenarios.value.reduce(
    (n, s) => n + s.channels.reduce((m, c) => m + c.sections.reduce((k, sec) => k + sec.items.length, 0), 0),
    0,
  ),
}));

const currentChannel = computed(() => draft.value?.channels[channelIndex.value] ?? null);

function itemCountOf(scenario: KycScenarioVO): number {
  return scenario.channels.reduce(
    (n, channel) => n + channel.sections.reduce((m, section) => m + section.items.length, 0),
    0,
  );
}

function select(scenario: KycScenarioVO) {
  selectedId.value = scenario.id;
  channelIndex.value = 0;
  draft.value = {
    id: scenario.id,
    scenario_code: scenario.scenario_code,
    scenario_name: scenario.scenario_name,
    process_description: scenario.process_description ?? "",
    channels: JSON.parse(JSON.stringify(scenario.channels)),
  };
}

async function load(keepSelection = false) {
  loading.value = true;
  try {
    scenarios.value = await fetchAllScenarios();
    if (keepSelection && selectedId.value) {
      const current = scenarios.value.find(s => s.id === selectedId.value);
      if (current) {
        const keptChannel = channelIndex.value;
        select(current);
        channelIndex.value = Math.min(keptChannel, current.channels.length - 1);
        return;
      }
    }
    if (scenarios.value.length) select(scenarios.value[0]);
    else draft.value = null;
  } finally {
    loading.value = false;
  }
}

/* ---------------- 场景弹窗（新建模式 / 编辑信息） ---------------- */

const scenarioDialog = reactive({
  visible: false,
  mode: "new" as "new" | "edit",
  code: "",
  name: "",
  process: "",
});

function openScenarioDialog(mode: "new" | "edit") {
  scenarioDialog.mode = mode;
  scenarioDialog.code = mode === "edit" ? (draft.value?.scenario_code ?? "") : "";
  scenarioDialog.name = mode === "edit" ? (draft.value?.scenario_name ?? "") : "";
  scenarioDialog.process = mode === "edit" ? (draft.value?.process_description ?? "") : "";
  scenarioDialog.visible = true;
}

async function confirmScenarioDialog() {
  if (!scenarioDialog.code.trim() || !scenarioDialog.name.trim()) {
    ElMessage.warning("请填写序号和业务类型名称");
    return;
  }
  if (scenarioDialog.mode === "new") {
    try {
      const created = await createScenario({
        scenario_code: scenarioDialog.code.trim(),
        scenario_name: scenarioDialog.name.trim(),
        process_description: scenarioDialog.process.trim() || null,
        channels: [],
      });
      scenarioDialog.visible = false;
      await load();
      const fresh = scenarios.value.find(s => s.id === created.id);
      if (fresh) select(fresh);
      ElMessage.success(`已新建业务模式 #${created.scenario_code}`);
    } catch {
      /* 提示由拦截器处理 */
    }
    return;
  }
  if (draft.value) {
    draft.value.scenario_code = scenarioDialog.code.trim();
    draft.value.scenario_name = scenarioDialog.name.trim();
    draft.value.process_description = scenarioDialog.process;
    scenarioDialog.visible = false;
  }
}

async function removeScenario() {
  if (!draft.value?.id) return;
  try {
    await ElMessageBox.confirm(
      `删除业务模式 #${draft.value.scenario_code} · ${draft.value.scenario_name}？删除后材料上传页不再展示该业务类型。`,
      "删除模式",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" },
    );
    await deleteScenario(draft.value.id);
    ElMessage.success("业务模式已删除");
    selectedId.value = null;
    await load();
  } catch {
    /* 取消或接口错误 */
  }
}

/* ---------------- 渠道弹窗（新增 / 编辑当前渠道） ---------------- */

const channelDialog = reactive({
  visible: false,
  mode: "new" as "new" | "edit",
  name: "",
  theme: KycChannelTheme.BLUE as KycChannelTheme,
  firstSection: "",
  restrictions: [] as Array<{ type: string; content: string }>,
});

function openChannelDialog(mode: "new" | "edit") {
  channelDialog.mode = mode;
  if (mode === "edit" && currentChannel.value) {
    channelDialog.name = currentChannel.value.channel_name;
    channelDialog.theme = currentChannel.value.theme;
    channelDialog.restrictions = JSON.parse(JSON.stringify(currentChannel.value.restrictions));
  } else {
    channelDialog.name = "";
    channelDialog.theme = KycChannelTheme.BLUE;
    channelDialog.firstSection = "";
    channelDialog.restrictions = [];
  }
  channelDialog.visible = true;
}

function confirmChannelDialog() {
  if (!draft.value) return;
  const name = channelDialog.name.trim();
  if (!name) {
    ElMessage.warning("请输入渠道名称");
    return;
  }
  const restrictions = channelDialog.restrictions
    .filter(item => item.content.trim())
    .map(item => ({ type: item.type as KycRestrictionType, content: item.content.trim() }));
  if (channelDialog.mode === "edit" && currentChannel.value) {
    currentChannel.value.channel_name = name;
    currentChannel.value.theme = channelDialog.theme;
    currentChannel.value.restrictions = restrictions;
  } else {
    const duplicated = draft.value.channels.some(c => c.channel_name === name);
    if (duplicated) {
      ElMessage.warning("同一业务模式下渠道名称不能重复");
      return;
    }
    draft.value.channels.push({
      channel_code: `CH_${Date.now().toString(36).toUpperCase()}`,
      channel_name: name,
      theme: channelDialog.theme,
      restrictions,
      sections: [
        {
          section_name: channelDialog.firstSection.trim() || `${name} 基础收集材料`,
          items: [],
        },
      ],
    });
    channelIndex.value = draft.value.channels.length - 1;
  }
  channelDialog.visible = false;
}

async function removeChannel() {
  if (!draft.value || !currentChannel.value) return;
  try {
    await ElMessageBox.confirm(`删除渠道「${currentChannel.value.channel_name}」及其材料清单？`, "删除渠道", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
    draft.value.channels.splice(channelIndex.value, 1);
    channelIndex.value = Math.max(0, channelIndex.value - 1);
  } catch {
    /* 取消 */
  }
}

/* ---------------- 材料模块 / 材料项 ---------------- */

function addSection() {
  currentChannel.value?.sections.push({ section_name: "新材料模块", items: [] });
}

function removeSection(index: number) {
  currentChannel.value?.sections.splice(index, 1);
}

function addItem(sectionIndex: number) {
  currentChannel.value?.sections[sectionIndex].items.push({
    item_id: `KYC-${Math.random().toString(36).slice(2, 9)}`,
    item_name: "",
    item_description: null,
    item_type: KycItemType.FILE,
    required: true,
    validity: KycItemValidity.NONE,
  });
}

function removeItem(sectionIndex: number, itemIndex: number) {
  currentChannel.value?.sections[sectionIndex].items.splice(itemIndex, 1);
}

/* ---------------- 保存并发布 ---------------- */

async function saveAndPublish() {
  const current = draft.value;
  if (!current) return;
  for (const channel of current.channels) {
    for (const section of channel.sections) {
      if (section.items.some(item => !item.item_name.trim())) {
        ElMessage.warning(`「${channel.channel_name} / ${section.section_name}」存在未命名材料项`);
        return;
      }
    }
  }
  saving.value = true;
  try {
    const payload = {
      scenario_code: current.scenario_code,
      scenario_name: current.scenario_name,
      process_description: current.process_description.trim() || null,
      channels: current.channels,
    };
    const saved = current.id
      ? await updateScenario(current.id, payload)
      : await createScenario(payload);
    await publishScenario(saved.id);
    lastSavedAt.value = new Date().toLocaleString("zh-CN", { hour12: false });
    ElMessage.success(`合规规则配置已保存并发布：#${saved.scenario_code} ${saved.scenario_name}`);
    selectedId.value = saved.id;
    await load(true);
  } catch {
    /* 提示由拦截器处理 */
  } finally {
    saving.value = false;
  }
}

const themeDot: Record<string, string> = {
  red: "#c45656",
  blue: "#4a7dbd",
  teal: "#2f9e8f",
  amber: "#c2660a",
};

onMounted(() => load());
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <p class="eyebrow">COMPLIANCE ROUTING ENGINE</p>
        <h1>合规材料与渠道路由配置中心</h1>
        <p class="subtitle">以业务场景为入口，维护渠道路由、限制规则、材料模块和前台提交要求。</p>
      </div>
      <div class="head-actions">
        <span class="muted">上一次保存时间：{{ lastSavedAt || "--" }}</span>
        <el-button type="primary" :loading="saving" :disabled="!draft" @click="saveAndPublish">
          保存并发布新版本
        </el-button>
      </div>
    </header>

    <div class="metrics">
      <div class="metric"><strong>{{ metrics.scenarios }}</strong><span>业务模式</span></div>
      <div class="metric"><strong>{{ metrics.channels }}</strong><span>绑定渠道</span></div>
      <div class="metric"><strong>{{ metrics.items }}</strong><span>材料/字段项</span></div>
    </div>

    <div class="shell">
      <!-- 左：业务类型配置库 -->
      <aside class="library" v-loading="loading">
        <div class="library-head">
          <strong>业务类型配置库</strong>
          <el-button size="small" type="primary" plain @click="openScenarioDialog('new')">＋ 新建模式</el-button>
        </div>
        <el-input v-model="searchQuery" placeholder="搜索业务类型或序号" clearable size="small" class="library-search" />
        <div class="scenario-list">
          <button
            v-for="scenario in filtered"
            :key="scenario.id"
            type="button"
            class="scenario-card"
            :class="{ active: scenario.id === selectedId }"
            @click="select(scenario)"
          >
            <span class="card-top">
              <em>#{{ scenario.scenario_code }}</em>
              <small>渠道 {{ scenario.channels.length }}</small>
            </span>
            <strong>{{ scenario.scenario_name }}</strong>
            <small class="card-meta">
              {{ itemCountOf(scenario) }} 项材料 ·
              {{ scenario.channels.length ? scenario.channels.map(c => c.channel_name).join(" / ") : "未绑定渠道" }}
            </small>
          </button>
          <el-empty v-if="!loading && !filtered.length" description="未找到匹配业务类型" :image-size="60" />
        </div>
      </aside>

      <!-- 右：编辑器 -->
      <main v-if="draft" class="editor">
        <div class="scenario-head">
          <span class="code-pill">#{{ draft.scenario_code }}</span>
          <el-input v-model="draft.scenario_name" class="name-input" placeholder="业务类型名称" />
          <div class="scenario-actions">
            <el-button size="small" @click="openScenarioDialog('edit')">编辑信息</el-button>
            <el-button size="small" type="danger" plain :disabled="!draft.id" @click="removeScenario">
              删除模式
            </el-button>
          </div>
        </div>
        <p class="scenario-sub">请定义该业务交易模式下的整体流转逻辑与各渠道收集规则</p>

        <div class="field-block">
          <label>业务流程、时效与约束说明（面向业务人员与合规预检，材料上传页"业务审核要点"引用）</label>
          <el-input v-model="draft.process_description" type="textarea" :rows="6" maxlength="2000" />
        </div>

        <div class="matrix-head">
          <div>
            <strong>通道渠道与材料收集规则 Matrix</strong>
            <small>同一业务模式可绑定多个渠道，每个渠道维护独立限制和材料模块。</small>
          </div>
          <div class="matrix-actions">
            <el-button size="small" :disabled="!currentChannel" @click="openChannelDialog('edit')">编辑当前渠道</el-button>
            <el-button size="small" :disabled="!currentChannel" @click="removeChannel">删除当前渠道</el-button>
            <el-button size="small" type="primary" plain @click="openChannelDialog('new')">＋ 新增绑定渠道</el-button>
          </div>
        </div>

        <div v-if="draft.channels.length" class="channel-tabs">
          <button
            v-for="(channel, index) in draft.channels"
            :key="channel.channel_code"
            type="button"
            class="channel-tab"
            :class="{ active: index === channelIndex }"
            @click="channelIndex = index"
          >
            <i :style="{ background: themeDot[channel.theme] }" />
            {{ channel.channel_name }} 渠道材料库
            <small>{{ channel.sections.reduce((n, s) => n + s.items.length, 0) }} 项材料</small>
          </button>
        </div>
        <el-empty v-else description="该业务模式暂未绑定渠道，点击「＋ 新增绑定渠道」开始配置" :image-size="70" />

        <template v-if="currentChannel">
          <div v-if="currentChannel.restrictions.length" class="restriction-strip">
            <strong>渠道限制</strong>
            <span v-for="restriction in currentChannel.restrictions" :key="restriction.content">
              {{ restriction.content }}
            </span>
          </div>

          <section v-for="(section, sIndex) in currentChannel.sections" :key="sIndex" class="material-section">
            <header>
              <span class="section-no">模块 {{ sIndex + 1 }}</span>
              <el-input v-model="section.section_name" class="section-name" size="small" placeholder="模块名称" />
              <el-button size="small" type="primary" plain @click="addItem(sIndex)">
                ＋ 添加需要收集的材料/字段
              </el-button>
              <el-button size="small" text type="danger" @click="removeSection(sIndex)">⌫ 删除模块</el-button>
            </header>
            <div v-for="(item, iIndex) in section.items" :key="item.item_id" class="item-row">
              <span class="drag">⋮⋮</span>
              <el-input v-model="item.item_name" size="small" class="item-name" placeholder="材料名称" />
              <el-input
                :model-value="item.item_description ?? ''"
                size="small"
                class="item-desc"
                placeholder="补充要求"
                @update:model-value="(value: string) => (item.item_description = value || null)"
              />
              <el-select v-model="item.item_type" size="small" class="item-type">
                <el-option :value="KycItemType.FILE" label="文件上传（PDF/图片）" />
                <el-option :value="KycItemType.TEXT" label="文本输入框" />
                <el-option :value="KycItemType.BANK_ACCOUNT" label="银行账户多字段" />
              </el-select>
              <el-checkbox v-model="item.required" size="small">{{ item.required ? "必填" : "选填" }}</el-checkbox>
              <el-select v-model="item.validity" size="small" class="item-validity">
                <el-option :value="KycItemValidity.NONE" label="无有效期限制" />
                <el-option :value="KycItemValidity.ONE_MONTH" label="需 1 个月内有效" />
                <el-option :value="KycItemValidity.THREE_MONTHS" label="需 3 个月内有效" />
              </el-select>
              <el-button size="small" text type="danger" @click="removeItem(sIndex, iIndex)">⌫</el-button>
            </div>
            <p v-if="!section.items.length" class="item-empty">该模块暂无材料项</p>
          </section>
          <el-button class="add-section" plain @click="addSection">＋ 新增材料模块</el-button>
        </template>
      </main>
      <main v-else class="editor">
        <el-empty description="左侧选择或新建一个业务模式开始配置" />
      </main>
    </div>

    <!-- 场景弹窗 -->
    <el-dialog
      v-model="scenarioDialog.visible"
      :title="scenarioDialog.mode === 'new' ? '新建业务模式' : '编辑业务模式'"
      width="520px"
      :close-on-click-modal="false"
    >
      <el-form label-position="top">
        <el-form-item label="序号" required>
          <el-input v-model="scenarioDialog.code" placeholder="如 22 或 16B" maxlength="30" />
          <div class="hint">显示为 #序号，不能与现有业务模式重复。</div>
        </el-form-item>
        <el-form-item label="业务类型名称" required>
          <el-input v-model="scenarioDialog.name" maxlength="50" />
        </el-form-item>
        <el-form-item label="业务流程、时效与约束说明">
          <el-input v-model="scenarioDialog.process" type="textarea" :rows="4" maxlength="2000" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="scenarioDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="confirmScenarioDialog">
          {{ scenarioDialog.mode === "new" ? "创建" : "保存" }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 渠道弹窗 -->
    <el-dialog
      v-model="channelDialog.visible"
      :title="channelDialog.mode === 'new' ? '新增绑定渠道' : '编辑渠道信息'"
      width="560px"
      :close-on-click-modal="false"
    >
      <el-form label-position="top">
        <div class="dialog-grid">
          <el-form-item label="渠道名称" required>
            <el-input v-model="channelDialog.name" maxlength="50" />
            <div class="hint">同一业务模式下渠道名称不能重复。</div>
          </el-form-item>
          <el-form-item label="标识颜色">
            <el-select v-model="channelDialog.theme" style="width: 100%">
              <el-option
                v-for="(label, value) in KycChannelThemeLabel"
                :key="value"
                :value="value"
                :label="label"
              />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item v-if="channelDialog.mode === 'new'" label="首个材料模块名称">
          <el-input v-model="channelDialog.firstSection" placeholder="留空默认「{渠道名} 基础收集材料」" maxlength="50" />
        </el-form-item>
        <el-form-item label="渠道限制条目">
          <div v-for="(restriction, index) in channelDialog.restrictions" :key="index" class="restriction-row">
            <el-select v-model="restriction.type" class="restriction-type" size="small">
              <el-option :value="KycRestrictionType.BANK_BAN" label="银行禁令" />
              <el-option :value="KycRestrictionType.SPECIAL_PROOF" label="特殊证明" />
            </el-select>
            <el-input v-model="restriction.content" size="small" placeholder="限制说明" maxlength="500" />
            <el-button size="small" text type="danger" @click="channelDialog.restrictions.splice(index, 1)">⌫</el-button>
          </div>
          <el-button
            size="small"
            plain
            @click="channelDialog.restrictions.push({ type: KycRestrictionType.SPECIAL_PROOF, content: '' })"
          >
            ＋ 添加限制条目
          </el-button>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="channelDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="confirmChannelDialog">
          {{ channelDialog.mode === "new" ? "新增渠道" : "保存" }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 14px;
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

.head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}

.muted {
  color: #909399;
  font-size: 13px;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(3, 180px);
  gap: 12px;
  margin-bottom: 14px;
}

.metric {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 10px 14px;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.metric strong {
  font-size: 20px;
}

.metric span {
  color: #909399;
  font-size: 13px;
}

.shell {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.library {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 14px;
}

.library-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.library-search {
  margin-bottom: 10px;
}

.scenario-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 640px;
  overflow-y: auto;
}

.scenario-card {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.scenario-card.active {
  border-color: #ff7a00;
  background: #fffaf5;
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-top em {
  font-style: normal;
  color: #ff7a00;
  font-weight: 700;
  font-size: 12px;
}

.card-top small,
.card-meta {
  color: #909399;
  font-size: 12px;
}

.editor {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 16px 18px;
}

.scenario-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.code-pill {
  flex: none;
  background: #231c17;
  color: #ff7a00;
  font-weight: 700;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 13px;
}

.name-input {
  max-width: 420px;
}

.scenario-actions {
  margin-left: auto;
  flex: none;
}

.scenario-sub {
  color: #909399;
  font-size: 13px;
  margin: 6px 0 14px;
}

.field-block {
  margin-bottom: 16px;
}

.field-block label {
  display: block;
  font-size: 13px;
  color: #606266;
  margin-bottom: 6px;
}

.matrix-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 10px;
}

.matrix-head small {
  display: block;
  color: #909399;
}

.matrix-actions {
  flex: none;
}

.channel-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.channel-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  background: #fff;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 13px;
}

.channel-tab i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.channel-tab small {
  color: #909399;
}

.channel-tab.active {
  border-color: #ff7a00;
  background: #fffaf5;
  font-weight: 600;
}

.restriction-strip {
  border: 1px solid #fde2e2;
  background: #fef6f6;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}

.restriction-strip strong {
  color: #c45656;
}

.material-section {
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 12px;
}

.material-section > header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.section-no {
  flex: none;
  color: #909399;
  font-size: 12px;
}

.section-name {
  max-width: 260px;
}

.material-section > header .el-button:last-child {
  margin-left: auto;
}

.item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.drag {
  color: #c0c4cc;
  cursor: default;
  font-size: 12px;
}

.item-name {
  width: 200px;
}

.item-desc {
  flex: 1;
  min-width: 120px;
}

.item-type {
  width: 175px;
  flex: none;
}

.item-validity {
  width: 150px;
  flex: none;
}

.item-empty {
  color: #c0c4cc;
  font-size: 13px;
  margin: 4px 0;
}

.add-section {
  width: 100%;
  border-style: dashed;
}

.dialog-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 14px;
}

.hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}

.restriction-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  width: 100%;
}

.restriction-type {
  width: 120px;
  flex: none;
}
</style>
