# 交易订单域集合设计（订单主线 / 出款排单 / 简化账户 / VA 账户）

> 依据 `docs/BV-MongoDB表结构与设计规范.md` §4.1/§4.5/§6.1 与 demo（index.html + app.js）交易订单实现；
> PRD §4.6、§5.3-5.5（业务推进/KYC 子状态/按钮矩阵）为背景。
> 实现位置：`apps/api/src/modules/order/`（Schema 与索引声明是最终事实来源）。
> 范围（2026-08-26 用户确认）：只做订单主线；凭证匹配/账务流水/库存/对账等独立页面留后续模块，
> 因此本轮不建 ledger 流水集合——冻结/释放/消耗直接更新 treasury_accounts 余额。

## trade_orders（订单主线）

主线状态机（demo）：`PENDING_KYC 待KYC → AWAITING_INFLOW 待客户入款 → AWAITING_DISPATCH 待出款排单 →
DISPATCH_REVIEW 出款审核中 → AWAITING_PAYOUT 待出款执行 → COMPLETED 已完成`；`CANCELLED 已取消`；
附加异常（exception）不打断主线。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `order_no` | string | `TO-YYYYMMDD-序号`，唯一（counters 原子自增） |
| `customer_id` + `customer_name/customer_code/person_name` | — | 客户引用 + 建单快照 |
| `business_type` | string \| null | 准入业务类型（KYC 场景名，联动订单 KYC 徽标） |
| `trade_type` | string | 现金换U / U换现金 / 转账换U / U换转账 / 法币换法币（可自定义） |
| `sell_currency/sell_amount`、`buy_currency/buy_amount` | string + Decimal128 | 客户卖出 / 买入 |
| `rate` / `pay_method` / `remark` | — | 执行汇率（字符串保精度）/ 收款方式 / 备注 |
| `quote` | 嵌入 \| null | 关联报价快照 `{quote_record_id, deal_rate, cost_rate, source, quoted_at, quoted_by, fee}` |
| `status` | enum | 主线状态（见上），持久化英文代码 |
| `handler_name` / `owner_user_id` | — | 当前经手人 / 建单交易员 |
| `dispatch_id` | ObjectId \| null | 当前出款排单（payout_orders） |
| `wallet_ops` | 嵌入 \| null | `{deposit_address/by/at, payout_address, kya_passed/by/at}` 链上节点登记 |
| `inflow_mark` / `outflow_mark` | 嵌入 \| null | 资金动作登记（金额/账户/凭证/哈希/确认数/交收地点等，按形态取用） |
| `freeze` | 嵌入 \| null | `{account_key, account_name, currency, amount, state FROZEN/RELEASED/CONSUMED}` |
| `profit` | 嵌入 \| null | 完成时计算 `{spread, fee, channel_cost, commission, net, currency}`（demo 固定比例） |
| `exception` | 嵌入 \| null | 附加异常 `{kind, reason, detail, prev_status, escalated, since}` |
| `payment_rejected` / `dispatch_rejected` | 嵌入 \| null | 驳回标记 `{reason, by, at}` |
| `receipt_ref` | string \| null | 出款回单引用 |
| `timeline[]` | 嵌入 | `{at, title, detail, actor}` 追加型活动记录（规范 §4.5） |

查询卡：

| 查询名称 | 过滤条件 | 排序 | 频率 | 对应索引 |
| --- | --- | --- | --- | --- |
| 订单列表（各角色待办由状态/标记组合筛） | `is_deleted` (+`status`) | `created_at desc` | 高频 | `idx_trade_orders_deleted_status_created_at` |
| 按单号定位 | `order_no` | 无 | 中频 | `uk_trade_orders_order_no` |
| 客户的订单（详情抽屉/防沉睡唤醒） | `customer_id` | `created_at desc` | 中频 | `idx_trade_orders_customer_id_created_at` |
| 准入通过后推进待KYC订单 | `customer_id + status=PENDING_KYC` | 无 | 准入结论时 | 前缀命中 `idx_trade_orders_customer_id_created_at` |
| 列表统计（指标条/待办计数） | `is_deleted` 聚合 | 无 | 高频 | 同列表索引（$group） |

## payout_orders（出款排单）

| 字段 | 说明 |
| --- | --- |
| `dispatch_no` | `SCH-YYYYMMDD-序号`，唯一 |
| `order_id` / `order_no` | 关联订单 |
| `customer_name/customer_code` | 快照 |
| `channel` | `SGB` / `SINO` |
| `currency` / `amount`(Decimal128) | 应付出款 |
| `order_title` / `final_text` | 排单标题 / 排单文案（demo 模板生成后可编辑） |
| `payout_account` / `va_account` | 出款账户文案 / SGB 渠道 VA 快照 |
| `payee` / `payee_bank` | 从文案解析的收款人要素 |
| `status` | `REVIEWING 出款审核中 / AWAITING_PAYOUT 待出款 / PAID 已出款 / VOID 已作废` |
| `submitted_by/at`、`reviewed_by/at`、`paid_by/at` | 审计 |
| `receipt` | `{file_name, reference, note, uploaded_by/at, matched}` 出款回单 |

查询卡：

| 查询名称 | 过滤条件 | 排序 | 频率 | 对应索引 |
| --- | --- | --- | --- | --- |
| 订单详情联查排单 | `order_id` | `created_at desc` | 高频 | `idx_payout_orders_order_id_created_at` |
| 按排单号定位 | `dispatch_no` | 无 | 中频 | `uk_payout_orders_dispatch_no` |

## treasury_accounts（简化账户，资金模块前身）

demo 库存账户原样迁移（现金/银行/VA/USDT 钱包 9 个）。冻结→`available -= x, frozen += x`；
释放→反向；消耗→`frozen -= x`。后续资金模块接管本集合，数据不作废。

| 字段 | 说明 |
| --- | --- |
| `key` | 唯一（如 `bank-SGB-USD`） |
| `group` / `name` / `currency` | 分组 / 展示名 / 币种 |
| `available` / `frozen` / `opening` / `floor` | Decimal128 余额字段 |

查询卡：按 `key` 点查（`uk_treasury_accounts_key`）；全量列表（集合 9 条，COLLSCAN）。

## va_accounts（客户 VA 账户）

SGB 渠道排单需要客户 VA。demo 数据原样迁移；登记界面留后续模块。

| 字段 | 说明 |
| --- | --- |
| `customer_id` | 所属客户 |
| `label` / `virtual_account_number` / `iban` / `currency` / `bank` | VA 要素 |

查询卡：按 `customer_id` 查（`idx_va_accounts_customer_id`）。

## 约束与业务规则

- 状态转换只经 `order.service.ts`；每步动作有角色校验（demo 按钮矩阵表5）：建单/排单/取消=交易员（AGENT/OPS），
  入款登记=资金责任人（法币财务 FINANCE / 链上钱包 WALLET / 现金财务），排单审核/异常处理/风险终止=OPS，
  出款执行=责任人（银行/现金 PAYOUT、链上 WALLET），出款执行前 KYA 必须通过（链上出款）。
- 订单 KYC 徽标由 `customer_id + business_type` 实时联查 access_applications 推导（demo 表3 映射）；
  准入审核通过时（review.service APPROVE）自动推进该客户就绪的 PENDING_KYC 订单 → AWAITING_INFLOW。
- 入款确认即冻结应付资金（treasury_accounts）；取消/风险终止释放冻结并作废排单；出款执行消耗冻结、
  计算收益（demo 固定比例：汇差 0.4%/手续费 0.1%/渠道成本 0.05%/佣金 0.35%）并完成订单。
- 排单驳回/执行异常退回：作废排单、订单回 AWAITING_DISPATCH 并记 `dispatch_rejected`；重新提交后再次进入审核。
- 金额 Decimal128 落库；`rate` 字符串保精度；展示转 number（金额均在安全整数范围内的业务金额）。
