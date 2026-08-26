# BV MongoDB 表结构与设计规范

> 适用对象：新项目的产品、后端开发、数据开发与代码审查人员  
> 参考基线：`bitvast-reporter` 当前 MongoDB 实体、Repository、索引声明及现有数据库规范  
> 文档目的：把 BV 已验证的共性做法沉淀为**新项目建集合（俗称“建表”）时可直接执行的标准**。  
> 说明：BV 使用 MongoDB，本文中的“表”均指 **Collection（集合）**，不是关系型数据库的物理表。

---

## 1. 先说结论：新项目应怎样沿用 BV 的做法

新项目以 MongoDB 文档模型设计数据，但不能把 MongoDB 当成“没有约束的 JSON 仓库”。每一个新集合都必须先明确：

1. 它保存的业务主体是什么；
2. 数据是独立文档、嵌入对象，还是两个主体之间的关系；
3. 列表查询会按什么条件过滤、按什么字段排序；
4. 数据是否需要审计、软删除、保留期限或敏感信息保护；
5. 对应的实体、索引、Schema 文档和迁移方案分别在哪里维护。

BV 当前代码采用的核心模式是：

| 设计事项 | BV 当前做法 | 新项目统一要求 |
| --- | --- | --- |
| 主键 | MongoDB `_id`，Java 侧为 `ObjectId id` | 统一使用 `ObjectId`；不把同一个关联 ID 有时存字符串、有时存 ObjectId |
| 通用审计字段 | `BaseEntity` 提供创建人、创建时间、更新人、更新时间 | 所有业务主集合和关系集合必须具备审计字段 |
| 关联 | 用 `ObjectId` 保存逻辑引用，不依赖 MongoDB 外键 | 关联字段要能看出目标对象，例如 `customer_id`、`role_id` |
| 一对多 | 子集合保存父 ID | 不在父文档中维护无限增长的大数组 |
| 多对多 | 单独建立关系集合，例如管理员—角色 | 关系集合建立两端 ID 的复合唯一索引 |
| 核心状态历史 | 主表保存当前状态；过程、快照、日志拆到独立集合 | 不能用覆盖更新代替需要追溯的业务历史 |
| 索引 | 在实体上用 `@Indexed`、`@CompoundIndex` 声明，并由统一索引服务创建 | 先写查询场景，再设计索引；每个列表查询都要能说明命中的索引 |

---

## 2. BV 当前实现基线与新项目的命名选择

### 2.1 当前 BV 的真实现状

BV 的 Java 实体通过 `@Document` 映射 MongoDB 集合；集合名既有早期的驼峰式命名，也有后续的下划线命名。例如：

| 类型 | 当前 BV 示例 | 含义 |
| --- | --- | --- |
| 历史驼峰集合 | `adminRole`、`prospectiveCustomer`、`fastQuoteWorkbench` | 存量集合，继续兼容，不应为了统一格式直接重命名 |
| 下划线集合 | `im_contact`、`agent_skill_pull_session` | 后续模块采用的规范化命名 |
| 默认映射集合 | `AdminRoleRel` 未显式写集合名，映射为 `adminRoleRel` | 当前可用，但新项目不建议依赖默认推导 |

`docs/schema.dbml` 是 BV 的结构说明参考，但它目前只覆盖部分核心集合；**代码里的 `@Document(collection = "...")` 或 `@Document("...")` 才是当前集合名的最终事实来源**。新项目不能只维护设计图而不维护实体和索引。

### 2.2 新项目统一命名规范

新项目从第一天起统一使用 `snake_case`，不再新增 camelCase 集合或字段。

| 对象 | 规范 | 正确示例 | 不建议 |
| --- | --- | --- | --- |
| 数据库名 | 小写字母、数字、下划线 | `bv_ops_core` | `BvOpsCore` |
| 集合名 | 小写复数或明确业务名，使用下划线 | `customer_follow_records`、`role_permissions` | `CustomerFollow`、`customerFollowRecord` |
| 普通字段 | 小写下划线 | `created_at`、`merchant_code` | `createdAt`、`merchantCode` |
| 关联字段 | `<对象>_id` / `<对象>_ids` | `customer_id`、`attachment_ids` | `id1`、`ref` |
| 布尔字段 | `is_`、`has_`、`can_` 开头 | `is_deleted`、`has_middleman` | `deleted_flag`、`flag` |
| 状态字段 | `status` 或 `<业务>_status` | `audit_status`、`address_status` | `state1` |
| 索引名 | `idx_<collection>_<fields>`；唯一索引用 `uk_` | `idx_customers_status_created_at`、`uk_role_permissions_role_id_permission_id` | 无名称或语义不明的索引名 |

> 重要：BV 当前 `BaseEntity` 的持久化字段是 `createdBy`、`createdAt` 等 camelCase。新项目若要求库内字段为 `created_by`、`created_at`，必须在公共基类通过 `@Field("created_at")` 或统一字段命名策略明确映射；只在文档里写 snake_case 而不配置映射，实际落库仍会是 Java 属性名。

---

## 3. 所有业务集合都应具备的基础结构

### 3.1 BV 当前基础实体

BV 的 `BaseEntity` 已统一提供下列基础字段：

| BV Java 属性 | MongoDB 实际字段 | 用途 | 新项目要求 |
| --- | --- | --- | --- |
| `id` | `_id` | 主键，类型为 `ObjectId` | 必填；由应用或 MongoDB 生成，禁止业务代码随意改写 |
| `createdBy` | `createdBy` | 创建人 ID | 需要审计的业务数据必填 |
| `createdAt` | `createdAt` | 创建时间 | 必填，统一使用 UTC 时间点 |
| `updatedBy` | `updatedBy` | 最后更新人 ID | 更新时同步维护 |
| `updatedAt` | `updatedAt` | 最后更新时间 | 更新时同步维护 |
| `errorMessage` | `errorMessage` | 运行/处理错误信息 | 仅在确有业务价值时写入；不可写入密钥、完整堆栈或敏感资料 |
| `outerId` | 不落库（`@BsonIgnore`） | 运行时临时字段 | 不可当作持久化关联字段使用 |

BV 通过 `init(...)` 初始化创建审计字段，通过 `doneUpdate(...)` 更新修改审计字段。新项目也应把这类操作收敛在公共基类、统一写入服务或审计机制中，不能由每个业务方法自行遗漏。

### 3.2 推荐的新项目公共基类

下例是面向新项目的字段名版本；它表达的是规范，不要求回改 BV 的存量数据。

```java
public abstract class BaseDocument {
    @MongoId
    @Field("_id")
    private ObjectId id;

    @Field("created_by")
    private ObjectId createdBy;

    @Field("created_at")
    private Date createdAt;

    @Field("updated_by")
    private ObjectId updatedBy;

    @Field("updated_at")
    private Date updatedAt;

    @Field("is_deleted")
    private Boolean isDeleted = false;
}
```

按业务需要再增加以下字段，而不是无条件全部加入：

| 字段 | 适用场景 | 说明 |
| --- | --- | --- |
| `deleted_by`、`deleted_at` | 软删除后仍需追溯 | 与 `is_deleted` 成套使用 |
| `version` | 同一记录存在并发编辑风险 | 使用乐观锁或等价版本校验，避免“后提交覆盖先提交” |
| `tenant_id` | 多租户、跨组织数据隔离 | 应进入绝大多数查询和索引前缀 |
| `source` | 数据来自导入、接口或人工录入 | 保存稳定枚举代码，不能只写展示文字 |
| `remark` | 人工可读补充说明 | 限长；不承载结构化业务字段 |

---

## 4. BV 已验证的六种表结构范式

新项目新建集合时，先从下面六种范式中选择；不要为一个简单问题创造第四种不一致的关联方式。

### 4.1 主数据：一个业务主体一条主文档

**BV 参考：** `admin`、`adminRole`、`bvMerchant`、`prospectiveCustomer`。

适用于管理员、客户、商户、角色、币种等有独立生命周期的主体。主文档保存“当前有效状态”和查询列表必需的少量冗余展示字段。

```text
customers
├── _id
├── customer_code                 # 业务唯一编号
├── name
├── customer_type                 # 稳定枚举代码
├── audit_status                  # 当前审核状态
├── owner_user_id                 # 当前负责人
├── is_deleted
└── created_by / created_at / updated_by / updated_at
```

规则：

- 业务编号如商户号、客户号必须建立唯一索引；BV 的 `bvMerchant.number` 即采用唯一索引。
- 主表只保留“当前值”。需要保留的历史操作、审核过程、报价结果应拆分成过程表或快照表。
- 可以冗余少量名称、代码等展示字段以减少高频查询拼接，但必须明确哪个字段是事实来源，更新时同步维护。

### 4.2 一对多：子集合持有父 ID

**BV 参考：** `prospectiveCustomer` 与 `prospectiveCustomerFollow`；商户与地址类数据也采用子集合关联。

```text
customer_follow_records
├── _id
├── customer_id                   # 父文档 ObjectId
├── content
├── attachment_ids                # 有上限的小型附件 ID 数组
└── created_by / created_at / updated_by / updated_at
```

规则：

- 子集合必须保存父 ID；按父对象查看历史的查询要有 `{ customer_id: 1, created_at: -1 }` 复合索引。
- 不把跟进记录、交易、地址、操作日志无限 append 到主文档数组中，否则文档会不断膨胀、更新冲突增多、分页困难。
- 只有数量小、大小可控、始终随主文档一起读取和更新的对象才可嵌入，例如联系方式 `contact`、标签 `tags`、轻量配置项。

### 4.3 多对多：关系集合（Rel / Pivot）

**BV 参考：** `adminRoleRel`（管理员—角色）、`adminMenuRel`（管理员—菜单）、中介—客户关系集合；`im_contact` 体现了双 ID 的唯一关系约束。

```text
role_permissions
├── _id
├── role_id
├── permission_id
├── created_by / created_at / updated_by / updated_at
└── [unique] role_id + permission_id
```

规则：

- 关系集合只保存两端 ID 和必要的关系属性（如来源、状态、排序），不要复制两端的大量字段。
- 必须建立两端 ID 的复合唯一索引，防止重复授权或重复绑定。
- 如果存在“从角色查权限”和“从权限查角色”两种查询，应分别评估索引；复合索引不能自动替代反向查询索引。
- 删除其中一端时，业务层应处理对应关系集合的清理、失效或归档；MongoDB 不会自动级联。

### 4.4 树形结构：自引用父 ID

**BV 参考：** `adminMenu.parentId`。

```text
menus
├── _id
├── parent_id                     # 根节点为 null 或约定根值
├── name
├── path
├── sort
└── status
```

规则：

- 用 `parent_id` 表达单棵或多棵树，建立 `{ parent_id: 1, sort: 1 }` 索引支撑同级菜单读取。
- 禁止形成循环引用；新增或变更父节点时必须校验不能把节点移动到自己的后代下。
- 需要高频整树查询时，可以维护受控的 `path_ids` / `path` 冗余字段；必须在移动节点时原子地同步子树，未设计同步方案前不要贸然增加。

### 4.5 快照与审核过程：当前主表 + 不可覆盖的历史文档

**BV 参考：** `prospectiveCustomerApply` 保存申请时的客户快照；`fastQuoteSnapshot` 保存报价快照；`audit`、`auditProcess` 保存审核过程。

```text
customer_audit_applications
├── _id
├── customer_id
├── audit_id
├── profile_id
├── customer_snapshot             # 提交当时的必要业务快照
├── audit_status
├── submitted_at
└── created_by / created_at / updated_by / updated_at
```

规则：

- “当前客户资料”放主表，“提交审核时看到的资料”放快照表；审核结论必须能还原当时输入，不能依赖后来已被修改的主表。
- 快照只保存审核/报价所需的字段，避免无边界复制整个对象；敏感字段按最小化原则处理。
- 审批流的每一步应有操作人、操作时间、动作、前后状态、意见和关联业务 ID；不要只在主表覆写一个 `status`。
- 对资金、合规、身份等跨集合一致性要求高的操作，评估 MongoDB 事务和适当的写关注级别；简单单文档更新不要为了“看起来完整”而滥用事务。

### 4.6 事件日志、回调与短期会话

**BV 参考：** `adminLoginHistory`、`vaCallbackLog`、`agent_skill_pull_session`。

```text
callback_logs
├── _id
├── business_id
├── event_type
├── request_summary               # 脱敏后的摘要，不存明文密钥
├── response_status
├── occurred_at
└── expire_at                     # 仅对可自动清理的数据使用
```

规则：

- 日志和回调是追加型数据，优先 `insert`，避免反复更新一条“总日志”。
- 必须按实际检索路径建立索引，例如 `{ business_id: 1, occurred_at: -1 }`。
- 有明确保留期限的临时会话、缓存、拉取预览可用 TTL 索引。BV 的 `agent_skill_pull_session.expiresAt` 已使用 TTL 自动清理；核心业务、合规和资金审计记录不得误用 TTL。
- 日志中禁止落库密码、Token、签名原文、身份证件全文、银行卡完整号和密钥；确需排障时保存脱敏摘要、哈希或受控加密内容。

---

## 5. 字段、类型与状态设计规范

### 5.1 ID 与关联

| 场景 | 规范 |
| --- | --- |
| 主键 | 使用 MongoDB `ObjectId`，API 层再按统一规则序列化为字符串 |
| 跨集合关联 | 使用 `ObjectId`，字段名体现目标集合，例如 `merchant_id`、`audit_id` |
| 多值关联 | 仅在数量有明确上限且始终一起读取时使用 `*_ids` 数组；否则建子集合或关系集合 |
| 外部系统 ID | 另设 `external_id`、`provider_id` 等字段，不能混写进内部 `_id` |
| 关联完整性 | MongoDB 无外键；创建、删除、迁移流程必须在业务层做存在性、权限和级联影响校验 |

### 5.2 金额、时间、枚举与嵌入对象

| 数据类型 | 规范 |
| --- | --- |
| 金额、汇率、比例 | 禁止使用 `double`。BV 业务实体使用 `BigDecimal`；新项目必须明确使用 `Decimal128` 或“最小货币单位整数”，并统一币种与精度规则 |
| 时间 | 存储 UTC 时间点（`Date` / Instant 对应类型），前端按时区展示；不要把展示格式字符串当时间字段存储 |
| 枚举 | 持久化稳定代码字符串，如 `ACTIVE`、`PENDING`；展示中文、繁体、英文由国际化层转换，禁止把展示文案当状态值 |
| 状态 | 一个状态字段只表示一个状态机。客户状态、审核状态、支付状态互不混写；必要时分别命名 `customer_status`、`audit_status` |
| 嵌入对象 | 适合联系方式、标签、小型配置、有限明细。要给嵌入对象定义固定字段和最大长度，禁止使用无约束的 `Map<String, Object>` 承载核心业务 |
| 文件 | 存文件中心 ID 或受控对象存储键，不在业务文档中直接保存大文件 Base64 内容 |

### 5.3 删除、状态与审计

- BV 存量中常用 `isDeleted`；新项目统一使用 `is_deleted`。需要恢复和追责时，同时保存 `deleted_by`、`deleted_at`。
- 软删除集合的所有常规查询都必须默认过滤 `is_deleted: false`；该过滤字段通常应位于常用复合索引的最前面。
- 审核、支付、交易等关键状态变更必须记录操作人、操作时间、动作和必要的前后值；不要只把旧状态覆盖掉。
- 无业务保留价值、可重建的临时数据才允许硬删除或 TTL。硬删除前必须确认其不被其他集合引用。

---

## 6. 索引设计规范：先写查询，再建索引

### 6.1 新建集合时必须交付的查询卡

每个集合在开发前至少写清这张卡；没有它，不允许凭感觉添加索引。

| 查询名称 | 过滤条件 | 排序 | 预计数据量/频率 | 对应索引 |
| --- | --- | --- | --- | --- |
| 客户分页列表 | `is_deleted`、`audit_status` | `created_at desc` | 高频 | `idx_customers_deleted_audit_status_created_at` |
| 按客户查看跟进 | `customer_id` | `created_at desc` | 高频 | `idx_customer_follow_records_customer_id_created_at` |
| 按业务编号查主体 | `merchant_code` | 无 | 高频 | `uk_merchants_merchant_code` |

### 6.2 复合索引顺序

索引一般按下面的顺序组织：

```text
等值过滤字段 → 范围过滤字段 → 排序字段
```

例如 BV 的 `prospectiveCustomer` 使用了：

```text
{ isDeleted: 1, auditStatus: 1, createdAt: -1 }
```

它匹配“未删除 + 某审核状态 + 按创建时间倒序”的客户列表。新项目采用下划线命名时，对应写法为：

```text
{ is_deleted: 1, audit_status: 1, created_at: -1 }
```

注意事项：

- 不能只因为字段“可能会查”就逐个建索引；索引会增加写入、内存和存储成本。
- 单独给低选择性布尔字段建索引通常收益很低；它更适合与状态、归属、时间等列表条件组合。
- 列表排序字段没有进入索引时，MongoDB 可能发生内存排序，数据量变大后会明显变慢甚至失败。
- 分页查询不要默认深度 `skip`；大数据量优先评估基于 `created_at + _id` 的游标/范围翻页。
- 聚合查询要先看 `$match` 是否前置、能否命中索引；超大聚合才评估 `allowDiskUse`，不能将它当成索引缺失的替代品。

### 6.3 现有 BV 索引范例

| 范例 | BV 当前声明 | 可复用的原则 |
| --- | --- | --- |
| 客户列表 | `prospectiveCustomer`：`isDeleted + auditStatus + createdAt` 等复合索引 | 过滤条件和排序字段一次覆盖 |
| 跟进记录 | `prospectiveCustomerFollow`：`prospectiveCustomerId + createdAt` | 子列表按父 ID 和时间查询 |
| 业务唯一编号 | `bvMerchant.number` 唯一索引 | 业务天然唯一值必须由数据库兜底 |
| 去重关系 | `im_contact.ownerId + targetId` 复合唯一索引 | 多对多关系禁止重复边 |
| 临时会话 | `agent_skill_pull_session.expiresAt` TTL 索引 | 仅可清理数据使用自动过期 |

### 6.4 索引上线流程

1. 记录查询卡和预期索引；
2. 在开发/预发用实际量级样本执行 `explain`；
3. 确认索引名称、唯一性、排序方向和已有索引没有重复；
4. 通过实体注解或统一索引服务创建，避免手工环境漂移；
5. 生产环境按在线索引构建流程发布并观察查询耗时、写入延迟和索引体积；
6. 定期删除低命中、重复或已废弃查询对应的索引。

---

## 7. Java / Spring Data MongoDB 实现规范

### 7.1 实体声明

新项目的每一个新集合都显式指定集合名，不依赖类名推导：

```java
@Data
@Document(collection = "customer_follow_records")
@CompoundIndexes({
    @CompoundIndex(
        name = "idx_customer_follow_records_customer_id_created_at",
        def = "{'customer_id': 1, 'created_at': -1}"
    )
})
public class CustomerFollowRecord extends BaseDocument {
    @Field("customer_id")
    private ObjectId customerId;

    @Field("content")
    private String content;
}
```

要求：

- 使用 `@Document(collection = "...")` 固定物理集合名；集合名改动属于数据迁移，不是普通重构。
- Java 命名可以保持驼峰，但凡数据库字段采用 snake_case，必须用 `@Field` 或统一映射策略显式保证。
- `@Indexed`、`@CompoundIndex` 与实体一起维护；禁止只在个人环境手工建索引。
- Repository 用于稳定、可表达的单集合查询；跨集合复杂筛选和统计使用经过索引设计的 aggregation。不要因为方便就让每个业务方法各写一套 `MongoTemplate` 字符串字段名。

### 7.2 更新与并发

- 所有新增、修改、删除都必须经过统一的审计字段填充逻辑。
- 状态流转必须校验“当前状态能否变为目标状态”，更新条件应带上当前状态或版本，避免并发下重复审批、重复支付或回退覆盖。
- 同一文档内的简单原子更新优先使用 MongoDB 原子操作；只有确实需要跨集合原子一致性时才使用事务。
- 批处理只在定时任务或确有大批量数据的场景分批执行，并记录批次范围、成功数、失败数和可重试信息。

### 7.3 数据保密与输出边界

BV 的管理员类数据涉及密码、Google 验证密钥、交易密码、邮箱等敏感字段。这类字段提供了明确警示：

- 密码只能保存不可逆安全哈希；密钥、Token、私钥类内容应采用专门密钥管理和受控加密，不应明文散落在普通业务集合。
- Entity、DTO、日志、导出和 API 响应必须分层；持久化实体不能直接等同于对外响应对象。
- 查询时按最小字段集投影；日志和异常中必须脱敏，尤其是身份证件、手机号、邮箱、地址、账户和签名材料。
- 涉及资金、身份、客户资料的集合须先定义访问角色和数据范围，不能只依赖前端隐藏字段。

---

## 8. 数据变更、迁移与文档同步规范

### 8.1 字段演进

字段变更按“兼容读写 → 回填 → 切换 → 清理”进行：

1. 新增字段时先提供默认值和兼容读取逻辑；
2. 新旧字段并存期间，按业务需要双写或在读取层兼容；
3. 使用可回滚、可重复执行的批处理回填历史数据；
4. 观察全量数据与调用方都已切换后，再停止旧字段写入；
5. 在明确保留期后才清理旧字段、旧索引和兼容代码。

禁止直接把线上字段改名、改变字段类型或删除字段后立即发布。MongoDB 的灵活结构不代表历史数据会自动符合新代码。

### 8.2 集合与索引变更

- 集合改名、拆分、合并必须有数据迁移脚本、校验统计、回滚方案和发布窗口；不应随 Java 类重命名自动发生。
- 唯一索引上线前先检查存量重复数据，否则索引创建会失败或阻塞发布。
- TTL 变更前必须确认字段含义、服务器时间、保留期限和法律/审计要求；TTL 是异步清理，不可作为精确的到期触发器。
- 每次变更后用样本数据核验文档结构、关联数、唯一性和关键列表的 `explain` 计划。

### 8.3 文档同步

BV 当前的 `docs/schema.dbml` 应作为核心结构可视化参考，但新项目应把以下内容一起维护：

| 变更项 | 必须同步的位置 |
| --- | --- |
| 新集合、字段、关联 | 实体类、Schema/DBML 文档、接口/DTO 说明 |
| 新查询或列表排序 | 查询卡、Repository/Aggregation、索引声明 |
| 新索引或索引调整 | 实体注解/统一索引服务、发布记录、Schema 文档 |
| 状态机调整 | 枚举、状态流转说明、审核/日志记录规则 |
| 数据迁移 | 可重复执行的迁移脚本、校验结果、回滚说明 |

---

## 9. 新项目“建表”评审清单

提交 PR 前逐项确认：

- [ ] 已明确这是主数据、子数据、关系数据、树、快照还是日志集合。
- [ ] 已显式指定 `@Document(collection = "snake_case")`，没有依赖默认集合名。
- [ ] 主键与关联均使用 `ObjectId`，外部 ID 没有混入内部 `_id`。
- [ ] 已复用公共审计字段；是否软删除、版本、租户字段有明确结论。
- [ ] 所有字段都有明确类型、长度/数量上限和业务含义；金额未使用 `double`，状态未存展示文案。
- [ ] 嵌入对象大小可控；不存在无限增长的数组。
- [ ] 多对多关系使用关系集合，并有双 ID 的复合唯一索引。
- [ ] 已写出真实的查询卡，索引覆盖过滤条件和排序字段。
- [ ] 唯一性、TTL、软删除过滤、数据范围和并发更新风险已评估。
- [ ] 敏感字段不直接出现在日志、导出、DTO 或不受控的快照中。
- [ ] 字段/索引变化有历史数据兼容与迁移方案。
- [ ] Entity、Repository、索引、Schema 文档和测试已同步更新。

---

## 10. BV 参考实现位置

下列位置用于新项目设计时核对 BV 现有写法；它们是参考，不要求复制历史 camelCase 命名。

| 主题 | BV 代码 / 文档位置 |
| --- | --- |
| 公共主键与审计字段 | `bitvast-reporter/bitvast-reporter-common/src/main/java/com/bitvast/entity/base/BaseEntity.java` |
| 管理员、角色与菜单关系 | `bitvast-reporter/bitvast-reporter-common/src/main/java/com/bitvast/entity/admin/` |
| 客户主数据、跟进与申请快照 | `bitvast-reporter/bitvast-reporter-common/src/main/java/com/bitvast/crm/entity/ProspectiveCustomer*.java` |
| 商户唯一编号 | `bitvast-reporter/bitvast-reporter-common/src/main/java/com/bitvast/entity/merchant/BvMerchant.java` |
| 联系人关系唯一索引 | `bitvast-reporter/bitvast-reporter-common/src/main/java/com/bitvast/im/entity/ImContact.java` |
| 临时会话 TTL 索引 | `bitvast-reporter/bitvast-reporter-common/src/main/java/com/bitvast/ai/entity/AgentSkillPullSession.java` |
| 核心集合关系图参考 | `docs/schema.dbml` |
| BV 既有 MongoDB 开发规范 | `docs/backend/mongodb-dev-spec.md` |

---

## 11. 使用边界

这份规范用于指导**新项目**的表/集合设计，默认目标是形成一致、可审计、可查询、可演进的数据模型。它不要求对 BV 已上线的存量 camelCase 集合、字段或业务结构做无风险评估之外的强行改名。若新项目与 BV 共用数据库，必须先制定命名隔离、权限隔离、数据迁移和兼容读取方案，再接入共享集合。
