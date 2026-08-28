/**
 * 移动端（H5）设备与角色判定。
 * 移动壳只对已有 H5 工作台的手机主力角色开放：
 * 钱包运营 WALLET / 高级交易员 OPS；其余角色始终使用桌面端。
 */
export const MOBILE_ROLES = ["WALLET", "OPS"] as const;

const DESKTOP_PREF_KEY = "bv-prefer-desktop";

/** UA 判定手机（Android 平板无 Mobile 标记、iPad 报 Mac，均按桌面处理） */
export function isMobileDevice(): boolean {
  return /Android.*Mobile|iPhone|iPod|Windows Phone/i.test(navigator.userAgent);
}

export function hasMobileWorkbench(roleCode: string): boolean {
  return (MOBILE_ROLES as readonly string[]).includes(roleCode);
}

/** 手机上主动「切换桌面版」的记忆：会话级，关浏览器后重新回到移动版 */
export function prefersDesktop(): boolean {
  try {
    return sessionStorage.getItem(DESKTOP_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPrefersDesktop(value: boolean): void {
  try {
    if (value) sessionStorage.setItem(DESKTOP_PREF_KEY, "1");
    else sessionStorage.removeItem(DESKTOP_PREF_KEY);
  } catch {
    /* 隐私模式下忽略 */
  }
}

/** 当前访问是否应落到移动壳（登录后跳转与桌面路由拦截共用） */
export function shouldEnterMobile(roleCode: string): boolean {
  return isMobileDevice() && hasMobileWorkbench(roleCode) && !prefersDesktop();
}

export function defaultHomePath(roleCode: string): string {
  return shouldEnterMobile(roleCode) ? "/m/home" : "/dashboard";
}
