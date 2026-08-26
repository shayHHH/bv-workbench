---
name: Bitvast Workbench
description: 交易执行、客户准入、地址校验、资金运营与合规审批的一体化工作台
colors:
  ink-950: "oklch(23% 0.018 54)"
  ink-800: "oklch(35% 0.016 54)"
  ink-700: "oklch(42% 0.015 54)"
  ink-600: "oklch(49% 0.013 54)"
  ink-500: "oklch(58% 0.012 54)"
  ink-300: "oklch(76% 0.010 54)"
  ink-200: "oklch(86% 0.009 54)"
  ink-100: "oklch(93% 0.007 54)"
  paper: "oklch(98.1% 0.009 72)"
  surface: "oklch(99.2% 0.006 72)"
  surface-muted: "oklch(96.3% 0.011 72)"
  orange-primary: "oklch(58% 0.183 51)"
  orange-hover: "oklch(66% 0.196 53)"
  orange-soft: "oklch(93.5% 0.055 66)"
  amber-warning: "oklch(53% 0.11 72)"
  amber-soft: "oklch(94% 0.045 82)"
  red-danger: "oklch(48% 0.15 27)"
  red-soft: "oklch(94% 0.035 25)"
  blue-info: "oklch(45% 0.105 245)"
  blue-soft: "oklch(94% 0.028 245)"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 720
    lineHeight: 1.18
    letterSpacing: "-0.035em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 720
    lineHeight: 1.3
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 650
    lineHeight: 1.4
rounded:
  sm: "7px"
  md: "11px"
  lg: "16px"
  xl: "18px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "34px"
components:
  button-primary:
    backgroundColor: "{colors.orange-primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "38px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-950}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "38px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-950}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
    height: "40px"
  workflow-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    border: "1px solid {colors.ink-100}"
  rule-assistant:
    width: "384px"
    backgroundColor: "{colors.surface}"
    border: "1px solid {colors.ink-100}"
---

# Design System: Bitvast Workbench

## Overview

**Creative North Star: "安静的业务准入控制台"**

Bitvast Workbench 是供交易员、客户准入运营、合规审核人员、财务出款人员和系统管理员在日间办公室持续使用的高密度产品界面。它要让用户快速确认当前客户、业务类型、材料要求、审核依据和下一步动作。

界面基于参考 HTML 的工作台模式：深墨侧栏、暖灰应用底、白色业务面板、右侧规则助手、底部固定提交栏。设计目标不是营销式吸引注意，而是让敏感材料处理过程稳定、可追溯、可解释。

**Key Characteristics:**
- 深墨侧栏固定业务范围，顶部栏承载全局搜索、角色视角和当前用户。
- 主内容采用浅灰工作台底，白色面板承载具体业务任务。
- 表单流程优先使用步骤面板，编号清晰，操作集中。
- 右侧规则助手展示 KYC 流程、渠道限制、材料清单和就绪度。
- 底部提交栏只承载提交目标、取消和主提交动作。
- 色彩克制，Bitvast 橙色只用于主操作、当前选择和关键进度。

## Layout

### App Shell

桌面端采用 `sidebar + topbar + workspace` 三段式结构。侧栏宽度保持 232px 到 256px，顶部栏高度保持 56px 到 68px。主内容区使用 `paper` 或 `surface-muted` 作为工作台底色，避免大面积纯白。

### Business Access Workspace

材料上传、客户准入、审核发起等流程页面使用三段式工作区：

1. 左侧主操作区，宽度自适应，承载步骤面板。
2. 右侧规则助手，桌面固定宽度 360px 到 400px，sticky 跟随滚动。
3. 底部提交栏，固定在工作台底部，只放提交模式和关键动作。

右侧规则助手不是装饰。它必须回答：当前业务是什么、当前渠道是什么、有哪些限制、还缺哪些材料。

### Step Panels

步骤面板用于客户选择、业务路由、材料上传、申请表确认等顺序任务。面板顶部包含编号、标题和必要的状态或计数；面板正文只放当前步骤需要填写或确认的内容。

步骤编号采用小尺寸实心橙色方块或胶囊，不使用大图标和大面积彩色背景。

## Colors

暖灰中性色覆盖绝大部分界面。深墨色负责侧栏和主文字，橙色负责主操作和当前选择。红色、蓝色、绿色只用于明确语义状态。

**Accent Rule.** 单屏中橙色只允许出现在主按钮、当前选中项、步骤编号和少量进度状态上。大面积橙色背景会削弱业务重点。

**Semantic Rule.** 风险、限制、成功、信息必须使用“浅色底 + 深色文字 + 明确文案”，禁止只靠颜色表达状态。

## Typography

使用系统无衬线字体栈。标题需要清楚，但不能像营销页面一样夸张。页面标题 22px 到 26px，区块标题 14px 到 18px，控件标签和表格字段 10px 到 12px。

业务说明和规则文本保持 65 到 75 字符宽度。规则助手中的长文本使用 10px 到 11px，行高至少 1.5，优先可读而不是压缩。

## Components

### Buttons

- 主按钮：橙色实心，用于“确认并提交”“保存并发布”等当前唯一主动作。
- 次按钮：白底中性边框，用于取消、查看、返回、预览。
- 危险按钮：白底红字或浅红底，只用于驳回、删除、终止。
- 禁止渐变按钮。参考 HTML 中的渐变意图转译为单色橙色主按钮。

### Fields

输入框、选择器、文本域统一为 40px 最小高度、7px 圆角、1px 中性边框。聚焦时使用橙色焦点环。字段标签放在控件上方，格式为清楚的业务语言，例如“路由出款通道”“业务说明 / 风险备注”。

### Panels

普通业务面板使用白色底、1px 中性边框、11px 或 16px 圆角。面板内部可以使用 `surface-muted` 做二级区域，但禁止“卡片套卡片”的多层阴影。

静态面板默认无阴影。只有抽屉、下拉、确认层、Toast 和底部固定提交栏可以使用轻阴影。

### Rule Assistant

规则助手用于展示系统建议和合规依据。它包含：

- Header：KYC 规则智能校验、业务类型、渠道。
- Flow card：业务标准流程，使用浅琥珀底。
- Restriction card：渠道限制，使用浅红底。
- Checklist：材料清单、必填/选填、有效期、当前就绪度。

规则助手必须显式声明“规则建议不是人工最终结论”的边界，避免让自动化看起来替代合规判断。

### Upload Zone

上传区使用 2px dashed 边框、16px 圆角、浅灰底。hover 或 dragover 时切换为浅橙底和橙色边框。图标可以使用上传符号，但不可使用装饰插画。

上传后的文件行包含：

- 文件类型图标或扩展名。
- 文件名、大小、格式和检测到的材料类型。
- 关联材料类型下拉。
- 删除操作。

### Sticky Submit Bar

提交栏固定在底部，背景为 `surface`，顶部 1px 边框，轻阴影。左侧放提交模式单选项，右侧放取消和主提交按钮。移动端改为文档流内纵向布局，避免遮挡内容。

## Navigation

侧栏分组使用小号 uppercase 标签。当前导航项使用低对比橙色背景和橙色文字，不使用高饱和大色块。徽标用于数量提示，不能替代状态文案。

顶部搜索框保持可预测：搜索客户、案件编号或交易编号。角色选择和当前用户信息在右侧，保持稳定位置。

## Tables And Lists

表格用于审核队列、客户管理、工单列表等高密度信息。表头用浅灰底和 10px 标签，行高不低于 56px。列表项 hover 使用轻浅色背景，不使用显著位移。

材料清单和审核材料行应优先使用列表，不使用重复的大卡片网格。

## Schedulo Reference: Calm Booking Operations

参考 Schedulo 的 online booking request 设计时，核心不是“任务管理抽屉”，而是一个轻盈的预约运营台：浅灰工作区、白色大圆角面板、薄荷绿色行动区、清楚的请求卡片和低噪声的详情确认流程。Dribbble 页面描述的产品重点是把新预约请求、员工分配、确认预约和押金跟踪放在一个流程里处理，减少在日历、通知和支付工具之间切换。Bitvast 应把这种模式转译为：订单请求、请假记录、审核工单和出款任务都在一个上下文里完成查看、分配、确认和后续动作。

### Visual Language

Schedulo 的视觉更接近“明亮、柔和、服务型 SaaS 后台”，不是高密度金融后台。背景以雾面浅灰为主，主面板是干净白色，边框接近不可见，只用柔和阴影和圆角分出层级。参考色板为 `#F2F2F1`、`#AAAAA1`、`#515660`、`#65DAC0`、`#0F181C`、`#98E6D2`。在 Bitvast 中，页面底色可以更接近 `#F2F2F1`，正文中性灰可参考 `#515660`，深色标题接近 `#0F181C`。薄荷绿不替代 Bitvast 橙色主按钮，只用于“可安排、已确认、可接手、已同步、低风险完成”这类状态和柔和提示区。

### Layout Composition

页面应该有明显的“运营工作台”感觉，而不是纯表格页。推荐结构：

- 左侧或顶部是请求列表、日历、队列或任务卡片。
- 中间主区域展示当前待处理请求或日程状态。
- 右侧使用详情面板展示所选请求的完整信息和确认动作。
- 高优先级请求可用一个独立 widget 浮现，不需要用户翻表格。

Schedulo 的层级很清楚：大标题和关键对象先出现，辅助说明非常轻；详情和表单放进圆角容器；操作按钮集中在少数位置。Bitvast 后续页面应减少满屏表格和大块 KPI，把“当前需要处理的请求”作为页面主角。

### Cards And Request Items

请求卡片应紧凑、圆润、可扫读。每张卡片最多包含：

- 请求对象：客户、员工、订单或工单名称。
- 请求类型：预约、请假、审核、出款、付款确认。
- 时间：提交时间、预约时间、请假时段或截止时间。
- 负责人：当前处理人或建议接手人。
- 状态胶囊：待确认、已确认、需押金、需交接、待审核。
- 一个主动作：确认、分配、查看、继续处理。

卡片不应堆满字段。次级信息用小号灰字，状态用低饱和胶囊，重要行动用单个实心按钮。圆角建议 14px 到 20px，边框使用极浅中性色。

### Detail Panel And Confirmation Flow

详情面板是 Schedulo 风格的关键。它不是沉重弹窗，而是轻量侧边工作面板，打开后保留原页面上下文。面板宽度建议 420px 到 520px，顶部放关闭和更多操作，主体采用大标题 + 属性组 + 说明块 + 操作区。

属性组使用清晰的两列或标签列表：

- 客户 / 员工。
- 服务 / 业务类型。
- 日期和时间段。
- 状态。
- 负责人。
- 付款或押金状态。
- 备注。

确认动作应该在面板内完成。例如 Schedulo 中用户能在同一处 review details、assign staff、confirm appointment、track deposit；Bitvast 中对应为：查看订单、分配处理人、确认到账、发起排单、标记交接、确认出款。不要让用户为了一个确认动作跳到另一个模块。

### Soft Action Area

Schedulo 的行动区倾向于明亮、友好、明确。Bitvast 可采用“浅色行动块”承载下一步：

- 薄荷浅底：可确认、可分配、已同步、低风险。
- 橙色浅底：需要运营经理确认、待人工处理。
- 红色浅底：拒绝、异常、逾期。
- 蓝灰浅底：信息提示、自动同步来源。

行动块内部只放一段短说明和 1 到 2 个按钮。不要把所有操作平铺成一排行按钮。

### Calendar And Availability

如果用于 `部门管理`，应更像 Schedulo 的预约系统而不是传统 HR 考勤表。日历里的请假、外出、培训记录应像预约卡一样展示：员工、类型、时段、状态和交接提示。点击日历色块打开详情面板，里面展示来源、审批状态、影响任务和建议接手人。

请假记录可以来自手工登记或 Lark 同步，但展示时统一为日程请求。若来源是 Lark，同步状态用浅蓝灰或薄荷胶囊，避免让接口字段暴露得太重。

### Payment Or Deposit Analogy

Schedulo 把 deposit issuance 和 tracking 放进确认流程里。Bitvast 的对应物是客户付款、保证金、到账确认、出款回单或通道押金。设计上应把付款状态紧贴业务请求，而不是拆成完全独立页面。订单详情里应直接展示：

- 应收 / 实收。
- 付款凭证。
- 确认人。
- 确认时间。
- 下一步能否继续。

### Applying To Current Demo

后续改造当前 demo 时，优先按这个方向处理：

- `部门管理`：请假记录点击后使用 Schedulo 式右侧详情面板，展示请假时段、来源、任务影响和交接确认。
- `交易订单`：订单列表使用请求卡片或更轻的列表，订单详情侧栏内完成付款登记、到账确认和排单。
- `审核队列`：待审核工单作为请求卡展示，详情面板内完成材料查看和通过/驳回。
- `出款任务`：出款详情保留订单上下文，付款、回单和状态确认在同一面板内完成。

### What Not To Copy

不要直接复制预约行业文案、营销式插画、过度圆润的消费级视觉或大面积薄荷绿。Bitvast 仍是敏感金融运营工具，需要更稳重的色彩、明确的审计信息和清晰的责任边界。参考 Schedulo 的重点是“轻量请求处理体验”，不是把 Bitvast 变成预约软件。

## Motion

只为状态变化使用 150ms 到 220ms 的过渡。允许 hover 背景、焦点环、抽屉进入和拖拽状态变化。禁止页面加载动画和装饰性动效。

## Responsive Behavior

1100px 以下，右侧规则助手下沉到主内容下方。820px 以下，侧栏收起并由菜单按钮打开。560px 以下，底部提交栏进入文档流，提交模式纵向排列。

## Do's And Don'ts

### Do

- 优先展示当前客户、当前业务、当前渠道、下一步动作。
- 把规则、限制和材料清单放在用户操作旁边，而不是藏到说明文档里。
- 使用固定字号、可预测表单和标准控件。
- 保持色彩稀少，让状态和主操作自然突出。

### Don't

- 不照搬 Tailwind 类名、外部图标依赖或 Vue 结构到当前静态工作台。
- 不使用装饰性渐变、玻璃拟态、过度阴影或营销式 hero。
- 不把每个区域都做成同样大小的卡片。
- 不使用纯黑、纯白或只靠颜色表达风险。
- 不让 OCR、KYC 规则或智能校验看起来替代人工审核。
