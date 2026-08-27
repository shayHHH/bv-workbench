# 报价域集合设计（quote_*）

> 依据 `docs/BV-MongoDB表结构与设计规范.md` §4.1/§4.5/§4.6、§5.2（金额禁 double → Decimal128）、§6.1 查询卡。
> 实现位置：`apps/api/src/modules/quote/schemas/`（代码中的 Schema 与索引声明是最终事实来源）。
> 原型参照：`bv-workbench-go/quote/index02.html`（iframe 复刻页）；迁移时已修正的原型缺陷见文末。

## 集合总览

| 集合 | 范式 | 用途 |
| --- | --- | --- |
| `quote_configs` | 主数据（一客户一文档） | 客户报价配置：报价项（公式 token）、对客文案、常用备注 |
| `quote_benchmarks` | 主数据 | 平台基准价当前行；`code` 是公式变量稳定键 |
| `quote_benchmark_snapshots` | 快照（§4.5） | 每次「保存基准价」的全量快照，不可覆盖，供往期报价回看 |
| `quote_channel_rates` | 主数据 | 渠道即时汇率（现为人工维护演示值；真实行情源/数仓接入后由 datasources 写入，接口不变） |
| `quote_groups` | 主数据 + 有序 `customer_ids` 数组（§5.1 多值关联） | 批量报价的报价组 |
| `quote_records` | 事件日志（§4.6） | 每次计算、每个报价项一条历史记录（变量取值快照），不可覆盖 |

## 公式存储

原型以 HTML 存公式（`var-badge`），迁移后统一为结构化 token 数组（`packages/shared/src/quote.ts`）：

```jsonc
[
  { "type": "var", "source": "BENCHMARK", "code": "sino", "label": "sino每日价格" },
  { "type": "op",  "value": "+" },
  { "type": "num", "value": "3" }
]
```

- 变量来源：`BENCHMARK`（基准价 code）/ `CHANNEL`（渠道汇率 code）/ `BROKER_ITEM`（绑定中介的报价项 `_id`，取其 `last_result`）/ `QUOTE_ITEM`（本客户其他报价项 `_id`，递归求值，带环路保护）。
- 求值为共享包里的递归下降解析器（前端实时预览与后端落库同一实现，无 eval/Function）。
- 汇率/加点/结果一律 `Decimal128` 持久化，VO 序列化为字符串；求值过程为 JS number（≤8 位小数场景可接受，已知边界）。

## 查询卡（§6.1）

| 查询名称 | 过滤条件 | 排序 | 频率 | 对应索引 |
| --- | --- | --- | --- | --- |
| 按客户取报价配置 | `customer_id` | 无（单文档） | 高频 | `uk_quote_configs_customer_id`（unique） |
| 基准价当前行 | `is_deleted` | `sort asc` | 高频（求值每次读） | 集合极小（≤50 行），全表扫描可接受，唯一性由 `uk_quote_benchmarks_code`（partial `is_deleted:false`）保证 |
| 基准价历史（按日） | `is_deleted` + `saved_at` 区间 | `saved_at desc` | 中频 | `idx_quote_benchmark_snapshots_saved_at` |
| 渠道汇率列表 | `is_deleted` | `sort asc` | 高频 | 集合极小，同上；`uk_quote_channel_rates_code`（partial） |
| 报价组列表/详情 | `is_deleted` | `created_at asc` | 中频 | `idx_quote_groups_deleted_created_at` |
| 客户报价历史（7 日矩阵/明细） | `customer_id` + `quoted_at` 区间 | `quoted_at desc` | 中频 | `idx_quote_records_customer_id_quoted_at` |

## 约束与业务规则

- `quote_configs.items` 为有界嵌入数组（≤30 项/客户，DTO 层限制）；数组顺序即展示顺序，排序、增删都通过全量 PUT 提交。
- `QUOTE_ITEM` 变量必须引用同一配置内存在的项（保存时校验）；`BROKER_ITEM` 允许悬空（被引用的中介项删除后求值报「变量暂无取值」，不阻断保存）。
- 保存基准价 = 全量提交：未提交的现有行软删除，同时写一条 `quote_benchmark_snapshots` 快照（操作人、时点、全量行）。
- `broker_point` / `bv_point`（中介加点/BV 加点）仅记录展示、**不参与计算**——对齐原型行为（原型 UI 亦标注「结果 = 公式计算值」），如业务要求参与需改共享求值器一处。
- 重算（单客户/整组/批量替换应用）成功的项写 `last_result` + `last_quoted_at` 并逐项落 `quote_records`；失败项保留旧值并逐项返回错误。
- **基准价/渠道汇率变动自动全量刷新**（2026-08-27 用户需求）：保存基准价、渠道汇率修改/真实同步后，服务端重算所有客户配置——中介客户先算（下级的 BROKER_ITEM 变量读中介项结果，一次变动传导到位），**只有结果发生变化的项**才更新并写历史（无噪音记录）；求值失败的项保留旧值不阻断。响应携带 `refreshed: {customers, items}` 供前端提示。
- **基准价行删除保护**：被任何报价公式引用（BENCHMARK 变量）的行不允许删除（保存前校验，报错提示引用客户数）；新增行与已删除行同名时**复活原行**（保留原 code），公式自动重新接上——防止误删导致报价失联且无法恢复。
- 批量调整公式的搜索/替换片段仅支持「基准价、渠道汇率变量 + 数字 + 运算符」（对齐原型）；匹配在 token 级完成，数字按完整 token 比对。

## 与原型的显性差异（已确认为缺陷修正）

1. 客户数据统一走 `customers` 主档（原型报价页自带一份独立客户表）；新建客户直接复用客户管理的新建弹窗组件，不再走 postMessage。
2. 默认报价项仅在配置首次创建时生成，删除后不再"复活"（原型 `mergeMissingDefaultQuoteItems` 会补齐）。
3. 组员、同步匹配一律按 `customer_id`（原型按 name 去重导致同名客户互斥）。
4. 基准价新增行的变量键由 `_id` 派生（原型 `custom_<行数+1>` 会重复）。
5. 渠道汇率 `xe_usdt_hkd` 的 label 修正为 `XE-USDT:HKD`（原型笔误与 `xe_usd_hkd` 重名，会污染别名匹配）。
6. 「刷新渠道汇率」为重新读库（原型是本地随机扰动的假数据，不落库）。

## 演进预留

- **渠道汇率 XE 行情源（2026-08-26 用户确认有 API，文档后补）**：接入点已就位——env `XE_RATES_API_URL` / `XE_RATES_API_KEY` + `datasources/xe-rates.service.ts`（补全 `fetchLatestRates()` 的请求与 code 映射即可）；`POST /quote/channel-rates/sync` 未配置时 synced=false 仅回读库中人工数据，配置后写回 `quote_channel_rates`，前端与公式引擎无需改动。平台基准价则维持每日人工录入（用户确认）。
- 报价 → 交易订单：订单模块上线后 `quote_records._id` 即 PRD 中订单关联的 `quoteId`。
