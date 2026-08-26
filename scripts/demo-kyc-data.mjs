/**
 * demo 原样提取的 KYC 业务类型配置（bv-workbench-go/app.js 322-1187 行，勿手改；
 * 结构：业务类型 → 渠道（含限制/主题色） → 材料模块 → 材料项）。seed 用它生成 kyc_scenarios。
 */

  const kycEngineItem = (name, subRequirement, type = "file", required = true, validity = "none") => ({
    id: `KYC-${Math.random().toString(36).slice(2, 9)}`,
    name, subRequirement, type, required, validity
  });

  const initialKycConfig = () => ({
    isEditing: true,
    lastSavedAt: "",
    searchQuery: "",
    selectedScenarioId: 1,
    activeChannelIndex: 0,
    scenarios: [
      {
        id: 1,
        code: "1",
        name: "港币/美元/外币私户打款买U",
        processDescription: "1. 审核流水，流水通过后我们才能接收该账户款项。\n2. 给我们对应的 KYC 和开户所需的文件。\n3. KYC 和 VA 账户通过后可以开始交易。\n4. 我们提供收款账户信息、收款账户名。\n5. 客户打款到指定的收款账户，提供水单给我们查账，到账后我们通知。\n6. 按照收款当天的汇率计算对应的 U 数，并跟客户确认收 U 地址，排单回 U。\n7. 回 U 后发出 U 水单给客户，客户查收，交易完成。",
        channels: [
          {
            id: "s1_sgb",
            name: "SGB",
            theme: "red",
            restrictions: [
              { type: "bank_ban", content: "暂不接受这三家银行出款给我们：招商永隆、交通银行、花旗银行（香港）。" },
              { type: "special_proof", content: "以上资料提交齐全后，如后期遇到银行合规审查需要，仍有机会需要提供更多额外文件。" }
            ],
            sections: [
              {
                title: "SGB - 个人出款材料",
                items: [
                  kycEngineItem("有效的个人身份证明文件", "护照 / 香港永居身份证 / 通行证等。"),
                  kycEngineItem("Bitvast Onboarding Form", "入驻表格。"),
                  kycEngineItem("最近一个月出款账户流水", "需能证明资金来源。", "file", true, "1m"),
                  kycEngineItem("手持证件及自愿买U声明自拍照", "手持护照/通行证/回乡证以及自愿买U声明自拍一张，具体格式参考示范图片，地址要发文字版本。")
                ]
              }
            ]
          },
          {
            id: "s1_sino",
            name: "SINO",
            theme: "blue",
            restrictions: [
              { type: "special_proof", content: "此业务方向 SINO 渠道暂停，恢复前请改用 SGB 或外部供应商渠道。" }
            ],
            sections: []
          },
          {
            id: "s1_vendor",
            name: "外部供应商",
            theme: "amber",
            restrictions: [
              { type: "special_proof", content: "环盛 2109 渠道只接受香港本地资金。" },
              { type: "special_proof", content: "以上资料提交齐全后，因应银行合规审查需要，仍有机会需要提供更多额外文件。" }
            ],
            sections: [
              {
                title: "环盛 2109 - 私户港币/外币买U",
                items: [
                  kycEngineItem("身份证明文件", "内地人：身份证+通行证/护照；香港人：永居身份证+最近 3 个月有效地址证明；外国人：护照+3 个月内的香港银行月结单作为地址证明。"),
                  kycEngineItem("出款户口最近 3 个月月结单", "完整月结单，不可遮挡。", "file", true, "3m"),
                  kycEngineItem("任职公司全称 + 职位", "以文字提供。", "text"),
                  kycEngineItem("出款人手持证件和自愿买U证明自拍", "详细参考示范图片，收 U 地址需要发文字版。")
                ]
              },
              {
                title: "MSB - 私户外币买U（3 月 16 日更新）",
                items: [
                  kycEngineItem("客户出账账户银行流水", "需提供最新一个月，日期需显示到提交资料的前一天，并完整显示交易对手信息，能穿透资金来源，否则会要求更长时段的流水或额外文件。", "file", true, "1m"),
                  kycEngineItem("身份证明文件", "内地人：身份证+通行证/护照；香港人：身份证+回乡证/护照；台湾人：身份证+护照；外国人：护照。只接受清晰彩色原件，证件不接受水印版本。"),
                  kycEngineItem("三个月有效的地址证明", "银行月结单 / 水电煤信件 / 政府信件 / 中国身份证均可。", "file", true, "3m"),
                  kycEngineItem("手持证件及自愿买U声明自拍照", "具体格式参考示范图片，地址要发文字版本。"),
                  kycEngineItem("签署我们公司的 KYC 表格一份", "只接受扫描版本，签名要用正楷字体签署全名，要清晰可辨认。")
                ]
              }
            ]
          }
        ]
      },
      {
        id: 2,
        code: "2",
        name: "港币/美元/外币公户打款买U",
        processDescription: "1. 审核流水，流水通过后我们才能接收该账户款项。\n2. KYC 审核，KYC 完成后可以进行交易。\n3. 交易前报价，接受报价后可以下一步打款。\n4. 我们提供收款账户信息、收款账户名。\n5. 客户打款到指定的收款账户，提供水单给我们查账，到账后我们通知。\n6. 按照当天汇率计算对应的 U 数，并跟客户确认收 U 地址，排单回 U。\n7. 回 U 后发出 U 水单给客户，客户查收，交易完成。",
        channels: [
          {
            id: "s2_sgb",
            name: "SGB",
            theme: "red",
            restrictions: [
              { type: "bank_ban", content: "暂不接受这三家银行出款给我们：招商永隆、交通银行、花旗银行（香港）。" },
              { type: "special_proof", content: "以上资料提交齐全后，如后期遇到银行合规审查需要，仍有机会需要提供更多额外文件。" }
            ],
            sections: [
              {
                title: "SGB - 企业主体与授权材料",
                items: [
                  kycEngineItem("BV Onboarding Form + Board Resolution", "签名需要所有董事全名 + 清晰公司公章 + 日期。"),
                  kycEngineItem("BR / 企业注册证书", "需要已缴费的。"),
                  kycEngineItem("CI / 公司注册证书", "彩色扫描件。"),
                  kycEngineItem("NAR1 / 周年申报表", "如新成立的公司请提供 NNC1，要有公司注册处收据或 barcode。"),
                  kycEngineItem("所有董事和签署人身份证明", "护照/港澳通行证、香港身份证（香港需要永居），四角露出、无破损、信息完整、有效期内，彩色原件扫描件或照片。"),
                  kycEngineItem("25% 以上股权股东身份证明", "护照/港澳通行证、香港身份证，身份证需彩色正反面。"),
                  kycEngineItem("股东架构图", "董事签名+职位+公司章+日期；董事和股东只有一人且为同一人的公司不用。")
                ]
              },
              {
                title: "SGB - 资金来源与声明",
                items: [
                  kycEngineItem("最新一个月出款账户流水证明", "同名账户，截止到入款当天。", "file", true, "1m"),
                  kycEngineItem("董事手持护照及自愿买U证明合照", "董事手持护照和签署自愿买U证明同时拍照，格式参考示范图片。")
                ]
              }
            ]
          },
          {
            id: "s2_sino",
            name: "SINO",
            theme: "blue",
            restrictions: [
              { type: "special_proof", content: "以上资料提交齐全后，如后期遇到银行合规审查需要，仍有机会需要提供更多额外文件。" }
            ],
            sections: [
              {
                title: "SINO - 企业主体与授权材料",
                items: [
                  kycEngineItem("公户最近一个月流水", "需提供最新一个月，日期需显示到提交资料的前一天，并完整显示交易对手信息，能穿透资金来源。", "file", true, "1m"),
                  kycEngineItem("BR / 企业注册证书", "彩色扫描件。"),
                  kycEngineItem("CI / 公司注册证书", "彩色扫描件。"),
                  kycEngineItem("NAR1 / 周年申报表", "如新成立的公司请提供 NNC1。"),
                  kycEngineItem("所有董事和签署人身份证明", "护照/港澳通行证、香港永居身份证，四角露出、无破损、信息完整、有效期内，彩色原件。"),
                  kycEngineItem("25% 以上股权股东身份证明", "身份证需彩色正反面。"),
                  kycEngineItem("股东架构图", "董事签名+职位+公司章+日期；董事和股东只有一人且为同一人的公司不用。"),
                  kycEngineItem("Onboarding Form + Board Resolution", "签名需要所有董事全名 + 清晰公司公章 + 日期。"),
                  kycEngineItem("董事手持护照及自愿买U声明合照", "声明文字：本人XXX为XXX公司董事，自愿跟 Big Big Leaf Limited 公司购买数字资产，我的收币地址是：xxxxxx，附签名和日期。")
                ]
              }
            ]
          }
        ]
      },
      {
        id: 3,
        code: "3",
        name: "港币/美元/外币私户打款换私户人民币",
        processDescription: "1. 审核流水，流水通过后我们才能接收该账户款项。\n2. 给我们对应的 KYC 和开户所需的文件。\n3. KYC 和 VA 账户通过后可以开始交易。\n4. 我们提供收款账户信息，收款账户名跟客户同名。\n5. 客户提供收款人民币的账户信息（姓名、银行、支行信息、账户号码）。\n6. 客户打款到指定的收款账户，提供水单给我们查账，到账后我们通知。\n7. T+1 当天完成付款人民币到客户指定的人民币账户。\n8. 收款人需在 20 分钟内查收人民币到账情况。\n9. 交易完成。",
        channels: [
          {
            id: "s3_sgb",
            name: "SGB",
            theme: "red",
            restrictions: [
              { type: "special_proof", content: "如出款和收款非同名，请提供关系证明。" },
              { type: "bank_ban", content: "暂不接受这三家银行出款给我们：招商永隆、交通银行、花旗银行（香港）。" },
              { type: "special_proof", content: "以上资料提交齐全后，如后期遇到银行合规审查需要，仍有机会需要提供更多额外文件。" }
            ],
            sections: [
              {
                title: "SGB - 出资方向材料",
                items: [
                  kycEngineItem("客户出账账户银行流水", "需提供最新一个月，日期需显示到提交资料的前一天，并完整显示交易对手信息，能穿透资金来源。", "file", true, "1m"),
                  kycEngineItem("身份证明文件", "内地人：身份证+通行证/护照；香港人：身份证+回乡证/护照；台湾人：身份证+护照；外国人：护照。只接受清晰彩色版本，证件正反面齐全。"),
                  kycEngineItem("TP Onboarding Form", "入驻表格。"),
                  kycEngineItem("换汇原因", "说明本次换汇用途与背景。", "text"),
                  kycEngineItem("出款银行账户信息", "账户名称、出款银行名称、出款人开户国家/地区、货币种类。", "bank_account")
                ]
              },
              {
                title: "SGB - 人民币收款方向材料",
                items: [
                  kycEngineItem("收款人身份证正反面 + 通行证/护照", "彩色清晰版本。")
                ]
              }
            ]
          },
          {
            id: "s3_sino",
            name: "SINO",
            theme: "blue",
            restrictions: [
              { type: "special_proof", content: "此业务方向 SINO 渠道暂停。" }
            ],
            sections: []
          }
        ]
      },
      {
        id: 4,
        code: "4",
        name: "港币/美元/外币公户打款换私户人民币",
        processDescription: "1. 审核流水，流水通过后我们才能接收该账户款项，并提前询问客户收款人民币的人和出款公户之间的关系证明。\n2. KYC 审核，KYC 完成后可以进行交易。\n3. 交易前报价，客户接受价格后可以进入下一步打款。\n4. 我们提供收款账户信息给客户。\n5. 客户提供收款人民币的账户信息（姓名、银行、支行信息、账户号码）。\n6. 客户打款到指定的收款账户，提供水单给我们查账，到账后我们通知。\n7. T+1 当天完成付款人民币到客户指定的人民币账户。\n8. 收款人需在 20 分钟内查收人民币到账情况。\n9. 交易完成。",
        channels: [
          {
            id: "s4_sgb",
            name: "SGB",
            theme: "red",
            restrictions: [
              { type: "bank_ban", content: "暂不接受这三家银行出款给我们：招商永隆、交通银行、花旗银行（香港）。" },
              { type: "special_proof", content: "以上资料提交齐全后，如后期遇到银行合规审查需要，仍有机会需要提供更多额外文件。" }
            ],
            sections: [
              {
                title: "SGB - 香港公户公司出款材料",
                items: [
                  kycEngineItem("TP Onboarding Form + Board Resolution", "签名需要所有董事全名 + 清晰公司公章 + 日期。"),
                  kycEngineItem("BR / 企业注册证书", "需要已缴费的。"),
                  kycEngineItem("CI / 公司注册证书", "彩色扫描件。"),
                  kycEngineItem("NAR1 / 周年申报表", "如新成立的公司请提供 NNC1，要有公司注册处收据或 barcode。"),
                  kycEngineItem("所有董事和签署人身份证明", "护照/港澳通行证、香港身份证（香港需要永居），彩色原件扫描件或照片。"),
                  kycEngineItem("25% 以上股权股东身份证明", "身份证需彩色正反面。"),
                  kycEngineItem("股东架构图", "董事签名+职位+公司章+日期；董事和股东只有一人且为同一人的公司不用。"),
                  kycEngineItem("最新一个月出款账户流水证明", "同名账户，截止到出款当天。", "file", true, "1m")
                ]
              },
              {
                title: "SGB - 私户收款人民币材料",
                items: [
                  kycEngineItem("收款私户的身份证正反面", "彩色清晰版本。"),
                  kycEngineItem("收款人与出款公户的关系证明", "收款人民币的人和出款公户之间的关系证明。")
                ]
              }
            ]
          },
          {
            id: "s4_sino",
            name: "SINO",
            theme: "blue",
            restrictions: [
              { type: "special_proof", content: "以上资料提交齐全后，如后期遇到银行合规审查需要，仍有机会需要提供更多额外文件。" }
            ],
            sections: [
              {
                title: "SINO - 香港公户公司出款材料",
                items: [
                  kycEngineItem("公户最近一个月流水", "需提供最新一个月，日期需显示到提交资料的前一天，并完整显示交易对手信息，能穿透资金来源。", "file", true, "1m"),
                  kycEngineItem("BR / 企业注册证书", "彩色扫描件。"),
                  kycEngineItem("CI / 公司注册证书", "彩色扫描件。"),
                  kycEngineItem("NAR1 / 周年申报表", "如新成立的公司请提供 NNC1。"),
                  kycEngineItem("所有董事和签署人身份证明", "护照/港澳通行证、香港永居身份证，彩色原件扫描件或照片。"),
                  kycEngineItem("25% 以上股权股东身份证明", "身份证需彩色正反面。"),
                  kycEngineItem("股东架构图", "董事签名+职位+公司章+日期；董事和股东只有一人且为同一人的公司不用。")
                ]
              },
              {
                title: "SINO - 私户收款人民币材料",
                items: [
                  kycEngineItem("收款私户的身份证正反面", "彩色清晰版本。"),
                  kycEngineItem("收款人与出款公户的关系证明", "收款人民币的人和出款公户之间的关系证明。")
                ]
              }
            ]
          }
        ]
      },
      {
        id: 5,
        code: "5",
        name: "卖U换私户美金/港币/其他外币转账",
        processDescription: "1. POBO 开户以及 KYC 审核。\n2. 完成开户及合规审核后，可以交易。\n3. 当天报价。\n4. 接受报价后，出 U 前要进行 KYA、KYT 审核。\n5. KYA、KYT 审核完毕，我们发地址，客户出 U，发出 U 截图。\n6. 我方查收到 U 之后，客户提供出款信息（6 要素）。\n7. 安排 T+1（第二天）出款，出款后发水单给客户。\n8. 客户注意查收款项，交易完成。",
        channels: [
          {
            id: "s5_sgb",
            name: "SGB",
            theme: "red",
            restrictions: [
              { type: "bank_ban", content: "暂不接受这三家银行作为收款行：招商永隆、交通银行、花旗银行（香港）。" },
              { type: "special_proof", content: "以上资料提交齐全后，如后期遇到银行合规审查需要，仍有机会需要提供更多额外文件。" }
            ],
            sections: [
              {
                title: "SGB - 个人收款材料",
                items: [
                  kycEngineItem("有效的个人身份证明文件", "护照 / 香港永居身份证 / 通行证等。"),
                  kycEngineItem("Bitvast Onboarding Form", "入驻表格。"),
                  kycEngineItem("收款银行账户信息", "收款人地址、账户名称、收款银行名称、开户国家/地区、账户号码、Swift Code/BIC、ABA（美国地区银行需要）、货币。", "bank_account")
                ]
              }
            ]
          },
          {
            id: "s5_sino",
            name: "SINO",
            theme: "blue",
            restrictions: [
              { type: "bank_ban", content: "不支持同名打香港星展银行（DBS HK）、香港花旗（CITI HK）、新加坡花旗（CITI SG）；渣打银行只支持香港渣打（SCB HK）。" },
              { type: "special_proof", content: "以上资料提交齐全后，如后期遇到银行合规审查需要，仍有机会需要提供更多额外文件。" }
            ],
            sections: [
              {
                title: "SINO - 个人收款材料",
                items: [
                  kycEngineItem("身份证明文件", "内地人：身份证+通行证/护照；香港人：身份证+回乡证/护照；台湾人：身份证+护照；外国人：护照。只接受清晰彩色版本，证件不接受水印版本。"),
                  kycEngineItem("三个月有效的地址证明", "水电煤信件 / 政府信件 / 中国身份证均可。", "file", true, "3m"),
                  kycEngineItem("无遮挡版本月结单", "3 个月内有效，不一定是收款户口银行的月结单。", "file", true, "3m"),
                  kycEngineItem("手持证件自拍照或核证副本（二选一）", "自拍接受水印但不可遮挡面部和证件；核证副本 Certified True Copy 需有从业资格的注册会计师出具，如需我司配合出具每次收费 900 HKD，同一客户累计满 10 万 USD 交易可豁免。"),
                  kycEngineItem("签署后的同名打款申请表格一份", "只接受扫描版本，职业栏目请提供完整公司名加职位，签名要用正楷字体签署全名。"),
                  kycEngineItem("签署我们公司的 KYC 表格一份", "只接受扫描版本，签名要用正楷字体签署全名。"),
                  kycEngineItem("收款银行账户信息", "收款人地址、账户名称、收款银行名称、开户国家/地区、账户号码、Swift Code/BIC、ABA、货币。", "bank_account")
                ]
              }
            ]
          }
        ]
      },
      {
        id: 6,
        code: "6",
        name: "卖U换香港公户美金/港币/其他外币转账",
        processDescription: "1. KYC 审核。\n2. 完成合规审核后，可以交易。\n3. 当天报价。\n4. 接受报价后，出 U 前要进行 KYA、KYT 审核。\n5. KYA、KYT 审核完毕，我们发地址，客户出 U，发出 U 截图。\n6. 我方查收到 U 之后，客户提供出款信息（6 要素）。\n7. 安排 T+1（第二天）出款，出款后会发水单给客户。\n8. 客户注意查收款项，交易完成。",
        channels: [
          {
            id: "s6_sgb",
            name: "SGB",
            theme: "red",
            restrictions: [
              { type: "bank_ban", content: "暂不接受这三家银行作为收款行：招商永隆、交通银行、花旗银行（香港）。" },
              { type: "special_proof", content: "以上资料提交齐全后，如后期遇到银行合规审查需要，仍有机会需要提供更多额外文件。" }
            ],
            sections: [
              {
                title: "SGB - 企业收款材料",
                items: [
                  kycEngineItem("BV Onboarding Form + Board Resolution", "签名需要所有董事全名 + 清晰公司公章 + 日期。"),
                  kycEngineItem("BR / 企业注册证书", "需要已缴费的。"),
                  kycEngineItem("CI / 公司注册证书", "彩色扫描件。"),
                  kycEngineItem("NAR1 / 周年申报表", "如新成立的公司请提供 NNC1，要有公司注册处收据或 barcode。"),
                  kycEngineItem("所有董事和签署人身份证明", "护照/港澳通行证、香港身份证（香港需要永居），彩色原件扫描件或照片。"),
                  kycEngineItem("25% 以上股权股东身份证明", "身份证需彩色正反面。"),
                  kycEngineItem("股东架构图", "董事签名+职位+公司章+日期；董事和股东只有一人且为同一人的公司不用。")
                ]
              }
            ]
          },
          {
            id: "s6_sino",
            name: "SINO",
            theme: "blue",
            restrictions: [
              { type: "special_proof", content: "以上资料提交齐全后，如后期遇到银行合规审查需要，仍有机会需要提供更多额外文件。" }
            ],
            sections: [
              {
                title: "SINO - 企业收款材料",
                items: [
                  kycEngineItem("Onboarding Form + Board Resolution", "签名需要所有董事全名 + 清晰公司公章 + 日期。"),
                  kycEngineItem("BR / 企业注册证书", "需要已缴费的。"),
                  kycEngineItem("CI / 公司注册证书", "彩色扫描件。"),
                  kycEngineItem("NAR1 / 周年申报表", "如新成立的公司请提供 NNC1，要有公司注册处收据或 barcode。"),
                  kycEngineItem("所有董事和签署人身份证明", "护照/港澳通行证、香港永居身份证，彩色原件扫描件或照片。"),
                  kycEngineItem("25% 以上股权股东身份证明", "身份证需彩色正反面。"),
                  kycEngineItem("股东架构图", "董事签名+职位+公司章+日期；董事和股东只有一人且为同一人的公司不用。")
                ]
              }
            ]
          }
        ]
      },
      {
        id: 7,
        code: "7",
        name: "卖U换私户人民币转账",
        processDescription: "1. 先提供账户收款人的证件给我们做 KYC，KYC 通过后方可交易。\n2. 当天报价。\n3. 接受报价后，出 U 前要进行 KYA、KYT 审核。\n4. KYA、KYT 审核完毕，客户出 U，发出 U 截图。\n5. 我方查收到 U 之后，客户提供收款账户信息（姓名+银行+支行+账户号码）。\n6. 付款人民币到客户指定的账户（尽量当天安排；优质人民币需要等待，当天不能安排则顺延到第二个工作日）。\n7. 收款人需在我们提供出款水单 20 分钟内查收人民币到账情况。\n8. 交易完成。",
        channels: [
          {
            id: "s7_rmb",
            name: "人民币专列",
            theme: "teal",
            restrictions: [],
            sections: [
              {
                title: "人民币专列 - 收款人材料",
                items: [
                  kycEngineItem("收款人身份证正反面", "彩色清晰版本。")
                ]
              }
            ]
          }
        ]
      },
      {
        id: 8,
        code: "8",
        name: "私户人民币转账买U",
        processDescription: "1. 出款人民币的银行卡流水审核通过后，可以接受做生意。\n2. 完成 KYC 要求提供文件。\n3. 每天 11:30 后报价。\n4. 接受当天报价后安排人民币账户打款（提前一天预约需求）。注意出款人民币账户的单笔和当天限额，确认限额才可以下单安排。\n5. 客户打款人民币，完成后提供截图证明出款（必须是已经审核通过流水的卡打出，否则不承认该款项）。\n6. 我方查账，到账通知客户（一般 30 分钟内）。\n7. 到账后当天回 U，客户收到 U，交易结束。",
        channels: [
          {
            id: "s8_rmb",
            name: "人民币专列",
            theme: "teal",
            restrictions: [],
            sections: [
              {
                title: "人民币专列 - 出款人材料",
                items: [
                  kycEngineItem("出款人民币账户一个月银行流水", "需提供最新一个月，日期需显示到提交资料的前一天，并完整显示交易对手信息，能穿透资金来源。", "file", true, "1m"),
                  kycEngineItem("出款人身份证正反面 + 护照/通行证", "名字 hit 中时需要提供护照/通行证。"),
                  kycEngineItem("出款人手持证件和自愿买U证明自拍", "详细参考示范图片，收 U 地址需要发文字版。")
                ]
              }
            ]
          }
        ]
      },
      {
        id: 9,
        code: "9",
        name: "U换内地公户人民币",
        processDescription: "",
        channels: [
          {
            id: "s9_rmb",
            name: "人民币专列",
            theme: "teal",
            restrictions: [],
            sections: [
              {
                title: "人民币专列 - 收款公户材料",
                items: [
                  kycEngineItem("收款账户信息", "收款公户账户完整信息。", "bank_account"),
                  kycEngineItem("营业执照", "彩色清晰版本。"),
                  kycEngineItem("法人身份证", "彩色正反面。")
                ]
              }
            ]
          }
        ]
      },
      {
        id: 10,
        code: "10",
        name: "私户人民币转账买美金/港币/外币",
        processDescription: "1. 出款人民币的银行卡流水审核通过后，可以接受做生意。\n2. 完成 KYC 要求提供文件，同名打款申请完成。\n3. 每天 11:30 后报价。\n4. 接受当天报价后安排人民币账户打款（提前一天预约需求）。注意出款人民币账户的单笔和当天限额，确认限额才可以下单安排。\n5. 客户打款人民币，完成后提供截图证明出款（必须是已经审核通过流水的卡打出，否则不承认该款项）。\n6. 我方查账，到账通知客户（一般 30 分钟内）。\n7. 到账后 2-3 小时内打出外币到客户报备的指定出款账户。\n8. 客户收到款项，交易结束。",
        channels: [
          {
            id: "s10_sgb",
            name: "SGB",
            theme: "red",
            restrictions: [
              { type: "bank_ban", content: "暂不接受这三家银行作为收款行：招商永隆、交通银行、花旗银行（香港）。" },
              { type: "special_proof", content: "如出款和收款非同名，请提供关系证明。" },
              { type: "special_proof", content: "以上资料提交齐全后，如后期遇到银行合规审查需要，仍有机会需要提供更多额外文件。" }
            ],
            sections: [
              {
                title: "SGB - 内地出款人民币材料",
                items: [
                  kycEngineItem("客户出款账户一个月银行流水", "需提供最新一个月，日期需显示到提交资料的前一天，并完整显示交易对手信息，能穿透资金来源。", "file", true, "1m"),
                  kycEngineItem("出款客户的身份证正反面", "彩色清晰版本。")
                ]
              },
              {
                title: "SGB - 收款外币材料",
                items: [
                  kycEngineItem("身份证明文件", "内地人：身份证+通行证/护照；香港人：身份证+回乡证/护照；台湾人：身份证+护照；外国人：护照。只接受清晰彩色版本。"),
                  kycEngineItem("TP Onboarding Form", "入驻表格。"),
                  kycEngineItem("换汇原因", "说明本次换汇用途与背景。", "text"),
                  kycEngineItem("收款银行账户信息", "收款人地址、账户名称、收款银行名称、开户国家/地区、账户号码、Swift Code/BIC、ABA、货币。", "bank_account")
                ]
              }
            ]
          },
          {
            id: "s10_sino",
            name: "SINO",
            theme: "blue",
            restrictions: [
              { type: "bank_ban", content: "不支持同名打香港星展银行（DBS HK）、香港花旗（CITI HK）、新加坡花旗（CITI SG）；渣打银行只支持香港渣打（SCB HK）。" },
              { type: "special_proof", content: "如出款和收款非同名，请提供关系证明。" },
              { type: "special_proof", content: "以上资料提交齐全后，如后期遇到银行合规审查需要，仍有机会需要提供更多额外文件。" }
            ],
            sections: [
              {
                title: "SINO - 内地出款人民币材料",
                items: [
                  kycEngineItem("客户出款账户一个月银行流水", "需提供最新一个月，日期需显示到提交资料的前一天，并完整显示交易对手信息，能穿透资金来源。", "file", true, "1m"),
                  kycEngineItem("出款客户的身份证正反面", "彩色清晰版本。")
                ]
              },
              {
                title: "SINO - 收款外币材料",
                items: [
                  kycEngineItem("身份证明文件", "内地人：身份证+通行证/护照；香港人：身份证+回乡证/护照；台湾人：身份证+护照；外国人：护照。只接受清晰彩色版本，证件不接受水印版本。"),
                  kycEngineItem("三个月有效的地址证明", "水电煤信件 / 政府信件 / 中国身份证均可。", "file", true, "3m"),
                  kycEngineItem("无遮挡版本月结单", "3 个月内有效，不一定是收款户口银行的月结单。", "file", true, "3m"),
                  kycEngineItem("手持证件自拍照或核证副本（二选一）", "自拍接受水印但不可遮挡面部和证件；核证副本需注册会计师出具，我司配合出具每次收费 900 HKD，累计满 10 万 USD 交易可豁免。"),
                  kycEngineItem("签署后的同名打款申请表格一份", "只接受扫描版本，职业栏目请提供完整公司名加职位，正楷签署全名。"),
                  kycEngineItem("收款银行账户信息", "收款人地址、账户名称、收款银行名称、开户国家/地区、账户号码、Swift Code/BIC、ABA、货币。", "bank_account")
                ]
              }
            ]
          }
        ]
      },
      {
        id: 11,
        code: "12",
        name: "公户人民币买U",
        processDescription: "",
        channels: [
          {
            id: "s12_rmb",
            name: "人民币专列",
            theme: "teal",
            restrictions: [],
            sections: [
              {
                title: "人民币专列 - 出款公户材料",
                items: [
                  kycEngineItem("出款公户最近一个月月结单", "需提供最新一个月，日期需显示到提交资料的前一天，并完整显示交易对手信息，能穿透资金来源。", "file", true, "1m"),
                  kycEngineItem("营业执照", "彩色清晰版本。"),
                  kycEngineItem("法人身份证 + 护照/通行证正反面", "名字 hit 中时需要提供护照/通行证。"),
                  kycEngineItem("法人手持证件和自愿购买声明书自拍", "声明文字：本人XXX为XXX公司法人，代表XXX公司自愿购买数字资产，我的收币地址是：xxxxxx，附签名和日期。")
                ]
              }
            ]
          }
        ]
      },
      {
        id: 12,
        code: "13",
        name: "公户人民币买私户美金/港币/外币",
        processDescription: "1. 出款人民币的银行卡流水审核通过后，可以进入 KYC 流程。\n2. 完成 KYC 要求提供文件，同名打款申请完成。\n3. 每天 11:30 后报价。\n4. 接受当天报价后安排人民币账户打款（提前一天预约需求）。注意出款人民币账户的单笔和当天限额，确认限额才可以下单安排。\n5. 客户打款人民币，完成后提供截图证明出款（必须是已经审核通过流水的卡打出，否则不承认该款项）。\n6. 我方查账，到账通知客户（一般 30 分钟内）。\n7. 到账后 2-3 小时内打出外币到客户报备的指定出款账户。\n8. 客户收到款项，交易结束。",
        channels: [
          {
            id: "s13_sgb",
            name: "SGB",
            theme: "red",
            restrictions: [
              { type: "bank_ban", content: "暂不接受这三家银行作为收款行：招商永隆、交通银行、花旗银行（香港）。" },
              { type: "special_proof", content: "如收款人非公户出款人的法人/股东/董事，需要提供关系证明；如属于董事/股东，请递交证明。" },
              { type: "special_proof", content: "以上资料提交齐全后，如后期遇到银行合规审查需要，仍有机会需要提供更多额外文件。" }
            ],
            sections: [
              {
                title: "SGB - 内地出款人民币材料",
                items: [
                  kycEngineItem("公户最近一个月月结单", "需提供最新一个月，日期需显示到提交资料的前一天，并完整显示交易对手信息，能穿透资金来源。", "file", true, "1m"),
                  kycEngineItem("营业执照", "彩色清晰版本。"),
                  kycEngineItem("法人身份证", "彩色正反面。")
                ]
              },
              {
                title: "SGB - 收款外币私户材料",
                items: [
                  kycEngineItem("身份证明文件", "内地人：身份证+通行证/护照；香港人：身份证+回乡证/护照；台湾人：身份证+护照；外国人：护照。只接受清晰彩色版本。"),
                  kycEngineItem("TP Onboarding Form", "入驻表格。"),
                  kycEngineItem("换汇原因", "说明本次换汇用途与背景。", "text"),
                  kycEngineItem("收款银行账户信息", "收款人地址、账户名称、收款银行名称、开户国家/地区、账户号码、Swift Code/BIC、ABA、货币。", "bank_account")
                ]
              }
            ]
          },
          {
            id: "s13_sino",
            name: "SINO",
            theme: "blue",
            restrictions: [
              { type: "bank_ban", content: "不支持同名打香港星展银行（DBS HK）、香港花旗（CITI HK）、新加坡花旗（CITI SG）；渣打银行只支持香港渣打（SCB HK）。" },
              { type: "special_proof", content: "如收款人非公户出款人的法人/股东/董事，需要提供关系证明；如属于董事/股东，请递交证明。" },
              { type: "special_proof", content: "以上资料提交齐全后，如后期遇到银行合规审查需要，仍有机会需要提供更多额外文件。" }
            ],
            sections: [
              {
                title: "SINO - 内地出款人民币材料",
                items: [
                  kycEngineItem("公户最近一个月月结单", "需提供最新一个月，日期需显示到提交资料的前一天，并完整显示交易对手信息，能穿透资金来源。", "file", true, "1m"),
                  kycEngineItem("营业执照", "彩色清晰版本。"),
                  kycEngineItem("法人身份证", "彩色正反面。")
                ]
              },
              {
                title: "SINO - 收款外币私户材料",
                items: [
                  kycEngineItem("身份证明文件", "内地人：身份证+通行证/护照；香港人：身份证+回乡证/护照；台湾人：身份证+护照；外国人：护照。只接受清晰彩色版本，证件不接受水印版本。"),
                  kycEngineItem("三个月有效的地址证明", "水电煤信件 / 政府信件 / 中国身份证均可。", "file", true, "3m"),
                  kycEngineItem("无遮挡版本月结单", "3 个月内有效，不一定是收款户口银行的月结单。", "file", true, "3m"),
                  kycEngineItem("手持证件自拍照或核证副本（二选一）", "自拍接受水印但不可遮挡面部和证件；核证副本需注册会计师出具，我司配合出具每次收费 900 HKD，累计满 10 万 USD 交易可豁免。"),
                  kycEngineItem("签署后的同名打款申请表格一份", "只接受扫描版本，签名要用正楷字体签署全名。"),
                  kycEngineItem("收款银行账户信息", "收款人地址、账户名称、收款银行名称、开户国家/地区、账户号码、Swift Code/BIC、ABA、货币。", "bank_account")
                ]
              }
            ]
          }
        ]
      },
      {
        id: 13,
        code: "14",
        name: "公户人民币买公户美金/港币/外币",
        processDescription: "",
        channels: [
          {
            id: "s14_sgb",
            name: "SGB",
            theme: "red",
            restrictions: [
              { type: "special_proof", content: "如出款公户和收款公户非同一股东或董事，也非控股关系，请提供关系证明。" },
              { type: "bank_ban", content: "暂不接受这三家银行作为收款行：招商永隆、交通银行、花旗银行（香港）。" },
              { type: "special_proof", content: "以上资料提交齐全后，如后期遇到银行合规审查需要，仍有机会需要提供更多额外文件。" }
            ],
            sections: [
              {
                title: "SGB - 内地出款人民币材料",
                items: [
                  kycEngineItem("公户最近一个月月结单", "需提供最新一个月，日期需显示到提交资料的前一天，并完整显示交易对手信息，能穿透资金来源。", "file", true, "1m"),
                  kycEngineItem("营业执照", "彩色清晰版本。"),
                  kycEngineItem("法人身份证 + 护照/通行证正反面", "彩色清晰版本。"),
                  kycEngineItem("换汇原因", "说明本次换汇用途与背景。", "text")
                ]
              },
              {
                title: "SGB - 收款外币公户材料",
                items: [
                  kycEngineItem("TP Onboarding Form + Board Resolution", "签名需要所有董事全名 + 清晰公司公章 + 日期。"),
                  kycEngineItem("BR / 企业注册证书", "需要已缴费的。"),
                  kycEngineItem("CI / 公司注册证书", "彩色扫描件。"),
                  kycEngineItem("NAR1 / 周年申报表", "如新成立的公司请提供 NNC1，要有公司注册处收据或 barcode。"),
                  kycEngineItem("所有董事和签署人身份证明", "护照/港澳通行证、香港身份证（香港需要永居），彩色原件扫描件或照片。"),
                  kycEngineItem("25% 以上股权股东身份证明", "身份证需彩色正反面。"),
                  kycEngineItem("股东架构图", "董事签名+职位+公司章+日期；董事和股东只有一人且为同一人的公司不用。")
                ]
              }
            ]
          },
          {
            id: "s14_sino",
            name: "SINO",
            theme: "blue",
            restrictions: [
              { type: "special_proof", content: "如出款公户和收款公户非同一股东或董事，也非控股关系，请提供关系证明。" },
              { type: "special_proof", content: "以上资料提交齐全后，如后期遇到银行合规审查需要，仍有机会需要提供更多额外文件。" }
            ],
            sections: [
              {
                title: "SINO - 内地出款人民币材料",
                items: [
                  kycEngineItem("公户最近一个月月结单", "需提供最新一个月，日期需显示到提交资料的前一天，并完整显示交易对手信息，能穿透资金来源。", "file", true, "1m"),
                  kycEngineItem("营业执照", "彩色清晰版本。"),
                  kycEngineItem("法人身份证 + 护照/通行证正反面", "名字 hit 中时需要提供护照/通行证。")
                ]
              },
              {
                title: "SINO - 收款外币公户材料",
                items: [
                  kycEngineItem("BR / 企业注册证书", "需要已缴费的。"),
                  kycEngineItem("CI / 公司注册证书", "彩色扫描件。"),
                  kycEngineItem("NAR1 / 周年申报表", "如新成立的公司请提供 NNC1，要有公司注册处收据或 barcode。"),
                  kycEngineItem("所有董事和签署人身份证明", "护照/港澳通行证、香港永居身份证，四角露出、无破损、信息完整、有效期内。"),
                  kycEngineItem("25% 以上股权股东身份证明", "护照/港澳通行证、香港永居身份证，彩色原件。"),
                  kycEngineItem("股东架构图", "董事签名+职位+公司章+日期；董事和股东只有一人且为同一人的公司不用。")
                ]
              }
            ]
          }
        ]
      },
      {
        id: 14,
        code: "15",
        name: "人私换公美（私户人民币换公户外币）",
        processDescription: "",
        channels: [
          {
            id: "s15_sgb",
            name: "SGB",
            theme: "red",
            restrictions: [
              { type: "bank_ban", content: "暂不接受这三家银行作为收款行：招商永隆、交通银行、花旗银行（香港）。" },
              { type: "special_proof", content: "以上资料提交齐全后，如后期遇到银行合规审查需要，仍有机会需要提供更多额外文件。" }
            ],
            sections: [
              {
                title: "SGB - 内地出款人民币材料",
                items: [
                  kycEngineItem("客户出款账户一个月银行流水", "不能有任何遮挡，流水通过后才接受此账户与我们交易。", "file", true, "1m"),
                  kycEngineItem("出款客户身份证正反面 + 护照/通行证正反面", "彩色清晰版本。")
                ]
              },
              {
                title: "SGB - 收款外币公户材料",
                items: [
                  kycEngineItem("TP Onboarding Form + Board Resolution", "签名需要所有董事全名 + 清晰公司公章 + 日期。"),
                  kycEngineItem("BR / 企业注册证书", "需要已缴费的。"),
                  kycEngineItem("CI / 公司注册证书", "彩色扫描件。"),
                  kycEngineItem("NAR1 / 周年申报表", "如新成立的公司请提供 NNC1，要有公司注册处收据或 barcode。"),
                  kycEngineItem("所有董事和签署人身份证明", "护照/港澳通行证、香港身份证（香港需要永居），彩色原件扫描件或照片。"),
                  kycEngineItem("25% 以上股权股东身份证明", "身份证需彩色正反面。"),
                  kycEngineItem("股东架构图", "董事签名+职位+公司章+日期；董事和股东只有一人且为同一人的公司不用。"),
                  kycEngineItem("出账私户和香港公户之间的关系证明", "证明出款私户与收款公户的关联关系。")
                ]
              }
            ]
          },
          {
            id: "s15_sino",
            name: "SINO",
            theme: "blue",
            restrictions: [
              { type: "special_proof", content: "以上资料提交齐全后，如后期遇到银行合规审查需要，仍有机会需要提供更多额外文件。" }
            ],
            sections: [
              {
                title: "SINO - 内地出款人民币材料",
                items: [
                  kycEngineItem("客户出款账户一个月银行流水", "不能有任何遮挡，流水通过后才接受此账户与我们交易。", "file", true, "1m"),
                  kycEngineItem("出款客户身份证正反面 + 护照/通行证正反面", "名字 hit 中时需要提供护照/通行证。")
                ]
              },
              {
                title: "SINO - 收款外币公户材料（香港公司文件要求）",
                items: [
                  kycEngineItem("BR / 企业注册证书", "需要已缴费的。"),
                  kycEngineItem("CI / 公司注册证书", "彩色扫描件。"),
                  kycEngineItem("NAR1 / 周年申报表", "如新成立的公司请提供 NNC1，要有公司注册处收据或 barcode。"),
                  kycEngineItem("所有董事和签署人身份证明", "护照/港澳通行证、香港永居身份证，四角露出、无破损、信息完整、有效期内。"),
                  kycEngineItem("25% 以上股权股东身份证明", "护照/港澳通行证、香港永居身份证，彩色原件。"),
                  kycEngineItem("股东架构图", "董事签名+职位+公司章+日期；董事和股东只有一人且为同一人的公司不用。"),
                  kycEngineItem("出账私户和香港公户之间的关系证明", "证明出款私户与收款公户的关联关系。")
                ]
              }
            ]
          }
        ]
      },
      {
        id: 15,
        code: "16",
        name: "人民币现金买卖",
        processDescription: "首先需要确定人民币现金在哪个城市及数量（目前广东省内广州、珠海、中山暂停待恢复，其他地方只做熟人）。\n\n人民币现金换U方向：\n1. 我们当天报价，你方锁定价格。\n2. 我方收款人提供信物 + 联系人联系方式，你们提供地址和联系人电话。\n3. 我们收款同事会联系对方约交付时间地点。\n4. 广东省内一般当天内完成交收；广东省外我们同事预订机票从广东出发，按约定时间地点交收。\n5. 交收使用信物确认，当场点算大数，收走现钞后回广东基地再点算清楚；广东省外 T+1 清点完找 U。\n\nU换人民币现金方向：\n1. 我们当天报价，你方锁定价格。\n2. 确定订单后先全数打 U 给我们，再安排送货。\n3. 现金送货同事会联系对方约交付时间地点，省内当天安排交收、省外按约定时间交付。\n4. 交收只使用信物作为确认。\n\n注意事项：\n1. 不同台交易，现场只数大数，回基地清点完再报数。\n2. 一旦确定单子后违约，需要赔偿总额的 1%。\n3. 单笔一百万起做，最高五百万。\n4. 现金换U方向只接受 100 元面值的人民币纸钞。",
        channels: []
      },
      {
        id: 16,
        code: "16B",
        name: "港币转账换大陆人民币现金",
        processDescription: "1. 审核流水，流水通过后我们才能接收该账户款项。\n2. 给我们对应的 KYC 和开户所需的文件。\n3. KYC 和 VA 账户通过后可以开始交易。\n4. 我们当天报价，你方锁定价格（报价当天有效）。\n5. 客户打款到指定的收款账户，提供水单给我们查账，到账后我们通知（港币需要打到我们提供的收款账户，该收款账户名跟客户同名）。\n6. 港币到账后安排大陆现金送货，客户提供收货人信息，现金送货同事会联系对方约交付时间地点。\n7. 广东省内一般是港币到账后 T+1 内完成交收；广东省外我们同事预订机票从广东出发，按约定时间交付。\n8. 交收只使用信物作为确认，交货完成后发信物照片到群组确认已交货。\n\n注意事项：\n1. 需港币到账后，才安排人民币送货。\n2. 单笔人民币一百万起做，最高五百万。\n3. 现金交收一旦确定单子后违约，需要赔偿总额的 1%。",
        channels: []
      },
      {
        id: 17,
        code: "17",
        name: "POBO个人客户出资到自己的公户进行注资",
        processDescription: "1. 注资计划书：写清楚注资金额、分多少次、单次注资金额、时间等要素，然后董事签名写日期，加盖公司公章。\n2. 资金证明要大于交易金额：客户提供的月结单足额且在 3 个月内的可以直接用；不够或超期的，请客户补交。",
        channels: [
          {
            id: "s17_sino",
            name: "SINO",
            theme: "blue",
            restrictions: [],
            sections: [
              {
                title: "SINO - POBO 注资追加材料（在 POBO 基础资料上追加）",
                items: [
                  kycEngineItem("公司注册文件", "例如香港公司 BR。"),
                  kycEngineItem("股权证明", "例如香港公司 NAR1。"),
                  kycEngineItem("注资计划书", "注明注资金额、次数、单次金额与时间，董事签名写日期，加盖公司公章。"),
                  kycEngineItem("足额的资金证明", "需大于交易金额，月结单需在 3 个月内。", "file", true, "3m")
                ]
              }
            ]
          }
        ]
      },
      {
        id: 18,
        code: "18",
        name: "POBO个人客户出资到自己的信托账户",
        processDescription: "1. 先问清楚背景，由 Gary 判断能否做，然后开通 POBO 以及 KYC 审核。\n2. 问清楚出资人和受益人是否同一人：同一人需与 Queenie 确认是否需要提供其他资料；非同一人要提供关系证明。\n3. 提供签署版的信托文件。\n4. 月结单作为资金来源证明，月结余额需要大于充值金额。",
        channels: [
          {
            id: "s18_sino",
            name: "SINO",
            theme: "blue",
            restrictions: [],
            sections: [
              {
                title: "SINO - POBO 信托追加材料（在 POBO 基础资料上追加）",
                items: [
                  kycEngineItem("信托开户文件", "签署版的信托文件。"),
                  kycEngineItem("足额的资金证明", "月结余额需大于充值金额。", "file", true, "3m"),
                  kycEngineItem("收款方的企业注册文件", "信托收款主体的注册文件。")
                ]
              }
            ]
          }
        ]
      },
      {
        id: 19,
        code: "19",
        name: "POBO个人账户交保费",
        processDescription: "",
        channels: [
          {
            id: "s19_sino",
            name: "SINO",
            theme: "blue",
            restrictions: [],
            sections: [
              {
                title: "SINO - POBO 保费追加材料（在 POBO 基础资料上追加）",
                items: [
                  kycEngineItem("已购保险的证明文件", "购买全新保险缴首期保费：完整版本投保申请书（有签名版本），后续有正式保单合同后需后补给银行；缴交非首年保费：正式保险合同和保险缴费通知书。"),
                  kycEngineItem("收款方的企业注册文件", "保险公司注册文件。"),
                  kycEngineItem("足额的资金证明", "需大于交易金额。", "file", true, "3m"),
                  kycEngineItem("预交保费优惠政策证明", "提前预交超过 2 年保费时提供，需保险公司出具，可以是小册子、宣传单张等。", "file", false)
                ]
              }
            ]
          }
        ]
      },
      {
        id: 20,
        code: "20",
        name: "POBO个人账户出款到证券账户",
        processDescription: "",
        channels: [
          {
            id: "s20_sino",
            name: "SINO",
            theme: "blue",
            restrictions: [],
            sections: [
              {
                title: "SINO - POBO 证券出款追加材料（在 POBO 基础资料上追加）",
                items: [
                  kycEngineItem("证券行开户书", "开户证明。"),
                  kycEngineItem("证券电汇信息", "一般证券行有一个电汇指示的通知书。"),
                  kycEngineItem("收款方的企业注册文件", "证券行注册文件。"),
                  kycEngineItem("足额的资金证明", "需大于交易金额；月结单足额且在 3 个月内的可直接用，不够或超期需补交。", "file", true, "3m")
                ]
              }
            ]
          }
        ]
      },
      {
        id: 21,
        code: "21",
        name: "POBO个人账户出款买楼（自己名下）",
        processDescription: "",
        channels: [
          {
            id: "s21_sino",
            name: "SINO",
            theme: "blue",
            restrictions: [],
            sections: [
              {
                title: "SINO - POBO 购房出款追加材料（在 POBO 基础资料上追加）",
                items: [
                  kycEngineItem("购房合同", "香港首期缴费：已盖章及签名的临时合约（无缴款信息则补缴费通知），并需在约定时间后补正式合同；非首期缴费需正式合同。国外直接要购房合同，非英文合同需英文翻译版；仅有预订协议时需提供付款周期或计划。"),
                  kycEngineItem("律师楼资质证书和律师委托协议", "如委托律所买房需提供，例如营业执照、律师公会资质显示。", "file", false),
                  kycEngineItem("收款方的企业注册文件", "开发商直接收款时提供。", "file", false),
                  kycEngineItem("足额的资金证明", "需大于交易金额；月结单足额且在 3 个月内的可直接用，不够或超期需补交。", "file", true, "3m")
                ]
              }
            ]
          }
        ]
      }
    ]
  });

export const demoKycScenarios = initialKycConfig().scenarios;
