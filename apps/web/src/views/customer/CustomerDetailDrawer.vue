<script setup lang="ts">
import {
  AccessStatusLabel,
  ApplicationMaterialStatusLabel,
  FundingKindLabel,
  FundingOwnerLabel,
  ReviewDecisionActionLabel,
  ReviewTypeLabel,
  CustomerKind,
  CustomerKindLabel,
  CustomerStatus,
  CustomerStatusLabel,
  CustomerSubTypeLabel,
  RegionLabel,
  TradeOrderStatusLabel,
  fundingKindOf,
  fundingOwnerRole,
  type AccessApplicationVO,
  type ApplicationMaterialVO,
  type AccessStatus,
  type CustomerEventVO,
  type CustomerMaterialVO,
  type CustomerVO,
  type FileRef,
  type FundingMarkVO,
  type FundingSide,
  type PayoutOrderVO,
  type TradeOrderVO,
} from "@bv/shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { CUSTOMER_STATUS_TONE, ACCESS_STATUS_TONE } from "@/components/statusTones";
import { localizeText } from "@/i18n";
import { fetchApplication, fetchApplications, fetchCustomerMaterials, openFilePreview } from "@/api/access";
import { fetchCustomer, fetchCustomerEvents, updateCustomer } from "@/api/customer";
import { fetchOrderDispatch, fetchOrders } from "@/api/order";
import { formatDateTime, formatRelative } from "@/utils/format";

const { t } = useI18n();
const visible = defineModel<boolean>({ required: true });
const props = defineProps<{ customer: CustomerVO | null }>();
const emit = defineEmits<{ edit: [customer: CustomerVO]; changed: [] }>();

const current = ref<CustomerVO | null>(null);
const activeTab = ref("overview");
const events = ref<CustomerEventVO[]>([]);
const eventsLoading = ref(false);
const statusSubmitting = ref(false);
/* 材料库 / 准入申请页签（数据来自业务准入模块，按需加载） */
const materials = ref<CustomerMaterialVO[]>([]);
const materialsLoading = ref(false);
const materialsLoaded = ref(false);
const applications = ref<AccessApplicationVO[]>([]);
const applicationsLoading = ref(false);
const applicationsLoaded = ref(false);
const orders = ref<TradeOrderVO[]>([]);
const ordersLoading = ref(false);
const ordersLoaded = ref(false);

const isSub = computed(() => current.value?.customer_kind === CustomerKind.SUB_CUSTOMER);
const isIntermediary = computed(() => current.value?.customer_kind === CustomerKind.INTERMEDIARY);
const suspended = computed(() => current.value?.customer_status === CustomerStatus.SUSPENDED);

const eyebrow = computed(() => {
  switch (current.value?.customer_kind) {
    case CustomerKind.INTERMEDIARY:
      return "INTERMEDIARY CUSTOMER";
    case CustomerKind.SUB_CUSTOMER:
      return "INTERMEDIARY SUB CUSTOMER";
    default:
      return "DIRECT CUSTOMER";
  }
});

const statusTagType = CUSTOMER_STATUS_TONE;

async function loadEvents() {
  if (!current.value) return;
  eventsLoading.value = true;
  try {
    events.value = await fetchCustomerEvents(current.value.id);
  } finally {
    eventsLoading.value = false;
  }
}

async function loadMaterials() {
  if (!current.value) return;
  materialsLoading.value = true;
  try {
    materials.value = await fetchCustomerMaterials(current.value.id);
    materialsLoaded.value = true;
  } finally {
    materialsLoading.value = false;
  }
}

async function loadApplications() {
  if (!current.value) return;
  applicationsLoading.value = true;
  try {
    const result = await fetchApplications({ customer_id: current.value.id, page: 1, page_size: 50 });
    applications.value = result.items;
    applicationsLoaded.value = true;
  } finally {
    applicationsLoading.value = false;
  }
}

async function loadOrders() {
  if (!current.value) return;
  ordersLoading.value = true;
  try {
    const result = await fetchOrders({ customer_id: current.value.id, page: 1, page_size: 50 });
    orders.value = result.items;
    ordersLoaded.value = true;
  } finally {
    ordersLoading.value = false;
  }
}

function resetTabData() {
  events.value = [];
  materials.value = [];
  materialsLoaded.value = false;
  applications.value = [];
  applicationsLoaded.value = false;
  orders.value = [];
  ordersLoaded.value = false;
  expandedApps.value = new Set();
  appDetails.value = new Map();
  expandedOrders.value = new Set();
  orderDispatches.value = new Map();
}

/** 切换抽屉主体（查看下级客户 / 上级中介） */
async function switchTo(target: CustomerVO | string) {
  try {
    current.value = typeof target === "string" ? await fetchCustomer(target) : target;
    resetTabData();
    onTabActivated(activeTab.value);
  } catch {
    /* 错误提示由 http 拦截器统一处理 */
  }
}

watch(visible, open => {
  if (!open) return;
  current.value = props.customer;
  activeTab.value = "overview";
  resetTabData();
});

/* 抽屉未关时切换目标客户（如列表再次点击其它客户名）也要刷新内容 */
watch(
  () => props.customer,
  customer => {
    if (!visible.value || !customer || customer.id === current.value?.id) return;
    current.value = customer;
    activeTab.value = "overview";
    resetTabData();
  },
);

function onTabActivated(tab: string) {
  if (tab === "timeline" && !events.value.length) loadEvents();
  if (tab === "documents" && !materialsLoaded.value) loadMaterials();
  if (tab === "applications" && !applicationsLoaded.value) loadApplications();
  if (tab === "funding" && !ordersLoaded.value) loadOrders();
}

watch(activeTab, onTabActivated);

/** 暂停 / 恢复合作：真实状态变更 + 备注写入档案事件 */
async function toggleCooperation() {
  const c = current.value;
  if (!c) return;
  const pausing = !suspended.value;
  try {
    const { value } = await ElMessageBox.prompt(
      pausing
        ? t("customer.drawer.pauseConfirm", { name: c.name })
        : t("customer.drawer.resumeConfirm", { name: c.name }),
      pausing ? t("customer.drawer.pauseCooperation") : t("customer.drawer.resumeCooperation"),
      {
        inputPlaceholder: pausing
          ? t("customer.drawer.pauseReasonPh")
          : t("customer.drawer.resumeReasonPh"),
        confirmButtonText: pausing
          ? t("customer.drawer.confirmPause")
          : t("customer.drawer.confirmResume"),
        cancelButtonText: t("customer.common.cancel"),
      },
    );
    statusSubmitting.value = true;
    const updated = await updateCustomer(c.id, {
      customer_status: pausing ? CustomerStatus.SUSPENDED : CustomerStatus.ACTIVE,
      change_note: value?.trim() || null,
    });
    current.value = { ...c, ...updated };
    ElMessage.success(
      pausing
        ? t("customer.drawer.pausedSuccess", { name: c.name })
        : t("customer.drawer.resumedSuccess", { name: c.name }),
    );
    events.value = [];
    if (activeTab.value === "timeline") await loadEvents();
    emit("changed");
  } catch {
    /* 用户取消或接口错误 */
  } finally {
    statusSubmitting.value = false;
  }
}

const accessStatusTagType = ACCESS_STATUS_TONE;

const orderStatusTagType: Record<string, "primary" | "success" | "warning" | "info" | "danger"> = {
  PENDING_KYC: "info",
  AWAITING_INFLOW: "warning",
  AWAITING_DISPATCH: "primary",
  DISPATCH_REVIEW: "info",
  AWAITING_PAYOUT: "warning",
  COMPLETED: "success",
  CANCELLED: "info",
};

/* 准入记录卡片点击展开：详情按需拉取并缓存（材料清单/结论/时间线） */
const expandedApps = ref(new Set<string>());
const appDetails = ref(new Map<string, AccessApplicationVO>());
const appDetailLoading = ref<string | null>(null);

/** 完成时间：终态申请取最近结论时间（取消/过期等无结论时取最后更新），进行中返回 null */
const FINAL_ACCESS_STATUSES = new Set(["APPROVED", "REJECTED", "CANCELLED", "EXPIRED", "SUSPENDED"]);
function appDoneAt(app: AccessApplicationVO): string | null {
  if (!FINAL_ACCESS_STATUSES.has(app.status)) return null;
  return app.latest_review?.reviewed_at ?? app.updated_at;
}

async function toggleApplication(app: AccessApplicationVO) {
  const next = new Set(expandedApps.value);
  if (next.has(app.id)) {
    next.delete(app.id);
    expandedApps.value = next;
    return;
  }
  next.add(app.id);
  expandedApps.value = next;
  if (!appDetails.value.has(app.id)) {
    appDetailLoading.value = app.id;
    try {
      const detail = await fetchApplication(app.id);
      const map = new Map(appDetails.value);
      map.set(app.id, detail);
      appDetails.value = map;
    } finally {
      appDetailLoading.value = null;
    }
  }
}

const appDetailOf = (app: AccessApplicationVO) => appDetails.value.get(app.id) ?? app;

const materialStatusTagType: Record<string, "primary" | "success" | "warning" | "info" | "danger"> = {
  PENDING: "info",
  APPROVED: "success",
  RETURNED: "danger",
};

function fileSizeText(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function docIcon(mime: string): string {
  if (mime.includes("pdf")) return "PDF";
  if (mime.startsWith("image/")) return t("customer.drawer.docIconImage");
  return t("customer.drawer.docIconFile");
}

function previewAppMaterial(material: ApplicationMaterialVO) {
  if (!material.file) return;
  openFilePreview(material.file).catch(() => {
    /* 错误提示由 http 拦截器统一处理 */
  });
}

async function previewMaterial(material: CustomerMaterialVO, download = false) {
  try {
    await openFilePreview(material.file, download);
  } catch {
    /* 错误提示由 http 拦截器统一处理 */
  }
}

const expandedOrders = ref(new Set<string>());
const orderDispatches = ref(new Map<string, PayoutOrderVO | null>());
const orderDispatchLoading = ref<string | null>(null);

async function toggleOrder(order: TradeOrderVO) {
  const next = new Set(expandedOrders.value);
  if (next.has(order.id)) {
    next.delete(order.id);
    expandedOrders.value = next;
    return;
  }
  next.add(order.id);
  expandedOrders.value = next;
  if (order.dispatch_id && !orderDispatches.value.has(order.id)) {
    orderDispatchLoading.value = order.id;
    try {
      const dispatch = await fetchOrderDispatch(order.id);
      const map = new Map(orderDispatches.value);
      map.set(order.id, dispatch);
      orderDispatches.value = map;
    } finally {
      orderDispatchLoading.value = null;
    }
  }
}

function fmtMoney(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString("en-US")}`;
}

function fundingKindText(order: TradeOrderVO, side: FundingSide): string {
  return localizeText(FundingKindLabel[fundingKindOf(order, side)]);
}

function fundingOwnerText(order: TradeOrderVO, side: FundingSide): string {
  const role = fundingOwnerRole(order, side);
  return localizeText(FundingOwnerLabel[role] ?? role);
}

function isFileRef(value: unknown): value is FileRef {
  return !!value && typeof value === "object" && "storage_key" in value && "original_name" in value;
}

function voucherText(voucher: FundingMarkVO["voucher"] | undefined): string {
  if (!voucher) return "-";
  return typeof voucher === "string" ? voucher : voucher.original_name;
}

async function previewFile(file: FileRef, download = false) {
  try {
    await openFilePreview(file, download);
  } catch {
    /* 错误提示由 http 拦截器统一处理 */
  }
}

function fundingRows(order: TradeOrderVO, side: FundingSide): Array<[string, string | FileRef]> {
  const mark = side === "inflow" ? order.inflow_mark : order.outflow_mark;
  const expectedAmount = side === "inflow" ? order.sell_amount : order.buy_amount;
  const expectedCurrency = side === "inflow" ? order.sell_currency : order.buy_currency;
  const rows: Array<[string, string | FileRef]> = [
    [
      side === "inflow" ? t("customer.drawer.orderExpectedInflow") : t("customer.drawer.orderExpectedOutflow"),
      fmtMoney(expectedCurrency, expectedAmount),
    ],
    [t("customer.drawer.orderFundingKind"), fundingKindText(order, side)],
    [t("customer.drawer.orderFundingOwner"), fundingOwnerText(order, side)],
  ];
  if (!mark) {
    rows.push([t("customer.drawer.orderMarkStatus"), t("customer.drawer.orderMarkPending")]);
    return rows;
  }
  rows.push([
    side === "inflow" ? t("customer.drawer.orderActualInflow") : t("customer.drawer.orderActualOutflow"),
    fmtMoney(mark.currency || expectedCurrency, mark.amount),
  ]);
  rows.push([t("customer.drawer.orderMarkedBy"), `${mark.by} · ${formatDateTime(mark.at)}`]);
  if (mark.method) rows.push([t("customer.drawer.orderMethod"), mark.method]);
  if (mark.account) rows.push([t("customer.drawer.orderAccount"), mark.account]);
  if (mark.hash) rows.push([t("customer.drawer.orderHash"), [mark.chain, mark.hash, mark.confirms ? `${mark.confirms} confirmations` : ""].filter(Boolean).join(" · ")]);
  if (mark.place) rows.push([t("customer.drawer.orderPlace"), [mark.place, mark.handler].filter(Boolean).join(" · ")]);
  if (mark.voucher) rows.push([t("customer.drawer.orderVoucher"), mark.voucher]);
  if (mark.note) rows.push([t("customer.drawer.orderNote"), mark.note]);
  return rows;
}

const kindText = (c: CustomerVO) => localizeText(CustomerKindLabel[c.customer_kind]);
const statusText = (c: CustomerVO) => localizeText(CustomerStatusLabel[c.customer_status]);
const regionText = (c: CustomerVO) => (c.region ? localizeText(RegionLabel[c.region]) : t("customer.drawer.regionEmpty"));
const subTypeText = (c: CustomerVO) => (c.sub_type ? localizeText(CustomerSubTypeLabel[c.sub_type]) : t("customer.drawer.subTypeEmpty"));
</script>

<template>
  <el-drawer v-model="visible" size="520px" :with-header="false">
    <div v-if="current" class="drawer">
      <header class="drawer-head">
        <div>
          <p class="eyebrow">{{ eyebrow }}</p>
          <h2>
            {{ current.name }}
            <el-tag :type="statusTagType[current.customer_status]" effect="light">
              {{ statusText(current) }}
            </el-tag>
            <el-tag v-if="current.deferral_overdue" type="danger" effect="dark">
              {{ t("customer.common.deferralOverdue") }}
            </el-tag>
            <el-tag v-else-if="current.deferral_pending" type="warning" effect="plain">
              {{ t("customer.common.deferralPending") }}
            </el-tag>
          </h2>
          <p class="sub-line">
            {{ current.customer_code || t("customer.common.noCode") }} · {{ kindText(current) }}
            <template v-if="current.parent_name"> · {{ t("customer.drawer.parentBroker") }} {{ current.parent_name }}</template>
          </p>
        </div>
        <div class="head-actions">
          <el-button size="small" @click="emit('edit', current)">{{ t("customer.common.editInfo") }}</el-button>
          <button class="drawer-close" type="button" :aria-label="t('customer.drawer.close')" @click="visible = false">×</button>
        </div>
      </header>

      <el-tabs v-model="activeTab">
        <el-tab-pane :label="t('customer.drawer.tabOverview')" name="overview">
          <el-descriptions :column="2" class="overview-grid">
            <el-descriptions-item :label="t('customer.common.customerCode')">{{ current.customer_code || t("customer.common.noCode") }}</el-descriptions-item>
            <el-descriptions-item :label="t('customer.drawer.kind')">{{ kindText(current) }}</el-descriptions-item>
            <template v-if="isSub">
              <el-descriptions-item :label="t('customer.drawer.parentBroker')">
                <el-button
                  v-if="current.parent_id"
                  link
                  type="primary"
                  @click="switchTo(current.parent_id!)"
                >
                  {{ current.parent_name || t("customer.drawer.view") }}
                </el-button>
                <span v-else>-</span>
              </el-descriptions-item>
              <el-descriptions-item :label="t('customer.drawer.subType')">{{ subTypeText(current) }}</el-descriptions-item>
            </template>
            <el-descriptions-item :label="t('customer.common.region')">{{ regionText(current) }}</el-descriptions-item>
            <el-descriptions-item :label="t('customer.common.phone')">{{ current.phone || "-" }}</el-descriptions-item>
            <el-descriptions-item :label="t('customer.common.lastUpdated')">{{ formatRelative(current.updated_at) }}</el-descriptions-item>
            <el-descriptions-item :label="t('customer.drawer.createdAt')" :span="2">{{ formatDateTime(current.created_at) }}</el-descriptions-item>
            <el-descriptions-item :label="t('customer.common.remark')" :span="2">{{ current.remark || "-" }}</el-descriptions-item>
          </el-descriptions>

          <section v-if="!isSub" class="section">
            <h3>{{ t("customer.drawer.statusManagement") }}</h3>
            <div class="lifecycle-row">
              <span>{{ t("customer.drawer.lifecycle") }}</span>
              <el-tag :type="statusTagType[current.customer_status]" effect="light">
                {{ statusText(current) }}
              </el-tag>
              <el-button
                size="small"
                :type="suspended ? 'primary' : 'default'"
                :loading="statusSubmitting"
                @click="toggleCooperation"
              >
                {{ suspended ? t("customer.drawer.resumeCooperation") : t("customer.drawer.pauseCooperation") }}
              </el-button>
            </div>
            <p class="hint">{{ t("customer.drawer.statusHint") }}</p>
          </section>

          <section v-if="isIntermediary && current.sub_customers?.length" class="section">
            <h3>{{ t("customer.drawer.subCustomersCount", { n: current.sub_customers.length }) }}</h3>
            <div v-for="sub in current.sub_customers" :key="sub.id" class="sub-row">
              <div class="sub-main">
                <strong>{{ sub.name }}</strong>
                <small>{{ sub.customer_code || t("customer.common.noCode") }}{{ sub.sub_type ? ` · ${subTypeText(sub)}` : "" }}</small>
              </div>
              <el-tag :type="statusTagType[sub.customer_status]" effect="light" size="small">
                {{ statusText(sub) }}
              </el-tag>
              <el-button size="small" link type="primary" @click="switchTo(sub)">{{ t("customer.drawer.view") }} →</el-button>
            </div>
          </section>
        </el-tab-pane>

        <el-tab-pane :label="t('customer.drawer.tabTimeline')" name="timeline">
          <div v-loading="eventsLoading" class="timeline-pane">
            <el-timeline v-if="events.length">
              <el-timeline-item
                v-for="event in events"
                :key="event.id"
                :timestamp="`${event.operator_name ? `${event.operator_name} · ` : ''}${formatDateTime(event.created_at)}`"
              >
                <strong>{{ event.title }}</strong>
                <p class="event-detail">{{ event.detail }}</p>
              </el-timeline-item>
            </el-timeline>
            <el-empty v-else-if="!eventsLoading" :description="t('customer.drawer.emptyEvents')" />
          </div>
        </el-tab-pane>

        <el-tab-pane :label="t('customer.drawer.tabDocuments')" name="documents">
          <div v-loading="materialsLoading" class="tab-pane-body">
            <template v-if="materials.length">
              <div v-for="material in materials" :key="material.id" class="doc-row">
                <span class="doc-icon">{{ docIcon(material.file.mime_type) }}</span>
                <div class="doc-main">
                  <strong>{{ material.name }}</strong>
                  <small>
                    {{ material.category ? `${material.category} · ` : "" }}v{{ material.version }} ·
                    {{ fileSizeText(material.file.size) }}
                    {{ material.uploader_name ? ` · ${material.uploader_name}` : "" }} ·
                    {{ formatRelative(material.created_at) }}
                  </small>
                </div>
                <el-button size="small" @click="previewMaterial(material)">{{ t("customer.drawer.preview") }}</el-button>
                <el-button size="small" @click="previewMaterial(material, true)">{{ t("customer.drawer.download") }}</el-button>
              </div>
            </template>
            <el-empty
              v-else-if="!materialsLoading"
              :description="t('customer.drawer.emptyMaterials')"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane :label="t('customer.drawer.tabApplications')" name="applications">
          <div v-loading="applicationsLoading" class="tab-pane-body">
            <template v-if="applications.length">
              <div
                v-for="app in applications"
                :key="app.id"
                class="app-card clickable"
                :class="{ expanded: expandedApps.has(app.id) }"
                @click="toggleApplication(app)"
              >
                <div class="app-head">
                  <strong>{{ app.scenario_name || t("customer.drawer.noScenario") }}</strong>
                  <el-tag :type="accessStatusTagType[app.status]" effect="light" size="small">
                    {{ localizeText(AccessStatusLabel[app.status]) }}
                  </el-tag>
                  <span class="app-toggle">{{ expandedApps.has(app.id) ? "⌃" : "⌄" }}</span>
                </div>
                <small class="app-meta">
                  {{ app.channel_name || app.channel_code || "-" }}
                  · {{ formatRelative(appDoneAt(app) || app.submitted_at || app.updated_at) }}
                </small>
                <p v-if="app.latest_review?.reason && !expandedApps.has(app.id)" class="app-reason">
                  {{ t("customer.drawer.latestConclusion", { reason: app.latest_review.reason }) }}
                </p>

                <div
                  v-if="expandedApps.has(app.id)"
                  v-loading="appDetailLoading === app.id"
                  class="app-detail"
                  @click.stop
                >
                  <div class="app-info-grid">
                    <div><span>{{ t("customer.drawer.appReviewType") }}</span><b>{{ appDetailOf(app).review_type ? localizeText(ReviewTypeLabel[appDetailOf(app).review_type!]) : "-" }}</b></div>
                    <div><span>{{ t("customer.drawer.appOwner") }}</span><b>{{ appDetailOf(app).owner_name || "-" }}</b></div>
                    <div><span>{{ t("customer.drawer.appSubmittedAt") }}</span><b>{{ appDetailOf(app).submitted_at ? formatDateTime(appDetailOf(app).submitted_at) : t("customer.drawer.appNotSubmitted") }}</b></div>
                    <div><span>{{ t("customer.drawer.appFinishedAt") }}</span><b>{{ appDoneAt(appDetailOf(app)) ? formatDateTime(appDoneAt(appDetailOf(app))) : t("customer.drawer.appNotFinished") }}</b></div>
                  </div>

                  <h5>{{ t("customer.drawer.appMaterials", { n: appDetailOf(app).materials.length }) }}</h5>
                  <div v-if="appDetailOf(app).materials.length" class="app-material-list">
                    <div v-for="material in appDetailOf(app).materials" :key="material.material_key" class="app-material-row">
                      <a v-if="material.file" class="material-name link" @click.stop="previewAppMaterial(material)">{{ material.name }}</a>
                      <span v-else class="material-name">{{ material.name }}</span>
                      <el-tag :type="materialStatusTagType[material.status] ?? 'info'" size="small" effect="plain">
                        {{ localizeText(ApplicationMaterialStatusLabel[material.status]) }}
                      </el-tag>
                      <em v-if="material.return_reason" class="material-reason">{{ material.return_reason }}</em>
                    </div>
                  </div>
                  <p v-else class="app-empty-line">{{ t("customer.drawer.appNoMaterials") }}</p>

                  <template v-if="appDetailOf(app).latest_review">
                    <h5>{{ t("customer.drawer.appLatestReview") }}</h5>
                    <p class="app-review-line">
                      {{ localizeText(ReviewDecisionActionLabel[appDetailOf(app).latest_review!.action] ?? appDetailOf(app).latest_review!.action) }}
                      · {{ appDetailOf(app).latest_review!.reviewer_name || "-" }}
                      · {{ formatDateTime(appDetailOf(app).latest_review!.reviewed_at) }}
                      <em v-if="appDetailOf(app).latest_review!.reason">「{{ appDetailOf(app).latest_review!.reason }}」</em>
                    </p>
                  </template>

                  <h5>{{ t("customer.drawer.appTimeline") }}</h5>
                  <div v-if="appDetailOf(app).timeline.length" class="app-timeline">
                    <div v-for="(entry, index) in [...appDetailOf(app).timeline].reverse()" :key="index" class="app-timeline-row">
                      <time>{{ formatDateTime(entry.at) }}</time>
                      <span>{{ entry.action }}{{ entry.by_name ? ` · ${entry.by_name}` : "" }}</span>
                      <em v-if="entry.note">{{ entry.note }}</em>
                    </div>
                  </div>
                  <p v-else class="app-empty-line">{{ t("customer.drawer.appNoTimeline") }}</p>
                </div>
              </div>
            </template>
            <el-empty v-else-if="!applicationsLoading" :description="t('customer.drawer.emptyApplications')" />
          </div>
        </el-tab-pane>

        <el-tab-pane :label="t('customer.drawer.tabFunding')" name="funding">
          <div v-loading="ordersLoading" class="tab-pane-body">
            <template v-if="orders.length">
              <div
                v-for="order in orders"
                :key="order.id"
                class="app-card order-card clickable"
                :class="{ expanded: expandedOrders.has(order.id) }"
                @click="toggleOrder(order)"
              >
                <div class="app-head">
                  <strong>{{ order.order_no }}</strong>
                  <el-tag :type="orderStatusTagType[order.status] ?? 'info'" effect="light" size="small">
                    {{ localizeText(TradeOrderStatusLabel[order.status]) }}
                  </el-tag>
                  <span class="app-toggle">{{ expandedOrders.has(order.id) ? "⌃" : "⌄" }}</span>
                </div>
                <small class="app-meta">
                  {{ order.trade_type }} ·
                  {{ fmtMoney(order.sell_currency, order.sell_amount) }} → {{ fmtMoney(order.buy_currency, order.buy_amount) }} ·
                  {{ formatRelative(order.created_at) }}
                </small>
                <p v-if="order.exception && !expandedOrders.has(order.id)" class="app-reason">
                  {{ order.exception.kind }}：{{ order.exception.reason }}
                </p>

                <div
                  v-if="expandedOrders.has(order.id)"
                  v-loading="orderDispatchLoading === order.id"
                  class="app-detail order-detail"
                  @click.stop
                >
                  <div class="app-info-grid">
                    <div><span>{{ t("customer.drawer.orderBusinessType") }}</span><b>{{ order.business_type || "-" }}</b></div>
                    <div><span>{{ t("customer.drawer.orderRate") }}</span><b>{{ order.rate }}</b></div>
                    <div><span>{{ t("customer.drawer.orderHandler") }}</span><b>{{ order.handler_name || "-" }}</b></div>
                    <div><span>{{ t("customer.drawer.orderUpdatedAt") }}</span><b>{{ formatDateTime(order.updated_at) }}</b></div>
                  </div>

                  <template v-if="order.quote">
                    <h5>{{ t("customer.drawer.orderQuote") }}</h5>
                    <p class="app-review-line">
                      {{ order.quote.source }} · {{ order.quote.deal_rate }}
                      <em>{{ [order.quote.quoted_by, order.quote.quoted_at ? formatDateTime(order.quote.quoted_at) : ""].filter(Boolean).join(" · ") }}</em>
                    </p>
                  </template>

                  <h5>{{ t("customer.drawer.orderInflow") }}</h5>
                  <div class="order-field-list">
                    <div v-for="[label, value] in fundingRows(order, 'inflow')" :key="`in-${label}`" class="order-field-row">
                      <span>{{ label }}</span>
                      <b v-if="!isFileRef(value)">{{ value }}</b>
                      <span v-else class="file-actions">
                        <b>{{ voucherText(value) }}</b>
                        <el-button size="small" link type="primary" @click="previewFile(value)">{{ t("customer.drawer.preview") }}</el-button>
                        <el-button size="small" link @click="previewFile(value, true)">{{ t("customer.drawer.download") }}</el-button>
                      </span>
                    </div>
                  </div>

                  <h5>{{ t("customer.drawer.orderOutflow") }}</h5>
                  <div class="order-field-list">
                    <div v-for="[label, value] in fundingRows(order, 'outflow')" :key="`out-${label}`" class="order-field-row">
                      <span>{{ label }}</span>
                      <b v-if="!isFileRef(value)">{{ value }}</b>
                      <span v-else class="file-actions">
                        <b>{{ voucherText(value) }}</b>
                        <el-button size="small" link type="primary" @click="previewFile(value)">{{ t("customer.drawer.preview") }}</el-button>
                        <el-button size="small" link @click="previewFile(value, true)">{{ t("customer.drawer.download") }}</el-button>
                      </span>
                    </div>
                  </div>

                  <template v-if="order.dispatch_id">
                    <h5>{{ t("customer.drawer.orderDispatch") }}</h5>
                    <div v-if="orderDispatches.get(order.id)" class="order-field-list">
                      <div class="order-field-row">
                        <span>{{ t("customer.drawer.orderDispatchNo") }}</span>
                        <b>{{ orderDispatches.get(order.id)!.dispatch_no }}</b>
                      </div>
                      <div class="order-field-row">
                        <span>{{ t("customer.drawer.orderDispatchChannel") }}</span>
                        <b>{{ orderDispatches.get(order.id)!.channel }}</b>
                      </div>
                      <div class="order-field-row">
                        <span>{{ t("customer.drawer.orderDispatchReceipt") }}</span>
                        <span v-if="orderDispatches.get(order.id)!.receipt?.file" class="file-actions">
                          <b>{{ orderDispatches.get(order.id)!.receipt!.file!.original_name }}</b>
                          <el-button size="small" link type="primary" @click="previewFile(orderDispatches.get(order.id)!.receipt!.file!)">{{ t("customer.drawer.preview") }}</el-button>
                          <el-button size="small" link @click="previewFile(orderDispatches.get(order.id)!.receipt!.file!, true)">{{ t("customer.drawer.download") }}</el-button>
                        </span>
                        <b v-else>{{ orderDispatches.get(order.id)!.receipt?.file_name || "-" }}</b>
                      </div>
                    </div>
                    <p v-else class="app-empty-line">{{ t("customer.drawer.orderDispatchLoading") }}</p>
                  </template>

                  <h5>{{ t("customer.drawer.orderTimeline") }}</h5>
                  <div v-if="order.timeline.length" class="app-timeline">
                    <div v-for="(entry, index) in order.timeline" :key="index" class="app-timeline-row order-timeline-row">
                      <time>{{ formatDateTime(entry.at) }}</time>
                      <span>{{ entry.title }} · {{ entry.actor }}</span>
                      <em>{{ entry.detail }}</em>
                    </div>
                  </div>
                  <p v-else class="app-empty-line">{{ t("customer.drawer.orderNoTimeline") }}</p>
                </div>
              </div>
            </template>
            <el-empty v-else-if="!ordersLoading" :description="t('customer.drawer.emptyOrders')" />
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </el-drawer>
</template>

<style scoped>
.drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 8px;
}

.eyebrow {
  color: var(--color-accent);
  font-size: 11px;
  letter-spacing: 0.12em;
  margin: 0 0 6px;
}

.drawer-head h2 {
  margin: 0 0 6px;
  font-size: 19px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.sub-line {
  color: var(--color-text-muted);
  margin: 0;
  font-size: 13px;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.drawer-close {
  border: none;
  background: transparent;
  font-size: 22px;
  color: var(--color-text-muted);
  cursor: pointer;
  line-height: 1;
  padding: 2px 6px;
}

.drawer-close:hover {
  color: var(--color-text-primary);
}

.overview-grid :deep(.el-descriptions__label) {
  color: var(--color-text-muted);
}

.section {
  margin-top: 20px;
}

.section h3 {
  font-size: 14px;
  margin: 0 0 10px;
}

.lifecycle-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--color-surface-alt);
  border-radius: 8px;
}

.lifecycle-row > span:first-child {
  color: var(--color-text-secondary);
  font-size: 13px;
}

.lifecycle-row .el-button {
  margin-left: auto;
}

.hint {
  color: var(--color-text-muted);
  font-size: 12px;
  margin: 8px 2px 0;
}

.sub-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  margin-bottom: 8px;
}

.sub-main {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.sub-main small {
  color: var(--color-text-muted);
}

.timeline-pane {
  min-height: 160px;
  padding-top: 6px;
}

.tab-pane-body {
  min-height: 160px;
  padding-top: 4px;
}

.doc-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  margin-bottom: 8px;
}

.doc-icon {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: var(--color-primary-light);
  color: var(--color-accent);
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.doc-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.doc-main strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-main small {
  color: var(--color-text-muted);
}

.app-card.clickable {
  cursor: pointer;
}

.app-card.clickable:hover {
  border-color: var(--color-primary-light);
}

.app-toggle {
  margin-left: auto;
  color: var(--color-text-placeholder);
}

.app-detail {
  margin-top: 10px;
  border-top: 1px dashed var(--color-border);
  padding-top: 10px;
  cursor: default;
}

.app-detail h5 {
  margin: 12px 0 6px;
  font-size: 12px;
  color: var(--color-text-primary);
}

.app-info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 16px;
}

.app-info-grid span {
  display: block;
  color: var(--color-text-muted);
  font-size: 11px;
}

.app-info-grid b {
  font-size: 12px;
  font-weight: 600;
}

.app-material-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.app-material-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.material-name {
  color: var(--color-text-primary);
}

.material-reason {
  color: var(--color-danger);
  font-style: normal;
  font-size: 11px;
}

.app-empty-line,
.app-review-line {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin: 0;
}

.app-review-line em {
  font-style: normal;
  color: var(--color-warning);
}

.app-timeline {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.app-timeline-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
  color: var(--color-text-secondary);
}

.app-timeline-row time {
  color: var(--color-text-muted);
  white-space: nowrap;
}

.app-timeline-row em {
  color: var(--color-text-muted);
  font-style: normal;
}

.app-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 8px;
}

.order-card.expanded {
  border-color: #d9ecff;
  background: #fcfdff;
}

.app-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.app-meta {
  color: var(--color-text-muted);
}

.app-reason {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--color-danger);
}

.order-field-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.order-field-row {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.order-field-row > span:first-child {
  color: var(--color-text-muted);
}

.order-field-row b {
  min-width: 0;
  font-weight: 500;
  color: var(--color-text-primary);
  overflow-wrap: anywhere;
}

.file-actions {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.file-actions b {
  margin-right: 2px;
}

.order-timeline-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
}

.order-timeline-row em {
  grid-column: 2;
  overflow-wrap: anywhere;
}

.event-detail {
  margin: 4px 0 0;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.tabs-hint {
  margin: auto 0 0;
  padding-top: 10px;
  color: var(--color-text-placeholder);
  font-size: 12px;
}
.app-material-row .material-name.link {
  color: var(--el-color-primary);
  cursor: pointer;
}

.app-material-row .material-name.link:hover {
  text-decoration: underline;
}
</style>
