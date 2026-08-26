<script setup lang="ts">
/**
 * 批量报价：报价组 CRUD / 组员管理 / 全组重算 / 勾选复制 / CSV 导出。
 * 三栏布局对齐原型 groupQuote 视图；组员与去重一律按 customer_id（原型按 name 的缺陷已修正）。
 */
import { Close, Download, MoreFilled, Plus, Refresh, Search } from "@element-plus/icons-vue";
import type { QuoteGroupBoardVO, QuoteGroupVO } from "@bv/shared";
import { ElMessage } from "element-plus";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  addQuoteGroupMembers,
  createQuoteGroup,
  deleteQuoteGroup,
  downloadQuoteGroupCsv,
  fetchQuoteGroupBoard,
  fetchQuoteGroups,
  recalculateQuoteGroup,
  removeQuoteGroupMember,
  renameQuoteGroup,
} from "@/api/quote";
import {
  customerDisplayLabel,
  fetchAllQuoteCustomers,
  formatQuoteTime,
  type QuoteCustomerOption,
} from "./quote-utils";

const { t } = useI18n();

const groups = ref<QuoteGroupVO[]>([]);
const currentGroupId = ref<string | null>(null);
const board = ref<QuoteGroupBoardVO | null>(null);
const boardLoading = ref(false);
const allCustomers = ref<QuoteCustomerOption[]>([]);

/* 勾选：key = `${customerId}::${itemId}` */
const selectedKeys = ref(new Set<string>());

/* 弹窗状态 */
const addGroupVisible = ref(false);
const newGroupName = ref("");
const editGroupVisible = ref(false);
const editGroupName = ref("");
const deleteGroupVisible = ref(false);
const menuOpenGroupId = ref<string | null>(null);
const addCustomerVisible = ref(false);
const customerSearch = ref("");
const pickedCustomerIds = ref(new Set<string>());

const currentGroup = computed(() => groups.value.find(g => g.id === currentGroupId.value) ?? null);

const memberIds = computed(() => new Set(board.value?.members.map(m => m.customer_id) ?? []));

const filteredCustomers = computed(() => {
  const keyword = customerSearch.value.trim().toLowerCase();
  if (!keyword) return allCustomers.value;
  return allCustomers.value.filter(option =>
    [customerDisplayLabel(option), option.broker_label ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(keyword),
  );
});

async function loadGroups(selectId?: string) {
  groups.value = await fetchQuoteGroups();
  const target =
    (selectId && groups.value.find(g => g.id === selectId)) ||
    (currentGroupId.value && groups.value.find(g => g.id === currentGroupId.value)) ||
    groups.value[0] ||
    null;
  currentGroupId.value = target?.id ?? null;
  await loadBoard();
}

async function loadBoard() {
  selectedKeys.value = new Set();
  if (!currentGroupId.value) {
    board.value = null;
    return;
  }
  boardLoading.value = true;
  try {
    board.value = await fetchQuoteGroupBoard(currentGroupId.value);
  } finally {
    boardLoading.value = false;
  }
}

async function selectGroup(id: string) {
  menuOpenGroupId.value = null;
  currentGroupId.value = id;
  await loadBoard();
}

/* ---------- 组 CRUD ---------- */
async function confirmAddGroup() {
  const name = newGroupName.value.trim();
  if (!name) {
    ElMessage.warning(t("quote.batch.nameRequired"));
    return;
  }
  const group = await createQuoteGroup(name);
  addGroupVisible.value = false;
  newGroupName.value = "";
  await loadGroups(group.id);
  ElMessage.success(t("quote.batch.groupCreated", { name }));
}

function openEditGroup() {
  editGroupName.value = currentGroup.value?.name ?? "";
  editGroupVisible.value = true;
  menuOpenGroupId.value = null;
}

async function confirmEditGroup() {
  const name = editGroupName.value.trim();
  if (!name) {
    ElMessage.warning(t("quote.batch.nameRequired"));
    return;
  }
  if (currentGroupId.value && name !== currentGroup.value?.name) {
    await renameQuoteGroup(currentGroupId.value, name);
    await loadGroups();
    ElMessage.success(t("quote.batch.groupRenamed", { name }));
  }
  editGroupVisible.value = false;
}

async function confirmDeleteGroup() {
  const group = currentGroup.value;
  if (!group) return;
  await deleteQuoteGroup(group.id);
  deleteGroupVisible.value = false;
  currentGroupId.value = null;
  await loadGroups();
  ElMessage.success(t("quote.batch.groupDeleted", { name: group.name }));
}

/* ---------- 组员 ---------- */
function openAddCustomer() {
  pickedCustomerIds.value = new Set();
  customerSearch.value = "";
  addCustomerVisible.value = true;
}

function togglePick(id: string, checked: boolean) {
  const next = new Set(pickedCustomerIds.value);
  if (checked) next.add(id);
  else next.delete(id);
  pickedCustomerIds.value = next;
}

function pickAllAvailable() {
  const next = new Set(pickedCustomerIds.value);
  for (const option of filteredCustomers.value) {
    if (!memberIds.value.has(option.id)) next.add(option.id);
  }
  pickedCustomerIds.value = next;
}

async function confirmAddCustomers() {
  if (!currentGroupId.value) return;
  if (!pickedCustomerIds.value.size) {
    ElMessage.warning(t("quote.batch.pickFirst"));
    return;
  }
  await addQuoteGroupMembers(currentGroupId.value, [...pickedCustomerIds.value]);
  addCustomerVisible.value = false;
  const count = pickedCustomerIds.value.size;
  await loadGroups();
  ElMessage.success(t("quote.batch.added", { n: count, name: currentGroup.value?.name ?? "" }));
}

async function removeMember(customerId: string, name: string) {
  if (!currentGroupId.value) return;
  await removeQuoteGroupMember(currentGroupId.value, customerId);
  await loadGroups();
  ElMessage.success(t("quote.batch.removed", { name, group: currentGroup.value?.name ?? "" }));
}

/* ---------- 勾选 / 复制 ---------- */
function quoteKey(customerId: string, itemId: string) {
  return `${customerId}::${itemId}`;
}

function toggleQuote(customerId: string, itemId: string, checked: boolean) {
  const next = new Set(selectedKeys.value);
  if (checked) next.add(quoteKey(customerId, itemId));
  else next.delete(quoteKey(customerId, itemId));
  selectedKeys.value = next;
}

function memberCheckState(customerId: string): { all: boolean; some: boolean } {
  const member = board.value?.members.find(m => m.customer_id === customerId);
  if (!member?.items.length) return { all: false, some: false };
  const picked = member.items.filter(item =>
    selectedKeys.value.has(quoteKey(customerId, item.id)),
  ).length;
  return { all: picked === member.items.length, some: picked > 0 && picked < member.items.length };
}

function toggleMemberAll(customerId: string, checked: boolean) {
  const member = board.value?.members.find(m => m.customer_id === customerId);
  if (!member) return;
  const next = new Set(selectedKeys.value);
  for (const item of member.items) {
    if (checked) next.add(quoteKey(customerId, item.id));
    else next.delete(quoteKey(customerId, item.id));
  }
  selectedKeys.value = next;
}

async function copyMemberSelected(customerId: string) {
  const member = board.value?.members.find(m => m.customer_id === customerId);
  if (!member) return;
  const picked = member.items.filter(item =>
    selectedKeys.value.has(quoteKey(customerId, item.id)),
  );
  if (!picked.length) {
    ElMessage.warning(t("quote.batch.pickQuoteFirst"));
    return;
  }
  const lines = picked.map(
    item => `${item.trade_type} ${item.prefix}: ${item.result ?? "-"}${item.suffix ? ` ${item.suffix}` : ""}`,
  );
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    ElMessage.success(t("quote.batch.copied", { name: member.name, n: picked.length }));
  } catch {
    ElMessage.error(t("quote.quick.copyFail"));
  }
}

/* ---------- 重算 / 导出 ---------- */
const recalculating = ref(false);

async function recalcGroup() {
  if (!currentGroupId.value || recalculating.value) return;
  recalculating.value = true;
  try {
    const result = await recalculateQuoteGroup(currentGroupId.value);
    await loadBoard();
    ElMessage.success(
      t("quote.batch.groupRecalcDone", { customers: result.customers, items: result.items }),
    );
    if (result.errors.length) ElMessage.warning(result.errors[0]);
  } finally {
    recalculating.value = false;
  }
}

async function exportCsv() {
  if (!currentGroupId.value) return;
  await downloadQuoteGroupCsv(
    currentGroupId.value,
    `quote-group-${currentGroup.value?.name ?? "export"}.csv`,
  );
  ElMessage.success(t("quote.batch.exported"));
}

onMounted(async () => {
  const [, options] = await Promise.all([loadGroups(), fetchAllQuoteCustomers()]);
  allCustomers.value = options;
});
</script>

<template>
  <div>
    <header class="page-header">
      <p class="eyebrow">{{ t("quote.common.eyebrow") }}</p>
      <h1>{{ t("quote.batch.title") }}</h1>
      <p class="subtitle">{{ t("quote.batch.subtitle") }}</p>
    </header>

    <div class="batch-shell">
      <!-- 栏 1：报价组 -->
      <section class="column group-column">
        <header class="column-head">
          <strong>{{ t("quote.batch.groups") }}</strong>
          <el-button circle size="small" type="primary" :icon="Plus" :title="t('quote.batch.addGroup')" @click="addGroupVisible = true" />
        </header>
        <div class="column-body">
          <div v-if="!groups.length" class="column-empty">
            <p>{{ t("quote.batch.emptyGroupList") }}</p>
            <small>{{ t("quote.batch.emptyGroupListHint") }}</small>
          </div>
          <div
            v-for="group in groups"
            :key="group.id"
            class="group-item"
            :class="{ active: group.id === currentGroupId }"
            @click="selectGroup(group.id)"
          >
            <span class="group-name" :title="group.name">{{ group.name }}</span>
            <span class="group-badge">{{ group.customer_count }}</span>
            <el-dropdown
              trigger="click"
              @command="(cmd: string) => (cmd === 'edit' ? openEditGroup() : (deleteGroupVisible = true))"
            >
              <el-button text size="small" :icon="MoreFilled" @click.stop />
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="edit">{{ t("quote.batch.editGroup") }}</el-dropdown-item>
                  <el-dropdown-item command="delete" class="danger-item">
                    {{ t("quote.batch.deleteGroup") }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </section>

      <!-- 栏 2：该组客户 -->
      <section class="column member-column">
        <header class="column-head">
          <strong>{{ t("quote.batch.groupCustomers") }}</strong>
          <el-button
            circle
            size="small"
            :icon="Plus"
            :disabled="!currentGroupId"
            :title="t('quote.batch.addCustomer')"
            @click="openAddCustomer"
          />
        </header>
        <div class="column-body">
          <div v-if="!board?.members.length" class="column-empty">
            <p>{{ t("quote.batch.emptyMemberList") }}</p>
            <small>{{ t("quote.batch.emptyMemberListHint") }}</small>
          </div>
          <div v-for="member in board?.members ?? []" :key="member.customer_id" class="member-item">
            <div class="member-meta">
              <span class="member-name">{{ member.name }}</span>
              <span class="member-tag">#{{ member.customer_code ?? t("quote.common.noCode") }}</span>
            </div>
            <el-button
              text
              size="small"
              :icon="Close"
              :title="t('quote.batch.removeFromGroup')"
              @click="removeMember(member.customer_id, member.name)"
            />
          </div>
        </div>
      </section>

      <!-- 栏 3：报价结果 -->
      <section class="column results-column" v-loading="boardLoading">
        <header class="column-head">
          <strong>
            {{
              currentGroup
                ? t("quote.batch.resultsTitle", { name: currentGroup.name, count: board?.members.length ?? 0 })
                : t("quote.batch.emptyNoGroup")
            }}
          </strong>
          <el-button
            type="primary"
            plain
            size="small"
            :icon="Refresh"
            :loading="recalculating"
            :disabled="!currentGroupId"
            @click="recalcGroup"
          >
            {{ t("quote.batch.recalcGroup") }}
          </el-button>
        </header>
        <div class="column-body results-body">
          <div v-if="!board?.members.length" class="column-empty tall">
            <p>{{ currentGroup ? t("quote.batch.emptyNoCustomer") : t("quote.batch.emptyNoGroup") }}</p>
          </div>
          <article v-for="member in board?.members ?? []" :key="member.customer_id" class="result-card">
            <header class="card-head">
              <el-checkbox
                :model-value="memberCheckState(member.customer_id).all"
                :indeterminate="memberCheckState(member.customer_id).some"
                @change="(checked: boolean) => toggleMemberAll(member.customer_id, checked)"
              />
              <strong class="card-name">{{ member.name }}</strong>
              <span class="member-tag">#{{ member.customer_code ?? t("quote.common.noCode") }}</span>
              <small class="card-updated">
                {{
                  member.last_quoted_at
                    ? t("quote.batch.lastUpdated", { time: formatQuoteTime(member.last_quoted_at) })
                    : t("quote.batch.notCalculated")
                }}
              </small>
              <div class="card-actions">
                <el-button
                  text
                  size="small"
                  :title="t('quote.batch.copySelected')"
                  @click="copyMemberSelected(member.customer_id)"
                >
                  ⧉
                </el-button>
              </div>
            </header>
            <div v-for="item in member.items" :key="item.id" class="quote-row">
              <el-checkbox
                :model-value="selectedKeys.has(quoteKey(member.customer_id, item.id))"
                @change="(checked: boolean) => toggleQuote(member.customer_id, item.id, checked)"
              />
              <span class="quote-type">{{ item.trade_type || t("quote.batch.uncategorized") }}</span>
              <span class="quote-label">{{ item.prefix || t("quote.batch.unnamed") }}</span>
              <code class="quote-formula">{{ item.formula_text || "-" }}</code>
              <strong class="quote-val">
                {{ item.result ?? "--" }}
                <small v-if="item.suffix" class="quote-suffix">{{ item.suffix }}</small>
              </strong>
            </div>
          </article>
        </div>
        <footer class="download-bar">
          <el-button type="primary" :icon="Download" :disabled="!currentGroupId" @click="exportCsv">
            {{ t("quote.batch.downloadCsv") }}
          </el-button>
        </footer>
      </section>
    </div>

    <!-- 新建报价组 -->
    <el-dialog v-model="addGroupVisible" :title="t('quote.batch.addGroupTitle')" width="420px">
      <el-form label-position="top" @submit.prevent="confirmAddGroup">
        <el-form-item :label="t('quote.batch.groupNameLabel')" required>
          <el-input
            v-model="newGroupName"
            :placeholder="t('quote.batch.groupNamePh')"
            autofocus
            @keyup.enter="confirmAddGroup"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addGroupVisible = false">{{ t("quote.batch.cancel") }}</el-button>
        <el-button type="primary" @click="confirmAddGroup">{{ t("quote.batch.confirm") }}</el-button>
      </template>
    </el-dialog>

    <!-- 编辑报价组 -->
    <el-dialog v-model="editGroupVisible" :title="t('quote.batch.editGroupTitle')" width="420px">
      <el-form label-position="top" @submit.prevent="confirmEditGroup">
        <el-form-item :label="t('quote.batch.groupNameLabel')" required>
          <el-input v-model="editGroupName" @keyup.enter="confirmEditGroup" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editGroupVisible = false">{{ t("quote.batch.cancel") }}</el-button>
        <el-button type="primary" @click="confirmEditGroup">{{ t("quote.batch.confirm") }}</el-button>
      </template>
    </el-dialog>

    <!-- 删除报价组 -->
    <el-dialog v-model="deleteGroupVisible" :title="t('quote.batch.deleteGroupTitle')" width="440px">
      <p>{{ t("quote.batch.deleteGroupConfirm", { name: currentGroup?.name ?? "" }) }}</p>
      <template #footer>
        <el-button @click="deleteGroupVisible = false">{{ t("quote.batch.cancel") }}</el-button>
        <el-button type="danger" @click="confirmDeleteGroup">{{ t("quote.batch.confirmDelete") }}</el-button>
      </template>
    </el-dialog>

    <!-- 添加客户至报价组 -->
    <el-dialog v-model="addCustomerVisible" :title="t('quote.batch.addCustomerTitle')" width="560px">
      <el-input
        v-model="customerSearch"
        :prefix-icon="Search"
        :placeholder="t('quote.batch.searchCustomerPh')"
        clearable
      />
      <div class="pick-summary">
        <span>{{ t("quote.batch.selectedCount", { n: pickedCustomerIds.size }) }}</span>
        <el-button text type="primary" size="small" @click="pickAllAvailable">
          {{ t("quote.batch.selectAllAvailable") }}
        </el-button>
      </div>
      <div class="pick-list">
        <div v-if="!filteredCustomers.length" class="column-empty">
          <p>{{ t("quote.batch.noMatchedSystemCustomer") }}</p>
        </div>
        <label
          v-for="option in filteredCustomers"
          :key="option.id"
          class="pick-item"
          :class="{ disabled: memberIds.has(option.id) }"
        >
          <el-checkbox
            :model-value="memberIds.has(option.id) || pickedCustomerIds.has(option.id)"
            :disabled="memberIds.has(option.id)"
            @change="(checked: boolean) => togglePick(option.id, checked)"
          />
          <div class="pick-meta">
            <span class="pick-title">
              {{ customerDisplayLabel(option) }}
              <em v-if="memberIds.has(option.id)">{{ t("quote.batch.inGroup") }}</em>
            </span>
            <span class="pick-sub">
              {{ t("quote.batch.infoPrefix") }}{{ option.name }} - {{ option.customer_code ?? t("quote.common.noCode") }}
              <span v-if="option.broker_label" class="broker-tag">
                {{ t("quote.batch.brokerPrefix") }}{{ option.broker_label }}
              </span>
            </span>
          </div>
        </label>
      </div>
      <template #footer>
        <el-button @click="addCustomerVisible = false">{{ t("quote.batch.cancel") }}</el-button>
        <el-button type="primary" @click="confirmAddCustomers">{{ t("quote.batch.confirmAdd") }}</el-button>
      </template>
    </el-dialog>
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

.batch-shell {
  display: grid;
  grid-template-columns: 220px 240px minmax(0, 1fr);
  gap: 1px;
  background: #e4e7ed;
  border: 1px solid #e4e7ed;
  border-radius: 12px;
  overflow: hidden;
  height: calc(100vh - 210px);
  min-height: 480px;
}

.column {
  background: #fff;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.column-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid #f0f2f5;
  font-size: 14px;
}

.column-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.column-empty {
  color: #c0c4cc;
  text-align: center;
  padding: 32px 8px;
  font-size: 13px;
}

.column-empty.tall {
  padding: 120px 8px;
}

.group-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}

.group-item:hover {
  background: #f7f8fa;
}

.group-item.active {
  background: #fff4ed;
  color: #d9531e;
  font-weight: 600;
}

.group-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-badge {
  background: #f0f2f5;
  color: #909399;
  border-radius: 999px;
  font-size: 12px;
  padding: 0 8px;
  line-height: 18px;
}

.group-item.active .group-badge {
  background: #ffe4d1;
  color: #d9531e;
}

.danger-item {
  color: #f56c6c;
}

.member-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 10px;
  border-radius: 8px;
}

.member-item:hover {
  background: #f7f8fa;
}

.member-meta {
  display: flex;
  flex-direction: column;
}

.member-name {
  font-size: 13px;
}

.member-tag {
  color: #909399;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.results-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  scroll-behavior: smooth;
}

.result-card {
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 10px 14px;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f5f6f8;
}

.card-name {
  font-size: 14px;
}

.card-updated {
  color: #c0c4cc;
  font-size: 12px;
}

.card-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

.quote-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px dashed #f5f6f8;
  font-size: 13px;
}

.quote-row:last-child {
  border-bottom: none;
}

.quote-type {
  background: #eaf2ff;
  color: #d9531e;
  border-radius: 999px;
  font-size: 12px;
  padding: 0 10px;
  line-height: 20px;
  white-space: nowrap;
}

.quote-label {
  width: 90px;
  color: #606266;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quote-formula {
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #909399;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quote-val {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #d9531e;
  white-space: nowrap;
}

.quote-suffix {
  color: #909399;
  font-weight: 400;
}

.download-bar {
  padding: 10px 14px;
  border-top: 1px solid #f0f2f5;
  display: flex;
  justify-content: flex-end;
}

.pick-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 10px 0 6px;
  color: #909399;
  font-size: 13px;
}

.pick-list {
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pick-item {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid #f0f2f5;
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
}

.pick-item.disabled {
  opacity: 0.6;
}

.pick-meta {
  display: flex;
  flex-direction: column;
}

.pick-title {
  font-size: 13px;
}

.pick-title em {
  color: #c0c4cc;
  font-style: normal;
  font-size: 12px;
}

.pick-sub {
  color: #909399;
  font-size: 12px;
}

.broker-tag {
  color: #d9531e;
  margin-left: 8px;
}
</style>
