<script setup lang="ts">
import {
  KycItemType,
  KycItemTypeLabel,
  KycScenarioStatusLabel,
  type KycScenarioVO,
  type SaveKycScenarioInput,
} from "@bv/shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus } from "@element-plus/icons-vue";
import { onMounted, reactive, ref } from "vue";
import {
  createScenario,
  deleteScenario,
  fetchAllScenarios,
  publishScenario,
  updateScenario,
} from "@/api/kyc";

const scenarios = ref<KycScenarioVO[]>([]);
const loading = ref(false);
const saving = ref(false);
const selectedId = ref<string | null>(null);

/** 编辑区草稿（选中场景的可编辑副本；id 为空表示新建未保存） */
const editor = reactive({
  id: "" as string,
  is_builtin: false,
  status: "DRAFT" as string,
  form: null as SaveKycScenarioInput | null,
});

function cloneToEditor(scenario: KycScenarioVO | null) {
  if (!scenario) {
    editor.id = "";
    editor.is_builtin = false;
    editor.status = "DRAFT";
    editor.form = {
      scenario_code: "",
      scenario_name: "",
      process_description: "",
      channels: [],
      sections: [{ section_name: "身份材料", items: [] }],
    };
    return;
  }
  editor.id = scenario.id;
  editor.is_builtin = scenario.is_builtin;
  editor.status = scenario.status;
  editor.form = JSON.parse(
    JSON.stringify({
      scenario_code: scenario.scenario_code,
      scenario_name: scenario.scenario_name,
      process_description: scenario.process_description ?? "",
      channels: scenario.channels,
      sections: scenario.sections,
    }),
  );
}

async function load(keepSelection = false) {
  loading.value = true;
  try {
    scenarios.value = await fetchAllScenarios();
    if (keepSelection && selectedId.value) {
      const current = scenarios.value.find(s => s.id === selectedId.value) ?? null;
      cloneToEditor(current);
      return;
    }
    if (scenarios.value.length) {
      selectedId.value = scenarios.value[0].id;
      cloneToEditor(scenarios.value[0]);
    } else {
      selectedId.value = null;
      cloneToEditor(null);
    }
  } finally {
    loading.value = false;
  }
}

function select(scenario: KycScenarioVO) {
  selectedId.value = scenario.id;
  cloneToEditor(scenario);
}

function startNew() {
  selectedId.value = null;
  cloneToEditor(null);
}

/* ---- 渠道 / 模块 / 材料项编辑 ---- */

function addChannel() {
  editor.form!.channels.push({ channel_code: "", channel_name: "", restriction_note: "" });
}

function removeChannel(index: number) {
  const removed = editor.form!.channels[index];
  editor.form!.channels.splice(index, 1);
  // 清理材料项对该渠道的引用
  for (const section of editor.form!.sections) {
    for (const item of section.items) {
      if (item.channel_codes) {
        item.channel_codes = item.channel_codes.filter(code => code !== removed.channel_code);
        if (!item.channel_codes.length) item.channel_codes = null;
      }
    }
  }
}

function addSection() {
  editor.form!.sections.push({ section_name: "新模块", items: [] });
}

function removeSection(index: number) {
  editor.form!.sections.splice(index, 1);
}

function addItem(sectionIndex: number) {
  editor.form!.sections[sectionIndex].items.push({
    item_id: crypto.randomUUID().slice(0, 8),
    item_name: "",
    item_description: "",
    item_type: KycItemType.FILE,
    required: true,
    max_count: 3,
    validity_note: "",
    channel_codes: null,
  });
}

function removeItem(sectionIndex: number, itemIndex: number) {
  editor.form!.sections[sectionIndex].items.splice(itemIndex, 1);
}

/* ---- 保存 / 发布 / 删除 ---- */

function validateForm(): boolean {
  const form = editor.form!;
  if (!form.scenario_code.trim() || !form.scenario_name.trim()) {
    ElMessage.warning("请填写业务编号与业务名称");
    return false;
  }
  if (form.channels.some(c => !c.channel_code.trim() || !c.channel_name.trim())) {
    ElMessage.warning("渠道代码与名称不能为空");
    return false;
  }
  for (const section of form.sections) {
    if (section.items.some(item => !item.item_name.trim())) {
      ElMessage.warning(`模块「${section.section_name}」存在未命名的材料项`);
      return false;
    }
  }
  return true;
}

async function save(): Promise<boolean> {
  if (!validateForm()) return false;
  saving.value = true;
  try {
    if (editor.id) {
      await updateScenario(editor.id, editor.form!);
    } else {
      const created = await createScenario(editor.form!);
      selectedId.value = created.id;
      editor.id = created.id;
    }
    ElMessage.success("配置已保存");
    await load(true);
    return true;
  } finally {
    saving.value = false;
  }
}

async function publish() {
  if (!(await save())) return;
  await ElMessageBox.confirm(
    "发布后材料上传页将实时引用该模板。确认发布？",
    "发布配置",
    { type: "warning", confirmButtonText: "发布", cancelButtonText: "取消" },
  );
  saving.value = true;
  try {
    await publishScenario(editor.id);
    ElMessage.success("已发布");
    await load(true);
  } finally {
    saving.value = false;
  }
}

async function remove() {
  await ElMessageBox.confirm("删除后交易员将无法再选择该业务类型（历史申请保留快照）。确认删除？", "删除业务类型", {
    type: "warning",
    confirmButtonText: "删除",
    cancelButtonText: "取消",
  });
  await deleteScenario(editor.id);
  ElMessage.success("已删除");
  selectedId.value = null;
  await load();
}

onMounted(() => load());
</script>

<template>
  <div>
    <header class="page-header">
      <p class="eyebrow">COMPLIANCE CONFIG</p>
      <h1>KYC list 配置</h1>
      <p class="subtitle">业务类型 → 渠道 → 材料项三层模板；发布后供材料上传页实时引用。</p>
    </header>

    <div class="config-layout">
      <!-- 左侧：业务类型列表 -->
      <el-card shadow="never" class="scenario-list" v-loading="loading">
        <el-button type="primary" :icon="Plus" class="new-btn" @click="startNew">新增业务类型</el-button>
        <button
          v-for="scenario in scenarios"
          :key="scenario.id"
          type="button"
          class="scenario-row"
          :class="{ selected: scenario.id === selectedId }"
          @click="select(scenario)"
        >
          <div>
            <strong>{{ scenario.scenario_name }}</strong>
            <small>{{ scenario.scenario_code }} · {{ scenario.channels.length }} 个渠道</small>
          </div>
          <el-tag :type="scenario.status === 'PUBLISHED' ? 'success' : 'info'" size="small">
            {{ KycScenarioStatusLabel[scenario.status] }}
          </el-tag>
        </button>
      </el-card>

      <!-- 右侧：编辑区 -->
      <el-card v-if="editor.form" shadow="never" class="editor">
        <div class="editor-head">
          <h3>{{ editor.id ? "编辑业务类型" : "新增业务类型" }}<el-tag v-if="editor.is_builtin" size="small" class="builtin-tag">内置</el-tag></h3>
          <div class="editor-actions">
            <el-button v-if="editor.id && !editor.is_builtin" type="danger" plain @click="remove">删除</el-button>
            <el-button :loading="saving" @click="save">保存配置</el-button>
            <el-button type="primary" :loading="saving" @click="publish">发布配置</el-button>
          </div>
        </div>

        <div class="base-grid">
          <el-form-item label="业务编号">
            <el-input v-model="editor.form.scenario_code" :disabled="editor.is_builtin" maxlength="30" placeholder="如 SINO" />
          </el-form-item>
          <el-form-item label="业务名称">
            <el-input v-model="editor.form.scenario_name" maxlength="50" placeholder="如 SINO 找换" />
          </el-form-item>
        </div>
        <el-form-item label="流程与约束说明（审核详情『人工审核要求』引用）">
          <el-input
            v-model="editor.form.process_description as string"
            type="textarea"
            :rows="3"
            maxlength="2000"
          />
        </el-form-item>

        <h4 class="section-title">渠道 Matrix</h4>
        <div v-for="(channel, index) in editor.form.channels" :key="index" class="channel-row">
          <el-input v-model="channel.channel_code" placeholder="渠道代码" class="channel-code" maxlength="30" />
          <el-input v-model="channel.channel_name" placeholder="渠道名称" class="channel-name" maxlength="50" />
          <el-input v-model="channel.restriction_note as string" placeholder="渠道限制说明（限制银行、特殊规则等）" class="channel-note" maxlength="500" />
          <el-button type="danger" link @click="removeChannel(index)">删除</el-button>
        </div>
        <el-button size="small" :icon="Plus" @click="addChannel">新增渠道</el-button>

        <template v-for="(section, sectionIndex) in editor.form.sections" :key="sectionIndex">
          <div class="section-head">
            <el-input v-model="section.section_name" class="section-name" maxlength="50" />
            <el-button type="danger" link @click="removeSection(sectionIndex)">删除模块</el-button>
          </div>
          <el-table :data="section.items" size="small" class="item-table">
            <el-table-column label="#" type="index" width="44" />
            <el-table-column label="材料名称" min-width="140">
              <template #default="{ row }">
                <el-input v-model="row.item_name" size="small" maxlength="100" />
              </template>
            </el-table-column>
            <el-table-column label="说明" min-width="160">
              <template #default="{ row }">
                <el-input v-model="row.item_description" size="small" maxlength="500" />
              </template>
            </el-table-column>
            <el-table-column label="类型" width="110">
              <template #default="{ row }">
                <el-select v-model="row.item_type" size="small">
                  <el-option v-for="(label, value) in KycItemTypeLabel" :key="value" :value="value" :label="label" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="必填" width="70">
              <template #default="{ row }">
                <el-switch v-model="row.required" size="small" />
              </template>
            </el-table-column>
            <el-table-column label="份数" width="90">
              <template #default="{ row }">
                <el-input-number v-model="row.max_count" size="small" :min="1" :max="20" controls-position="right" class="count-input" />
              </template>
            </el-table-column>
            <el-table-column label="有效期" width="120">
              <template #default="{ row }">
                <el-input v-model="row.validity_note" size="small" maxlength="200" placeholder="如 3 个月内" />
              </template>
            </el-table-column>
            <el-table-column label="适用渠道" width="150">
              <template #default="{ row }">
                <el-select
                  v-model="row.channel_codes"
                  size="small"
                  multiple
                  collapse-tags
                  clearable
                  placeholder="全渠道"
                >
                  <el-option
                    v-for="channel in editor.form!.channels"
                    :key="channel.channel_code"
                    :value="channel.channel_code"
                    :label="channel.channel_name || channel.channel_code"
                  />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="" width="60">
              <template #default="{ $index }">
                <el-button type="danger" link size="small" @click="removeItem(sectionIndex, $index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-button size="small" :icon="Plus" class="add-item" @click="addItem(sectionIndex)">新增材料项</el-button>
        </template>

        <div class="add-section">
          <el-button size="small" :icon="Plus" @click="addSection">新增材料模块</el-button>
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.page-header {
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

.config-layout {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

.new-btn {
  width: 100%;
  margin-bottom: 12px;
}

.scenario-row {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  text-align: left;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #fff;
  padding: 10px 12px;
  margin-bottom: 8px;
  cursor: pointer;
}

.scenario-row.selected {
  border-color: #ff7a00;
  box-shadow: 0 0 0 2px rgba(255, 122, 0, 0.12);
}

.scenario-row small {
  display: block;
  color: #909399;
}

.editor-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.editor-head h3 {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.builtin-tag {
  font-weight: normal;
}

.editor-actions {
  display: flex;
  gap: 8px;
}

.base-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 16px;
}

.section-title {
  margin: 18px 0 10px;
  color: #606266;
}

.channel-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  align-items: center;
}

.channel-code {
  width: 130px;
}

.channel-name {
  width: 150px;
}

.channel-note {
  flex: 1;
}

.section-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 20px 0 8px;
}

.section-name {
  width: 220px;
}

.item-table {
  margin-bottom: 8px;
}

.count-input {
  width: 70px;
}

.add-item {
  margin-bottom: 6px;
}

.add-section {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px dashed #e4e7ed;
}

@media (max-width: 1100px) {
  .config-layout {
    grid-template-columns: 1fr;
  }
}
</style>
