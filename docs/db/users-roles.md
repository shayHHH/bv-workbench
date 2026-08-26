# users / roles 集合设计（登录账号与角色）

> 依据 `docs/BV-MongoDB表结构与设计规范.md` §4.1 主数据、§7.3 数据保密。
> 实现位置：`apps/api/src/modules/user/user.schema.ts`、`role.schema.ts`。

## users（登录账号）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `username` | string | 登录名，小写，唯一 |
| `password_hash` | string | bcrypt 哈希；任何 VO/日志/导出不得外泄 |
| `display_name` | string | 姓名 |
| `title` | string \| null | 职位/工号展示 |
| `role_id` | ObjectId | → roles |
| `user_status` | enum | `ACTIVE` / `DISABLED` |
| `last_login_at` | Date \| null | 登录时更新 |
| 基类 | - | created_by/created_at/updated_by/updated_at/is_deleted/deleted_* |

索引：`uk_users_username`（唯一）、`idx_users_deleted_status_created_at`、`idx_users_role_id`

查询卡：

| 查询 | 过滤 | 排序 | 索引 |
| --- | --- | --- | --- |
| 登录校验 | `username` | 无 | `uk_users_username` |
| 账号列表 | `is_deleted` | `created_at desc` | `idx_users_deleted_status_created_at` |
| 角色下账号数 | `role_id` | 无 | `idx_users_role_id` |

## roles（角色）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `role_code` | string | 稳定大写代码（ADMIN/AGENT/…），唯一 |
| `role_name` | string | 展示名 |
| `description` | string \| null | 职责说明 |
| `is_builtin` | boolean | 内置角色不可删、不可改代码 |

索引：`uk_roles_role_code`、`idx_roles_deleted_created_at`

## 业务规则

- 启动引导（`auth/bootstrap.service.ts`）幂等写入 8 个内置角色；无 ADMIN 账号时创建 `admin/admin123` 并告警要求改密。
- 登录返回 JWT（12h），全局 `JwtAuthGuard` 鉴权 + `RolesGuard` 校验 `@Roles("ADMIN")` 路由。
- 不能停用/删除自己；不能删除最后一个可用 ADMIN；使用中的角色不可删。
- 后续演进：菜单/接口级权限拆到 `role_permissions` 关系集合（规范 §4.3，参考 BV adminRoleRel），客户表 `agent_name` 迁移为 `owner_user_id` 引用本集合。
