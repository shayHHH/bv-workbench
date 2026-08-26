# review_assignments 集合设计（合规审核分配）

> 依据 `docs/BV-MongoDB表结构与设计规范.md` §6.1 查询卡要求；admin「系统管理 → 审核分配」板块（2026-08-26 用户确认）。
> 实现位置：`apps/api/src/modules/assignment/`（Schema 与索引声明是最终事实来源）。

## 背景与规则

将来有两名合规官分别处理不同的审核：按**审核类型**（`FX` 找换 / `USDT` U相关，与材料上传页两个提交按钮一致）指定负责的合规账号（可多选）。

- 配置了负责人的类型：非负责人的合规官**能看不能办**（队列可见、出具结论被拒）；
- 未配置负责人（含账号被删/停用后未改派）：兜底**全体合规可办**，避免审核卡死；
- ADMIN 始终可改配置（改派/顶班通道）。

## 集合结构

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `review_type` | enum | `FX` / `USDT`，唯一（每类型一条文档） |
| `assignee_user_ids` | ObjectId[] | 负责的合规账号；空数组 = 未配置（兜底全员可办） |
| `updated_by_name` | string \| null | 最近改派人（展示用途） |
| 审计/软删除基类 | — | `created_*` / `updated_*` / `is_deleted` 等 |

## 查询卡（§6.1）

| 查询名称 | 过滤条件 | 排序 | 频率 | 对应索引 |
| --- | --- | --- | --- | --- |
| 出具结论时鉴权（canDecide） | `review_type + is_deleted` | 无 | 高频（每次结论） | `uk_review_assignments_review_type` |
| 配置总览（admin 板块） | `is_deleted` | 无 | 低频 | 集合仅 2 条，COLLSCAN 可接受 |

## 接口

- `GET /api/review-assignments`（ADMIN 配置 / COMPLIANCE 只读查看自己负责范围）→ `{assignments, compliance_users}`
- `PUT /api/review-assignments/:reviewType`（仅 ADMIN）body `{assignee_user_ids: []}`；空数组 = 取消配置

## 与审核模块的集成点

`AssignmentService.canDecide(reviewType, operator)` 由 `review.service.decide()` 在出具结论前调用（待审核模块 demo 重构落地后接线）；队列列表可用 `assigneeIds(reviewType)` 标注"当前责任人"。
