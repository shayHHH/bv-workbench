import { createRouter, createWebHistory } from "vue-router";
import { QUOTE_ACCESS_ROLES } from "@bv/shared";
import { localizeText } from "@/i18n";
import AppLayout from "@/layout/AppLayout.vue";
import { useAuthStore } from "@/stores/auth";
import { defaultHomePath, MOBILE_ROLES, shouldEnterMobile } from "@/utils/device";

/** meta.roles 为空表示所有登录用户可见 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("@/views/LoginView.vue"),
      meta: { title: "登录", public: true },
    },
    {
      path: "/m",
      component: () => import("@/mobile/MobileLayout.vue"),
      /* 移动壳只对手机主力三角色开放（MOBILE_ROLES：WALLET/OPS/MANAGER） */
      meta: { roles: [...MOBILE_ROLES] },
      children: [
        { path: "", redirect: "/m/home" },
        {
          path: "home",
          name: "mobileHome",
          component: () => import("@/mobile/views/HomeView.vue"),
          meta: { title: "工作台", tab: "home" },
        },
        {
          path: "orders",
          name: "mobileOrders",
          component: () => import("@/mobile/views/orders/OrderListView.vue"),
          meta: { title: "交易订单", tab: "orders" },
        },
        {
          path: "orders/:id",
          name: "mobileOrderDetail",
          component: () => import("@/mobile/views/orders/OrderDetailView.vue"),
          meta: { title: "订单详情" },
        },
        {
          path: "department",
          name: "mobileDepartment",
          component: () => import("@/mobile/views/department/DepartmentView.vue"),
          meta: { title: "部门管理", tab: "department", roles: ["MANAGER"] },
        },
        {
          path: "profile",
          name: "mobileProfile",
          component: () => import("@/mobile/views/ProfileView.vue"),
          meta: { title: "我的", tab: "profile" },
        },
      ],
    },
    {
      path: "/",
      component: AppLayout,
      children: [
        { path: "", redirect: "/dashboard" },
        {
          path: "dashboard",
          name: "dashboard",
          component: () => import("@/views/DashboardView.vue"),
          meta: { title: "工作台" },
        },
        {
          path: "customers",
          name: "customers",
          component: () => import("@/views/customer/CustomerListView.vue"),
          /* 用户 2026-08-27：客户管理与客户详情抽屉全员可看（meta.roles 为空＝所有登录角色） */
          meta: { title: "客户管理" },
        },
        {
          path: "quote/quick",
          name: "quoteQuick",
          component: () => import("@/views/quote/QuickQuoteView.vue"),
          meta: { title: "快速报价", roles: [...QUOTE_ACCESS_ROLES] },
        },
        {
          path: "quote/batch",
          name: "quoteBatch",
          component: () => import("@/views/quote/BatchQuoteView.vue"),
          meta: { title: "批量报价", roles: [...QUOTE_ACCESS_ROLES] },
        },
        {
          path: "quote/adjust",
          name: "quoteAdjust",
          component: () => import("@/views/quote/FormulaAdjustView.vue"),
          meta: { title: "批量调整公式", roles: [...QUOTE_ACCESS_ROLES] },
        },
        {
          path: "quote/history",
          name: "quoteHistory",
          component: () => import("@/views/quote/QuoteHistoryView.vue"),
          meta: { title: "往期报价", roles: [...QUOTE_ACCESS_ROLES] },
        },
        {
          path: "access/materials",
          name: "accessMaterials",
          component: () => import("@/views/access/MaterialUploadView.vue"),
          meta: { title: "材料上传", roles: [...QUOTE_ACCESS_ROLES] },
        },
        {
          path: "access/materials/:id",
          name: "accessApplication",
          component: () => import("@/views/access/ApplicationWizardView.vue"),
          meta: { title: "材料申报", roles: [...QUOTE_ACCESS_ROLES] },
        },
        {
          path: "access/documents",
          name: "accessDocuments",
          component: () => import("@/views/access/SupplementView.vue"),
          meta: { title: "审核跟踪", roles: [...QUOTE_ACCESS_ROLES] },
        },
        {
          path: "access/documents/:id",
          name: "accessOrderDetail",
          component: () => import("@/views/access/OrderDetailView.vue"),
          meta: { title: "审核工单", roles: [...QUOTE_ACCESS_ROLES] },
        },
        {
          path: "access/documents/:id/supplement",
          name: "accessSupplementWork",
          component: () => import("@/views/access/SupplementWorkView.vue"),
          meta: { title: "补件处理", roles: [...QUOTE_ACCESS_ROLES] },
        },
        {
          path: "compliance/review",
          name: "complianceReview",
          component: () => import("@/views/compliance/ReviewQueueView.vue"),
          meta: { title: "合规审核", roles: ["COMPLIANCE", "RISK_OFFICER", "ADMIN"] },
        },
        {
          path: "compliance/review/:id",
          name: "complianceReviewDetail",
          component: () => import("@/views/compliance/ReviewDetailView.vue"),
          meta: { title: "审核详情", roles: ["COMPLIANCE", "RISK_OFFICER", "ADMIN"] },
        },
        {
          path: "compliance/kyc-config",
          name: "complianceKycConfig",
          component: () => import("@/views/compliance/KycConfigView.vue"),
          meta: { title: "KYC list 配置", roles: ["COMPLIANCE", "RISK_OFFICER", "ADMIN"] },
        },
        {
          path: "compliance/audit",
          name: "complianceAudit",
          component: () => import("@/views/compliance/AuditLogView.vue"),
          meta: { title: "审计日志", roles: ["COMPLIANCE", "RISK_OFFICER", "ADMIN"] },
        },
        {
          path: "orders",
          name: "orders",
          component: () => import("@/views/orders/TradeOrdersView.vue"),
          meta: { title: "交易订单", roles: ["AGENT", "OPS", "PAYOUT", "MANAGER", "FINANCE", "WALLET", "ADMIN"] },
        },
        {
          path: "department",
          name: "department",
          component: () => import("@/views/department/DepartmentView.vue"),
          meta: { title: "部门管理", roles: ["MANAGER"] },
        },
        {
          path: "admin/users",
          name: "adminUsers",
          component: () => import("@/views/admin/UserManagementView.vue"),
          meta: { title: "用户管理", roles: ["ADMIN"] },
        },
        {
          path: "admin/review-assignment",
          name: "adminReviewAssignment",
          component: () => import("@/views/admin/ReviewAssignmentView.vue"),
          meta: { title: "审核分配", roles: ["ADMIN"] },
        },
      ],
    },
    { path: "/:pathMatch(.*)*", redirect: "/dashboard" },
  ],
});

router.beforeEach(async to => {
  const auth = useAuthStore();
  if (to.meta.public) {
    if (auth.isLoggedIn && to.path === "/login") return defaultHomePath(auth.roleCode);
    return true;
  }
  if (!auth.isLoggedIn) return { path: "/login", query: { redirect: to.fullPath } };
  const roles = to.meta.roles as string[] | undefined;
  if (roles?.length && !auth.hasRole(roles)) {
    /* 本人角色不匹配时才去确认代班：交接期内接手人按被代班岗位放行（首次判定要等拉取完成） */
    await auth.ensureHandoffs();
    if (!auth.hasRole(roles)) return "/dashboard";
  }
  /* 手机主力角色在手机设备上访问桌面路由时统一收口到移动壳；已登录期间切换设备/直接改地址栏都要收口，
     不只是登录那一刻——用户在「我的」里主动切换过桌面版后（prefersDesktop）不受此限制 */
  if (!to.path.startsWith("/m") && shouldEnterMobile(auth.roleCode)) return "/m/home";
  return true;
});

router.afterEach(to => {
  const title = (to.meta.title as string | undefined) ?? "";
  /* meta.title 统一写简体，展示按当前语言转换（切换语言时由 AppLayout 的 watch 同步） */
  document.title = title ? `${localizeText(title)} · Bitvast Workbench` : "Bitvast Workbench";
});
