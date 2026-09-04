import type {
  ReviewAuditType,
  ReviewFinalResult,
  AccessApplicationVO,
  ArchiveMaterialsInput,
  CustomerMaterialVO,
  FileRef,
  PageResult,
  ReviewCaseVO,
  ReviewDecisionInput,
  ReviewStatsVO,
  ReviewType,
  SaveApplicationDraftInput,
} from "@bv/shared";
import { http } from "./http";

/* ---------------- 准入申请（交易员侧） ---------------- */

export interface ApplicationListQuery {
  /** 逗号分隔状态列表，如 "SUPPLEMENT_REQUIRED,REJECTED" */
  status?: string;
  keyword?: string;
  customer_id?: string;
  updated_from?: number;
  updated_to?: number;
  page?: number;
  page_size?: number;
}

export async function fetchApplications(
  query: ApplicationListQuery,
): Promise<PageResult<AccessApplicationVO>> {
  const { data } = await http.get<PageResult<AccessApplicationVO>>("/access/applications", {
    params: query,
  });
  return data;
}

export async function fetchApplication(id: string): Promise<AccessApplicationVO> {
  const { data } = await http.get<AccessApplicationVO>(`/access/applications/${id}`);
  return data;
}

export async function createApplication(customerId: string): Promise<AccessApplicationVO> {
  const { data } = await http.post<AccessApplicationVO>("/access/applications", {
    customer_id: customerId,
  });
  return data;
}

export async function saveApplicationDraft(
  id: string,
  input: SaveApplicationDraftInput,
): Promise<AccessApplicationVO> {
  const { data } = await http.patch<AccessApplicationVO>(`/access/applications/${id}`, input);
  return data;
}

export async function submitApplication(
  id: string,
  reviewType: ReviewType,
): Promise<AccessApplicationVO> {
  const { data } = await http.post<AccessApplicationVO>(`/access/applications/${id}/submit`, {
    review_type: reviewType,
  });
  return data;
}

/** 重新提交（审核拒绝/已过期/已取消 → 重开为草稿） */
export async function reopenApplication(id: string): Promise<AccessApplicationVO> {
  const { data } = await http.post<AccessApplicationVO>(`/access/applications/${id}/reopen`);
  return data;
}

export async function cancelApplication(id: string, note?: string): Promise<AccessApplicationVO> {
  const { data } = await http.post<AccessApplicationVO>(`/access/applications/${id}/cancel`, {
    note,
  });
  return data;
}

/* ---------------- 文件 ---------------- */

export async function uploadFile(file: File): Promise<FileRef> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await http.post<FileRef>("/files", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 60000,
  });
  return data;
}

/** 鉴权预览：以 blob 打开新窗口（<a href> 直链无法带 Authorization 头） */
export async function openFilePreview(ref: FileRef, download = false): Promise<void> {
  const { data } = await http.get<Blob>("/files", {
    params: { key: ref.storage_key, name: ref.original_name, download: download ? 1 : undefined },
    responseType: "blob",
    timeout: 60000,
  });
  const url = URL.createObjectURL(new Blob([data], { type: ref.mime_type }));
  if (download) {
    const link = document.createElement("a");
    link.href = url;
    link.download = ref.original_name;
    link.click();
  } else {
    window.open(url, "_blank");
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* ---------------- 客户材料库 ---------------- */

export async function fetchCustomerMaterials(customerId: string): Promise<CustomerMaterialVO[]> {
  const { data } = await http.get<CustomerMaterialVO[]>(`/access/customers/${customerId}/materials`);
  return data;
}

export async function archiveCustomerMaterials(
  customerId: string,
  input: ArchiveMaterialsInput,
): Promise<CustomerMaterialVO[]> {
  const { data } = await http.post<CustomerMaterialVO[]>(
    `/access/customers/${customerId}/materials`,
    input,
  );
  return data;
}

export async function deleteCustomerMaterial(id: string): Promise<void> {
  await http.delete(`/access/materials/${id}`);
}

/* ---------------- 合规审核 ---------------- */

export interface ReviewListQuery {
  status?: "PENDING" | "PROCESSED";
  /** 已处理工单分桶：跟踪中（驳回/条件性通过待补件）或已完结（申请终态）；仅 status=PROCESSED 生效 */
  bucket?: "ON_HOLD" | "CLOSED";
  keyword?: string;
  audit_type?: ReviewAuditType;
  review_type?: ReviewType;
  final_result?: ReviewFinalResult;
  /** 已处理页签「我的结论」筛选 */
  decision_action?: "APPROVE" | "CONDITIONAL" | "REJECT" | "TERMINATE";
  submitted_from?: number;
  submitted_to?: number;
  sort_by?: "submitted_at" | "reviewed_at";
  sort_order?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

/** 合规官工作台指标 */
export async function fetchReviewStats(): Promise<ReviewStatsVO> {
  const { data } = await http.get<ReviewStatsVO>("/review/cases/stats");
  return data;
}

export async function fetchReviewCases(
  query: ReviewListQuery,
): Promise<PageResult<ReviewCaseVO>> {
  const { data } = await http.get<PageResult<ReviewCaseVO>>("/review/cases", { params: query });
  return data;
}

export async function fetchReviewCase(id: string): Promise<ReviewCaseVO> {
  const { data } = await http.get<ReviewCaseVO>(`/review/cases/${id}`);
  return data;
}

export async function decideReviewCase(
  id: string,
  input: ReviewDecisionInput,
): Promise<ReviewCaseVO> {
  const { data } = await http.post<ReviewCaseVO>(`/review/cases/${id}/decision`, input);
  return data;
}
