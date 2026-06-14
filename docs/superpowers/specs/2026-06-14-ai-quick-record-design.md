# AI 任务快速录入（AI Quick Record）

**Date:** 2026-06-14
**Status:** Draft (design)

## 背景

应用现有的任务创建方式都要求用户填结构化字段：`TodayView` 顶部快速输入只接受标题，完整字段要进 `TaskEditor` 独立窗口逐项填写。当用户脑子里同时冒出好几件事、或从一段会议记录 / 聊天里想批量转任务时，逐条手填字段很慢，打断思路。

本特性提供一种"先倾倒、后整理"的录入方式：用户把任意杂乱、无格式的文字一次性写进一个输入框，由本地 Tauri 后端调用 Claude 把这段文字解析成一个或多个结构化任务，再以可编辑的确认卡片呈现，用户勾选确认后批量入库。

## 目标

- 用户用一个快捷入口唤起输入框，输入任意自由文本，无需关心字段格式
- 一段文本可被解析成**多个**任务，每个任务尽可能填好 `title` / `description` / `priority` / `scheduledDates` / `tagIds`
- 解析结果以**可逐张编辑、可勾选、可删除**的卡片呈现，用户拥有最终决定权
- 相对时间（"明天""周五"）由 AI 直接换算成绝对 ISO 日期
- 标签**匹配优先**：能对上已有标签就复用，对不上才建议新建，由用户勾选才真正创建
- API Key 不出现在前端：请求由 Rust `tauri::command` 代理发起

## 非目标

- 全局系统快捷键 / 托盘菜单入口（本期只做 App 内按钮 + App 内快捷键，其余留作未来扩展）
- 流式输出、解析过程的逐字展示（一次性返回即可）
- Web 端支持（本特性依赖 Rust 代理，v1 仅桌面端可用，Web 模式入口隐藏）
- 语音输入、附件 / 图片解析
- 解析历史记录、撤销已入库的批次

## 用户流程

```
唤起（按钮 / Cmd+Shift+I）
   → 独立 Spotlight 小窗弹出（输入态）
   → 用户粘贴 / 输入自由文本
   → 点「解析」或 Cmd+Enter
   → 小窗内 loading（调 parse_quick_input）
   → 切到确认态：N 张任务卡片
   → 用户逐张编辑 / 勾选 / 删除，处理标签建议
   → 点「录入 N 个任务」
   → 提交事件回 main 窗口 store 落库
   → 小窗显示成功并自动关闭
```

输入示例：

> 明天下午做用户访谈，准备问题清单，这个紧急；周五前交季度报告初稿，关联产品规划；有空看下竞品的新版本

期望解析为 3 个任务：

| title | priority | scheduledDates | 标签 |
|---|---|---|---|
| 做用户访谈 / 准备问题清单 | p0 | [明天的 ISO 日期] | （无匹配，建议"调研"）|
| 交季度报告初稿 | p1 | [周五的 ISO 日期] | 匹配已有"产品规划" |
| 看竞品新版本 | p2 | []（未提日期）| （建议"竞品"）|

## 架构

### 窗口形态

复用项目现有的独立 webview 多窗口机制（与 `task-editor` 同构）：

- `main.tsx` 按 `?win=` 分发根组件，新增分支 `win=quick-record` → 挂载 `<QuickRecordWindow />`
- Rust 侧新增 `open_quick_record` 命令，用 `WebviewWindowBuilder` 建一个无边框、透明、居中、`skip_taskbar` 的小窗（参数照搬 `tray.rs` 里 `open_task_editor` 的窗口配置，尺寸更小，如 `560 × 自适应`）
- 窗口已存在则复用：重新居中 + `show` + `focus`
- `Esc` 关闭（隐藏）窗口

### 数据写入边界（关键约束）

遵循项目铁律——**独立 webview 不直接写 store / 库**（见 `taskEditorBridge.ts` 注释："避免多个 webview 各自写库导致状态分叉"）。因此：

- **解析**（只读，无副作用）：`quick-record` 窗口**直接** `invoke("parse_quick_input")`，因为它不碰 store
- **入库**（有副作用）：`quick-record` 窗口把"已确认的任务草稿 + 待新建标签"通过事件 `quick-record:commit` 发给 `main` 窗口；`main` 窗口持有 store，依次执行 `addTag` / `addTask` 并持久化，再回发 `quick-record:committed`（成功条数）让小窗收尾

### 调用链

```
QuickRecordWindow (webview)
  │  invoke("parse_quick_input", { text, today, tags: [{id,name}] })
  ▼
Rust  commands::ai::parse_quick_input  (async tauri::command)
  │  读 AI 设置（settings 表 / 环境变量兜底）
  │  组 Anthropic Messages 请求（强制 tool_use 结构化输出）
  │  reqwest 调 https://api.anthropic.com/v1/messages
  │  取 tool_use.input，按 schema 校验
  ▼  返回 ParsedTaskDraft[]
QuickRecordWindow 渲染确认卡片
  │  用户确认
  │  emit("quick-record:commit", { drafts, newTags })  → main
  ▼
main 窗口 bridge 监听 → 逐条 addTag/addTask（走现有 store → adapter）
  │  emit("quick-record:committed", { count })  → quick-record
  ▼
小窗显示成功并关闭
```

## AI 解析设计

### 提供方与模型

- 提供方：Anthropic Messages API（`POST /v1/messages`）
- 默认模型：`claude-sonnet-4-6`（抽取类任务，Sonnet 足够且更快更省；设置页可改）
- 鉴权：`x-api-key` + `anthropic-version: 2023-06-01`

### 结构化输出（强制 tool_use）

请求带一个工具并用 `tool_choice` 强制调用，从而拿到稳定的结构化 JSON，无需解析自然语言：

```jsonc
{
  "tool_choice": { "type": "tool", "name": "emit_tasks" },
  "tools": [{
    "name": "emit_tasks",
    "description": "把用户的自由文本拆解成结构化任务列表",
    "input_schema": {
      "type": "object",
      "properties": {
        "tasks": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "title":          { "type": "string", "description": "简洁的任务标题" },
              "description":    { "type": "string", "description": "补充细节，没有则空串" },
              "priority":       { "type": "string", "enum": ["p0", "p1", "p2"] },
              "scheduledDates": { "type": "array", "items": { "type": "string" },
                                  "description": "YYYY-MM-DD 绝对日期，未提及则空数组" },
              "matchedTagIds":  { "type": "array", "items": { "type": "string" },
                                  "description": "仅可从提供的已有标签 id 中选" },
              "newTagNames":    { "type": "array", "items": { "type": "string" },
                                  "description": "已有标签覆盖不到时建议的新标签名" }
            },
            "required": ["title"]
          }
        }
      },
      "required": ["tasks"]
    }
  }]
}
```

### System Prompt 要点

- 注入"今天是 {today}（{星期}）"，要求所有相对时间换算成绝对 `YYYY-MM-DD`
- 一段文本可能包含多件事，按语义拆成多个任务；同一件事的多个动作可合并进一个任务的 title/description
- 优先级推断：出现"紧急/急/重要/尽快"→ p0/p1，否则默认 p2
- 标签：`matchedTagIds` **只能**从随请求提供的已有标签列表里选 id；覆盖不到的语义放进 `newTagNames`（短名词）
- 未提及的字段留空（空串 / 空数组），不要臆造日期
- 输出语言跟随输入（中文输入 → 中文 title/description）

### 解析请求入参

前端组装、随 invoke 传入，Rust 仅做透传 + 鉴权，自身不查标签表也不依赖时区：

```ts
interface ParseQuickInputArgs {
  text: string;                       // 用户自由文本
  today: string;                      // 前端 isoDate()，保证用本机时区
  tags: { id: string; name: string }[]; // 已有标签（来自 main 窗口 tagStore）
}
```

> 标签列表由发起方（main 窗口）先取好再唤起小窗，或小窗唤起时由 main 通过既有状态桥下发；二选一在实现阶段定，原则是 Rust 不直接读 DB 取标签。

### 返回结构

```ts
interface ParsedTaskDraft {
  title: string;
  description: string;
  priority: TaskPriority;        // 缺省补 "p2"
  scheduledDates: string[];      // 已是绝对 ISO
  matchedTagIds: string[];       // 已对前端标签做过存在性过滤
  newTagNames: string[];
}
// parse_quick_input → ParsedTaskDraft[]
```

Rust 取到 `tool_use.input` 后：按 schema 反序列化；过滤掉不在入参 `tags` 里的 `matchedTagIds`（防 AI 编造 id）；`priority` 缺失补 `p2`。

## 设置（AI 配置）

存储沿用现有 `settings` KV 表（`settings.rs`），新增 key：

| key | 含义 | 默认 |
|---|---|---|
| `ai.anthropic_api_key` | API Key（明文存本地 SQLite）| 空 |
| `ai.model` | 模型 id | `claude-sonnet-4-6` |
| `ai.base_url` | 可选，自建网关 / 代理地址 | `https://api.anthropic.com` |

读取优先级：`settings` 表 → 为空时回退环境变量 `ANTHROPIC_API_KEY`（仅 key 走环境变量兜底，model/base_url 用默认）。

UI：`AdvancedPage.tsx` 新增「AI 录入」分区——API Key（密码框，展示时掩码）、模型（文本框，带默认值占位）、可选 base URL。新增两个命令 `get_ai_settings` / `set_ai_settings`。

> 安全说明：Key 以明文存本地 DB 文件，与桌面应用的其它本地数据同级别；不上传、不出前端内存以外的网络（仅 Rust → Anthropic）。UI 上对已存 Key 做掩码显示。

## UI 设计

### 输入态

```
┌──────────────────────────────────────────────┐
│  ✨ 快速录入                            Esc   │
├──────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────┐│
│  │ 把想做的事随便写下来，明天下午做用户访谈… ││
│  │                                          ││
│  │                                          ││
│  └──────────────────────────────────────────┘│
│                                              │
│              ⌘↵ 解析            [ 解析 ]      │
└──────────────────────────────────────────────┘
```

- 自动聚焦 textarea；`Cmd/Ctrl+Enter` = 解析；`Esc` = 关窗
- 解析中：按钮转 loading，textarea 禁用

### 确认态

```
┌──────────────────────────────────────────────┐
│  识别出 3 个任务            ‹ 返回重写         │
├──────────────────────────────────────────────┤
│ ☑ ┌────────────────────────────────────────┐ │
│   │ 做用户访谈·准备问题清单         🗑      │ │
│   │ [p0▾]  📅 6/15   #调研(新建? ☑)         │ │
│   └────────────────────────────────────────┘ │
│ ☑ ┌────────────────────────────────────────┐ │
│   │ 交季度报告初稿                  🗑      │ │
│   │ [p1▾]  📅 6/20   #产品规划              │ │
│   └────────────────────────────────────────┘ │
│ ☐ ┌────────────────────────────────────────┐ │
│   │ 看竞品新版本                    🗑      │ │
│   │ [p2▾]  📅 —     #竞品(新建? ☑)          │ │
│   └────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│  全选 ☑              [ 录入 2 个任务 ]        │
└──────────────────────────────────────────────┘
```

每张卡片：

- 左侧勾选框：是否入库（默认全选）
- 标题：可点击就地编辑（input）
- 优先级：复用 `PriorityPicker`
- 排期日期：复用 `DateRangePicker` / 现有日期选择，可增删
- 标签：已匹配标签用 `TagChip` 展示；建议新建的标签名带「新建?」开关（默认开），关掉则该新标签不创建也不挂到任务
- 🗑 删除：从确认列表移除该卡片（不影响其它）
- 描述：折叠，展开后可编辑多行

底部：

- 「录入 N 个任务」按钮，N = 当前勾选数；N=0 时禁用
- 「返回重写」回到输入态，保留原文本
- 提交后：已勾选卡片依次创建（先建被勾选的新标签 → 拿到新 tagId → 合并进 `tagIds` → `addTask`），成功后小窗显示"已录入 N 个"短暂提示并关闭

### 唤起入口

- `TasksHub.tsx` 顶栏「新建任务」旁加一个按钮（图标 `Sparkles`，标题"快速录入"）
- App 内快捷键：在 `TasksHub` 现有 `keydown` 监听里加 `Cmd/Ctrl+Shift+I` → 唤起小窗（与现有 `Cmd+K`/`Cmd+N` 同一套监听，非全局系统热键）
  - 注意：`Cmd+Shift+I` 在浏览器/dev 模式可能与开发者工具冲突；生产 Tauri 窗口无此问题。若实测冲突，降级为 `Cmd+Shift+A`（实现阶段确认）
- Web 模式（`!isTauri()`）：入口隐藏（本期不支持）

## 涉及的代码改动

| 文件 | 改动 |
|---|---|
| `src-tauri/Cargo.toml` | 新增依赖 `reqwest`（`json` + `rustls-tls` features）|
| `src-tauri/src/settings.rs` | 新增 AI 三个 key 的读写 + `AiSettings` 结构 + 环境变量兜底 |
| `src-tauri/src/commands/ai.rs`（新建）| `parse_quick_input`（async）、`get_ai_settings`、`set_ai_settings` |
| `src-tauri/src/commands/mod.rs` | 导出 `ai` 模块 |
| `src-tauri/src/tray.rs`（或新窗口模块）| 新增 `open_quick_record` 窗口构建命令 |
| `src-tauri/src/lib.rs` | `invoke_handler` 注册 4 个新命令 |
| `src/main.tsx` | 新增 `win=quick-record` 分支 → 挂载 `QuickRecordWindow` |
| `src/routes/QuickRecordWindow.tsx`（新建）| 小窗根组件：输入态 + 确认态两阶段 |
| `src/lib/quickRecordBridge.ts`（新建）| 开窗 + `commit`/`committed` 事件（仿 `taskEditorBridge`）|
| `src/lib/aiParse.ts`（新建）| 类型定义 + `parseQuickInput()` invoke 包装 |
| `src/components/TrayMainBridge.tsx`（或 main 入口）| 监听 `quick-record:commit`，执行批量 `addTag`/`addTask`，回发 `committed` |
| `src/routes/tasks/TasksHub.tsx` | 「快速录入」按钮 + `Cmd+Shift+I` 快捷键 |
| `src/routes/AdvancedPage.tsx` | 「AI 录入」设置分区 + `get/set_ai_settings` 接线 |

## 错误处理

| 场景 | 表现 |
|---|---|
| 未配置 API Key | 命令返回类型化错误；小窗提示"未配置 AI，去设置" + 跳转「高级」页按钮 |
| 网络 / API 报错（4xx/5xx）| 小窗显示错误摘要，保留原文本可重试 |
| 解析出 0 个任务 | 显示"没识别出任务，换种说法或写具体点"，停在输入态 |
| tool_use 输出不符 schema | Rust 反序列化失败 → 返回错误，小窗提示"解析失败，重试" |
| AI 编造了不存在的 tagId | Rust / 前端过滤丢弃，不影响其它字段 |
| 提交时某新标签重名 | 复用同名已有标签（按 name 查），不重复建 |

## 边界情况

- **一段文本只对应一个任务**：确认态就一张卡片，流程不变
- **用户全部取消勾选**：底部按钮禁用，无法提交
- **同一输入里多个任务命中同一个新标签名**：批量提交时该新标签只建一次，多个任务复用同一 `tagId`
- **小窗解析中用户关窗**：请求被丢弃（无副作用，解析只读），重开是干净的输入态
- **main 窗口未就绪 / 隐藏**：`commit` 事件由 main 的 bridge 监听，main 隐藏不影响事件处理；落库后正常出现在列表
- **超长文本**：前端对 textarea 长度软上限提示（如 > 4000 字），仍允许提交（成本由用户承担）

## 测试策略

单元测试（前端）：

- `aiParse` 返回的 `ParsedTaskDraft[]` → 卡片视图模型映射：priority 补默认、matchedTagIds 与 newTagNames 分流渲染
- 提交编排：勾选过滤、新标签去重建、`tagIds` 合并顺序
- bridge 事件序列化往返（`commit` payload ↔ 解析）

Rust 测试：

- AI 设置读取优先级：settings 表有值 / 仅环境变量 / 都没有
- `tool_use.input` → `ParsedTaskDraft[]` 反序列化 + tagId 存在性过滤（可对固定 JSON fixture 测，不打真实网络）

集成（手动）：

- 配好 Key，输入多任务文本，验证拆分 / 日期换算 / 标签匹配
- 删卡片、改字段、关新建标签开关后提交，核对入库结果
- 未配 Key、断网、空结果三种错误路径

## 未来扩展

- 全局系统快捷键 + 托盘「快速录入」菜单项（App 在后台也能唤起，真正的"速记盒子"）
- 多 Provider / 本地 Ollama 可切换
- 解析历史 + 一键撤销刚录入的批次
- 语音转文字入口、从剪贴板/选中文本一键带入
- 流式解析，边出边显示卡片

## 决策记录

| 决策点 | 选择 | 原因 |
|---|---|---|
| AI 接入方式 | Rust `reqwest` 直调 Anthropic HTTP API | Key 不出前端，避开浏览器 CORS，符合 Tauri 代理模式 |
| 结构化输出 | 强制 `tool_use` 工具调用 | 拿稳定 JSON，免解析自然语言 |
| 调用位置 | `tauri::command` 代理 | 与项目既有命令一致，集中鉴权 |
| Key 存储 | settings 表 + `ANTHROPIC_API_KEY` 兜底 | 用户友好 + 开发期省事 |
| 标签策略 | 匹配优先，建议新建（用户勾选才建）| 平衡自动化与标签库整洁 |
| 唤起入口 | App 内按钮 + App 内快捷键 | v1 最小可用，全局热键/托盘留待后续 |
| 输入框形态 | 独立 Spotlight 风格 webview 小窗 | 聚焦、不挤占主界面，复用既有多窗口机制 |
| 时间解析 | system prompt 注入今天 + AI 输出绝对 ISO | 一步到位，前端不再二次换算时区 |
| 确认 UI | 卡片列表，逐张可勾选/编辑/删除 | 用户对每个识别结果有完全控制权 |
| 写入边界 | 小窗只解析；入库经事件回 main store | 遵循"webview 不各自写库"的项目铁律 |
| 默认模型 | `claude-sonnet-4-6` | 抽取任务足够，快且省 |
| Web 端 | v1 不支持，入口隐藏 | 依赖 Rust 代理，桌面端优先 |
