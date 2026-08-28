import axios, { AxiosError } from "axios";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { router } from "@/router";

export const http = axios.create({
  baseURL: "/api",
  timeout: 15000,
});

http.interceptors.request.use(config => {
  const auth = useAuthStore();
  if (auth.token) config.headers.Authorization = `Bearer ${auth.token}`;
  return config;
});

export interface ApiErrorBody {
  statusCode?: number;
  message?: string | string[];
}

/** 统一错误提示；401 清除会话并回登录页 */
http.interceptors.response.use(
  response => response,
  (error: AxiosError<ApiErrorBody>) => {
    const body = error.response?.data;
    const message = Array.isArray(body?.message)
      ? body?.message[0]
      : body?.message ||
        (error.request ? "无法连接服务器，请确认后端服务已启动" : error.message) ||
        "请求失败";
    if (error.response?.status === 401) {
      const auth = useAuthStore();
      const wasLoggedIn = auth.isLoggedIn;
      auth.logout();
      if (wasLoggedIn) ElMessage.error(message);
      if (router.currentRoute.value.path !== "/login") router.push("/login");
    } else {
      ElMessage.error(message);
    }
    return Promise.reject(error);
  },
);
