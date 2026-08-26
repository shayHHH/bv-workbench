# 业务准入域集合设计（KYC 配置 / 准入申请 / 材料库 / 审核工单）

> 依据 `docs/BV-MongoDB表结构与设计规范.md` §4.1/§4.2/§4.5/§6.1 与 PRD §4.7-4.10、§5.2、§6.2-6.4。
> 实现位置：`apps/api/src/modules/kyc/`、`apps/api/src/modules/access/`（代码中的 Schema 与索引声明是最终事实来源）。

## kyc_scenarios（KYC 材料清单配置）

业务类型 → 渠道 → 材料项三层模板；配置型小集合。`status=PUBLISHED` 才被材料上传页引用。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `scenario_code` | string | 业务编号，唯一 |
| `scenario_name` | string | 业务类型名称 |
| `process_description` | string \| null | 流程与约束说明（审核详情"人工审核要求"引用） |
| `status` | enum | `DRAFT` / `PUBLISHED` |
| `is_builtin` | bool | 内置模板不可删、不可改编号 |
| `channels[]` | 嵌入 | `{channel_code, channel_name, restriction_note}` |
| `sections[]` | 嵌入 | `{section_name, items[]}`；item：`{item_id, item_name, item_description, item_type(FILE/TEXT/BANK_ACCOUNT), required, max_count, validity_note, channel_codes(null=全渠道)}` |
| `sort_order` / `published_at` | — | 排序 / 最近发布时间 |

查询卡：

| 查询名称 | 过滤条件 | 排序 | 频率 | 对应索引 |
| --- | --- | --- | --- | --- |
| 配置页全量列表 | `is_deleted` | `sort_order` | 低频 | 集合极小，COLLSCAN 可接受 |
| 材料上传页已发布模板 | `is_deleted + status` | `sort_order` | 中频 | 同上 |
| 按业务编号定位 | `scenario_code` | 无 | 中频 | `uk_kyc_scenarios_scenario_code` |

简化说明：发布暂不保留版本历史（保存即改当前文档，发布改状态）；申请侧通过 `scenario_code/name` 冗余快照兜底。若后续要求"发布版本可追溯"，按规范 §4.5 增加快照集合。

## access_applications（准入申请，当前态主表）

按 客户 × 业务类型 × 渠道 记录准入状态（PRD §5.2 状态机）。提交时的输入快照落 `review_cases`，本表始终反映"当前资料"。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `application_no` | string | `APP-YYYYMMDD-序号`，唯一（counters 集合原子自增） |
| `customer_id` | ObjectId | 关联客户 |
| `customer_snapshot` | 嵌入 | `{name, customer_code, customer_kind}` 创建时快照 |
| `scenario_id` / `scenario_code` / `scenario_name` | — | 业务类型引用 + 冗余快照 |
| `channel_code` | string \| null | 渠道 |
| `form` | 嵌入 | `{customer_cn_name, customer_en_name, business_note}` |
| `materials[]` | 嵌入 | `{material_key, requirement_item_id, name, source(LOCAL_UPLOAD/LIBRARY/SYSTEM), file{storage_key,...}, library_material_id, status(PENDING/ACCEPTED/RETURNED), return_reason, uploaded_at}`；有界数组（≤ 几十份） |
| `status` | enum | `DRAFT/PENDING_REVIEW/REJECTED/APPROVED/EXPIRED/SUSPENDED/CANCELLED`（EXPIRED/SUSPENDED 本轮仅定义，过期/暂停引擎后续迭代；`SUPPLEMENT_REQUIRED` 已废弃——2026-08-26 用户拍板"要求补件"并入"驳回"，枚举值仅为历史数据保留） |
| `owner_user_id` / `owner_name` | — | 发起交易员 |
| `latest_review` | 嵌入 \| null | 最近合规结论摘要（补件处理页免联查） |
| `timeline[]` | 嵌入 | 审批步进：`{at, by_name, action, from_status, to_status, note}`（规范 §4.5） |
| `submitted_at` | Date \| null | 最近提交时间 |

查询卡：

| 查询名称 | 过滤条件 | 排序 | 频率 | 对应索引 |
| --- | --- | --- | --- | --- |
| 申请列表（材料上传页） | `is_deleted` (+`status`) | `updated_at desc` | 高频 | `idx_access_applications_deleted_status_updated_at` |
| 补件待办（补件处理页） | `is_deleted + status in [SUPPLEMENT_REQUIRED, REJECTED]` | 同上 | 高频 | 同上 |
| 按单号定位 | `application_no` | 无 | 中频 | `uk_access_applications_application_no` |
| 客户的申请历史 | `customer_id` | `created_at desc` | 中频 | `idx_access_applications_customer_id_created_at` |
| 提交防重（同客户同业务同渠道活跃申请） | `customer_id + scenario_id + channel_code + status` | 无 | 提交时 | 前缀命中 `idx_access_applications_customer_id_created_at`；业务层校验（Mongo 无跨文档约束） |

## customer_materials（客户材料库）

一对多子集合（规范 §4.2）。"保存客户材料库"仅归档，不进审核队列；申请复用时把文件引用复制为申请内快照。

| 字段 | 说明 |
| --- | --- |
| `customer_id` | 所属客户 |
| `name` / `category` | 文件名 / 归档时关联材料项名称 |
| `file` | `{storage_key, original_name, mime_type, size}` |
| `version` | 同名材料重复归档递增 |
| `uploader_name` | 归档人 |

查询卡：

| 查询名称 | 过滤条件 | 排序 | 频率 | 对应索引 |
| --- | --- | --- | --- | --- |
| 客户材料库面板 | `customer_id + is_deleted` | `created_at desc` | 中频 | `idx_customer_materials_customer_id_deleted_created_at` |

## review_cases（合规审核工单）

追加型（规范 §4.5）：交易员每次提交（含补件重提）新增一条，携带提交当时的表单/材料/审核要求快照；合规结论不可覆盖历史。

| 字段 | 说明 |
| --- | --- |
| `case_no` | `RC-YYYYMMDD-序号`，唯一 |
| `application_id` / `application_no` | 关联申请 |
| `customer_id` / `customer_name` / `customer_code` | 客户快照 |
| `audit_type` | `NEW` 新提交 / `RESUBMIT` 驳回重审 |
| `status` | `PENDING` 待审核 / `PROCESSED` 已处理 |
| `final_result` | `APPROVED` 审核通过 / `UNRESOLVED` 未完结（补件或驳回）/ `TERMINATED` 审核终止 |
| `risk_level` / `completeness` / `note` | 提交时快照 |
| `form_snapshot` / `materials_snapshot` / `review_requirement` | 提交当时输入与审核要求快照 |
| `decision` | `{action(APPROVE/REJECT/TERMINATE), reason, rejected_item_ids}`；历史数据可能含已废弃的 `REQUEST_SUPPLEMENT` |
| `material_verdicts[]` | 单份材料判定 `{material_key, verdict, reason}` |
| `submitted_by_name` / `submitted_at` / `reviewer_id` / `reviewer_name` / `reviewed_at` | 提交与审核审计 |

查询卡：

| 查询名称 | 过滤条件 | 排序 | 频率 | 对应索引 |
| --- | --- | --- | --- | --- |
| 待处理/已处理队列 | `is_deleted + status` (+keyword regex) | `submitted_at desc` | 高频 | `idx_review_cases_deleted_status_submitted_at` |
| 申请的工单历史 | `application_id` | `submitted_at desc` | 中频 | `idx_review_cases_application_id_submitted_at` |
| 按工单号定位 | `case_no` | 无 | 中频 | `uk_review_cases_case_no` |

## 约束与业务规则

- 状态机转换只经服务层（`access.service.ts` / `review.service.ts`），前端不可直改状态；PRD §8 的"补件/驳回是否合并"已确认：只保留驳回（驳回可退回指定材料，交易员在补件处理页跟进后重新提交）。
- 提交要求：业务类型/渠道已选、必填材料完整（按渠道适用项）、无未替换的被退回材料；同 客户×业务×渠道 仅一条活跃申请（PENDING_REVIEW/APPROVED）。
- 文件二进制不入库：`storage_key` 指向存储适配层（当前本地磁盘 `UPLOAD_DIR`，对象存储信息确认后切 S3 兼容适配器），预览/下载统一走 `/api/files` 鉴权流。
- `counters` 集合：`{_id: "<前缀>_<yyyymmdd>", seq}` 原子自增生成业务单号，见 `apps/api/src/common/sequence.ts`。
