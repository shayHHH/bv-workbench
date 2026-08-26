<script setup lang="ts">
import { UserStatus, UserStatusLabel, type RoleVO, type UserVO } from "@bv/shared";
import { Plus } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
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
    ElMessage.warning("请填写用户名、初始密码、姓名并选择角色");
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
    ElMessage.success(`账号已创建：${user.username}（${user.role?.name}）`);
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
    ElMessage.warning("用户名为 3-32 位字母、数字或 _ . -");
    return;
  }
  if (!editForm.display_name.trim()) {
    ElMessage.warning("请输入姓名");
    return;
  }
  if (!editForm.role_id) {
    ElMessage.warning("请选择角色");
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
    ElMessage.success(`账号已更新：${user.display_name}（${user.username}）`);
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
    ElMessage.success(next === UserStatus.ACTIVE ? "账号已启用" : "账号已停用");
    load();
  } catch {
    /* 提示由拦截器处理 */
  }
}

async function resetPassword(user: UserVO) {
  try {
    const { value } = await ElMessageBox.prompt(
      `为 ${user.display_name}（${user.username}）设置新密码`,
      "重置密码",
      { inputType: "password", inputPlaceholder: "至少 6 位", confirmButtonText: "重置", cancelButtonText: "取消" },
    );
    if (!value || value.length < 6) {
      ElMessage.warning("新密码至少 6 位");
      return;
    }
    await resetUserPassword(user.id, value);
    ElMessage.success("密码已重置");
  } catch {
    /* 用户取消或接口错误 */
  }
}

async function removeUser(user: UserVO) {
  try {
    await ElMessageBox.confirm(`确定删除账号 ${user.username}？该操作为软删除，可由 DBA 恢复。`, "删除账号", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
    await deleteUser(user.id);
    ElMessage.success("账号已删除");
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
    ElMessage.warning("请填写角色代码与角色名称");
    return;
  }
  roleSubmitting.value = true;
  try {
    const role = await createRole({
      role_code: roleForm.role_code.trim().toUpperCase(),
      role_name: roleForm.role_name.trim(),
      description: roleForm.description.trim() || null,
    });
    ElMessage.success(`角色已创建：${role.role_code} · ${role.role_name}`);
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
    await ElMessageBox.confirm(`确定删除角色 ${role.role_code} · ${role.role_name}？`, "删除角色", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
    await deleteRole(role.id);
    ElMessage.success("角色已删除");
    load();
  } catch {
    /* 用户取消或接口错误 */
  }
}

const statusText = (user: UserVO) => UserStatusLabel[user.user_status];
const isSelf = (user: UserVO) => user.id === auth.user?.id;

onMounted(load);
</script>

<template>
  <div>
    <header class="page-header">
      <p class="eyebrow">SYSTEM ADMIN</p>
      <h1>用户管理</h1>
      <p class="subtitle">管理系统登录账号与角色；账号按角色获得对应模块的访问权限。</p>
    </header>

    <el-card shadow="never">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="登录账号" name="users">
          <div class="toolbar">
            <span class="count">共 {{ users.length }} 个账号</span>
            <el-button type="primary" :icon="Plus" @click="openUserDialog">新建账号</el-button>
          </div>
          <el-table v-loading="loading" :data="users" row-key="id">
            <el-table-column label="账号" min-width="180">
              <template #default="{ row }">
                <div class="cell-name">
                  <strong>{{ row.display_name }}<el-tag v-if="isSelf(row)" size="small" class="self-tag">当前登录</el-tag></strong>
                  <small>{{ row.username }}{{ row.title ? ` · ${row.title}` : "" }}</small>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="角色" width="150">
              <template #default="{ row }">
                <el-tag v-if="row.role" :type="row.role.code === 'ADMIN' ? 'danger' : 'primary'" effect="light">
                  {{ row.role.name }}
                </el-tag>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.user_status === 'ACTIVE' ? 'success' : 'info'" effect="light">
                  {{ statusText(row) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="最近登录" width="140">
              <template #default="{ row }">{{ formatRelative(row.last_login_at) }}</template>
            </el-table-column>
            <el-table-column label="创建时间" width="170">
              <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="290" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="primary" plain @click="openEditDialog(row)">编辑</el-button>
                <el-button size="small" :disabled="isSelf(row)" @click="toggleStatus(row)">
                  {{ row.user_status === "ACTIVE" ? "停用" : "启用" }}
                </el-button>
                <el-button size="small" @click="resetPassword(row)">重置密码</el-button>
                <el-button size="small" type="danger" plain :disabled="isSelf(row)" @click="removeUser(row)">
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="角色管理" name="roles">
          <div class="toolbar">
            <span class="count">共 {{ roles.length }} 个角色</span>
            <el-button type="primary" :icon="Plus" @click="openRoleDialog">新建角色</el-button>
          </div>
          <el-table v-loading="loading" :data="roles" row-key="id">
            <el-table-column label="角色代码" width="150">
              <template #default="{ row }"><code>{{ row.role_code }}</code></template>
            </el-table-column>
            <el-table-column prop="role_name" label="角色名称" width="140" />
            <el-table-column prop="description" label="说明" min-width="240" show-overflow-tooltip />
            <el-table-column label="来源" width="90">
              <template #default="{ row }">
                <el-tag :type="row.is_builtin ? 'info' : 'primary'" effect="plain">
                  {{ row.is_builtin ? "内置" : "自定义" }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="账号数" width="90">
              <template #default="{ row }">{{ row.user_count }}</template>
            </el-table-column>
            <el-table-column label="操作" width="110">
              <template #default="{ row }">
                <el-button
                  size="small"
                  type="danger"
                  plain
                  :disabled="row.is_builtin || row.user_count > 0"
                  @click="removeRole(row)"
                >
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="userDialog" title="新建登录账号" width="520px" :close-on-click-modal="false">
      <el-form label-position="top">
        <div class="grid">
          <el-form-item label="用户名" required>
            <el-input v-model="userForm.username" placeholder="3-32 位字母、数字或 _ . -" />
          </el-form-item>
          <el-form-item label="初始密码" required>
            <el-input v-model="userForm.password" type="password" show-password placeholder="至少 6 位" />
          </el-form-item>
          <el-form-item label="姓名" required>
            <el-input v-model="userForm.display_name" placeholder="用于系统内展示" />
          </el-form-item>
          <el-form-item label="职位 / 工号">
            <el-input v-model="userForm.title" placeholder='如 "Junior Trader · JT-018"（可选）' />
          </el-form-item>
        </div>
        <el-form-item label="角色" required>
          <el-select v-model="userForm.role_id" placeholder="选择角色" style="width: 100%">
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
        <el-button @click="userDialog = false">取消</el-button>
        <el-button type="primary" :loading="userSubmitting" @click="submitUser">创建账号</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editDialog" title="编辑账号" width="520px" :close-on-click-modal="false">
      <p class="dialog-subtitle">
        <template v-if="editingSelf">当前登录账号，角色与状态不可自改 · </template>
        密码修改请使用列表中的「重置密码」
      </p>
      <el-form label-position="top">
        <div class="grid">
          <el-form-item label="用户名（登录名）" required>
            <el-input v-model="editForm.username" placeholder="3-32 位字母、数字或 _ . -" maxlength="32" />
          </el-form-item>
          <el-form-item label="姓名" required>
            <el-input v-model="editForm.display_name" placeholder="用于系统内展示" maxlength="50" />
          </el-form-item>
        </div>
        <el-form-item label="职位 / 工号">
          <el-input v-model="editForm.title" placeholder='如 "Junior Trader · JT-018"（可选）' maxlength="100" />
        </el-form-item>
        <el-form-item label="角色" required>
          <el-select v-model="editForm.role_id" :disabled="editingSelf" placeholder="选择角色" style="width: 100%">
            <el-option
              v-for="role in roles"
              :key="role.id"
              :value="role.id"
              :label="`${role.role_name}（${role.role_code}）`"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="editForm.user_status" :disabled="editingSelf">
            <el-radio-button :value="UserStatus.ACTIVE">{{ UserStatusLabel.ACTIVE }}</el-radio-button>
            <el-radio-button :value="UserStatus.DISABLED">{{ UserStatusLabel.DISABLED }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialog = false">取消</el-button>
        <el-button type="primary" :loading="editSubmitting" @click="submitEdit">保存修改</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="roleDialog" title="新建角色" width="480px" :close-on-click-modal="false">
      <el-form label-position="top">
        <el-form-item label="角色代码" required>
          <el-input v-model="roleForm.role_code" placeholder="大写字母/数字/下划线，如 RISK_OFFICER" />
        </el-form-item>
        <el-form-item label="角色名称" required>
          <el-input v-model="roleForm.role_name" placeholder="如 风控专员" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="roleForm.description" type="textarea" :rows="2" placeholder="角色职责说明（可选）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleDialog = false">取消</el-button>
        <el-button type="primary" :loading="roleSubmitting" @click="submitRole">创建角色</el-button>
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

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.count {
  color: #909399;
  font-size: 13px;
}

.cell-name {
  display: flex;
  flex-direction: column;
}

.cell-name small {
  color: #909399;
}

.self-tag {
  margin-left: 8px;
}

.dialog-subtitle {
  margin: 0 0 16px;
  color: #909399;
  font-size: 13px;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 16px;
}
</style>
