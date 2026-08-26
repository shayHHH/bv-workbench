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
  agent_name: null,
  follow_trader: null,
  phone: null,
  remark: null,
  customer_status: "NEW",
  risk_level: "PENDING",
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
  { _id: chenJianingId, ...customer("20001", "陈嘉宁", CustomerKind.DIRECT, { region: "HK", agent_name: "杨澜", phone: "+852 6123 4567", customer_status: "ACTIVE", risk_level: "LOW" }), ...base(24 * 18, 2) },
  { _id: northstarId, ...customer("20002", "Northstar Trading Limited", CustomerKind.INTERMEDIARY, { region: "HK", agent_name: "杨澜", customer_status: "ACTIVE", risk_level: "MEDIUM", remark: "企业中介，可挂载下级客户" }), ...base(24 * 16, 5) },
  { _id: new ObjectId(), ...customer("22156", "Northstar 贸易联系人 A", CustomerKind.SUB_CUSTOMER, { parent_id: northstarId, sub_type: "PERSONAL", region: "HK", agent_name: "杨澜" }), ...base(24 * 10, 24) },
  { _id: new ObjectId(), ...customer(null, "Northstar 付款人 B", CustomerKind.SUB_CUSTOMER, { parent_id: northstarId, sub_type: "CORPORATE", region: "HK" }), ...base(24 * 9, 30) },
  { _id: brokerLinId, ...customer("20005", "中介林", CustomerKind.INTERMEDIARY, { region: "HK", agent_name: "杨澜", customer_status: "ACTIVE", risk_level: "LOW", remark: "中介报价源" }), ...base(24 * 14, 8) },
  { _id: raviId, ...customer("22001", "ravi", CustomerKind.SUB_CUSTOMER, { parent_id: brokerLinId, sub_type: "PERSONAL", region: "HK", agent_name: "杨澜", customer_status: "ACTIVE", risk_level: "LOW" }), ...base(24 * 12, 6) },
  { _id: linYawenId, ...customer("20003", "林雅雯", CustomerKind.DIRECT, { region: "CN_MAINLAND", agent_name: "周辰", phone: "+86 138 0013 8000", customer_status: "ACTIVE", risk_level: "LOW" }), ...base(24 * 13, 10) },
  { _id: new ObjectId(), ...customer("20004", "赵明远", CustomerKind.DIRECT, { region: "CN_MAINLAND", agent_name: "陈浩", customer_status: "SUSPENDED", risk_level: "HIGH", remark: "命中高风险地区关联规则，暂停合作" }), ...base(24 * 12, 24 * 3) },
  { _id: auroraId, ...customer("20006", "Aurora Capital Pte. Ltd.", CustomerKind.DIRECT, { region: "SG", agent_name: "周辰", customer_status: "ACTIVE", risk_level: "LOW" }), ...base(24 * 8, 20) },
  { _id: new ObjectId(), ...customer("20007", "Mosaic Ventures Pte. Ltd.", CustomerKind.DIRECT, { region: "SG", agent_name: "陈浩", customer_status: "DORMANT", risk_level: "MEDIUM" }), ...base(24 * 7, 24 * 5) },
  { _id: zhengKaiwenId, ...customer("20008", "郑凯文", CustomerKind.DIRECT, { region: "HK", agent_name: "杨澜", phone: "+852 9876 1234" }), ...base(24 * 2, 1) },
  { _id: new ObjectId(), ...customer("20009", "李婉晴", CustomerKind.DIRECT, { region: "HK", agent_name: "杨澜", customer_status: "DORMANT", risk_level: "LOW" }), ...base(24 * 6, 24 * 4) },
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
  operator_name: "杨澜",
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
        { digits: 9, last_result: D("4.207900000"), last_quoted_at: at(3) },
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
  record(raviId, 3, "美元", "sino", "(含手续费)", "sino每日价格", "7.823", [{ label: "sino每日价格", value: "7.823" }], "7.8230", 4, "杨澜"),
  record(raviId, 3, "港币", "sgb", "", "sino每日价格 + 3", "7.823 + 3", [{ label: "sino每日价格", value: "7.823" }], "10.8230", 4, "杨澜"),
  record(raviId, 3, "USDT/CNH-TT", "USDT/CNH-TT", "", "XE-USDT:CNH - 3.0289", "7.2368 - 3.0289", [{ label: "XE-USDT:CNH", value: "7.2368" }], "4.207900000", 9, "杨澜"),
  record(raviId, 26, "美元", "sino", "(含手续费)", "sino每日价格", "7.823", [{ label: "sino每日价格", value: "7.823" }], "7.8230", 4, "杨澜"),
  record(raviId, 26, "港币", "sgb", "", "sino每日价格 + 3", "7.823 + 3", [{ label: "sino每日价格", value: "7.823" }], "10.8230", 4, "周辰"),
  record(raviId, 50, "USDT/CNH-TT", "USDT/CNH-TT", "", "XE-USDT:CNH - 3.0289", "7.2479 - 3.0289", [{ label: "XE-USDT:CNH", value: "7.2479" }], "4.219000000", 9, "杨澜"),
  record(raviId, 74, "美元", "sino", "(含手续费)", "sino每日价格", "7.8195", [{ label: "sino每日价格", value: "7.8195" }], "7.8195", 4, "周辰"),
  record(raviId, 98, "港币", "sgb", "", "sino每日价格 + 3", "7.8195 + 3", [{ label: "sino每日价格", value: "7.8195" }], "10.8195", 4, "杨澜"),
  record(chenJianingId, 8, "美元", "sino", "(含手续费)", "sino每日价格", "7.823", [{ label: "sino每日价格", value: "7.823" }], "7.8230", 4, "杨澜"),
  record(chenJianingId, 8, "港币", "sgb", "", "sino每日价格 + 3 * 3", "7.823 + 3 * 3", [{ label: "sino每日价格", value: "7.823" }], "16.8230", 4, "杨澜"),
]);

/* ---- KYC 材料清单（demo 原样迁移：21 个业务类型，四层结构 业务类型→渠道→材料模块→材料项；重建） ---- */
const { demoKycScenarios } = await import("./demo-kyc-data.mjs");
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

const counts = {
  roles: await db.collection("roles").countDocuments(),
  users: await db.collection("users").countDocuments(),
  customers: await db.collection("customers").countDocuments(),
  quote_configs: await db.collection("quote_configs").countDocuments(),
  quote_groups: await db.collection("quote_groups").countDocuments(),
  quote_records: await db.collection("quote_records").countDocuments(),
  kyc_scenarios: await db.collection("kyc_scenarios").countDocuments(),
};
console.log("seed done:", counts);
await client.close();
