<script setup lang="ts">
import { ElMessage } from "element-plus";
import { reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { changePassword, updateProfile } from "@/api/auth";
import { useAuthStore } from "@/stores/auth";

/** 顶栏用户菜单的两个自助弹窗：个人资料 / 修改密码 */
const profileVisible = defineModel<boolean>("profile", { required: true });
const passwordVisible = defineModel<boolean>("password", { required: true });

const auth = useAuthStore();
const { t } = useI18n();

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
    ElMessage.warning(t("layout.profileDialog.nameRequired"));
    return;
  }
  profileSubmitting.value = true;
  try {
    const user = await updateProfile({
      display_name: profileForm.display_name.trim(),
      title: profileForm.title.trim() || null,
    });
    auth.setSession(auth.token, user);
    ElMessage.success(t("layout.profileDialog.saved"));
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
    ElMessage.warning(t("layout.passwordDialog.oldRequired"));
    return;
  }
  if (passwordForm.new_password.length < 6) {
    ElMessage.warning(t("layout.passwordDialog.tooShort"));
    return;
  }
  if (passwordForm.new_password !== passwordForm.confirm) {
    ElMessage.warning(t("layout.passwordDialog.mismatch"));
    return;
  }
  passwordSubmitting.value = true;
  try {
    await changePassword(passwordForm.old_password, passwordForm.new_password);
    ElMessage.success(t("layout.passwordDialog.changed"));
    passwordVisible.value = false;
  } catch {
    /* 错误提示由 http 拦截器统一处理 */
  } finally {
    passwordSubmitting.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="profileVisible" :title="t('layout.profile')" width="440px" :close-on-click-modal="false">
    <el-form label-position="top">
      <el-form-item :label="t('layout.profileDialog.username')">
        <el-input :model-value="auth.user?.username" disabled />
        <div class="hint">{{ t("layout.profileDialog.usernameHint") }}</div>
      </el-form-item>
      <el-form-item :label="t('layout.profileDialog.name')" required>
        <el-input v-model="profileForm.display_name" maxlength="50" :placeholder="t('layout.profileDialog.namePh')" />
      </el-form-item>
      <el-form-item :label="t('layout.profileDialog.title')">
        <el-input v-model="profileForm.title" maxlength="100" :placeholder="t('layout.profileDialog.titlePh')" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="profileVisible = false">{{ t("layout.cancel") }}</el-button>
      <el-button type="primary" :loading="profileSubmitting" @click="submitProfile">{{ t("layout.save") }}</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="passwordVisible" :title="t('layout.changePassword')" width="440px" :close-on-click-modal="false">
    <el-form label-position="top">
      <el-form-item :label="t('layout.passwordDialog.old')" required>
        <el-input v-model="passwordForm.old_password" type="password" show-password autocomplete="current-password" />
      </el-form-item>
      <el-form-item :label="t('layout.passwordDialog.new')" required>
        <el-input v-model="passwordForm.new_password" type="password" show-password :placeholder="t('layout.passwordDialog.newPh')" autocomplete="new-password" />
      </el-form-item>
      <el-form-item :label="t('layout.passwordDialog.confirm')" required>
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
      <el-button @click="passwordVisible = false">{{ t("layout.cancel") }}</el-button>
      <el-button type="primary" :loading="passwordSubmitting" @click="submitPassword">{{ t("layout.passwordDialog.submit") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.5;
}
</style>
