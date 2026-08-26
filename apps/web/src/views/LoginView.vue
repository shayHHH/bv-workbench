<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { login } from "@/api/auth";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

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
      <h1>登录交易运营系统</h1>
      <p class="hint">请使用管理员分配的账号登录</p>
      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="用户名">
          <el-input v-model="username" placeholder="输入用户名" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="password"
            type="password"
            show-password
            placeholder="输入密码"
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
          登 录
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
