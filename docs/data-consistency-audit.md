# 数据真实性 / 联通性审计（2026-08-27）

> 背景：用户反馈"系统数据没有共通"（登记入账的应收金额来源、创建时间对不上等）。
> 本文档是全仓库代码 + 生产库双重排查的结果清单，供后续修复对照；修完一项请勾掉或注明 commit。
> 严重程度：**A** = 界面显示假数据/写死值；**B** = 字段存在但没跨模块打通/无校验；**C** = seed 演示数据内部不自洽。

## 结论速览

- 用户截图里的「应收 USD 30,000」**本身是真实的**（取自订单 `sell_amount`，即交易员建单登记的金额）；真正的问题在它周边：实收金额无校验、界面不展示实收、金额不符异常文案写死（见 1.1）。
- 「创建时间对不上」实锤两个来源：seed 订单编号是写死常量而 created_at 是相对时间（每天漂移扩大，见 2.1）；单号生成取 UTC 日期与本地时区显示差 8 小时（见 1.3）。
- 报价→订单**没有真实打通**：真实建单落库的 `quote` 快照为 null / cost、fee 恒 null，详情页也不展示（见 1.2）。
- 资金账户只出不进：入款确认从不给账户加钱，余额单向递减（见 1.4.6）。

---

## 一、交易订单模块（orders，最重灾区）

### 1.1 「登记法币入账」应收/实收链路

结论：无独立"应收金额"字段。「应收」= `order.sell_amount`（真实）；实收落 `inflow_mark.amount`，两者从不比对、实收从不在详情显示。

| # | 严重 | 位置 | 问题 |
|---|---|---|---|
| 1.1.1 | B | `order.service.ts:416-436` | 入款确认对 `dto.amount` 零校验（不比对应收/币种/容差），填 1 元也推进并按 buy_amount 全额冻结 |
| 1.1.2 | B | `OrderPanel.vue:165-180` | 实收金额从不渲染，只出现在时间线文本里；收款卡片永远显示应收 |
| 1.1.3 | A | `OrderPanel.vue:376` | 「金额不符」异常的 kind/reason/detail 全写死，与实际差额无关 |
| 1.1.4 | A | `FundingDialog.vue:24-31,48` | 默认值写死：chain=TRC20、confirms=20（凭空的链上确认数会落库展示）、method=电汇转账 |
| 1.1.5 | A | `FundingDialog.vue:108-143` | 链/转账方式选项写死，未取自渠道配置 |

### 1.2 建单：汇率/金额/业务类型/报价关联

| # | 严重 | 位置 | 问题 |
|---|---|---|---|
| 1.2.1 | A | `OrderCreateDialog.vue:36` | 执行汇率默认 1.0020 为字面量 |
| 1.2.2 | A | `packages/shared/src/order.ts:186-192` | TRADE_TYPE_PRESETS 写死 5 个汇率，与 quote_benchmarks 全部对不上 |
| 1.2.3 | A | `OrderCreateDialog.vue:68-76` | 切交易类型会覆盖已从报价带出的汇率且不清 quote_record_id |
| 1.2.4 | B | `OrderCreateDialog.vue:78-88` | 选报价只填 rate，买卖金额不联动、cost/fee 不带出 |
| 1.2.5 | B | `order.service.ts:87-95` | 落库 quote 快照 cost_rate/fee 恒 null、source 写死"报价记录"；quote_records 本身无 cost/fee 字段 |
| 1.2.6 | B | `order.service.ts:88,146` | order.rate（手填）与 quote.deal_rate 可不一致且无校验；金额×汇率≈买入额也无校验（库里已有一张 1214×7.823≠2324 的实测单） |
| 1.2.7 | B | `OrderPanel.vue` | quote 快照落库后详情页完全不展示 |
| 1.2.8 | A/B | `seed.mjs:473` | seed 订单 business_type 全 null → 详情"业务类型 —" |
| 1.2.9 | B | `order.service.ts:711-719` | business_type 为 null 时 KYC 徽标退化为"该客户任意申请的最优状态"→ 业务类型显示 — 而 KYC 显示已通过，互相矛盾 |
| 1.2.10 | B | `order.service.ts:713` | 订单存 business_type 字符串匹配 scenario_name 字符串，改场景名即断链；应存 scenario_id |
| 1.2.11 | B | `shared/order.ts:143` | 「KYC已过期」徽标存在但全仓库无任何代码写 EXPIRED；材料 validity 配置从不参与判断 |

### 1.3 单号时区

| # | 严重 | 位置 | 问题 |
|---|---|---|---|
| 1.3.1 | B | `common/sequence.ts:14` | 单号取 UTC 日期，本地（UTC+8）00:00-08:00 创建的单，编号日期比界面创建日期早一天；影响 TO-/APP-/SCH- 全部单号 |

### 1.4 服务端落库缺口/硬编码

| # | 严重 | 位置 | 问题 |
|---|---|---|---|
| 1.4.1 | B | `order.service.ts:139` | person_name 恒 null（弹窗无此字段），排单收款人永远 fallback 客户名 |
| 1.4.2 | A | `order.service.ts:472` | SINO 出款账户写死 "pobo cq開-開" |
| 1.4.5 | A | `order.service.ts:877-886` | 收益五项（汇差/手续费/渠道成本/佣金/净收益）全部按写死比例 0.4%/0.1%/0.05%/0.35% 推导 |
| 1.4.6 | B | `order.service.ts:655-670` | 入款确认从不给入款账户加钱；treasury 只有 freeze/release/consume，余额单向递减 |
| 1.4.7 | B | `order.service.ts:657` | 找不到账户时静默跳过冻结，订单照常推进 |
| 1.4.8 | B | `order.service.ts:660` | 扣减不校验 available 与 floor，可扣成负数 |
| 1.4.9 | B | `treasury-account.schema.ts:34,37` | opening/floor 只写不读 |
| 1.4.10 | A | `order.service.ts:289` | 排单通道余额硬编码只查两个 USD 账户，非 USD 订单显示 — |
| 1.4.12 | B | `order.service.ts:695-708` | 出款账户按 key 字符串猜测，与用户选的渠道无关（选 SINO 可能冻 SGB） |
| 1.4.13 | B | `order.service.ts:151` | handler_name 只在建单写一次不再更新；owner_user_id 只写不查 |

## 二、seed 演示数据不自洽（C 类）

| # | 位置 | 问题 |
|---|---|---|
| 2.1 | `seed.mjs:487-540` | 10 张订单 order_no 是写死常量、created_at 是相对时间 → 日期差 2-3 天且每天扩大；SCH-/APP- 单号同病 |
| 2.2 | `seed.mjs:456-458` | SCH-20260817-002 审核/出款时间早于提交时间 16/10 小时；订单与排单两套时间互相矛盾 |
| 2.3 | seed 订单 | 汇率方向语义不统一（有的乘有的除），界面无方向标注 |
| 2.4 | `seed.mjs:384-392` | treasury 余额与 opening±订单流水对不上（SGB-USD 多 2 万、SINO-USD 超 opening 2 万、wallet-USDT 差 10.98 万、cash-HKD 把未到账的 156,400 提前计入） |
| 2.5 | seed 全文 | handler/operator/agent 名字（sinclair/jacky/keen/choy/ivy/杨澜/周辰/陈浩）都不在 users 表；owner_user_id 全 null；TO-102 的报价快照 quote_record_id 为 null 却标"快速报价" |

## 三、其他模块

| # | 严重 | 位置 | 问题 |
|---|---|---|---|
| 3.1 | A | `CustomerCreateDialog.vue:230` / `CustomerEditDialog.vue:210` | 「所属交易员」下拉写死 杨澜/周辰/陈浩，应取 users 表 AGENT 角色 |
| 3.3 | B | `customer.schema.ts:43,46` | agent_name/follow_trader 是自由字符串无 user 引用，改名不同步 |
| 3.4 | A | `AppLayout.vue:137` | 「正式环境 · 数据实时入库」写死，不判环境 |
| 3.5 | A/B | `AppLayout.vue:98-100` | 全局搜索宣称支持案件号/交易号，实际无条件跳客户管理 |
| 3.6 | B | `DashboardView.vue` | 工作台无任何数据请求（订单 stats 聚合已有现成接口未接）——已另行等用户拍板迁移方案 |
| 3.7 | B | `CustomerDetailDrawer.vue:365` | 客户详情「交易与凭证」禁用，后端 `GET /orders?customer_id=` 已支持 |
| 3.8 | A | 快速报价 | 「中介预期加点」写死 —（demo 亦然，业务口径待用户定义，已在 quotes.md 记录） |

✅ 核查为真实数据的：订单列表 5 指标卡与页签角标（stats 聚合）、KYC 配置页 metric、access/compliance/admin 全部界面、准入通过自动推进订单、建单报价候选列表、排单 VA 账户。

## 修复优先级建议

1. **1.1.1 + 1.1.2**：入款金额校验 + 实收上屏（资金风险最高）；
2. **1.4.6-1.4.8**：treasury 入款入账 + 余额/下限校验（余额单向递减，通道可用额是错的）；
3. **1.2 系列**：报价→订单真实打通（选报价联动金额、快照展示、rate 一致性校验）+ business_type 改存 scenario_id；
4. **1.4.5**：收益比例接真实配置（或明确标注为估算）；
5. **2.x**：seed 重写为"相对日期生成单号"（单号日期派生自 created_at）+ 余额自洽 + 人名对齐 users 表；
6. **1.3.1**：单号日期改本地时区；
7. **3.1/3.3**：交易员下拉接 users 表。
