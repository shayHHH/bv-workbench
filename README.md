# Bitvast Trade Workbench

交易运营系统正式版工程。原型（需求参照）位于 `../bv-workbench-go`，产品与数据库文档见 `docs/`。

## 技术栈

- **后端** `apps/api`：NestJS 11 + Mongoose 8（MongoDB）
- **前端** `apps/web`：Vue 3 + Vite + Element Plus + TypeScript
- **共享** `packages/shared`：前后端共用的枚举代码、中文标签映射、DTO 类型
- **数据库**：MongoDB（本地 Docker；线上接公司内部库）。集合设计遵循 `docs/BV-MongoDB表结构与设计规范.md`，每个集合的查询卡见 `docs/db/`

## 本地开发

```bash
# 1. 安装依赖（workspaces 一次装齐）
npm install

# 2. 启动本地 MongoDB
docker compose up -d

# 3. 构建共享包（修改 packages/shared 后需重新执行，或用 npm run watch -w @bv/shared）
npm run build:shared

# 4. 一键启动前后端（推荐；后端 http://127.0.0.1:3000/api，前端 http://127.0.0.1:5173）
#    在自己的终端里跑可常驻，不受 AI 会话生命周期影响；Ctrl+C 一并退出
npm run dev

#    也可分开启动：
#    npm run dev:api   # 仅后端（健康检查 /api/healthz）
#    npm run dev:web   # 仅前端（/api 已代理到后端）

# 6.（可选）写入演示数据：内置角色、演示账号与演示客户（会重建 customers 集合）
npm run seed
```

环境变量：复制 `.env.example` 为 `.env`。默认连接本地 `mongodb://127.0.0.1:27017/bv_workbench`，不配置也可运行。

## 登录与账号

- 首次启动自动创建 `admin / admin123`（请立即修改密码）；admin 在「系统管理 → 用户管理」中添加角色与登录账号。
- `npm run seed` 额外提供演示账号（密码均为 `123456`）：`yanglan`（初级交易员）、`zhouchen`（高级交易员）、`chenhao`（初级交易员）、`tina`（财务）、`manager`（运营经理）、`helin`（合规官）。
- 鉴权：JWT（12 小时），除 `/api/auth/login`、`/api/healthz` 外所有接口需登录；`/api/users`、`/api/roles` 写操作仅 ADMIN。

## 内部数据仓库（预留）

`INTERNAL_DW_MONGODB_URI` 留空即不启用。接入时在部署环境配置该变量，
API 会注册第二个命名连接 `internal_dw`（与业务主库隔离）；数仓侧模型统一放在
`apps/api/src/datasources/`，详见该目录内注释。接入前与 DBA 确认：独立最小权限账号、
服务器出口 IP 白名单、TLS 要求。

## 部署

```bash
# 构建并启动（部署机 .env 提供 MONGODB_URI 指向公司数据库）
docker compose -f docker-compose.prod.yml up -d --build

# 测试环境如需自带 Mongo：
docker compose -f docker-compose.prod.yml --profile with-mongo up -d --build
```

`web` 容器（nginx）托管前端静态资源并把 `/api/` 反代到 `api` 容器，对外只暴露 `WEB_PORT`（默认 8080）。

## 目录约定

```
apps/api/src/
├── common/          # 公共基类（审计/软删除字段）
├── config/          # 环境配置
├── datasources/     # 外部数据源接入点（内部数仓预留）
├── health/          # 健康检查 /api/healthz
└── modules/         # 业务模块（每个业务域一个目录：customer、quote…）
```

新增集合前先在 `docs/db/` 写查询卡（规范 §6.1），再写 Schema 与索引。

## 迭代路线

1. ✅ 骨架 + 客户主档（列表 / 中介层级展开 / 新建 / 编辑（含类型变更）/ 软删除）
2. ✅ 登录鉴权与用户体系（JWT + 角色守卫；admin 用户管理：角色 / 登录账号）
3. ⬜ 报价模块（快速报价 / 批量报价 / 往期报价）——当前为占位页
4. ✅ 业务准入闭环（材料上传五步申报 / 客户材料库 / 补件处理 / 合规审核队列与详情 / KYC list 配置；材料文件当前存本地磁盘 `UPLOAD_DIR`，对象存储接入后切换适配器，见 `apps/api/src/modules/file/storage.service.ts`）
5. ⬜ 交易订单、排单出款、对账——当前为占位页
6. ⬜ 菜单/接口级权限配置（role_permissions）、`agent_name` → `owner_user_id` 迁移
