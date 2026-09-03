<script setup lang="ts">
import { UserStatus, UserStatusLabel, type RoleVO, type UserVO } from "@bv/shared";
import { Plus } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { localizeText } from "@/i18n";
import {
  createRole,
  createUser,
  deleteRole,
  deleteUser,
  fetchRoles,
  fetchUsers,
  resetUserPassword,
  updateUser,
} from "@/api/user";
import { useAuthStore } from "@/stores/auth";
import { formatDateTime, formatRelative } from "@/utils/format";

const { t } = useI18n();
const auth = useAuthStore();
const activeTab = ref("users");
const loading = ref(false);
const users = ref<UserVO[]>([]);
const roles = ref<RoleVO[]>([]);

async function load() {
  loading.value = true;
  try {
    [users.value, roles.value] = await Promise.all([fetchUsers(), fetchRoles()]);
  } finally {
    loading.value = false;
  }
}

/* ---- 新建账号 ---- */
const userDialog = ref(false);
const userSubmitting = ref(false);
const userForm = reactive({ username: "", password: "", display_name: "", title: "", role_id: "" });

function openUserDialog() {
  Object.assign(userForm, { username: "", password: "", display_name: "", title: "", role_id: "" });
  userDialog.value = true;
}

async function submitUser() {
  if (!userForm.username.trim() || !userForm.password || !userForm.display_name.trim() || !userForm.role_id) {
    ElMessage.warning(t("admin.users.fillUserRequired"));
    return;
  }
  userSubmitting.value = true;
  try {
    const user = await createUser({
      username: userForm.username.trim(),
      password: userForm.password,
      display_name: userForm.display_name.trim(),
      title: userForm.title.trim() || null,
      role_id: userForm.role_id,
    });
    ElMessage.success(t("admin.users.userCreated", { username: user.username, role: user.role?.name ?? "" }));
    userDialog.value = false;
    load();
  } catch {
    /* 提示由拦截器处理 */
  } finally {
    userSubmitting.value = false;
  }
}

/* ---- 编辑账号 ---- */
const editDialog = ref(false);
const editSubmitting = ref(false);
const editForm = reactive({
  id: "",
  username: "",
  display_name: "",
  title: "",
  role_id: "",
  user_status: UserStatus.ACTIVE as UserStatus,
});
const editingSelf = computed(() => editForm.id === auth.user?.id);

function openEditDialog(user: UserVO) {
  Object.assign(editForm, {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    title: user.title || "",
    role_id: user.role?.id || "",
    user_status: user.user_status,
  });
  editDialog.value = true;
}

async function submitEdit() {
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(editForm.username.trim())) {
    ElMessage.warning(t("admin.users.usernameInvalid"));
    return;
  }
  if (!editForm.display_name.trim()) {
    ElMessage.warning(t("admin.users.nameRequired"));
    return;
  }
  if (!editForm.role_id) {
    ElMessage.warning(t("admin.users.roleRequired"));
    return;
  }
  editSubmitting.value = true;
  try {
    const user = await updateUser(editForm.id, {
      username: editForm.username.trim(),
      display_name: editForm.display_name.trim(),
      title: editForm.title.trim() || null,
      // 自己的角色与状态由后端拒绝修改，编辑自己时不提交这两项
      ...(editingSelf.value ? {} : { role_id: editForm.role_id, user_status: editForm.user_status }),
    });
    ElMessage.success(t("admin.users.userUpdated", { name: user.display_name, username: user.username }));
    editDialog.value = false;
    if (editingSelf.value && auth.user) {
      auth.setSession(auth.token, {
        ...auth.user,
        username: user.username,
        display_name: user.display_name,
        title: user.title,
      });
    }
    load();
  } catch {
    /* 提示由拦截器处理 */
  } finally {
    editSubmitting.value = false;
  }
}

async function toggleStatus(user: UserVO) {
  const next = user.user_status === UserStatus.ACTIVE ? UserStatus.DISABLED : UserStatus.ACTIVE;
  try {
    await updateUser(user.id, { user_status: next });
    ElMessage.success(next === UserStatus.ACTIVE ? t("admin.users.userEnabled") : t("admin.users.userDisabled"));
    load();
  } catch {
    /* 提示由拦截器处理 */
  }
}

async function resetPassword(user: UserVO) {
  try {
    const { value } = await ElMessageBox.prompt(
      t("admin.users.resetPasswordPrompt", { name: user.display_name, username: user.username }),
      t("admin.users.resetPassword"),
      {
        inputType: "password",
        inputPlaceholder: t("admin.users.passwordPh"),
        confirmButtonText: t("admin.users.confirmReset"),
        cancelButtonText: t("admin.users.cancel"),
      },
    );
    if (!value || value.length < 6) {
      ElMessage.warning(t("admin.users.passwordTooShort"));
      return;
    }
    await resetUserPassword(user.id, value);
    ElMessage.success(t("admin.users.passwordResetSuccess"));
  } catch {
    /* 用户取消或接口错误 */
  }
}

async function removeUser(user: UserVO) {
  try {
    await ElMessageBox.confirm(
      t("admin.users.deleteUserConfirm", { username: user.username }),
      t("admin.users.deleteUserTitle"),
      {
        type: "warning",
        confirmButtonText: t("admin.users.delete"),
        cancelButtonText: t("admin.users.cancel"),
      },
    );
    await deleteUser(user.id);
    ElMessage.success(t("admin.users.userDeleted"));
    load();
  } catch {
    /* 用户取消或接口错误 */
  }
}

/* ---- 新建角色 ---- */
const roleDialog = ref(false);
const roleSubmitting = ref(false);
const roleForm = reactive({ role_code: "", role_name: "", description: "" });

function openRoleDialog() {
  Object.assign(roleForm, { role_code: "", role_name: "", description: "" });
  roleDialog.value = true;
}

async function submitRole() {
  if (!roleForm.role_code.trim() || !roleForm.role_name.trim()) {
    ElMessage.warning(t("admin.users.fillRoleRequired"));
    return;
  }
  roleSubmitting.value = true;
  try {
    const role = await createRole({
      role_code: roleForm.role_code.trim().toUpperCase(),
      role_name: roleForm.role_name.trim(),
      description: roleForm.description.trim() || null,
    });
    ElMessage.success(t("admin.users.roleCreated", { code: role.role_code, name: role.role_name }));
    roleDialog.value = false;
    load();
  } catch {
    /* 提示由拦截器处理 */
  } finally {
    roleSubmitting.value = false;
  }
}

async function removeRole(role: RoleVO) {
  try {
    await ElMessageBox.confirm(
      t("admin.users.deleteRoleConfirm", { code: role.role_code, name: role.role_name }),
      t("admin.users.deleteRoleTitle"),
      {
        type: "warning",
        confirmButtonText: t("admin.users.delete"),
        cancelButtonText: t("admin.users.cancel"),
      },
    );
    await deleteRole(role.id);
    ElMessage.success(t("admin.users.roleDeleted"));
    load();
  } catch {
    /* 用户取消或接口错误 */
  }
}

const statusText = (user: UserVO) => localizeText(UserStatusLabel[user.user_status]);
const isSelf = (user: UserVO) => user.id === auth.user?.id;

onMounted(load);
</script>

<template>
  <div>
    <header class="page-header">
      <p class="eyebrow">SYSTEM ADMIN</p>
      <h1>{{ t("admin.users.title") }}</h1>
      <p class="subtitle">{{ t("admin.users.subtitle") }}</p>
    </header>

    <el-card shadow="never">
      <el-tabs v-model="activeTab">
        <el-tab-pane :label="t('admin.users.tabUsers')" name="users">
          <div class="toolbar">
            <span class="count">{{ t("admin.users.userCount", { n: users.length }) }}</span>
            <el-button type="primary" :icon="Plus" @click="openUserDialog">{{ t("admin.users.createUser") }}</el-button>
          </div>
          <el-table v-loading="loading" :data="users" row-key="id">
            <el-table-column :label="t('admin.users.colAccount')" min-width="180">
              <template #default="{ row }">
                <div class="cell-name">
                  <strong>{{ row.display_name }}<el-tag v-if="isSelf(row)" size="small" class="self-tag">{{ t("admin.users.selfTag") }}</el-tag></strong>
                  <small>{{ row.username }}{{ row.title ? ` · ${row.title}` : "" }}</small>
                </div>
              </template>
            </el-table-column>
            <el-table-column :label="t('admin.users.role')" width="150">
              <template #default="{ row }">
                <el-tag v-if="row.role" :type="row.role.code === 'ADMIN' ? 'danger' : 'primary'" effect="light">
                  {{ row.role.name }}
                </el-tag>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column :label="t('admin.users.status')" width="90">
              <template #default="{ row }">
                <el-tag :type="row.user_status === 'ACTIVE' ? 'success' : 'info'" effect="light">
                  {{ statusText(row) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column :label="t('admin.users.colLastLogin')" width="140">
              <template #default="{ row }">{{ formatRelative(row.last_login_at) }}</template>
            </el-table-column>
            <el-table-column :label="t('admin.users.createdAt')" width="170">
              <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column :label="t('admin.users.actions')" width="290" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="primary" plain @click="openEditDialog(row)">{{ t("admin.users.edit") }}</el-button>
                <el-button size="small" :disabled="isSelf(row)" @click="toggleStatus(row)">
                  {{ row.user_status === "ACTIVE" ? t("admin.users.disable") : t("admin.users.enable") }}
                </el-button>
                <el-button size="small" @click="resetPassword(row)">{{ t("admin.users.resetPassword") }}</el-button>
                <el-button size="small" type="danger" plain :disabled="isSelf(row)" @click="removeUser(row)">
                  {{ t("admin.users.delete") }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="t('admin.users.tabRoles')" name="roles">
          <div class="toolbar">
            <span class="count">{{ t("admin.users.roleCount", { n: roles.length }) }}</span>
            <el-button type="primary" :icon="Plus" @click="openRoleDialog">{{ t("admin.users.createRole") }}</el-button>
          </div>
          <el-table v-loading="loading" :data="roles" row-key="id">
            <el-table-column :label="t('admin.users.roleCode')" width="150">
              <template #default="{ row }"><code>{{ row.role_code }}</code></template>
            </el-table-column>
            <el-table-column prop="role_name" :label="t('admin.users.roleName')" width="140" />
            <el-table-column prop="description" :label="t('admin.users.description')" min-width="240" show-overflow-tooltip />
            <el-table-column :label="t('admin.users.colSource')" width="90">
              <template #default="{ row }">
                <el-tag :type="row.is_builtin ? 'info' : 'primary'" effect="plain">
                  {{ row.is_builtin ? t("admin.users.builtin") : t("admin.users.custom") }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column :label="t('admin.users.colUserCount')" width="90">
              <template #default="{ row }">{{ row.user_count }}</template>
            </el-table-column>
            <el-table-column :label="t('admin.users.actions')" width="110">
              <template #default="{ row }">
                <el-button
                  size="small"
                  type="danger"
                  plain
                  :disabled="row.is_builtin || row.user_count > 0"
                  @click="removeRole(row)"
                >
                  {{ t("admin.users.delete") }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="userDialog" :title="t('admin.users.createUserTitle')" width="520px" :close-on-click-modal="false">
      <el-form label-position="top">
        <div class="grid">
          <el-form-item :label="t('admin.users.username')" required>
            <el-input v-model="userForm.username" :placeholder="t('admin.users.usernamePh')" />
          </el-form-item>
          <el-form-item :label="t('admin.users.initialPassword')" required>
            <el-input v-model="userForm.password" type="password" show-password :placeholder="t('admin.users.passwordPh')" />
          </el-form-item>
          <el-form-item :label="t('admin.users.displayName')" required>
            <el-input v-model="userForm.display_name" :placeholder="t('admin.users.displayNamePh')" />
          </el-form-item>
          <el-form-item :label="t('admin.users.titleLabel')">
            <el-input v-model="userForm.title" :placeholder="t('admin.users.titlePh')" />
          </el-form-item>
        </div>
        <el-form-item :label="t('admin.users.role')" required>
          <el-select v-model="userForm.role_id" :placeholder="t('admin.users.rolePh')" style="width: 100%">
            <el-option
              v-for="role in roles"
              :key="role.id"
              :value="role.id"
              :label="`${role.role_name}（${role.role_code}）`"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="userDialog = false">{{ t("admin.users.cancel") }}</el-button>
        <el-button type="primary" :loading="userSubmitting" @click="submitUser">{{ t("admin.users.submitCreateUser") }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editDialog" :title="t('admin.users.editUserTitle')" width="520px" :close-on-click-modal="false">
      <p class="dialog-subtitle">
        <template v-if="editingSelf">{{ t("admin.users.editSelfHint") }} · </template>
        {{ t("admin.users.passwordHint") }}
      </p>
      <el-form label-position="top">
        <div class="grid">
          <el-form-item :label="t('admin.users.usernameLogin')" required>
            <el-input v-model="editForm.username" :placeholder="t('admin.users.usernamePh')" maxlength="32" />
          </el-form-item>
          <el-form-item :label="t('admin.users.displayName')" required>
            <el-input v-model="editForm.display_name" :placeholder="t('admin.users.displayNamePh')" maxlength="50" />
          </el-form-item>
        </div>
        <el-form-item :label="t('admin.users.titleLabel')">
          <el-input v-model="editForm.title" :placeholder="t('admin.users.titlePh')" maxlength="100" />
        </el-form-item>
        <el-form-item :label="t('admin.users.role')" required>
          <el-select v-model="editForm.role_id" :disabled="editingSelf" :placeholder="t('admin.users.rolePh')" style="width: 100%">
            <el-option
              v-for="role in roles"
              :key="role.id"
              :value="role.id"
              :label="`${role.role_name}（${role.role_code}）`"
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('admin.users.status')">
          <el-radio-group v-model="editForm.user_status" :disabled="editingSelf">
            <el-radio-button :value="UserStatus.ACTIVE">{{ localizeText(UserStatusLabel.ACTIVE) }}</el-radio-button>
            <el-radio-button :value="UserStatus.DISABLED">{{ localizeText(UserStatusLabel.DISABLED) }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialog = false">{{ t("admin.users.cancel") }}</el-button>
        <el-button type="primary" :loading="editSubmitting" @click="submitEdit">{{ t("admin.users.saveEdit") }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="roleDialog" :title="t('admin.users.createRole')" width="480px" :close-on-click-modal="false">
      <el-form label-position="top">
        <el-form-item :label="t('admin.users.roleCode')" required>
          <el-input v-model="roleForm.role_code" :placeholder="t('admin.users.roleCodePh')" />
        </el-form-item>
        <el-form-item :label="t('admin.users.roleName')" required>
          <el-input v-model="roleForm.role_name" :placeholder="t('admin.users.roleNamePh')" />
        </el-form-item>
        <el-form-item :label="t('admin.users.description')">
          <el-input v-model="roleForm.description" type="textarea" :rows="2" :placeholder="t('admin.users.roleDescPh')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleDialog = false">{{ t("admin.users.cancel") }}</el-button>
        <el-button type="primary" :loading="roleSubmitting" @click="submitRole">{{ t("admin.users.submitCreateRole") }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-header {
  margin-bottom: 16px;
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

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.count {
  color: var(--color-text-muted);
  font-size: 13px;
}

.cell-name {
  display: flex;
  flex-direction: column;
}

.cell-name small {
  color: var(--color-text-muted);
}

.self-tag {
  margin-left: 8px;
}

.dialog-subtitle {
  margin: 0 0 16px;
  color: var(--color-text-muted);
  font-size: 13px;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 16px;
}
</style>
