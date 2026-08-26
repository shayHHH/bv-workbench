# customers 集合设计（客户主数据）

> 依据 `docs/BV-MongoDB表结构与设计规范.md` §4.1 主数据范式、§6.1 查询卡要求。
> 实现位置：`apps/api/src/modules/customer/customer.schema.ts`（代码中的 Schema 与索引声明是最终事实来源）。

## 集合结构

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | ObjectId | 主键 |
| `customer_code` | string \| null | 业务客户编号，20001-29999 五位数字；中介下级客户允许为 null（无编号） |
| `name` | string | 客户名称 |
| `customer_kind` | enum | `DIRECT` 直客 / `INTERMEDIARY` 中介 / `SUB_CUSTOMER` 中介下级客户 |
| `parent_id` | ObjectId \| null | 所属中介（仅 SUB_CUSTOMER 有值，自引用 customers） |
| `sub_type` | enum \| null | 下级主体类型：`PERSONAL` / `CORPORATE` |
| `region` | enum \| null | `HK` / `CN_MAINLAND` / `SG` / `OTHER` |
| `agent_name` | string \| null | 所属交易员（用户体系上线后迁移为 `owner_user_id`，见「演进预留」） |
| `follow_trader` | string \| null | 跟进交易员 |
| `phone` | string \| null | 联系电话 |
| `remark` | string \| null | 备注，≤500 字 |
| `customer_status` | enum | 生命周期：`NEW`（默认）/ `ACTIVE` / `DORMANT` / `SUSPENDED`（对齐原型；准入审核后续用独立 audit_status） |
| `risk_level` | enum | `PENDING`（默认）/ `LOW` / `MEDIUM` / `HIGH` |
| `created_by` / `created_at` / `updated_by` / `updated_at` | 审计 | 公共基类字段；`*_by` 待登录鉴权上线后填充 |
| `is_deleted` / `deleted_by` / `deleted_at` | 软删除 | 常规查询默认过滤 `is_deleted: false` |

## 查询卡（§6.1）

| 查询名称 | 过滤条件 | 排序 | 频率 | 对应索引 |
| --- | --- | --- | --- | --- |
| 客户分页列表 | `is_deleted` (+`customer_status`) | `created_at desc, _id desc` | 高频 | `idx_customers_deleted_status_created_at` |
| 按编号/名称/电话搜索 | `is_deleted` + `$or` regex | 同上 | 中频 | 前缀命中 `idx_customers_deleted_status_created_at`；数据量增大后改造为前缀匹配或搜索服务 |
| 按业务编号定位 | `customer_code` | 无 | 高频 | `uk_customers_customer_code`（partial：仅 string 参与唯一约束） |
| 查中介的下级客户 | `parent_id` | `created_at desc` | 中频 | `idx_customers_parent_id_created_at` |

## 约束与业务规则

- `customer_code` 唯一（partial unique index），无编号下级客户不参与唯一约束。
- `SUB_CUSTOMER` 必须有 `parent_id`，且父文档必须是未删除的 `INTERMEDIARY`（业务层校验，Mongo 无外键）。
- 软删除中介前须确认名下无未删除的下级客户（业务层校验）。
- 枚举持久化英文代码；中文展示由前端 `@bv/shared` 的 `*Label` 映射转换。

## customer_events（客户档案事件，规范 §4.6）

追加型日志集合，驱动客户详情抽屉的时间线；只 insert 不更新。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `customer_id` | ObjectId | → customers |
| `event_type` | enum | `CREATED` / `PROFILE_UPDATED` / `STATUS_CHANGED` / `RISK_CHANGED` / `KIND_CHANGED` / `DELETED` |
| `title` / `detail` | string | 展示文案；状态类事件 detail 含前后值与备注（§5.3） |
| `operator_id` / `operator_name` | ObjectId / string | 操作人；姓名为展示冗余，事实来源 users |

查询卡：按客户看时间线 → `{ customer_id: 1, created_at: -1 }` → `idx_customer_events_customer_id_created_at`（高频）。

写入点：`customer.service.ts` 的 create / update（按变更类型分别落事件）/ softDelete；历史数据无建档事件时接口层补合成展示项，不落库。

## 演进预留

- `agent_name` → `owner_user_id: ObjectId`：待 admin/用户模块上线后按 §8.1「兼容读写 → 回填 → 切换 → 清理」迁移。
- 审核流（准入）上线时新增 `audit_status` 独立状态机与快照集合 `customer_audit_applications`（§4.5），不复用 `customer_status`。
- 接入内部数据仓库后，数仓侧集合的读取统一走 `apps/api/src/datasources/`（命名连接 `internal_dw`），不与本集合混用。
