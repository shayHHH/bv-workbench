import type { UserVO } from "@bv/shared";
import { defineStore } from "pinia";

const TOKEN_KEY = "bv-token";
const USER_KEY = "bv-user";

function readStoredUser(): UserVO | null {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) || "",
    user: readStoredUser(),
  }),
  getters: {
    isLoggedIn: state => !!state.token,
    roleCode: state => state.user?.role?.code ?? "",
    initials(state): string {
      const name = state.user?.display_name || "";
      return /^[a-zA-Z]/.test(name) ? name.slice(0, 2).toUpperCase() : name.slice(0, 1);
    },
  },
  actions: {
    setSession(token: string, user: UserVO) {
      this.token = token;
      this.user = user;
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    },
    logout() {
      this.token = "";
      this.user = null;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    },
  },
});
