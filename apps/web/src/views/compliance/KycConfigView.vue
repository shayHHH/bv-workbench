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
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
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

const { t } = useI18n();
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
    ElMessage.warning(t("compliance.kycConfig.codeNameRequired"));
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
      ElMessage.success(t("compliance.kycConfig.created", { code: created.scenario_code }));
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
      t("compliance.kycConfig.deleteConfirm", { code: draft.value.scenario_code, name: draft.value.scenario_name }),
      t("compliance.kycConfig.deleteTitle"),
      {
        type: "warning",
        confirmButtonText: t("compliance.kycConfig.confirmDelete"),
        cancelButtonText: t("compliance.kycConfig.cancel"),
      },
    );
    await deleteScenario(draft.value.id);
    ElMessage.success(t("compliance.kycConfig.deleted"));
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
    ElMessage.warning(t("compliance.kycConfig.channelNameRequired"));
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
      ElMessage.warning(t("compliance.kycConfig.channelNameDup"));
      return;
    }
    draft.value.channels.push({
      channel_code: `CH_${Date.now().toString(36).toUpperCase()}`,
      channel_name: name,
      theme: channelDialog.theme,
      restrictions,
      sections: [
        {
          section_name: channelDialog.firstSection.trim() || t("compliance.kycConfig.defaultSection", { name }),
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
    await ElMessageBox.confirm(
      t("compliance.kycConfig.channelDeleteConfirm", { name: currentChannel.value.channel_name }),
      t("compliance.kycConfig.channelDeleteTitle"),
      {
        type: "warning",
        confirmButtonText: t("compliance.kycConfig.confirmDelete"),
        cancelButtonText: t("compliance.kycConfig.cancel"),
      },
    );
    draft.value.channels.splice(channelIndex.value, 1);
    channelIndex.value = Math.max(0, channelIndex.value - 1);
  } catch {
    /* 取消 */
  }
}

/* ---------------- 材料模块 / 材料项 ---------------- */

function addSection() {
  currentChannel.value?.sections.push({ section_name: t("compliance.kycConfig.newSection"), items: [] });
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
        ElMessage.warning(t("compliance.kycConfig.unnamedItem", { channel: channel.channel_name, section: section.section_name }));
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
    ElMessage.success(t("compliance.kycConfig.saved", { code: saved.scenario_code, name: saved.scenario_name }));
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
        <p class="eyebrow">{{ t("compliance.kycConfig.eyebrow") }}</p>
        <h1>{{ t("compliance.kycConfig.title") }}</h1>
        <p class="subtitle">{{ t("compliance.kycConfig.subtitle") }}</p>
      </div>
      <div class="head-actions">
        <span class="muted">{{ t("compliance.kycConfig.lastSaved", { time: lastSavedAt || "--" }) }}</span>
        <el-button type="primary" :loading="saving" :disabled="!draft" @click="saveAndPublish">
          {{ t("compliance.kycConfig.saveBtn") }}
        </el-button>
      </div>
    </header>

    <div class="metrics">
      <div class="metric"><strong>{{ metrics.scenarios }}</strong><span>{{ t("compliance.kycConfig.mScenarios") }}</span></div>
      <div class="metric"><strong>{{ metrics.channels }}</strong><span>{{ t("compliance.kycConfig.mChannels") }}</span></div>
      <div class="metric"><strong>{{ metrics.items }}</strong><span>{{ t("compliance.kycConfig.mItems") }}</span></div>
    </div>

    <div class="shell">
      <!-- 左：业务类型配置库 -->
      <aside class="library" v-loading="loading">
        <div class="library-head">
          <strong>{{ t("compliance.kycConfig.libraryTitle") }}</strong>
          <el-button size="small" type="primary" plain @click="openScenarioDialog('new')">{{ t("compliance.kycConfig.newScenario") }}</el-button>
        </div>
        <el-input v-model="searchQuery" :placeholder="t('compliance.kycConfig.searchPh')" clearable size="small" class="library-search" />
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
              <small>{{ t("compliance.kycConfig.cardChannels", { n: scenario.channels.length }) }}</small>
            </span>
            <strong>{{ scenario.scenario_name }}</strong>
            <small class="card-meta">
              {{ t("compliance.kycConfig.cardItems", { n: itemCountOf(scenario) }) }}
              {{ scenario.channels.length ? scenario.channels.map(c => c.channel_name).join(" / ") : t("compliance.kycConfig.noChannels") }}
            </small>
          </button>
          <el-empty v-if="!loading && !filtered.length" :description="t('compliance.kycConfig.libraryEmpty')" :image-size="60" />
        </div>
      </aside>

      <!-- 右：编辑器 -->
      <main v-if="draft" class="editor">
        <div class="scenario-head">
          <span class="code-pill">#{{ draft.scenario_code }}</span>
          <el-input v-model="draft.scenario_name" class="name-input" :placeholder="t('compliance.kycConfig.namePh')" />
          <div class="scenario-actions">
            <el-button size="small" @click="openScenarioDialog('edit')">{{ t("compliance.kycConfig.editInfo") }}</el-button>
            <el-button size="small" type="danger" plain :disabled="!draft.id" @click="removeScenario">
              {{ t("compliance.kycConfig.deleteScenario") }}
            </el-button>
          </div>
        </div>
        <p class="scenario-sub">{{ t("compliance.kycConfig.scenarioSub") }}</p>

        <div class="field-block">
          <label>{{ t("compliance.kycConfig.processLabel") }}</label>
          <el-input v-model="draft.process_description" type="textarea" :rows="6" maxlength="2000" />
        </div>

        <div class="matrix-head">
          <div>
            <strong>{{ t("compliance.kycConfig.matrixTitle") }}</strong>
            <small>{{ t("compliance.kycConfig.matrixSub") }}</small>
          </div>
          <div class="matrix-actions">
            <el-button size="small" :disabled="!currentChannel" @click="openChannelDialog('edit')">{{ t("compliance.kycConfig.editChannel") }}</el-button>
            <el-button size="small" :disabled="!currentChannel" @click="removeChannel">{{ t("compliance.kycConfig.deleteChannel") }}</el-button>
            <el-button size="small" type="primary" plain @click="openChannelDialog('new')">{{ t("compliance.kycConfig.addChannel") }}</el-button>
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
            {{ t("compliance.kycConfig.channelTab", { name: channel.channel_name }) }}
            <small>{{ t("compliance.kycConfig.channelTabItems", { n: channel.sections.reduce((n, s) => n + s.items.length, 0) }) }}</small>
          </button>
        </div>
        <el-empty v-else :description="t('compliance.kycConfig.channelsEmpty')" :image-size="70" />

        <template v-if="currentChannel">
          <div v-if="currentChannel.restrictions.length" class="restriction-strip">
            <strong>{{ t("compliance.kycConfig.restrictionsTitle") }}</strong>
            <span v-for="restriction in currentChannel.restrictions" :key="restriction.content">
              {{ restriction.content }}
            </span>
          </div>

          <section v-for="(section, sIndex) in currentChannel.sections" :key="sIndex" class="material-section">
            <header>
              <span class="section-no">{{ t("compliance.kycConfig.sectionNo", { n: sIndex + 1 }) }}</span>
              <el-input v-model="section.section_name" class="section-name" size="small" :placeholder="t('compliance.kycConfig.sectionNamePh')" />
              <el-button size="small" type="primary" plain @click="addItem(sIndex)">
                {{ t("compliance.kycConfig.addItem") }}
              </el-button>
              <el-button size="small" text type="danger" @click="removeSection(sIndex)">{{ t("compliance.kycConfig.removeSection") }}</el-button>
            </header>
            <div v-for="(item, iIndex) in section.items" :key="item.item_id" class="item-row">
              <span class="drag">⋮⋮</span>
              <el-input v-model="item.item_name" size="small" class="item-name" :placeholder="t('compliance.kycConfig.itemNamePh')" />
              <el-input
                :model-value="item.item_description ?? ''"
                size="small"
                class="item-desc"
                :placeholder="t('compliance.kycConfig.itemDescPh')"
                @update:model-value="(value: string) => (item.item_description = value || null)"
              />
              <el-select v-model="item.item_type" size="small" class="item-type">
                <el-option :value="KycItemType.FILE" :label="t('compliance.kycConfig.typeFile')" />
                <el-option :value="KycItemType.TEXT" :label="t('compliance.kycConfig.typeText')" />
                <el-option :value="KycItemType.BANK_ACCOUNT" :label="t('compliance.kycConfig.typeBankAccount')" />
              </el-select>
              <el-checkbox v-model="item.required" size="small">{{ item.required ? t("compliance.kycConfig.required") : t("compliance.kycConfig.optional") }}</el-checkbox>
              <el-select v-model="item.validity" size="small" class="item-validity">
                <el-option :value="KycItemValidity.NONE" :label="t('compliance.kycConfig.validityNone')" />
                <el-option :value="KycItemValidity.ONE_MONTH" :label="t('compliance.kycConfig.validityOneMonth')" />
                <el-option :value="KycItemValidity.THREE_MONTHS" :label="t('compliance.kycConfig.validityThreeMonths')" />
              </el-select>
              <el-button size="small" text type="danger" @click="removeItem(sIndex, iIndex)">⌫</el-button>
            </div>
            <p v-if="!section.items.length" class="item-empty">{{ t("compliance.kycConfig.sectionEmpty") }}</p>
          </section>
          <el-button class="add-section" plain @click="addSection">{{ t("compliance.kycConfig.addSection") }}</el-button>
        </template>
      </main>
      <main v-else class="editor">
        <el-empty :description="t('compliance.kycConfig.editorEmpty')" />
      </main>
    </div>

    <!-- 场景弹窗 -->
    <el-dialog
      v-model="scenarioDialog.visible"
      :title="scenarioDialog.mode === 'new' ? t('compliance.kycConfig.dialogNewTitle') : t('compliance.kycConfig.dialogEditTitle')"
      width="520px"
      :close-on-click-modal="false"
    >
      <el-form label-position="top">
        <el-form-item :label="t('compliance.kycConfig.codeLabel')" required>
          <el-input v-model="scenarioDialog.code" :placeholder="t('compliance.kycConfig.codePh')" maxlength="30" />
          <div class="hint">{{ t("compliance.kycConfig.codeHint") }}</div>
        </el-form-item>
        <el-form-item :label="t('compliance.kycConfig.nameLabel')" required>
          <el-input v-model="scenarioDialog.name" maxlength="50" />
        </el-form-item>
        <el-form-item :label="t('compliance.kycConfig.processDialogLabel')">
          <el-input v-model="scenarioDialog.process" type="textarea" :rows="4" maxlength="2000" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="scenarioDialog.visible = false">{{ t("compliance.kycConfig.cancel") }}</el-button>
        <el-button type="primary" @click="confirmScenarioDialog">
          {{ scenarioDialog.mode === "new" ? t("compliance.kycConfig.create") : t("compliance.kycConfig.save") }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 渠道弹窗 -->
    <el-dialog
      v-model="channelDialog.visible"
      :title="channelDialog.mode === 'new' ? t('compliance.kycConfig.channelNewTitle') : t('compliance.kycConfig.channelEditTitle')"
      width="560px"
      :close-on-click-modal="false"
    >
      <el-form label-position="top">
        <div class="dialog-grid">
          <el-form-item :label="t('compliance.kycConfig.channelNameLabel')" required>
            <el-input v-model="channelDialog.name" maxlength="50" />
            <div class="hint">{{ t("compliance.kycConfig.channelNameHint") }}</div>
          </el-form-item>
          <el-form-item :label="t('compliance.kycConfig.themeLabel')">
            <el-select v-model="channelDialog.theme" style="width: 100%">
              <template #prefix>
                <i class="theme-dot" :style="{ background: themeDot[channelDialog.theme] }" />
              </template>
              <el-option
                v-for="(label, value) in KycChannelThemeLabel"
                :key="value"
                :value="value"
                :label="localizeText(label)"
              >
                <span class="theme-option">
                  <i class="theme-dot" :style="{ background: themeDot[value] }" />{{ localizeText(label) }}
                </span>
              </el-option>
            </el-select>
          </el-form-item>
        </div>
        <el-form-item v-if="channelDialog.mode === 'new'" :label="t('compliance.kycConfig.firstSectionLabel')">
          <el-input v-model="channelDialog.firstSection" :placeholder="t('compliance.kycConfig.firstSectionPh')" maxlength="50" />
        </el-form-item>
        <el-form-item :label="t('compliance.kycConfig.restrictionLabel')">
          <div v-for="(restriction, index) in channelDialog.restrictions" :key="index" class="restriction-row">
            <el-select v-model="restriction.type" class="restriction-type" size="small">
              <el-option :value="KycRestrictionType.BANK_BAN" :label="t('compliance.kycConfig.restrictionBankBan')" />
              <el-option :value="KycRestrictionType.SPECIAL_PROOF" :label="t('compliance.kycConfig.restrictionSpecialProof')" />
            </el-select>
            <el-input v-model="restriction.content" size="small" :placeholder="t('compliance.kycConfig.restrictionContentPh')" maxlength="500" />
            <el-button size="small" text type="danger" @click="channelDialog.restrictions.splice(index, 1)">⌫</el-button>
          </div>
          <el-button
            size="small"
            plain
            @click="channelDialog.restrictions.push({ type: KycRestrictionType.SPECIAL_PROOF, content: '' })"
          >
            {{ t("compliance.kycConfig.addRestriction") }}
          </el-button>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="channelDialog.visible = false">{{ t("compliance.kycConfig.cancel") }}</el-button>
        <el-button type="primary" @click="confirmChannelDialog">
          {{ channelDialog.mode === "new" ? t("compliance.kycConfig.addChannelConfirm") : t("compliance.kycConfig.save") }}
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
  color: var(--color-primary);
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

.head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}

.muted {
  color: var(--color-text-muted);
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
  border: 1px solid var(--color-border);
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
  color: var(--color-text-muted);
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
  border: 1px solid var(--color-border);
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
  border: 1px solid var(--color-border);
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
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-top em {
  font-style: normal;
  color: var(--color-primary);
  font-weight: 700;
  font-size: 12px;
}

.card-top small,
.card-meta {
  color: var(--color-text-muted);
  font-size: 12px;
}

.editor {
  background: #fff;
  border: 1px solid var(--color-border);
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
  color: var(--color-primary);
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
  color: var(--color-text-muted);
  font-size: 13px;
  margin: 6px 0 14px;
}

.field-block {
  margin-bottom: 16px;
}

.field-block label {
  display: block;
  font-size: 13px;
  color: var(--color-text-secondary);
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
  color: var(--color-text-muted);
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
  border: 1px solid var(--color-border);
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
  color: var(--color-text-muted);
}

.channel-tab.active {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
  font-weight: 600;
}

.restriction-strip {
  border: 1px solid var(--color-danger-bg);
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
  color: var(--color-danger);
}

.material-section {
  border: 1px solid var(--color-border);
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
  color: var(--color-text-muted);
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
  color: var(--color-text-placeholder);
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
  color: var(--color-text-placeholder);
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
  color: var(--color-text-muted);
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

.theme-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
  flex: none;
}

.theme-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
</style>
