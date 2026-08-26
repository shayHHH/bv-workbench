<script setup lang="ts">
import { ElMessage } from "element-plus";
import { reactive, ref, watch } from "vue";
import { changePassword, updateProfile } from "@/api/auth";
import { useAuthStore } from "@/stores/auth";

/** 顶栏用户菜单的两个自助弹窗：个人资料 / 修改密码 */
const profileVisible = defineModel<boolean>("profile", { required: true });
const passwordVisible = defineModel<boolean>("password", { required: true });

const auth = useAuthStore();

/* ---- 个人资料 ---- */
const profileForm = reactive({ display_name: "", title: "" });
const profileSubmitting = ref(false);

watch(profileVisible, open => {
  if (!open) return;
  profileForm.display_name = auth.user?.display_name || "";
  profileForm.title = auth.user?.title || "";
});

async function submitProfile() {
  if (!profileForm.display_name.trim()) {
    ElMessage.warning("请输入姓名");
    return;
  }
  profileSubmitting.value = true;
  try {
    const user = await updateProfile({
      display_name: profileForm.display_name.trim(),
      title: profileForm.title.trim() || null,
    });
    auth.setSession(auth.token, user);
    ElMessage.success("个人资料已更新");
    profileVisible.value = false;
  } catch {
    /* 错误提示由 http 拦截器统一处理 */
  } finally {
    profileSubmitting.value = false;
  }
}

/* ---- 修改密码 ---- */
const passwordForm = reactive({ old_password: "", new_password: "", confirm: "" });
const passwordSubmitting = ref(false);

watch(passwordVisible, open => {
  if (open) Object.assign(passwordForm, { old_password: "", new_password: "", confirm: "" });
});

async function submitPassword() {
  if (!passwordForm.old_password) {
    ElMessage.warning("请输入当前密码");
    return;
  }
  if (passwordForm.new_password.length < 6) {
    ElMessage.warning("新密码至少 6 位");
    return;
  }
  if (passwordForm.new_password !== passwordForm.confirm) {
    ElMessage.warning("两次输入的新密码不一致");
    return;
  }
  passwordSubmitting.value = true;
  try {
    await changePassword(passwordForm.old_password, passwordForm.new_password);
    ElMessage.success("密码已修改，下次登录请使用新密码");
    passwordVisible.value = false;
  } catch {
    /* 错误提示由 http 拦截器统一处理 */
  } finally {
    passwordSubmitting.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="profileVisible" title="个人资料" width="440px" :close-on-click-modal="false">
    <el-form label-position="top">
      <el-form-item label="登录用户名">
        <el-input :model-value="auth.user?.username" disabled />
        <div class="hint">用户名与角色由管理员在「用户管理」中维护，不可自改。</div>
      </el-form-item>
      <el-form-item label="姓名" required>
        <el-input v-model="profileForm.display_name" maxlength="50" placeholder="系统内展示的姓名" />
      </el-form-item>
      <el-form-item label="职位 / 工号">
        <el-input v-model="profileForm.title" maxlength="100" placeholder='如 "Junior Trader · JT-018"（可选）' />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="profileVisible = false">取消</el-button>
      <el-button type="primary" :loading="profileSubmitting" @click="submitProfile">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="passwordVisible" title="修改密码" width="440px" :close-on-click-modal="false">
    <el-form label-position="top">
      <el-form-item label="当前密码" required>
        <el-input v-model="passwordForm.old_password" type="password" show-password autocomplete="current-password" />
      </el-form-item>
      <el-form-item label="新密码" required>
        <el-input v-model="passwordForm.new_password" type="password" show-password placeholder="至少 6 位" autocomplete="new-password" />
      </el-form-item>
      <el-form-item label="确认新密码" required>
        <el-input
          v-model="passwordForm.confirm"
          type="password"
          show-password
          autocomplete="new-password"
          @keyup.enter="submitPassword"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="passwordVisible = false">取消</el-button>
      <el-button type="primary" :loading="passwordSubmitting" @click="submitPassword">确认修改</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
</style>
