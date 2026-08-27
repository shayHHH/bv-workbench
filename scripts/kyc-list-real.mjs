/**
 * 正式 KYC list（2026-08 甲方表格，繁體原文）：
 * https://docs.google.com/spreadsheets/d/16gcKxGg6nUFyOUrDr4j8o4Q65jtvrULURwXFy9npKmA gid=353822398
 * 结构与 demo-kyc-data.mjs 同形（seed 直接映射入库）。表格中标注「❌for record」「❌暫不適用」
 * 的两列（序號1 的 SINO VA 全套与 MSB 私戶外幣買U）按原表语义不收录为有效材料。
 */

let seq = 0;
const item = (name, subRequirement = "", type = "file", required = true, validity = "none") => ({
  id: `KYC-R${String(++seq).padStart(3, "0")}`,
  name, subRequirement, type, required, validity,
});

const banThree = dir => ({ type: "bank_ban", content: `暫不接受這三家銀行${dir}：1.招商永隆 2.交通銀行 3.花旗銀行（香港）` });
const moreDocs = { type: "special_proof", content: "以上資料提交齊全後，如後期遇到銀行合規審查需要，仍有機會需要提供更多額外文件，請知悉" };
const sinoPaused = { type: "special_proof", content: "此業務方向 SINO 渠道暫停" };
const dbsBan = { type: "bank_ban", content: "不支持同名打香港星展銀行（DBS HK）、香港花旗（CITI HK）、新加坡花旗（CITI SG）；渣打銀行只支持香港渣打（SCB HK）" };

/* 复用的长描述 */
const FLOW_1M = "需要提供最新一個月，日期需顯示到提交資料的前一天，並完整顯示交易對手信息，能穿透資金來源，否則會要求更長時段的流水或者額外更多文件";
const ID_GROUPS = "內地人：身份證+通行證/護照；香港人：身份證+回鄉證/護照；台灣人：身份證+護照；外國人：護照。只接受清晰的彩色版本證件，身份證/通行證/回鄉證要求提供正反面，護照上下頁面拍攝完整，能清晰顯示四條邊框";
const ID_GROUPS_NO_WM = `${ID_GROUPS}；證件均不接受水印版本`;
const BANK_INFO_IN = "收款人地址、賬戶名稱、收款銀行名稱、收款人開戶國家/地區、賬戶號碼、Swift Code/BIC 代碼、ABA（美國地區銀行需要）、貨幣";
const SELFIE_OR_CTC = "手持護照/通行證/回鄉證的自拍照 或 核證副本 Certified True Copy（核證身份證正反面以及護照上下兩版），二選一。自拍接受水印版本，但水印不可遮擋面部和證件，證件資料清晰可見；核證副本需有從業資格的註冊會計師出具，如需我司配合出具每次收費 900 HKD，同一客戶累計夠 10 萬 USD 以上交易可豁免";
const COMPANY_DOCS_SGB = [
  ["BR/企業註冊證書", "需要已繳費的"],
  ["CI/公司註冊證書", ""],
  ["NAR1/周年申報表", "如新成立的公司請提供 NNC1（要有公司註冊處收據或 barcode）"],
  ["所有董事和簽署人的證件", "護照/港澳通行證、香港身份證（香港需要永居），四角露出、無破損、信息完整、有效期內，彩色原件掃描件或照片"],
  ["25％以上股權的股東證件", "護照/港澳通行證、香港身份證（身份證需彩色正反面）"],
  ["股東架構圖", "董事簽名+職位+公司章+日期（董事和股東只有一人、且董事和股東同一人的公司不用）"],
];
const COMPANY_DOCS_SINO = [
  ["BR/企業註冊證書", "需要已繳費的"],
  ["CI/公司註冊證書", ""],
  ["NAR1/週年申報表", "如新成立的公司請提供 NNC1（要有公司註冊處收據或 barcode）"],
  ["所有董事和簽署人的證件", "護照/港澳通行證、香港永居身份證，四角露出、無破損、信息完整、有效期內，彩色原件掃描件或照片"],
  ["25％以上股權的股東證件", "護照/港澳通行證、香港身份證（身份證需彩色正反面）"],
  ["股東架構圖", "董事簽名+職位+公司章+日期（董事和股東只有一人、且董事和股東同一人的公司不用）"],
];
const companyItems = defs => defs.map(([n, d]) => item(n, d));

export const realKycScenarios = [
  {
    id: 1, code: "1", name: "港幣/美元/外幣私戶打款買U",
    processDescription: "1. 審核流水，流水通過後我們才能接收該賬戶款項。\n2. 給我們對應的 KYC 和開戶所需的文件。\n3. KYC 和 VA 賬戶通過後可以開始交易。\n4. 我們提供收款賬戶信息，收款賬戶名。\n5. 客戶打款到指定的收款賬戶，提供水單給我們查賬，到賬後我們通知。\n6. 按照收款當天的匯率計算對應的 U 數，並跟客戶確認收 U 地址，排單回 U。\n7. 回 U 後發出 U 水單給客戶，客戶查收，交易完成。",
    channels: [
      {
        id: "s1_sgb", name: "SGB", theme: "red",
        restrictions: [banThree("出款給我們"), moreDocs],
        sections: [{
          title: "SGB - 個人出款材料",
          items: [
            item("有效的個人身份證明文件", "護照 / 香港永居身份證 / 通行證等"),
            item("Bitvast Onboarding Form", "入駐表格"),
            item("最近一個月出款賬戶的流水", "能證明資金來源", "file", true, "1m"),
            item("手持證件及自願買U聲明的自拍照", "手持護照/通行證/回鄉證以及自願買U聲明的自拍照一張（具體格式參考示範圖片，地址要發文字版本）"),
          ],
        }],
      },
      { id: "s1_sino", name: "SINO", theme: "blue", restrictions: [sinoPaused], sections: [] },
      {
        id: "s1_vendor", name: "外部供應商", theme: "amber",
        restrictions: [{ type: "special_proof", content: "環盛 2109 渠道只接受香港本地資金" }],
        sections: [{
          title: "環盛 2109 - 私戶港幣/外幣買U",
          items: [
            item("身份證明文件", "內地人：身份證+通行證/護照；香港人：永居身份證+最近 3 個月有效地址證明；外國人：護照+3 個月內的香港銀行月結單作為地址證明"),
            item("出款戶口最近 3 個月月結單", "", "file", true, "3m"),
            item("任職公司全稱+職位", "以文字提供", "text"),
            item("出款人手持證件和自願買U證明自拍", "詳細參考示範圖片，收 U 地址需要發一下文字版"),
          ],
        }],
      },
    ],
  },
  {
    id: 2, code: "2", name: "港幣/美元/外幣公戶打款買U",
    processDescription: "1. 審核流水，流水通過後我們才能接收該賬戶款項。\n2. KYC 審核，KYC 完成後可以進行交易。\n3. 交易前報價，接受報價後可以下一步打款。\n4. 我們提供收款賬戶信息，收款賬戶名。\n5. 客戶打款到指定的收款賬戶，提供水單給我們查賬，到賬後我們通知。\n6. 按照當天匯率計算對應的 U 數，並跟客戶確認收 U 地址，排單回 U。\n7. 回 U 後發出 U 水單給客戶，客戶查收，交易完成。",
    channels: [
      {
        id: "s2_sgb", name: "SGB", theme: "red",
        restrictions: [banThree("出款給我們"), moreDocs],
        sections: [{
          title: "SGB - 企業出款材料",
          items: [
            item("BV Onboarding Form + Board Resolution", "簽名需要所有董事全名+清晰公司公章+日期"),
            ...companyItems(COMPANY_DOCS_SGB),
            item("入款：最新一個月出款賬戶的流水證明", "同名賬戶（截止到入款當天）", "file", true, "1m"),
            item("董事手持護照和簽署自願買U證明同時拍照", "格式參考示範圖片"),
          ],
        }],
      },
      {
        id: "s2_sino", name: "SINO", theme: "blue",
        restrictions: [moreDocs],
        sections: [{
          title: "SINO - 企業出款材料",
          items: [
            item("公戶最近一個月的流水", FLOW_1M, "file", true, "1m"),
            ...companyItems(COMPANY_DOCS_SINO),
            item("Onboarding Form + Board Resolution", "簽名需要所有董事全名+清晰公司公章+日期"),
            item("董事手持護照和簽署自願買U證明同時拍照", "公司聲明文字：本人XXX為XXX公司董事，自願跟 Big Big Leaf Limited 公司購買數字資產，我的收幣地址是：xxxxxx，附簽名和日期"),
          ],
        }],
      },
    ],
  },
  {
    id: 3, code: "3", name: "港幣/美元/外幣私戶打款換私戶人民幣",
    processDescription: "1. 審核流水，流水通過後我們才能接收該賬戶款項。\n2. 給我們對應的 KYC 和開戶所需的文件。\n3. KYC 和 VA 賬戶通過後可以開始交易。\n4. 我們提供收款賬戶信息，收款賬戶名跟客戶同名。\n5. 客戶提供收款人民幣的賬戶信息（姓名、銀行、支行信息、賬戶號碼）。\n6. 客戶打款到指定的收款賬戶，提供水單給我們查賬，到賬後我們通知。\n7. T+1 當天完成付款人民幣到客戶指定的人民幣賬戶。\n8. 收款人需在 20 分鐘內查收人民幣到賬情況。\n9. 交易完成。",
    channels: [
      {
        id: "s3_sgb", name: "SGB", theme: "red",
        restrictions: [
          { type: "special_proof", content: "如出款和收款非同名，請提供關係證明" },
          banThree("出款給我們"), moreDocs,
        ],
        sections: [
          {
            title: "SGB - 出資方向需要的文件",
            items: [
              item("客戶出賬賬戶銀行流水", FLOW_1M, "file", true, "1m"),
              item("身份證明文件", ID_GROUPS),
              item("TP Onboarding Form", "入駐表格"),
              item("換匯原因", "說明本次換匯用途與背景", "text"),
              item("出款銀行賬戶信息", "賬戶名稱、出款銀行名稱、出款人開戶國家/地區、貨幣種類", "bank_account"),
            ],
          },
          {
            title: "SGB - 人民幣收款方向",
            items: [item("收款人身份證正反面+通行證/護照", "彩色清晰版本")],
          },
        ],
      },
      { id: "s3_sino", name: "SINO", theme: "blue", restrictions: [sinoPaused], sections: [] },
    ],
  },
  {
    id: 4, code: "4", name: "港幣/美元/外幣公戶打款換私戶人民幣",
    processDescription: "1. 審核流水，流水通過後我們才能接收該賬戶款項，並提前詢問客戶收款人民幣的人和出款公戶之間的關係證明。\n2. KYC 審核，KYC 完成後可以進行交易。\n3. 交易前報價，客戶接受價格的話可以進入下一步打款。\n4. 我們提供收款賬戶信息給客戶。\n5. 客戶提供收款人民幣的賬戶信息（姓名、銀行、支行信息、賬戶號碼）。\n6. 客戶打款到指定的收款賬戶，提供水單給我們查賬，到賬後我們通知。\n7. T+1 當天完成付款人民幣到客戶指定的人民幣賬戶。\n8. 收款人需在 20 分鐘內查收人民幣到賬情況。\n9. 交易完成。",
    channels: [
      {
        id: "s4_sgb", name: "SGB", theme: "red",
        restrictions: [banThree("出款給我們"), moreDocs],
        sections: [
          {
            title: "SGB - 香港公戶公司出款",
            items: [
              item("TP Onboarding Form + Board Resolution", "簽名需要所有董事全名+清晰公司公章+日期"),
              ...companyItems(COMPANY_DOCS_SGB),
              item("最新一個月出款賬戶的流水證明", "同名賬戶（截止到出款當天）", "file", true, "1m"),
            ],
          },
          {
            title: "SGB - 私戶收款人民幣",
            items: [
              item("收款私戶的身份證正反面", "彩色清晰版本"),
              item("收款人民幣的人和出款公戶之間的關係證明", ""),
            ],
          },
        ],
      },
      {
        id: "s4_sino", name: "SINO", theme: "blue",
        restrictions: [moreDocs],
        sections: [
          {
            title: "SINO - 香港公戶公司出款",
            items: [
              item("公戶最近一個月的流水", FLOW_1M, "file", true, "1m"),
              ...companyItems(COMPANY_DOCS_SINO),
            ],
          },
          {
            title: "SINO - 私戶收款人民幣",
            items: [
              item("收款私戶的身份證正反面", "彩色清晰版本"),
              item("收款人民幣的人和出款公戶之間的關係證明", ""),
            ],
          },
        ],
      },
    ],
  },
  {
    id: 5, code: "5", name: "賣U換私戶美金/港幣/其他外幣轉賬",
    processDescription: "1. POBO 開戶以及 KYC 審核。\n2. 完成開戶及合規審核後，可以交易。\n3. 當天報價。\n4. 接受報價後，出 U 前要進行 KYA、KYT 審核。\n5. KYA、KYT 審核完畢，我們發地址，客戶出 U，發出 U 截圖。\n6. 我方查收到 U 之後，客戶提供出款信息（6 要素）。\n7. 安排 T+1（第二天）出款，出款後發水單給客戶。\n8. 客戶注意查收款項，交易完成。",
    channels: [
      {
        id: "s5_sgb", name: "SGB", theme: "red",
        restrictions: [banThree("作為收款行"), moreDocs],
        sections: [{
          title: "SGB - 個人收款材料",
          items: [
            item("有效的個人身份證明文件", "護照 / 香港永居身份證 / 通行證等"),
            item("Bitvast Onboarding Form", "入駐表格"),
            item("收款銀行帳戶訊息", BANK_INFO_IN, "bank_account"),
          ],
        }],
      },
      {
        id: "s5_sino", name: "SINO", theme: "blue",
        restrictions: [dbsBan, moreDocs],
        sections: [{
          title: "SINO - 個人收款材料",
          items: [
            item("身份證明文件", ID_GROUPS_NO_WM),
            item("三個月有效的地址證明", "水電煤信件/政府信件/中國身份證都可", "file", true, "3m"),
            item("無遮擋版本月結單", "3 個月內有效，不一定是收款戶口銀行的月結單", "file", true, "3m"),
            item("手持證件自拍照或核證副本（二選一）", SELFIE_OR_CTC),
            item("簽署後的同名打款申請表格一份", "只接受掃描版本，職業欄目請提供完整公司名加職位。簽名要用正楷字體簽署全名，要清晰可辨認"),
            item("簽署我們公司的 KYC 表格一份", "只接受掃描版本，簽名要用正楷字體簽署全名，要清晰可辨認"),
            item("收款銀行帳戶訊息", BANK_INFO_IN, "bank_account"),
          ],
        }],
      },
    ],
  },
  {
    id: 6, code: "6", name: "賣U換香港公戶美金/港幣/其他外幣轉賬",
    processDescription: "1. KYC 審核。\n2. 完成合規審核後，可以交易。\n3. 當天報價。\n4. 接受報價後，出 U 前要進行 KYA、KYT 審核。\n5. KYA、KYT 審核完畢，我們發地址，客戶出 U，發出 U 截圖。\n6. 我方查收到 U 之後，客戶提供出款信息（6 要素）。\n7. 安排 T+1（第二天）出款，出款後會發水單給客戶。\n8. 客戶注意查收款項，交易完成。",
    channels: [
      {
        id: "s6_sgb", name: "SGB", theme: "red",
        restrictions: [banThree("作為收款行"), moreDocs],
        sections: [{
          title: "SGB - 企業收款材料",
          items: [
            item("BV Onboarding Form + Board Resolution", "簽名需要所有董事全名+清晰公司公章+日期"),
            ...companyItems(COMPANY_DOCS_SGB),
          ],
        }],
      },
      {
        id: "s6_sino", name: "SINO", theme: "blue",
        restrictions: [moreDocs],
        sections: [{
          title: "SINO - 企業收款材料",
          items: [
            item("Onboarding Form + Board Resolution", "簽名需要所有董事全名+清晰公司公章+日期"),
            ...companyItems(COMPANY_DOCS_SINO),
          ],
        }],
      },
    ],
  },
  {
    id: 7, code: "7", name: "賣U換私戶人民幣轉賬",
    processDescription: "1. 先提供帳戶收款人的證件給我們做 KYC，KYC 通過後方可交易。\n2. 當天報價。\n3. 接受報價後，出 U 前要進行 KYA、KYT 審核。\n4. KYA、KYT 審核完畢，客戶出 U，發出 U 截圖。\n5. 我方查收到 U 之後，客戶提供收款賬戶信息（姓名+銀行+支行+賬戶號碼）。\n6. 付款人民幣到客戶指定的賬戶（盡量當天安排，但由於優質人民幣需要等待，如果當天不能安排，就會順延到第二個工作日安排）。\n7. 收款人需在我們提供出款水單 20 分鐘內查收人民幣到賬情況。\n8. 交易完成。",
    channels: [{
      id: "s7_rmb", name: "人民幣專列", theme: "teal", restrictions: [],
      sections: [{ title: "人民幣專列 - 收款人材料", items: [item("收款人身份證正反面", "彩色清晰版本")] }],
    }],
  },
  {
    id: 8, code: "8", name: "私戶人民幣轉賬買U",
    processDescription: "1. 出款人民幣的銀行卡流水審核通過後，可以接受做生意。\n2. 完成 KYC 要求提供文件。\n3. 每天 11:30 後報價。\n4. 接受當天報價後安排人民幣帳戶打款（提前一天預約需求）。注意出款人民幣帳戶的單筆和當天限額，確認限額才可以下單安排人民幣帳戶。\n5. 客戶打款人民幣，完成後提供截圖證明出款（必須是已經審核通過流水的卡打出，否則不承認該款項）。\n6. 我方查帳，到帳通知客戶（一般 30 分鐘內）。\n7. 到帳後當天回 U，客戶收到 U，交易結束。",
    channels: [{
      id: "s8_rmb", name: "人民幣專列", theme: "teal", restrictions: [],
      sections: [{
        title: "人民幣專列 - 出款人材料",
        items: [
          item("出款人民幣賬戶一個月的銀行流水", FLOW_1M, "file", true, "1m"),
          item("出款人身份證正反面+護照/通行證正反面", "名字 hit 中時需要提供護照/通行證"),
          item("出款人手持證件和自願買U證明自拍", "詳細參考示範圖片，收 U 地址需要發一下文字版"),
        ],
      }],
    }],
  },
  {
    id: 9, code: "9", name: "U換內地公戶人民幣",
    processDescription: null,
    channels: [{
      id: "s9_rmb", name: "人民幣專列", theme: "teal", restrictions: [],
      sections: [{
        title: "人民幣專列 - 收款公戶材料",
        items: [
          item("收款賬戶信息", "收款公戶賬戶完整信息", "bank_account"),
          item("營業執照", "彩色清晰版本"),
          item("法人身份證", "彩色正反面"),
        ],
      }],
    }],
  },
  {
    id: 10, code: "10", name: "私戶人民幣轉賬買美金/港幣/外幣",
    processDescription: "1. 出款人民幣的銀行卡流水審核通過後，可以接受做生意。\n2. 完成 KYC 要求提供文件，同名打款申請完成。\n3. 每天 11:30 後報價。\n4. 接受當天報價後安排人民幣帳戶打款（提前一天預約需求）。注意出款人民幣帳戶的單筆和當天限額，確認限額才可以下單安排人民幣帳戶。\n5. 客戶打款人民幣，完成後提供截圖證明出款（必須是已經審核通過流水的卡打出，否則不承認該款項）。\n6. 我方查帳，到帳通知客戶（一般 30 分鐘內）。\n7. 到帳後 2-3 小時內打出外幣到客戶報備的指定出款帳戶。\n8. 客戶收到款項，交易結束。",
    channels: [
      {
        id: "s10_sgb", name: "SGB", theme: "red",
        restrictions: [
          banThree("作為收款行"),
          { type: "special_proof", content: "如出款和收款非同名，請提供關係證明" },
          moreDocs,
        ],
        sections: [
          {
            title: "SGB - 內地出款人民幣",
            items: [
              item("客戶出款賬戶一個月的銀行流水", FLOW_1M, "file", true, "1m"),
              item("出款客戶的身份證正反面", "彩色清晰版本"),
            ],
          },
          {
            title: "SGB - 收款外幣",
            items: [
              item("身份證明文件", ID_GROUPS),
              item("TP Onboarding Form", "入駐表格"),
              item("換匯原因", "說明本次換匯用途與背景", "text"),
              item("收款銀行帳戶訊息", BANK_INFO_IN, "bank_account"),
            ],
          },
        ],
      },
      {
        id: "s10_sino", name: "SINO", theme: "blue",
        restrictions: [
          dbsBan,
          { type: "special_proof", content: "如出款和收款非同名，請提供關係證明" },
          moreDocs,
        ],
        sections: [
          {
            title: "SINO - 內地出款人民幣",
            items: [
              item("客戶出款賬戶一個月的銀行流水", FLOW_1M, "file", true, "1m"),
              item("出款客戶的身份證正反面", "彩色清晰版本"),
            ],
          },
          {
            title: "SINO - 收款外幣",
            items: [
              item("身份證明文件", ID_GROUPS_NO_WM),
              item("三個月有效的地址證明", "水電煤信件/政府信件/中國身份證都可", "file", true, "3m"),
              item("無遮擋版本月結單", "3 個月內有效，不一定是收款戶口銀行的月結單", "file", true, "3m"),
              item("手持證件自拍照或核證副本（二選一）", SELFIE_OR_CTC),
              item("簽署後的同名打款申請表格一份", "只接受掃描版本，職業欄目請提供完整公司名加職位。簽名要用正楷字體簽署全名，要清晰可辨認"),
              item("收款銀行帳戶訊息", BANK_INFO_IN, "bank_account"),
            ],
          },
        ],
      },
    ],
  },
  {
    id: 12, code: "12", name: "公戶人民幣買U",
    processDescription: null,
    channels: [{
      id: "s12_rmb", name: "人民幣專列", theme: "teal", restrictions: [],
      sections: [{
        title: "人民幣專列 - 出款公戶材料",
        items: [
          item("出款公戶最近一個月月結單", FLOW_1M, "file", true, "1m"),
          item("營業執照", "彩色清晰版本"),
          item("法人身份證+護照/通行證正反面", "名字 hit 中時需要提供護照/通行證"),
          item("法人手持證件和自願購買聲明書的自拍", "聲明文字：本人XXX為XXX公司法人，代表XXX公司自願購買數字資產，我的收幣地址是：xxxxxx，附簽名和日期（例子如圖和文字描述）"),
        ],
      }],
    }],
  },
  {
    id: 13, code: "13", name: "公戶人民幣買私戶美金/港幣/外幣",
    processDescription: "1. 出款人民幣的銀行卡流水審核通過後，可以進入 KYC 流程。\n2. 完成 KYC 要求提供文件，同名打款申請完成。\n3. 每天 11:30 後報價。\n4. 接受當天報價後安排人民幣帳戶打款（提前一天預約需求）。注意出款人民幣帳戶的單筆和當天限額，確認限額才可以下單安排人民幣帳戶。\n5. 客戶打款人民幣，完成後提供截圖證明出款（必須是已經審核通過流水的卡打出，否則不承認該款項）。\n6. 我方查帳，到帳通知客戶（一般 30 分鐘內）。\n7. 到帳後 2-3 小時內打出外幣到客戶報備的指定出款帳戶。\n8. 客戶收到款項，交易結束。",
    channels: [
      {
        id: "s13_sgb", name: "SGB", theme: "red",
        restrictions: [
          banThree("作為收款行"),
          { type: "special_proof", content: "如收款人非公戶出款人的法人/股東/董事，需要提供關係；如屬於董事/股東，請遞交證明" },
          moreDocs,
        ],
        sections: [
          {
            title: "SGB - 內地出款人民幣",
            items: [
              item("公戶最近一個月月結單", FLOW_1M, "file", true, "1m"),
              item("營業執照", "彩色清晰版本"),
              item("法人身份證", "彩色正反面"),
            ],
          },
          {
            title: "SGB - 收款外幣私戶",
            items: [
              item("身份證明文件", ID_GROUPS),
              item("TP Onboarding Form", "入駐表格"),
              item("換匯原因", "說明本次換匯用途與背景", "text"),
              item("收款銀行帳戶訊息", BANK_INFO_IN, "bank_account"),
            ],
          },
        ],
      },
      {
        id: "s13_sino", name: "SINO", theme: "blue",
        restrictions: [
          dbsBan,
          { type: "special_proof", content: "如收款人非公戶出款人的法人/股東/董事，需要提供關係；如屬於董事/股東，請遞交證明" },
          moreDocs,
        ],
        sections: [
          {
            title: "SINO - 內地出款人民幣",
            items: [
              item("公戶最近一個月月結單", FLOW_1M, "file", true, "1m"),
              item("營業執照", "彩色清晰版本"),
              item("法人身份證", "彩色正反面"),
            ],
          },
          {
            title: "SINO - 收款外幣私戶",
            items: [
              item("身份證明文件", ID_GROUPS_NO_WM),
              item("三個月有效的地址證明", "水電煤信件/政府信件/中國身份證都可", "file", true, "3m"),
              item("無遮擋版本月結單", "3 個月內有效，不一定是收款戶口銀行的月結單", "file", true, "3m"),
              item("手持證件自拍照或核證副本（二選一）", SELFIE_OR_CTC),
              item("簽署後的同名打款申請表格一份", "只接受掃描版本，簽名要用正楷字體簽署全名，要清晰可辨認"),
              item("收款銀行帳戶訊息", BANK_INFO_IN, "bank_account"),
            ],
          },
        ],
      },
    ],
  },
  {
    id: 14, code: "14", name: "公戶人民幣買公戶美金/港幣/外幣",
    processDescription: null,
    channels: [
      {
        id: "s14_sgb", name: "SGB", theme: "red",
        restrictions: [
          { type: "special_proof", content: "如出款公戶和收款公戶非同一股東或董事，也非控股關係，請提供關係證明" },
          banThree("作為收款行"), moreDocs,
        ],
        sections: [
          {
            title: "SGB - 內地出款人民幣",
            items: [
              item("公戶最近一個月月結單", FLOW_1M, "file", true, "1m"),
              item("營業執照", "彩色清晰版本"),
              item("法人身份證+護照/通行證正反面", "彩色清晰版本"),
              item("換匯原因", "說明本次換匯用途與背景", "text"),
            ],
          },
          {
            title: "SGB - 收款外幣公戶",
            items: [
              item("TP Onboarding Form + Board Resolution", "簽名需要所有董事全名+清晰公司公章+日期"),
              ...companyItems(COMPANY_DOCS_SGB),
            ],
          },
        ],
      },
      {
        id: "s14_sino", name: "SINO", theme: "blue",
        restrictions: [
          { type: "special_proof", content: "如出款公戶和收款公戶非同一股東或董事，也非控股關係，請提供關係證明" },
          moreDocs,
        ],
        sections: [
          {
            title: "SINO - 內地出款人民幣",
            items: [
              item("公戶最近一個月月結單", FLOW_1M, "file", true, "1m"),
              item("營業執照", "彩色清晰版本"),
              item("法人身份證+護照/通行證正反面", "名字 hit 中時需要提供護照/通行證"),
            ],
          },
          {
            title: "SINO - 收款外幣公戶",
            items: companyItems(COMPANY_DOCS_SINO),
          },
        ],
      },
    ],
  },
  {
    id: 15, code: "15", name: "人私換公美（私戶人民幣換公戶外幣）",
    processDescription: null,
    channels: [
      {
        id: "s15_sgb", name: "SGB", theme: "red",
        restrictions: [banThree("作為收款行"), moreDocs],
        sections: [
          {
            title: "SGB - 內地出款人民幣",
            items: [
              item("客戶出款賬戶一個月的銀行流水", "不能有任何遮擋，流水通過後才接受此賬戶與我們交易", "file", true, "1m"),
              item("出款客戶的身份證正反面+護照/通行證正反面", "彩色清晰版本"),
            ],
          },
          {
            title: "SGB - 收款外幣公戶",
            items: [
              item("TP Onboarding Form + Board Resolution", "簽名需要所有董事全名+清晰公司公章+日期"),
              ...companyItems(COMPANY_DOCS_SGB),
              item("出賬私戶和香港公戶之間的關係證明", ""),
            ],
          },
        ],
      },
      {
        id: "s15_sino", name: "SINO", theme: "blue",
        restrictions: [moreDocs],
        sections: [
          {
            title: "SINO - 內地出款人民幣",
            items: [
              item("客戶出款賬戶一個月的銀行流水", "不能有任何遮擋，流水通過後才接受此賬戶與我們交易", "file", true, "1m"),
              item("出款客戶的身份證正反面+護照/通行證正反面", "名字 hit 中時需要提供護照/通行證"),
            ],
          },
          {
            title: "SINO - 收款外幣公戶（香港公司文件要求）",
            items: [
              ...companyItems(COMPANY_DOCS_SINO),
              item("出賬私戶和香港公戶之間的關係證明", ""),
            ],
          },
        ],
      },
    ],
  },
  {
    id: 16, code: "16", name: "人民幣現金買賣",
    processDescription: "首先需要確定人民幣現金在哪個城市及數量（目前廣東省內廣州、珠海、中山暫停，待恢復，其他地方只做熟人）。\n\n人民幣現金換U方向：\n1. 我們當天報價，你方鎖定價格。\n2. 我方收款人提供信物+聯繫人聯繫方式，你們提供地址和聯繫人電話。\n3. 我們收款同事會聯繫對方約交付時間地點。\n4. 確定細節後，廣東省內一般當天內完成交收；廣東省外：我們同事預訂機票，從廣東出發，按約定時間地點交收。\n5. 交收使用信物確認，當場點算大數然後收走現鈔後回廣東（基地）再點算清楚；廣東省外 T+1 清點完找 U。\n\nU換人民幣現金方向：\n1. 我們當天報價，你方鎖定價格。\n2. 確定完訂單，先全數打 U 給我們後安排送貨。\n3. 我們現金送貨同事會聯繫對方約交付時間地點。\n4. 確定細節後，廣東省內一般當天內完成交收；廣東省外按約定時間交付。\n5. 交收只使用信物作為確認。\n\n注意事項：\n1. 不同台交易，現場只會數大數，回廣東（基地）清點完再報數。\n2. 一旦確定單子後違約，需要賠償總額的 1%。\n3. 單筆一百萬起做，最高五百萬。\n4. 現金換U方向只接受 100 元面值的人民幣紙鈔。",
    channels: [],
  },
  {
    id: 160, code: "16B", name: "港幣轉帳換大陸人民幣現金",
    processDescription: "1. 審核流水，流水通過後我們才能接收該賬戶款項。\n2. 給我們對應的 KYC 和開戶所需的文件。\n3. KYC 和 VA 賬戶通過後可以開始交易。\n4. 我們當天報價，你方鎖定價格（報價當天有效）。\n5. 客戶打款到指定的收款賬戶，提供水單給我們查賬，到賬後我們通知（注意，港幣需要打到我們提供的收款賬戶，該收款賬戶名跟客戶同名）。\n6. 港幣到帳後安排大陸現金送貨，客戶提供收貨人信息，我們現金送貨同事會聯繫對方約交付時間地點。\n7. 確定交付細節後，廣東省內一般是港幣到帳後 T+1 內完成交收；廣東省外：我們同事預訂機票，從廣東出發，會按照跟客戶約定好的時間交付。\n8. 交收只使用信物作為確認。交貨完成後，會發信物照片到群組確認已交貨。\n\n注意事項：\n1. 需港幣到帳後，才安排人民幣送貨。\n2. 單筆人民幣一百萬起做，最高五百萬。\n3. 現金交收一旦確定單子後違約，需要賠償總額的 1%。",
    channels: [],
  },
  {
    id: 17, code: "17", name: "POBO個人客戶出資到自己的公戶進行注資",
    processDescription: "1. 注資計劃書：寫清楚文字說明注資金額、分多少次、單次注資金額、什麼時候等要素，然後董事簽名寫日期，加蓋公司公章。\n2. 資金證明要大於交易金額：客戶提供的月結單足額且時間在 3 個月內的可以直接用；不夠或超期的，同客戶講，叫客戶補交。",
    channels: [{
      id: "s17_sino", name: "SINO", theme: "blue", restrictions: [],
      sections: [{
        title: "SINO - 在 POBO 資料的基礎上追加",
        items: [
          item("公司註冊文件", "例如香港公司 BR"),
          item("股權證明", "例如香港公司 NAR1"),
          item("注資計劃書", "注明注資金額、次數、單次金額與時間，董事簽名寫日期，加蓋公司公章"),
          item("足額的資金證明", "需大於交易金額", "file", true, "3m"),
        ],
      }],
    }],
  },
  {
    id: 18, code: "18", name: "POBO個人客戶出資到自己的信託賬戶",
    processDescription: "1. 先問清楚背景，給 Gary 判斷能否做，然後開通 POBO 以及 KYC 審核。\n2. 要問清楚出資人和受益人是否同一人：如果是同一人，問 Queenie 是否需要提供其他資料；如果不是同一人，要提供關係證明。\n3. 簽署版的信託文件。\n4. 月結單（作為資金來源證明，月結餘額需要大於充值金額）。",
    channels: [{
      id: "s18_sino", name: "SINO", theme: "blue", restrictions: [],
      sections: [{
        title: "SINO - 在 POBO 資料的基礎上追加",
        items: [
          item("信託開戶文件", "簽署版的信託文件"),
          item("足額的資金證明", "月結餘額需大於充值金額", "file", true, "3m"),
          item("收款方的企業註冊文件", "信託收款主體的註冊文件"),
        ],
      }],
    }],
  },
  {
    id: 19, code: "19", name: "POBO個人賬戶交保費",
    processDescription: null,
    channels: [{
      id: "s19_sino", name: "SINO", theme: "blue", restrictions: [],
      sections: [{
        title: "SINO - 在 POBO 資料的基礎上追加",
        items: [
          item("已購保險的證明文件", "購買全新保險、繳交第一期保費：完整版本投保申請書（要有簽名的版本），後續有正式保單合同後需要後補給銀行；繳交非首年保費：正式保險合同和保險繳費通知書"),
          item("收款方的企業註冊文件", "保險公司註冊文件"),
          item("足額的資金證明", "需大於交易金額", "file", true, "3m"),
          item("預交保費優惠政策證明", "如果是提前預交超過 2 年的保費，要有保險公司出的預交優惠政策證明文件，可以是小冊子、宣傳單張等", "file", false),
        ],
      }],
    }],
  },
  {
    id: 20, code: "20", name: "POBO個人賬戶出款到證券賬戶",
    processDescription: null,
    channels: [{
      id: "s20_sino", name: "SINO", theme: "blue", restrictions: [],
      sections: [{
        title: "SINO - 在 POBO 資料的基礎上追加",
        items: [
          item("證券行開戶書", "開戶證明"),
          item("證券電匯信息", "一般證券行有一個電匯指示的通知書"),
          item("收款方的企業註冊文件", "證券行註冊文件"),
          item("足額的資金證明", "需大於交易金額；月結單足額且時間在 3 個月內的可直接用，不夠或超期需補交額外的，加起來要夠", "file", true, "3m"),
        ],
      }],
    }],
  },
  {
    id: 21, code: "21", name: "POBO個人賬戶出款想買樓（自己名下）",
    processDescription: null,
    channels: [{
      id: "s21_sino", name: "SINO", theme: "blue", restrictions: [],
      sections: [{
        title: "SINO - 在 POBO 資料的基礎上追加",
        items: [
          item("購房合同", "香港：第一期繳費提供已蓋章及簽名的臨時合約（無繳款信息則補繳費通知），並需在具體時間後補正式合同；非第一期繳費要給買房的正式合同。國外：直接要買房合同，非英文合同要提供英文翻譯版本；沒有買房合同僅有預定協議時，要提供付款週期或計劃"),
          item("律師樓的資質證書和律師委託協議", "如委託律所買房需提供，例如營業執照、律師公會的資質顯示", "file", false),
          item("收款方的企業註冊文件", "如果是開發商直接收款", "file", false),
          item("足額的資金證明", "需大於交易金額；月結單足額且時間在 3 個月內的可直接用，不夠或超期需補交額外的，加起來要夠", "file", true, "3m"),
        ],
      }],
    }],
  },
];
