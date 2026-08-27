<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { login } from "@/api/auth";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { t } = useI18n();

const username = ref("");
const password = ref("");
const submitting = ref(false);

async function submit() {
  if (!username.value.trim() || !password.value) return;
  submitting.value = true;
  try {
    const result = await login(username.value.trim(), password.value);
    auth.setSession(result.token, result.user);
    router.replace((route.query.redirect as string) || "/dashboard");
  } catch {
    /* 错误提示由 http 拦截器统一处理 */
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="brand">
        <span class="brand-mark">B</span>
        <div>
          <strong>Bitvast</strong>
          <small>Trade Workbench</small>
        </div>
      </div>
      <h1>{{ t("login.title") }}</h1>
      <p class="hint">{{ t("login.hint") }}</p>
      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item :label="t('login.username')">
          <el-input v-model="username" :placeholder="t('login.usernamePh')" autocomplete="username" />
        </el-form-item>
        <el-form-item :label="t('login.password')">
          <el-input
            v-model="password"
            type="password"
            show-password
            :placeholder="t('login.passwordPh')"
            autocomplete="current-password"
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-button
          type="primary"
          class="submit"
          :loading="submitting"
          native-type="submit"
          @click="submit"
        >
          {{ t("login.submit") }}
        </el-button>
      </el-form>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1f2430;
}

.login-card {
  width: 380px;
  background: #fff;
  border-radius: 12px;
  padding: 36px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 24px;
}

.brand-mark {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: #231c17;
  color: #ff7a00;
  font-weight: 800;
  font-size: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.brand strong {
  display: block;
  font-size: 16px;
}

.brand small {
  color: #909399;
  letter-spacing: 0.08em;
}

h1 {
  font-size: 20px;
  margin: 0 0 4px;
}

.hint {
  color: #909399;
  margin: 0 0 20px;
  font-size: 13px;
}

.submit {
  width: 100%;
  margin-top: 8px;
}
</style>
