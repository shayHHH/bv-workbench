<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { login } from "@/api/auth";
import { useAuthStore } from "@/stores/auth";
import { defaultHomePath } from "@/utils/device";

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
    router.replace((route.query.redirect as string) || defaultHomePath(result.user.role?.code ?? ""));
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
        <img class="brand-mark" src="/bv.ico" alt="Bitvast" />
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
  background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%);
}

.login-card {
  width: 380px;
  background: #fff;
  border-radius: 16px;
  padding: 36px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
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
  background: #1E293B;
  object-fit: contain;
  padding: 5px;
  box-sizing: border-box;
}

.brand strong {
  display: block;
  font-size: 16px;
  font-weight: 700;
  color: #0F172A;
}

.brand small {
  color: #94A3B8;
  letter-spacing: 0.06em;
  font-size: 12px;
}

h1 {
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 4px;
  color: #0F172A;
}

.hint {
  color: #94A3B8;
  margin: 0 0 20px;
  font-size: 13px;
}

.submit {
  width: 100%;
  margin-top: 8px;
  border-radius: 8px;
  font-weight: 600;
}
</style>
