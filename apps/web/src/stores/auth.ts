import type { ActiveHandoffVO, UserVO } from "@bv/shared";
import { defineStore } from "pinia";
import { fetchMyHandoffs } from "@/api/department";

const TOKEN_KEY = "bv-token";
const USER_KEY = "bv-user";

function readStoredUser(): UserVO | null {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

/** 代班拉取只做一次，路由守卫并发进入时共用同一个 Promise */
let handoffLoading: Promise<void> | null = null;

export const useAuthStore = defineStore("auth", {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) || "",
    user: readStoredUser(),
    /** 业务交接：本人当前生效中的代班（部门管理里由运营经理指定，到期自动失效） */
    handoffs: [] as ActiveHandoffVO[],
    handoffsLoaded: false,
  }),
  getters: {
    isLoggedIn: state => !!state.token,
    roleCode: state => state.user?.role?.code ?? "",
    /** 代班岗位代码（不含本人角色） */
    delegatedRoles: state => [...new Set(state.handoffs.map(item => item.role_code).filter(Boolean))],
    /** 本人角色 + 代班岗位：菜单与页面可见范围一律按这个判定 */
    actingRoles(state): string[] {
      const own = state.user?.role?.code ?? "";
      return [...new Set([own, ...state.handoffs.map(item => item.role_code)].filter(Boolean))];
    },
    initials(state): string {
      const name = state.user?.display_name || "";
      return /^[a-zA-Z]/.test(name) ? name.slice(0, 2).toUpperCase() : name.slice(0, 1);
    },
  },
  actions: {
    hasRole(roles?: readonly string[]): boolean {
      if (!roles?.length) return true;
      return this.actingRoles.some(code => roles.includes(code));
    },
    setSession(token: string, user: UserVO) {
      this.token = token;
      this.user = user;
      this.handoffs = [];
      this.handoffsLoaded = false;
      handoffLoading = null;
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    },
    /** 载入本人代班（登录后与路由守卫首次判定时调用，失败按「无代班」处理） */
    ensureHandoffs(force = false): Promise<void> {
      if (!this.token) return Promise.resolve();
      if (this.handoffsLoaded && !force) return Promise.resolve();
      if (!handoffLoading || force) {
        handoffLoading = fetchMyHandoffs()
          .then(list => {
            this.handoffs = list;
          })
          .catch(() => {
            this.handoffs = [];
          })
          .finally(() => {
            this.handoffsLoaded = true;
            handoffLoading = null;
          });
      }
      return handoffLoading;
    },
    logout() {
      this.token = "";
      this.user = null;
      this.handoffs = [];
      this.handoffsLoaded = false;
      handoffLoading = null;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    },
  },
});
