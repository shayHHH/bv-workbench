/**
 * 开发/演示环境种子数据：node scripts/seed.mjs
 * - 内置角色（幂等 upsert）与各角色演示账号（upsert，密码 123456）
 * - 演示客户数据：会清空 customers 集合后重建（仅限开发环境使用！）
 */
import bcrypt from "bcryptjs";
import { Decimal128, MongoClient, ObjectId } from "mongodb";
import { BUILTIN_ROLES, CustomerKind } from "@bv/shared";

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/bv_workbench";
const client = new MongoClient(uri);
await client.connect();
const db = client.db();

const now = Date.now();
const at = hoursAgo => new Date(now - hoursAgo * 3_600_000);
const base = (createdHoursAgo, updatedHoursAgo = createdHoursAgo) => ({
  is_deleted: false,
  created_by: null,
  updated_by: null,
  deleted_by: null,
  deleted_at: null,
  created_at: at(createdHoursAgo),
  updated_at: at(updatedHoursAgo),
});

/* ---- 角色（幂等） ---- */
for (const role of BUILTIN_ROLES) {
  await db.collection("roles").updateOne(
    { role_code: role.code },
    {
      $setOnInsert: {
        role_code: role.code,
        role_name: role.name,
        description: role.description,
        is_builtin: true,
        ...base(24 * 30),
      },
    },
    { upsert: true },
  );
}
const roleIds = new Map(
  (await db.collection("roles").find({}).toArray()).map(role => [role.role_code, role._id]),
);

/* ---- 基础账号（upsert，仅首次插入）----
 * 正式团队账号由 admin 在「用户管理」维护（2026-08-26 用户已录入真实名单），
 * seed 不再创建演示人员账号——此前用户改名后重跑 seed 曾把旧演示账号复活污染名单。
 */
const users = [
  ["admin", "admin123", "系统管理员", "Administrator", "ADMIN"],
  ["quotetest", "123456", "报价测试", "QA · 可随时删除", "AGENT"],
  // 交易订单验证账号：真实名单暂无 钱包运营/出款员 角色，先用 QA 账号占位
  ["wallettest", "123456", "钱包测试", "QA · 可随时删除", "WALLET"],
  ["payouttest", "123456", "出款测试", "QA · 可随时删除", "PAYOUT"],
  // H5 移动端验证账号：高级交易员/运营经理真实账号密码未知，用 QA 账号占位
  ["opstest", "123456", "交易测试", "QA · 可随时删除", "OPS"],
  ["managertest", "123456", "经理测试", "QA · 可随时删除", "MANAGER"],
];
for (const [username, password, displayName, title, roleCode] of users) {
  await db.collection("users").updateOne(
    { username },
    {
      $setOnInsert: {
        username,
        password_hash: bcrypt.hashSync(password, 10),
        display_name: displayName,
        title,
        role_id: roleIds.get(roleCode),
        user_status: "ACTIVE",
        last_login_at: null,
        ...base(24 * 20),
      },
    },
    { upsert: true },
  );
}

/* ---- 演示客户（重建；档案事件与业务准入数据随之清空，避免悬挂引用） ---- */
await db.collection("customers").deleteMany({});
await db.collection("customer_events").deleteMany({});
await db.collection("access_applications").deleteMany({});
await db.collection("customer_materials").deleteMany({});
await db.collection("review_cases").deleteMany({});
const customer = (code, name, kind, extra = {}) => ({
  customer_code: code,
  name,
  customer_kind: kind,
  parent_id: null,
  sub_type: null,
  region: null,
  phone: null,
  remark: null,
  customer_status: "NEW",
  ...extra,
});

const northstarId = new ObjectId();
const brokerLinId = new ObjectId();
const chenJianingId = new ObjectId();
const raviId = new ObjectId();
const linYawenId = new ObjectId();
const auroraId = new ObjectId();
const zhengKaiwenId = new ObjectId();

await db.collection("customers").insertMany([
  { _id: chenJianingId, ...customer("20001", "陈嘉宁", CustomerKind.DIRECT, { sub_type: "PERSONAL", region: "HK", phone: "+852 6123 4567", customer_status: "ACTIVE" }), ...base(24 * 18, 2) },
  { _id: northstarId, ...customer("20002", "Northstar Trading Limited", CustomerKind.INTERMEDIARY, { sub_type: "CORPORATE", region: "HK", customer_status: "ACTIVE", remark: "企业中介，可挂载下级客户" }), ...base(24 * 16, 5) },
  { _id: new ObjectId(), ...customer("22156", "Northstar 贸易联系人 A", CustomerKind.SUB_CUSTOMER, { parent_id: northstarId, sub_type: "PERSONAL", region: "HK" }), ...base(24 * 10, 24) },
  { _id: new ObjectId(), ...customer("2000201", "Northstar 付款人 B", CustomerKind.SUB_CUSTOMER, { parent_id: northstarId, sub_type: "CORPORATE", region: "HK" }), ...base(24 * 9, 30) },
  { _id: brokerLinId, ...customer("20005", "中介林", CustomerKind.INTERMEDIARY, { sub_type: "PERSONAL", region: "HK", customer_status: "ACTIVE", remark: "中介报价源" }), ...base(24 * 14, 8) },
  { _id: raviId, ...customer("22001", "ravi", CustomerKind.SUB_CUSTOMER, { parent_id: brokerLinId, sub_type: "PERSONAL", region: "HK", customer_status: "ACTIVE" }), ...base(24 * 12, 6) },
  { _id: linYawenId, ...customer("20003", "林雅雯", CustomerKind.DIRECT, { sub_type: "PERSONAL", region: "CN_MAINLAND", phone: "+86 138 0013 8000", customer_status: "ACTIVE" }), ...base(24 * 13, 10) },
  { _id: new ObjectId(), ...customer("20004", "赵明远", CustomerKind.DIRECT, { sub_type: "PERSONAL", region: "CN_MAINLAND", customer_status: "SUSPENDED", remark: "命中高风险地区关联规则，暂停合作" }), ...base(24 * 12, 24 * 3) },
  { _id: auroraId, ...customer("20006", "Aurora Capital Pte. Ltd.", CustomerKind.DIRECT, { sub_type: "CORPORATE", region: "SG", customer_status: "ACTIVE" }), ...base(24 * 8, 20) },
  { _id: new ObjectId(), ...customer("20007", "Mosaic Ventures Pte. Ltd.", CustomerKind.DIRECT, { sub_type: "CORPORATE", region: "SG", customer_status: "DORMANT" }), ...base(24 * 7, 24 * 5) },
  { _id: zhengKaiwenId, ...customer("20008", "郑凯文", CustomerKind.DIRECT, { sub_type: "PERSONAL", region: "HK", phone: "+852 9876 1234" }), ...base(24 * 2, 1) },
  { _id: new ObjectId(), ...customer("20009", "李婉晴", CustomerKind.DIRECT, { sub_type: "PERSONAL", region: "HK", customer_status: "DORMANT" }), ...base(24 * 6, 24 * 4) },
]);

/* ---- 报价域演示数据（重建；仅限开发环境） ---- */
for (const name of [
  "quote_benchmarks",
  "quote_benchmark_snapshots",
  "quote_channel_rates",
  "quote_configs",
  "quote_groups",
  "quote_records",
]) {
  await db.collection(name).deleteMany({});
}
const D = text => Decimal128.fromString(text);

/* 平台基准价（code 为公式变量稳定键）+ 一条保存快照 */
const benchmarks = [
  ["sino", "sino每日价格", "7.8230"],
  ["usd_bid", "美元报价", "7.8120"],
  ["xe_hkd", "xe港币", "1.2773306"],
  ["hkd_u", "HKD-U", "7.8100"],
  ["u_hkd", "U-HKD", "7.8280"],
];
await db.collection("quote_benchmarks").insertMany(
  benchmarks.map(([code, label, value], index) => ({
    code,
    label,
    value: D(value),
    sort: index,
    ...base(24 * 10, 20),
  })),
);
await db.collection("quote_benchmark_snapshots").insertOne({
  saved_at: at(20),
  operator_name: "quotetest",
  prices: benchmarks.map(([, label, value]) => ({ label, value: D(value) })),
  ...base(20),
});

/* 渠道即时汇率（原型 XE Global 数据；原型中 xe_usdt_hkd 的 label 笔误已修正） */
const channelRates = [
  ["xe_hkd_usd", "XE-HKD:USD", "1.2773306"],
  ["xe_usd_hkd", "XE-USD:HKD", "7.8120"],
  ["xe_hkd_usdt", "XE-HKD:USDT", "7.8100"],
  ["xe_usdt_hkd", "XE-USDT:HKD", "7.8280"],
  ["xe_hkd_tt_cnh_tt", "XE-HKD(TT):CNH(TT)", "0.9236"],
  ["xe_cnh_tt_hkd_tt", "XE-CNH(TT):HKD(TT)", "1.0827"],
  ["xe_usd_tt_cnh_tt", "XE-USD(TT):CNH(TT)", "7.2145"],
  ["xe_cnh_tt_usd_tt", "XE-CNH(TT):USD(TT)", "0.1386"],
  ["xe_usdt_cnh", "XE-USDT:CNH", "7.2368"],
  ["xe_cnh_usdt", "XE-CNH:USDT", "0.1382"],
  ["xe_usd_sgd", "XE-USD:SGD", "1.3421"],
  ["xe_sgd_usd", "XE-SGD:USD", "0.7451"],
  ["xe_hkd_sgd", "XE-HKD:SGD", "0.1718"],
  ["xe_sgd_hkd", "XE-SGD:HKD", "5.8204"],
  ["xe_usd_eur", "XE-USD:EUR", "0.9224"],
  ["xe_eur_usd", "XE-EUR:USD", "1.0841"],
  ["xe_hkd_eur", "XE-HKD:EUR", "0.1181"],
  ["xe_eur_hkd", "XE-EUR:HKD", "8.4675"],
  ["xe_usd_jpy", "XE-USD:JPY", "151.2840"],
  ["xe_jpy_usd", "XE-JPY:USD", "0.0066"],
  ["xe_hkd_jpy", "XE-HKD:JPY", "19.3652"],
  ["xe_jpy_hkd", "XE-JPY:HKD", "0.0516"],
  ["xe_usd_aud", "XE-USD:AUD", "1.5214"],
  ["xe_aud_usd", "XE-AUD:USD", "0.6573"],
  ["xe_usd_gbp", "XE-USD:GBP", "0.7876"],
  ["xe_gbp_usd", "XE-GBP:USD", "1.2697"],
  ["xe_usd_cad", "XE-USD:CAD", "1.3769"],
  ["xe_cad_usd", "XE-CAD:USD", "0.7263"],
  ["xe_usd_thb", "XE-USD:THB", "35.4210"],
  ["xe_thb_usd", "XE-THB:USD", "0.0282"],
  ["xe_usd_php", "XE-USD:PHP", "57.1820"],
  ["xe_php_usd", "XE-PHP:USD", "0.0175"],
  ["xe_usd_myr", "XE-USD:MYR", "4.7320"],
  ["xe_myr_usd", "XE-MYR:USD", "0.2113"],
  ["xe_usd_idr", "XE-USD:IDR", "16248.5"],
  ["xe_idr_usd", "XE-IDR:USD", "0.0000615"],
];
await db.collection("quote_channel_rates").insertMany(
  channelRates.map(([code, label, value], index) => ({
    code,
    label,
    value: D(value),
    sort: index,
    source: "XE",
    ...base(24 * 10, 3),
  })),
);

/* 客户报价配置：变量 token 结构见 packages/shared/src/quote.ts */
const benchVar = code => {
  const [, label] = benchmarks.find(([c]) => c === code);
  return { type: "var", value: null, source: "BENCHMARK", code, label };
};
const chanVar = code => {
  const [, label] = channelRates.find(([c]) => c === code);
  return { type: "var", value: null, source: "CHANNEL", code, label };
};
const num = value => ({ type: "num", value, source: null, code: null, label: null });
const op = value => ({ type: "op", value, source: null, code: null, label: null });
const item = (id, tradeType, prefix, suffix, formula, extra = {}) => ({
  _id: id,
  trade_type: tradeType,
  prefix,
  suffix,
  formula,
  broker_point: null,
  bv_point: null,
  digits: 4,
  round_mode: "HALF_UP",
  output_checked: true,
  last_result: null,
  last_quoted_at: null,
  ...extra,
});

const linUsdItemId = new ObjectId();
const linHkdItemId = new ObjectId();
const linTtItemId = new ObjectId();
const config = (customerId, items, opening, extra = {}) => ({
  customer_id: customerId,
  items,
  text_opening: opening,
  text_ending: "",
  include_quote_time: false,
  common_notes: [],
  ...base(24 * 6, 4),
  ...extra,
});

await db.collection("quote_configs").insertMany([
  config(
    brokerLinId,
    [
      item(linUsdItemId, "美元", "sino", "(含手续费)", [benchVar("sino")], { last_result: D("7.8230"), last_quoted_at: at(4) }),
      item(linHkdItemId, "港币", "sgb", "", [benchVar("sino"), op("+"), num("3")], { last_result: D("10.8230"), last_quoted_at: at(4) }),
      item(linTtItemId, "HKD-TT/CNH-TT", "sino", "", [num("2.6547")], { digits: 5, last_result: D("2.65470"), last_quoted_at: at(4) }),
    ],
    "中介林(20005)：",
  ),
  config(
    raviId,
    [
      item(new ObjectId(), "美元", "sino", "(含手续费)", [benchVar("sino")], { last_result: D("7.8230"), last_quoted_at: at(3) }),
      item(new ObjectId(), "港币", "sgb", "", [benchVar("sino"), op("+"), num("3")], { last_result: D("10.8230"), last_quoted_at: at(3) }),
      item(
        new ObjectId(),
        "USDT/CNH-TT",
        "USDT/CNH-TT",
        "",
        [chanVar("xe_usdt_cnh"), op("-"), num("3.0289")],
        { digits: 8, last_result: D("4.20790000"), last_quoted_at: at(3) },
      ),
      item(
        new ObjectId(),
        "HKD-TT/CNH-TT",
        "sino",
        "",
        [{ type: "var", value: null, source: "BROKER_ITEM", code: linTtItemId.toString(), label: "中介林HKD-TT/CNH-TTsino" }],
        { digits: 5, last_result: D("2.65470"), last_quoted_at: at(3) },
      ),
    ],
    "ravi(22001)：",
  ),
  config(
    chenJianingId,
    [
      item(new ObjectId(), "美元", "sino", "(含手续费)", [benchVar("sino")], { last_result: D("7.8230"), last_quoted_at: at(8) }),
      item(new ObjectId(), "港币", "sgb", "", [benchVar("sino"), op("+"), num("3"), op("*"), num("3")], { last_result: D("16.8230"), last_quoted_at: at(8) }),
    ],
    "陈嘉宁(20001)：",
  ),
  config(
    linYawenId,
    [
      item(new ObjectId(), "美元", "同名", "(VIP)", [benchVar("usd_bid")], { last_result: D("7.8120"), last_quoted_at: at(26) }),
      item(new ObjectId(), "港币", "第三方", "", [benchVar("xe_hkd"), op("+"), num("0.2")], { last_result: D("1.4773"), last_quoted_at: at(26) }),
    ],
    "林雅雯(20003)：",
  ),
]);

/* 报价组 */
await db.collection("quote_groups").insertMany([
  { name: "早上报价", customer_ids: [chenJianingId, linYawenId, zhengKaiwenId], ...base(24 * 9, 24) },
  { name: "下午报价", customer_ids: [brokerLinId, raviId, chenJianingId, linYawenId, auroraId], ...base(24 * 9, 4) },
  { name: "高频报价组", customer_ids: [raviId, auroraId], ...base(24 * 5, 24 * 2) },
]);

/* 报价历史（近一周，供往期报价矩阵与明细抽屉演示） */
const record = (customerId, hoursAgo, tradeType, prefix, suffix, formulaText, formulaCalc, variables, result, digits, operatorName) => ({
  customer_id: customerId,
  trade_type: tradeType,
  prefix,
  suffix,
  formula_text: formulaText,
  formula_calc: formulaCalc,
  variables,
  result: D(result),
  broker_point: null,
  bv_point: null,
  digits,
  round_mode: "HALF_UP",
  quoted_at: at(hoursAgo),
  operator_name: operatorName,
  ...base(hoursAgo),
});

await db.collection("quote_records").insertMany([
  record(raviId, 3, "美元", "sino", "(含手续费)", "sino每日价格", "7.823", [{ label: "sino每日价格", value: "7.823" }], "7.8230", 4, "quotetest"),
  record(raviId, 3, "港币", "sgb", "", "sino每日价格 + 3", "7.823 + 3", [{ label: "sino每日价格", value: "7.823" }], "10.8230", 4, "quotetest"),
  record(raviId, 3, "USDT/CNH-TT", "USDT/CNH-TT", "", "XE-USDT:CNH - 3.0289", "7.2368 - 3.0289", [{ label: "XE-USDT:CNH", value: "7.2368" }], "4.207900000", 9, "quotetest"),
  record(raviId, 26, "美元", "sino", "(含手续费)", "sino每日价格", "7.823", [{ label: "sino每日价格", value: "7.823" }], "7.8230", 4, "quotetest"),
  record(raviId, 26, "港币", "sgb", "", "sino每日价格 + 3", "7.823 + 3", [{ label: "sino每日价格", value: "7.823" }], "10.8230", 4, "jacky"),
  record(raviId, 50, "USDT/CNH-TT", "USDT/CNH-TT", "", "XE-USDT:CNH - 3.0289", "7.2479 - 3.0289", [{ label: "XE-USDT:CNH", value: "7.2479" }], "4.219000000", 9, "quotetest"),
  record(raviId, 74, "美元", "sino", "(含手续费)", "sino每日价格", "7.8195", [{ label: "sino每日价格", value: "7.8195" }], "7.8195", 4, "jacky"),
  record(raviId, 98, "港币", "sgb", "", "sino每日价格 + 3", "7.8195 + 3", [{ label: "sino每日价格", value: "7.8195" }], "10.8195", 4, "quotetest"),
  record(chenJianingId, 8, "美元", "sino", "(含手续费)", "sino每日价格", "7.823", [{ label: "sino每日价格", value: "7.823" }], "7.8230", 4, "quotetest"),
  record(chenJianingId, 8, "港币", "sgb", "", "sino每日价格 + 3 * 3", "7.823 + 3 * 3", [{ label: "sino每日价格", value: "7.823" }], "16.8230", 4, "quotetest"),
]);

/* ---- KYC 材料清单（demo 原样迁移：21 个业务类型，四层结构 业务类型→渠道→材料模块→材料项；重建） ---- */
/* 2026-08-27 起以甲方正式 KYC list（繁體）为准；demo-kyc-data.mjs 仅存档 */
const { realKycScenarios: demoKycScenarios } = await import("./kyc-list-real.mjs");
const kycValidityMap = { none: "NONE", "1m": "ONE_MONTH", "3m": "THREE_MONTHS" };
const kycTypeMap = { file: "FILE", text: "TEXT", bank_account: "BANK_ACCOUNT" };
await db.collection("kyc_scenarios").deleteMany({});
let kycIndex = 0;
for (const scenario of demoKycScenarios) {
  await db.collection("kyc_scenarios").insertOne({
    scenario_code: String(scenario.code),
    scenario_name: scenario.name,
    process_description: scenario.processDescription || null,
    status: "PUBLISHED",
    is_builtin: false,
    channels: (scenario.channels || []).map((channel, channelIndex) => ({
      channel_code: channel.id ? String(channel.id).toUpperCase() : `CH_${scenario.code}_${channelIndex}`,
      channel_name: channel.name,
      theme: channel.theme || "blue",
      restrictions: (channel.restrictions || []).map(r => ({ type: r.type || "special_proof", content: r.content })),
      sections: (channel.sections || []).map(section => ({
        section_name: section.title,
        items: (section.items || []).map(item => ({
          item_id: item.id,
          item_name: item.name,
          item_description: item.subRequirement || null,
          item_type: kycTypeMap[item.type] || "FILE",
          required: item.required !== false,
          validity: kycValidityMap[item.validity] || "NONE",
        })),
      })),
    })),
    sort_order: kycIndex++,
    published_at: at(24 * 5),
    ...base(24 * 6, 24 * 5),
  });
}

/* ---- 交易订单域演示数据（重建；demo seedTradeCore 迁移，客户映射到本 seed 名单）---- */
for (const name of ["trade_orders", "payout_orders", "treasury_accounts", "va_accounts"]) {
  await db.collection(name).deleteMany({});
}

/* 单号从 created_at（本地时区）派生：修复"写死单号日期 vs 相对创建时间"逐日漂移（审计 2.1） */
const bizNo = (prefix, hoursAgo, seq) => {
  const d = at(hoursAgo);
  const p = n => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  if (prefix === "TO") return `${day}-${seq}`;
  return `${prefix}-${day}-${seq}`;
};

/* 简化账户（demo 9 个）。余额与下方订单流水自洽（审计 2.4）：
   opening ± 已确认流水 = available + frozen。
   SGB-USD：opening 2,050,000 − 完成订单消耗 220,000 − 待排单订单冻结 25,000；
   SINO-USD：opening 900,000 − 冻结 235,000（150,000 + 85,000）；
   SGB-HKD：opening 240,000 + 法币订单入款 663,000；
   wallet-USDT：opening 200,000 + 链上入款 150,300 + 220,440 + 25,060；
   现金/VA 账户无订单流水，available = opening（HKD 现金订单尚未到账，不计入）。 */
const treasuryRows = [
  ["cash-HKD", "现金库存", "现金库存 · HKD", "HKD", 1100000, 0, 1100000, 500000],
  ["cash-USD", "现金库存", "现金库存 · USD", "USD", 380000, 0, 380000, 400000],
  ["cash-CNY", "现金库存", "现金库存 · CNY", "CNY", 508000, 0, 508000, 200000],
  ["cash-EUR", "现金库存", "现金库存 · EUR", "EUR", 96000, 0, 96000, 50000],
  ["bank-SGB-USD", "银行账户", "SGB 银行账户 · USD", "USD", 1805000, 25000, 2050000, 800000],
  ["bank-SGB-HKD", "银行账户", "SGB 银行账户 · HKD", "HKD", 903000, 0, 240000, 300000],
  ["bank-SINO-USD", "银行账户", "SINO 清算账户 · USD", "USD", 665000, 235000, 900000, 800000],
  ["va-USD", "VA 账户", "SGB VA 归集账户 · USD", "USD", 610000, 0, 610000, 200000],
  ["wallet-USDT", "USDT 钱包", "USDT 热钱包 · TRC20", "USDT", 595800, 0, 200000, 100000],
];
await db.collection("treasury_accounts").insertMany(
  treasuryRows.map(([key, group, name, currency, available, frozen, opening, floor]) => ({
    key, group, name, currency,
    available: D(String(available)), frozen: D(String(frozen)),
    opening: D(String(opening)), floor: D(String(floor)),
    ...base(24 * 10, 2),
  })),
);

/* 客户 VA 账户（demo initialVaAccounts 映射） */
const vaRow = (customerId, label, van, currency, bank) => ({
  customer_id: customerId, label, virtual_account_number: van, iban: `BH09SGBD${van}`,
  currency, bank, ...base(24 * 12),
});
await db.collection("va_accounts").insertMany([
  vaRow(chenJianingId, "Account 1", "79209100000095", "USD", "SGB Virtual Account"),
  vaRow(chenJianingId, "Account 2", "79209100000118", "HKD", "SGB Virtual Account"),
  vaRow(linYawenId, "Account 1", "79209100000242", "USD", "SGB Virtual Account"),
  vaRow(northstarId, "Account 1", "79209100000309", "USD", "SGB Business VA"),
  vaRow(zhengKaiwenId, "Account 1", "79209100000355", "USD", "SGB Virtual Account"),
  vaRow(zhengKaiwenId, "Account 2", "79209100000356", "HKD", "SGB Virtual Account"),
  vaRow(auroraId, "Account 1", "79209100000318", "USD", "SGB Business VA"),
]);

/* 已通过的准入申请（订单 KYC 徽标联查用；scenario 取 demo 第一个业务类型） */
const kycScenarioName = "港幣/美元/外幣私戶打款買U";
/* 按名称查真实 kyc_scenarios 拿 _id 回填，seed 数据同样具备"改场景名不断链"性质（审计 1.2.10） */
const kycScenarioDoc = await db.collection("kyc_scenarios").findOne({ scenario_name: kycScenarioName, is_deleted: false });
const kycScenarioId = kycScenarioDoc?._id ?? null;
const approvedAccess = (no, customerId, name, code) => ({
  application_no: no, customer_id: customerId,
  customer_snapshot: { name, customer_code: code, customer_kind: "DIRECT" },
  scenario_id: kycScenarioId, scenario_code: "1", scenario_name: kycScenarioName,
  channel_code: "SGB", channel_name: "SGB", review_type: "FX",
  form: { customer_cn_name: name, customer_en_name: null, business_note: null },
  materials: [], status: "APPROVED", owner_user_id: null, owner_name: "quotetest",
  latest_review: null,
  /* 客户详情弹窗要求每条准入记录（含已完结）都展示处理时间线 */
  timeline: [
    { at: at(24 * 7), by_name: "quotetest", action: "创建申请", from_status: null, to_status: "DRAFT", note: null },
    { at: at(24 * 6), by_name: "quotetest", action: "提交合规审核", from_status: "DRAFT", to_status: "PENDING_REVIEW", note: null },
    { at: at(24 * 6 - 2), by_name: "keen", action: "审核通过", from_status: "PENDING_REVIEW", to_status: "APPROVED", note: null },
  ],
  submitted_at: at(24 * 6), ...base(24 * 7, 24 * 6 - 2),
});
await db.collection("access_applications").insertMany([
  approvedAccess(bizNo("APP", 24 * 7, "901"), zhengKaiwenId, "郑凯文", "20008"),
  approvedAccess(bizNo("APP", 24 * 7, "902"), linYawenId, "林雅雯", "20003"),
  approvedAccess(bizNo("APP", 24 * 7, "903"), auroraId, "Aurora Capital Pte. Ltd.", "20006"),
  approvedAccess(bizNo("APP", 24 * 7, "904"), northstarId, "Northstar Trading Limited", "20002"),
  approvedAccess(bizNo("APP", 24 * 7, "905"), chenJianingId, "陈嘉宁", "20001"),
]);

/* 出款排单（与订单联动：SCH-001 审核中 / SCH-004 待出款 / SCH-002 已出款）。
   单号与各时点从提交时刻派生，且 提交 → 审核 → 出款 时间顺序自洽（审计 2.2）。 */
const sch001Id = new ObjectId();
const sch004Id = new ObjectId();
const sch002Id = new ObjectId();
const SCH001_SUB_H = 8;
const SCH004_SUB_H = 24;
const SCH002_SUB_H = 48;
const schNo001 = bizNo("SCH", SCH001_SUB_H, "001");
const schNo004 = bizNo("SCH", SCH004_SUB_H, "004");
const schNo002 = bizNo("SCH", SCH002_SUB_H, "002");
const to105Id = new ObjectId();
const to106Id = new ObjectId();
const to107Id = new ObjectId();
const dispatchDoc = (_id, no, orderId, orderNo, customerId, name, code, channel, currency, amount, status, extra = {}) => ({
  _id, dispatch_no: no, order_id: orderId, order_no: orderNo, customer_id: customerId,
  customer_name: name, customer_code: code, channel, currency, amount: D(String(amount)),
  order_title: `補單:${code}`, final_text: `* ${channel === "SGB" ? "sgb（渠道2）" : "sino(渠道1) pobo"}\n\n補單:${code}\n\nAccount Name: ${name}\nName of Bank: HSBC Hong Kong\nBank Account Number: 808-****-001\n\n金額：${amount.toLocaleString("en-US")} ${currency.toLowerCase()}\n出款帳戶：${channel === "SGB" ? `${name.toUpperCase()} SGB VA` : "pobo cq開-開"}`,
  payout_account: channel === "SGB" ? `${name.toUpperCase()} SGB VA` : "pobo cq開-開",
  va_account: null, payee: name, payee_bank: "HSBC Hong Kong · 808-****-001",
  status, submitted_by: "quotetest", submitted_at: at(30), reviewed_by: null, reviewed_at: null,
  paid_by: null, paid_at: null, receipt: null, ...base(30, 5), ...extra,
});
const orderNo105 = bizNo("TO", 130, "001");
const orderNo106 = bizNo("TO", 150, "001");
const orderNo107 = bizNo("TO", 175, "001");
await db.collection("payout_orders").insertMany([
  dispatchDoc(sch001Id, schNo001, to105Id, orderNo105, linYawenId, "林雅雯", "20003", "SINO", "USD", 150000, "REVIEWING", {
    submitted_at: at(SCH001_SUB_H), ...base(SCH001_SUB_H, SCH001_SUB_H),
  }),
  dispatchDoc(sch004Id, schNo004, to106Id, orderNo106, auroraId, "Aurora Capital Pte. Ltd.", "20006", "SINO", "USD", 85000, "AWAITING_PAYOUT", {
    reviewed_by: "jacky", reviewed_at: at(20),
    submitted_at: at(SCH004_SUB_H), ...base(SCH004_SUB_H, 20),
  }),
  dispatchDoc(sch002Id, schNo002, to107Id, orderNo107, new ObjectId(), "李婉晴", "20009", "SGB", "USD", 220000, "PAID", {
    reviewed_by: "jacky", reviewed_at: at(46), paid_by: "payouttest", paid_at: at(40),
    receipt: { file_name: "SGB-回单.pdf", reference: "808-****-001", note: null, uploaded_by: "payouttest", uploaded_at: at(40), matched: true },
    submitted_at: at(SCH002_SUB_H), ...base(SCH002_SUB_H, 40),
  }),
]);

/* 交易订单（demo 11 单精简迁移，覆盖全部状态与三种资金形态） */
const liWanqingId = (await db.collection("customers").findOne({ customer_code: "20009" }))._id;
const mosaicId = (await db.collection("customers").findOne({ customer_code: "20007" }))._id;
const zhaoMingyuanId = (await db.collection("customers").findOne({ customer_code: "20004" }))._id;
await db.collection("access_applications").insertMany([
  approvedAccess(bizNo("APP", 24 * 7, "906"), liWanqingId, "李婉晴", "20009"),
  approvedAccess(bizNo("APP", 24 * 7, "907"), mosaicId, "Mosaic Ventures Pte. Ltd.", "20007"),
]);
const tl = (hoursAgo, title, detail, actor) => ({ at: at(hoursAgo), title, detail, actor });
/* 订单 20260828-001 关联的真实报价记录（往期报价里可查到，订单详情"关联报价"引用它；审计 2.5 悬空快照修复） */
const mosaicQuoteId = new ObjectId();
await db.collection("quote_records").insertOne({
  _id: mosaicQuoteId, customer_id: mosaicId, trade_type: "转账换U", prefix: "USDT",
  suffix: "", formula_text: "U-HKD - 6.8260", formula_calc: "7.8280 - 6.8260",
  variables: [{ label: "U-HKD", value: "7.8280" }], result: D("1.0020"),
  broker_point: null, bv_point: null, digits: 4, round_mode: "HALF_UP",
  quoted_at: at(11), operator_name: "quotetest", ...base(11),
});
/* business_type 默认取客户已通过的准入业务类型（审计 1.2.8：避免"业务类型 — 而 KYC 已通过"的矛盾） */
const orderDoc = (no, customerId, name, code, tradeType, sellCur, sellAmt, buyCur, buyAmt, rate, payMethod, status, extra = {}) => ({
  order_no: no, customer_id: customerId, customer_name: name, customer_code: code, person_name: null,
  business_type: extra.business_type ?? kycScenarioName,
  business_scenario_id: extra.business_scenario_id ?? kycScenarioId, trade_type: tradeType,
  sell_currency: sellCur, sell_amount: D(String(sellAmt)), buy_currency: buyCur, buy_amount: D(String(buyAmt)),
  rate, pay_method: payMethod, remark: extra.remark ?? null, quote: extra.quote ?? null,
  status, handler_name: extra.handler ?? "quotetest", owner_user_id: null, dispatch_id: extra.dispatch_id ?? null,
  wallet_ops: extra.wallet_ops ?? null, inflow_mark: extra.inflow_mark ?? null, outflow_mark: extra.outflow_mark ?? null,
  freeze: extra.freeze ?? null, profit: extra.profit ?? null, exception: extra.exception ?? null,
  payment_rejected: null, dispatch_rejected: extra.dispatch_rejected ?? null,
  receipt_ref: extra.receipt_ref ?? null, timeline: extra.timeline ?? [], ...base(extra.createdH ?? 30, extra.updatedH ?? 5),
});
const chainMark = (hoursAgo, amount, hash) => ({
  by: "wallettest", at: at(hoursAgo), amount, currency: "USDT", account: null, voucher: `trx-${hash.slice(0, 6)}.png`,
  chain: "TRC20", hash, confirms: "24", place: null, handler: null, token: null, method: "链上收款", note: null,
});
await db.collection("trade_orders").insertMany([
  orderDoc(bizNo("TO", 9, "002"), zhengKaiwenId, "郑凯文", "20008", "U换现金", "USDT", 5000, "HKD", 39000, "7.8000", "USDT 转入", "AWAITING_INFLOW", {
    createdH: 9, updatedH: 9,
    timeline: [tl(9, "KYC 校验通过", "建单时客户 郑凯文 已准入（审核通过），订单直接进入待客户入款", "系统"), tl(9, "订单创建", "U换现金 · 卖出 USDT 5,000 买入 HKD 39,000 · 创建人 quotetest", "初级交易员 quotetest")],
  }),
  orderDoc(bizNo("TO", 10, "001"), mosaicId, "Mosaic Ventures Pte. Ltd.", "20007", "转账换U", "USD", 30000, "USDT", 29940, "1.0020", "银行转账", "AWAITING_INFLOW", {
    createdH: 10, updatedH: 10,
    quote: { quote_record_id: mosaicQuoteId.toString(), deal_rate: "1.0020", cost_rate: "0.9990", source: "快速报价", quoted_at: at(11), quoted_by: "quotetest", fee: null },
    timeline: [tl(10, "关联报价", "成交价 1.0020 · 成本价 0.9990", "初级交易员 quotetest"), tl(10, "订单创建", "转账换U · 卖出 USD 30,000 买入 USDT 29,940 · 创建人 quotetest", "初级交易员 quotetest")],
  }),
  orderDoc(bizNo("TO", 26, "002"), zhengKaiwenId, "郑凯文", "20008", "现金换U", "HKD", 156400, "USDT", 20000, "7.8200", "现金", "AWAITING_INFLOW", {
    createdH: 26, updatedH: 20, handler: "quotetest",
    wallet_ops: { deposit_address: null, deposit_by: null, deposit_at: null, payout_address: "TWb5Yd8Nc2Kf7Rq3Hm9Ls1Xz6Gv4Tu0Pe", kya_passed: false, kya_by: null, kya_at: null },
    timeline: [tl(20, "通知客户付款", "等待客户交付 HKD 156,400 现金", "初级交易员 quotetest"), tl(26, "订单创建", "现金换U · 卖出 HKD 156,400 买入 USDT 20,000 · 创建人 quotetest", "初级交易员 quotetest")],
  }),
  { ...orderDoc(orderNo105, linYawenId, "林雅雯", "20003", "U换转账", "USDT", 150300, "USD", 150000, "0.9980", "USDT 转入", "DISPATCH_REVIEW", {
    createdH: 130, updatedH: 8, handler: "jacky", dispatch_id: sch001Id,
    wallet_ops: { deposit_address: "TXk7Rm2Qd9Vb4Nc8Hs1Lp6Wz3Ye5Gu0Tf", deposit_by: "wallettest", deposit_at: at(129), payout_address: null, kya_passed: true, kya_by: "wallettest", kya_at: at(128) },
    inflow_mark: chainMark(127, 150300, "9f2c7a1e5b34d806fa71c2e93b5d4087ac16e2f9d3b7c8514a0e6d9f2b3c7a15"),
    freeze: { account_key: "bank-SINO-USD", account_name: "SINO 清算账户 · USD", currency: "USD", amount: D("150000"), state: "FROZEN" },
    timeline: [tl(8, "排单已提交", `${schNo001} · USD 150,000 · SINO 通道，进入排单审核`, "初级交易员 quotetest"), tl(127, "入款已确认", "150,300 USDT 到账，冻结 USD 150,000，进入待出款排单", "钱包运营 wallettest"), tl(130, "订单创建", "U换转账 · 卖出 USDT 150,300 买入 USD 150,000 · 创建人 quotetest", "初级交易员 quotetest")],
  }) },
  { ...orderDoc(orderNo106, auroraId, "Aurora Capital Pte. Ltd.", "20006", "法币换法币", "HKD", 663000, "USD", 85000, "7.8000", "银行转账", "AWAITING_PAYOUT", {
    createdH: 150, updatedH: 20, handler: "jacky", dispatch_id: sch004Id,
    inflow_mark: { by: "ivy", at: at(148), amount: 663000, currency: "HKD", account: "SGB 银行账户 · HKD", voucher: "aurora-chats-0818.pdf", chain: null, hash: null, confirms: null, place: null, handler: null, token: null, method: "电汇转账", note: "CHATS 汇入" },
    freeze: { account_key: "bank-SINO-USD", account_name: "SINO 清算账户 · USD", currency: "USD", amount: D("85000"), state: "FROZEN" },
    timeline: [tl(20, "排单审核通过", `${schNo004} 转入待出款执行（执行人：出款员 payouttest）`, "高级交易员 jacky"), tl(148, "入款已确认", "HKD 663,000 到账，冻结 USD 85,000，进入待出款排单", "财务 ivy"), tl(150, "订单创建", "法币换法币 · 卖出 HKD 663,000 买入 USD 85,000 · 创建人 quotetest", "初级交易员 quotetest")],
  }) },
  { ...orderDoc(orderNo107, liWanqingId, "李婉晴", "20009", "U换转账", "USDT", 220440, "USD", 220000, "0.9980", "USDT 转入", "COMPLETED", {
    createdH: 175, updatedH: 40, handler: "payouttest", dispatch_id: sch002Id, receipt_ref: "SGB-回单.pdf",
    wallet_ops: { deposit_address: "TZp9Wc3Kd6Nb2Vq8Hs1Lp6Wz3Ye5Gu0Ef", deposit_by: "wallettest", deposit_at: at(174), payout_address: null, kya_passed: false, kya_by: null, kya_at: null },
    inflow_mark: chainMark(172, 220440, "6a4e9c02b7d158f3e0c74b295ad86031fc52e9b7d403a1685cf29d7e04b3a1c6"),
    outflow_mark: { by: "payouttest", at: at(40), amount: 220000, currency: "USD", account: "SGB 银行账户 · USD", voucher: "SGB-回单.pdf", chain: null, hash: null, confirms: null, place: null, handler: null, token: null, method: null, note: null },
    freeze: { account_key: "bank-SGB-USD", account_name: "SGB 银行账户 · USD", currency: "USD", amount: D("220000"), state: "CONSUMED" },
    profit: { currency: "USD", spread: 880, fee: 220, channel_cost: 110, commission: 770, net: 220 },
    timeline: [tl(40, "订单完成", "出款已执行、凭证已归档，预计净收益 USD 220，订单闭环", "出款员 payouttest"), tl(40, "银行出款已完成", "SGB 银行账户 · USD 220,000 已出款，回单已归档", "出款员 payouttest"), tl(46, "排单审核通过", `${schNo002} 转入待出款执行`, "高级交易员 jacky"), tl(175, "订单创建", "U换转账 · 卖出 USDT 220,440 买入 USD 220,000 · 创建人 quotetest", "初级交易员 quotetest")],
  }) },
  orderDoc(bizNo("TO", 30, "001"), northstarId, "Northstar Trading Limited", "20002", "转账换U", "USD", 50000, "USDT", 49900, "1.0020", "银行转账", "AWAITING_INFLOW", {
    createdH: 30, updatedH: 12, handler: "jacky",
    exception: { kind: "业务异常", reason: "金额不符", detail: "客户实付 USD 48,000，与应收 USD 50,000 不符", prev_status: "AWAITING_INFLOW", escalated: false, since: at(12) },
    timeline: [tl(12, "标记异常", "付款金额不符：实付 USD 48,000 / 应收 USD 50,000，等待处理", "高级交易员 jacky"), tl(30, "订单创建", "转账换U · 卖出 USD 50,000 买入 USDT 49,900 · 创建人 quotetest", "初级交易员 quotetest")],
  }),
  orderDoc(bizNo("TO", 55, "001"), zhaoMingyuanId, "赵明远", "20004", "转账换U", "USD", 120000, "USDT", 119760, "1.0020", "银行转账", "PENDING_KYC", {
    createdH: 55, updatedH: 50, handler: "keen", business_type: kycScenarioName,
    exception: { kind: "合规异常", reason: "高风险客户", detail: "客户命中可疑交易规则，待合规复核", prev_status: "PENDING_KYC", escalated: true, since: at(50) },
    timeline: [tl(50, "升级合规", "命中高风险规则，已转合规复核，主线停留在待KYC", "高级交易员 jacky"), tl(55, "合规提示", `「${kycScenarioName}」准入未通过，本单进入待KYC`, "系统"), tl(55, "订单创建", "转账换U · 卖出 USD 120,000 买入 USDT 119,760 · 创建人 choy", "初级交易员 choy")],
  }),
  { ...orderDoc(bizNo("TO", 9, "003"), zhengKaiwenId, "郑凯文", "20008", "U换转账", "USDT", 25060, "USD", 25000, "0.9976", "USDT 转入", "AWAITING_DISPATCH", {
    createdH: 9, updatedH: 8, handler: "quotetest",
    wallet_ops: { deposit_address: "TQm4Rf7Xb2Vd9Kc1Ns6Hp3Lw8Zy5Ge0Ur", deposit_by: "wallettest", deposit_at: at(9), payout_address: null, kya_passed: false, kya_by: null, kya_at: null },
    inflow_mark: chainMark(8, 25060, "3d8b1f60ac52e7194b0d6c83fa27e5b19d4c0a76e8f3b512c9a7d04e6b18f2c3"),
    freeze: { account_key: "bank-SGB-USD", account_name: "SGB 银行账户 · USD", currency: "USD", amount: D("25000"), state: "FROZEN" },
    timeline: [tl(8, "入款已确认", "25,060 USDT 到账，冻结 USD 25,000，进入待出款排单", "钱包运营 wallettest"), tl(9, "订单创建", "U换转账 · 卖出 USDT 25,060 买入 USD 25,000 · 创建人 quotetest", "初级交易员 quotetest")],
  }) },
  orderDoc(bizNo("TO", 80, "001"), liWanqingId, "李婉晴", "20009", "现金换U", "HKD", 78000, "USDT", 10000, "7.8000", "现金", "CANCELLED", {
    createdH: 80, updatedH: 75,
    timeline: [tl(75, "订单取消", "客户主动取消，未发生资金动作，订单作废", "初级交易员 quotetest"), tl(80, "订单创建", "现金换U · 卖出 HKD 78,000 买入 USDT 10,000 · 创建人 quotetest", "初级交易员 quotetest")],
  }),
]);
/* 修正排单的 order_id 引用（trade_orders 插入后回填真实 _id） */
for (const [schNo, orderNo] of [[schNo001, orderNo105], [schNo004, orderNo106], [schNo002, orderNo107]]) {
  const order = await db.collection("trade_orders").findOne({ order_no: orderNo });
  if (order) {
    await db.collection("payout_orders").updateOne({ dispatch_no: schNo }, { $set: { order_id: order._id } });
    await db.collection("trade_orders").updateOne({ _id: order._id }, { $set: { dispatch_id: (await db.collection("payout_orders").findOne({ dispatch_no: schNo }))._id } });
  }
}

const counts = {
  roles: await db.collection("roles").countDocuments(),
  users: await db.collection("users").countDocuments(),
  customers: await db.collection("customers").countDocuments(),
  quote_configs: await db.collection("quote_configs").countDocuments(),
  quote_groups: await db.collection("quote_groups").countDocuments(),
  quote_records: await db.collection("quote_records").countDocuments(),
  kyc_scenarios: await db.collection("kyc_scenarios").countDocuments(),
  trade_orders: await db.collection("trade_orders").countDocuments(),
  payout_orders: await db.collection("payout_orders").countDocuments(),
  treasury_accounts: await db.collection("treasury_accounts").countDocuments(),
};
console.log("seed done:", counts);
await client.close();
