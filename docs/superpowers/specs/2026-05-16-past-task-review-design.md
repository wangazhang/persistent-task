# 过期未完成任务次日处理（Past Task Review）

**Date:** 2026-05-16
**Status:** Approved (design)

## 背景

应用现有数据模型允许任务通过 `scheduledDates` 排到任意多天。一个只排了某一天且未完成的任务，到了第二天就会从「今日」列表自然消失，但任务本身仍是 `todo` / `in_progress` 状态——既不再出现在视野中，也没有被显式标记为放弃。

本特性在新一天首次打开应用时，主动把这一批被"遗忘"的任务拉到用户面前，让用户用三种方式之一显式处理：完成、今天继续、挂起。

## 目标

- 用户跨日打开应用时，能在一个集中入口上一次性处理掉过期未完成任务
- 处理过程不打断当日工作流：可关闭，剩余的可重入
- "今天继续"和"挂起"两个动作支持非必填的原因记录，便于日后回顾
- 处理动作记入任务自身的日志数组，为未来统计预留无 migration 的扩展点

## 非目标

- 统计分析面板（本期不做，日志数据先落库）
- 自动判定/自动处理（不做"系统帮你挂起"的隐式行为）
- 多设备同步、提醒推送

## 触发条件（"过期未完成"判定）

一个任务进入待处理列表当且仅当：

- `scheduledDates.length === 1` —— 任务只排了某一天，没有跨天
- `scheduledDates[0] < today`（yyyy-MM-dd 字符串比较）—— 那一天已经过去
- `status ∈ {"todo", "in_progress"}` —— `done` / `suspended` / `archived` 都不参与

如果用户连续多日没打开应用，所有满足上述条件的历史任务都会进入同一个列表（不限制最远天数）。

## 触发时机与重入

### 触发
本地（`localStorage` 即可，无需走 adapter）存一个键 `lastReviewPromptDate: "yyyy-MM-dd"`。在以下时机检查并可能弹出对话框：

1. 应用启动后、`taskStore.hydrate()` 完成后
2. 应用持续打开时跨日：监听 `visibilitychange`（页面回到前台时）+ 一个轻量定时器（每 5 分钟检查一次今天的日期）

满足以下条件时自动弹出对话框：

- `lastReviewPromptDate !== isoDate()`（今日尚未提示过）
- 待处理列表非空

无论用户处理多少条（哪怕一条没处理就关掉），**只要弹过一次，就把 `lastReviewPromptDate` 设为今天**——当天不再自动弹。

### 重入
顶栏新增一个图标按钮 + 红点徽标：

- 徽标数字 = 当前待处理列表条数（实时计算，不缓存）
- 条数为 0 时图标隐藏（不渲染）
- 点击 → 重新打开对话框

## 数据模型变更

`src/lib/types.ts` 中 `Task` 接口新增可选字段：

```ts
export interface TaskReviewEntry {
  /** 处理日期 yyyy-MM-dd */
  date: string;
  /** 处理动作 */
  action: "done" | "continue" | "suspend";
  /** 用户填写的原因（非必填，"done" 时永远不填）*/
  reason?: string;
}

export interface Task {
  // ... 现有字段不变
  /**
   * 次日处理日志（追加式）。
   * 缺失 / undefined 视为空数组。老数据无需 migration。
   */
  reviewLog?: TaskReviewEntry[];
}
```

设计要点：

- 字段挂在 Task 内，读写最简单，避免独立表的 join 成本
- 数组追加式：同一任务被多次"今天继续"或反复推迟都会留下历史
- "已完成"动作也写日志，未来统计才能算"过期任务的次日处理总量"
- 老数据兼容：所有 selector 都按 `task.reviewLog ?? []` 处理

## 三种动作的副作用

| 动作 | status 变化 | scheduledDates 变化 | reviewLog 追加 | 是否需要原因 |
|---|---|---|---|---|
| 已完成 | `→ done`，写 `completedAt` | 不变 | `{date: today, action: "done"}` | 否 |
| 今天继续 | 不变 | 从原日期到今天的所有日期填充：`[d, d+1, ..., today]` | `{date: today, action: "continue", reason?}` | 可填 |
| 挂起 | `→ suspended` | 不变 | `{date: today, action: "suspend", reason?}` | 可填 |

"今天继续"日期填充示例：
- 原 `scheduledDates = ["2026-05-13"]`，今天 = `2026-05-16`
- 处理后：`["2026-05-13", "2026-05-14", "2026-05-15", "2026-05-16"]`

## UI 设计

### 对话框（PastTaskReviewDialog）

模态对话框，标题"待处理的过期任务（N）"，主体是列表：

```
┌──────────────────────────────────────────────────────┐
│  待处理的过期任务（3）                          ✕    │
├──────────────────────────────────────────────────────┤
│  写周报                          5/13      ✓  ↻  ⏸   │
│  整理桌面                         5/14      ✓  ↻  ⏸   │
│  联系设计师对接                    5/15      ✓  ↻  ⏸   │
├──────────────────────────────────────────────────────┤
│                                          稍后再说    │
└──────────────────────────────────────────────────────┘
```

每行元素：

- 任务标题（点击可跳到任务详情？——v1 先不做，行只用于处理）
- 原排期日期（短格式 `M/d`）
- 三个图标按钮，顺序：`✓ 已完成`、`↻ 今天继续`、`⏸ 挂起`（具体图标用 `lucide-react`：`Check`、`RotateCcw`、`PauseCircle`）

交互：

- 点 `✓` → 立即执行，行用淡出动画移出列表
- 点 `↻` 或 `⏸` → 弹出二级小对话框：
  ```
  ┌────────────────────────────┐
  │  今天继续：写周报           │
  │                            │
  │  原因（可选）：              │
  │  ┌──────────────────────┐  │
  │  │                      │  │
  │  └──────────────────────┘  │
  │              取消    确认   │
  └────────────────────────────┘
  ```
  确认 → 执行 + 行淡出；取消 → 关掉小对话框、什么都不做
- "稍后再说" 或右上 ✕ → 关闭主对话框；未处理的留在顶栏徽标里

列表清空（条数变 0）时，主对话框直接关闭，不显示中间过渡态。

### 顶栏入口

放在现有顶栏（`src/components/layout/` 下，找到 TopBar / Layout 容器）的右侧，位置和现有图标按钮风格一致。

- 图标：`lucide-react` 的 `BellRing` 或 `Inbox`
- 徽标：右上角小圆点 + 数字（沿用项目现有徽标样式，如有；否则用 Tailwind 写一个最小实现）
- 条数 0：图标按钮不渲染

## 涉及的代码改动

| 文件 | 改动 |
|---|---|
| `src/lib/types.ts` | 新增 `TaskReviewEntry`，给 `Task` 加 `reviewLog?` |
| `src/store/taskStore.ts` | 新增 selector / action：`getPastUnfinishedTasks()`、`reviewPastTask(id, action, reason?)` |
| `src/store/dialogStore.ts` | 新增 `pastReviewDialogOpen: boolean`、`openPastReview()`、`closePastReview()`；新增 `lastReviewPromptDate` 的读写（封装 `localStorage`）|
| `src/components/task/PastTaskReviewDialog.tsx`（新建）| 主对话框 + 行内三按钮 + 二级原因输入框 |
| `src/components/layout/*`（找到顶栏文件）| 新增触发按钮 + 红点徽标 |
| `src/App.tsx`（或其它入口）| 启动后 hydrate 完成检查 + visibilitychange 监听 + 5 分钟定时器 |
| `src/lib/dataAdapter*`（如果需要后端持久化字段）| 边界处保留 `reviewLog`（snake_case ↔ camelCase 转换，如果适用）|

## 数据持久化

`reviewLog` 跟随现有 `updateTask` → `persistTask` → adapter 的链路存储。当前 adapter 实现（无论是 IndexedDB 还是 Tauri）都按整对象 upsert，无需特殊处理，新字段自然落库。

如果后端是 Tauri + serde 严格 schema，则需要：
1. 在 Rust 端 Task struct 加 `review_log: Option<Vec<ReviewEntry>>`
2. dataAdapter 边界做 camelCase ↔ snake_case 转换

实现阶段需要先验证当前后端是否做严格 schema 校验。

## 边界情况

- **没有任何过期未完成任务**：对话框不弹，顶栏图标隐藏。
- **任务在列表展示期间被其它界面改动**（例如用户在另一个 tab 把它的 status 改成 done）：对话框基于 store selector 实时渲染，状态变了行就消失。
- **同一天弹过后用户手动重开**：通过顶栏图标随时可重开，不受 `lastReviewPromptDate` 限制。
- **"今天继续"后这条任务出现在今天的列表中**：现有 `getTasksByDate(today)` 已基于 `scheduledDates.includes(today)`，自动生效。
- **多次"今天继续"**：每次都会在 `reviewLog` 追加一条；`scheduledDates` 已经包含今天的话，再点继续在新的某天处理时仍会从最早未填日期补到今天。

## 测试策略

单元测试：
- selector `getPastUnfinishedTasks()`：构造若干 Task 覆盖 (单日/多日 × 过去/今天 × 各种 status)，验证只命中目标
- action `reviewPastTask()`：分别测三种 action 的 status / scheduledDates / reviewLog 变化
- "今天继续"的日期填充逻辑：跨 1 天、跨 5 天、跨月分别验证

集成（手动）：
- 把系统日期或某 Task 的 scheduledDates 调到过去，重启应用验证弹窗
- 弹窗中处理一条、关闭，验证顶栏徽标剩余条数
- 点徽标重开，验证剩余可继续处理

## 未来扩展

- Stats 页面新增"次日处理"分析维度：flatten 所有 task 的 `reviewLog`，按 `action` 分组、按 `reason` 词频。无 schema 变更
- "处理时距离原排期的天数"分析：从 `reviewLog[i].date - task.scheduledDates[0]` 计算
- 多次推迟提醒：如果一条任务 `reviewLog` 中 `action === "continue"` 出现 N 次，在卡片上加视觉标记

## 决策记录

| 决策点 | 选择 | 原因 |
|---|---|---|
| 弹窗形态 | 列表 + 行内三图标 | 用户偏好（v1 反馈）|
| 原因填写时机 | 二级小对话框 | 原因和动作绑定清晰，避免误操作 |
| 重入入口 | 顶栏图标 + 红点 | 全局可见，跨页面可重入 |
| "今天继续"语义 | 填充原日期到今天的所有日期 | 用户偏好"持续"语义 |
| 日志存储 | Task 内嵌 `reviewLog` 数组 | 当前数据量级无需独立表，扩展时零 migration |
| 检测范围 | 所有过去未处理任务（不限天数）| 不让任务被默默遗忘 |
| 触发时机 | 启动 + 跨日（visibilitychange + 定时器），用 `lastReviewPromptDate` 去重 | 任何回到应用的方式都能可靠提示一次 |
