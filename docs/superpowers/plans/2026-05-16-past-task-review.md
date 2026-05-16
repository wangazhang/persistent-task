# 过期未完成任务次日处理（Past Task Review）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新一天首次打开应用时，弹列表对话框处理过期未完成任务（已完成 / 今天继续 / 挂起），剩余项通过顶栏图标 + 红点徽标随时重入；处理动作落到任务自身的 reviewLog 数组，为后续统计预留扩展点。

**Architecture:** 在现有 `Task` 上新增可选 `reviewLog` 数组字段，前后端 SQLite 都加 `tasks.review_log` TEXT 列存 JSON。`taskStore` 增加 selector / action；新建 `pastReviewStore` 封装 `lastReviewPromptDate` localStorage 读写和对话框开关。新建 `PastTaskReviewDialog` 主对话框 + `ReasonPromptDialog` 二级原因输入框，新建 `TopBar` 顶栏组件挂在 `AppLayout`。`App.tsx` 的 hydrate effect 末尾触发首次检查 + visibilitychange + 5 分钟定时器。

**Tech Stack:** TypeScript + React 18 + Zustand 4 + date-fns + lucide-react + Tailwind；Web 端 sql.js / IndexedDB；桌面端 Tauri 2 + rusqlite；手写最小测试运行器（`npx tsx src/lib/__xxx.test.ts`）。

---

## 文件结构

**新建：**

- `src/lib/pastReview.ts` — 纯函数：`isPastUnfinished(task, today)`、`fillContinueDates(scheduledDates, today)`，以及 `lastReviewPromptDate` 的 localStorage 读写
- `src/lib/__pastReview.test.ts` — 上述纯函数的断言测试（沿用 `__dateRange.test.ts` 的最小风格）
- `src/store/pastReviewStore.ts` — Zustand store：`{ open, isHydrated, openDialog(), closeDialog(), markPromptedToday() }`
- `src/components/task/PastTaskReviewDialog.tsx` — 列表对话框（行内三图标）
- `src/components/task/ReasonPromptDialog.tsx` — 二级原因输入对话框（仅"今天继续"/"挂起"使用）
- `src/components/layout/TopBar.tsx` — 应用顶栏，包含"待处理过期任务"按钮 + 红点徽标

**修改：**

- `src/lib/types.ts` — 新增 `TaskReviewAction`、`TaskReviewEntry` 类型；`Task.reviewLog?: TaskReviewEntry[]`
- `src/store/taskStore.ts` — 新增 `reviewPastTask(id, action, reason?)` action
- `src/components/layout/AppLayout.tsx` — 渲染 `<TopBar />` 在 `<main>` 顶部；渲染 `<PastTaskReviewDialog />`
- `src/App.tsx` — hydrate 完成后触发首次检查；监听 `visibilitychange` + 5 分钟 setInterval
- `src/lib/webDb/schema.ts` — `tasks` 表新增 `review_log TEXT`
- `src/lib/webDb/sqliteDb.ts` — 启动迁移加 `ensureColumn` 调用（如果当前是裸 schema 创建，则需要在那里加上）
- `src/lib/webDb/sqliteAdapter.ts` — listTasks 读 `review_log` JSON.parse；upsertTask 写 JSON.stringify
- `src-tauri/src/db.rs` — `tasks` 表 `CREATE TABLE` 加列 + `ensure_column("tasks", "review_log", "TEXT")`
- `src-tauri/src/models.rs` — `Task` 加 `pub review_log: Option<String>`（serde camelCase 自动 → `reviewLog`）
- `src-tauri/src/commands.rs` — `list_tasks` 多读一列；`upsert_task` 多写一列

---

## Task 1: 类型定义

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: 在 `Task` 接口前新增类型；给 `Task` 加 `reviewLog?` 字段**

打开 `src/lib/types.ts`。在第 28 行（`TaskPriority` 类型定义结束后）和第 30 行（`/** 任务 */`）之间插入：

```ts
/** 次日处理动作 */
export type TaskReviewAction = "done" | "continue" | "suspend";

/** 单条次日处理日志（追加式） */
export interface TaskReviewEntry {
  /** 处理日期 yyyy-MM-dd */
  date: string;
  /** 处理动作 */
  action: TaskReviewAction;
  /** 用户填写的原因（非必填，"done" 永远不填） */
  reason?: string;
}
```

然后在 `Task` 接口的 `updatedAt: string;` 行（第 67 行）之前加一段：

```ts
  /**
   * 次日处理日志（追加式）。
   * 缺失 / undefined 视为空数组。老数据无需 migration。
   */
  reviewLog?: TaskReviewEntry[];
```

- [ ] **Step 2: 编译检查**

Run: `npx tsc --noEmit`
Expected: PASS（不引入新错误；已有错误如有则维持原状，diff 0 增加）

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): add TaskReviewEntry and Task.reviewLog"
```

---

## Task 2: 纯函数 `isPastUnfinished` 与测试

**Files:**
- Create: `src/lib/pastReview.ts`
- Create: `src/lib/__pastReview.test.ts`

- [ ] **Step 1: 写测试（先失败）**

新建 `src/lib/__pastReview.test.ts`：

```ts
// src/lib/__pastReview.test.ts
// 用法：npx tsx src/lib/__pastReview.test.ts
import {
  isPastUnfinished,
  fillContinueDates,
  readLastPromptDate,
  writeLastPromptDate,
} from "./pastReview";
import type { Task } from "./types";

let fail = 0;
function eq<T>(label: string, got: T, expect: T) {
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) {
    console.log("  got:   ", got);
    console.log("  expect:", expect);
    fail++;
  }
}

function makeTask(partial: Partial<Task>): Task {
  return {
    id: partial.id ?? "t1",
    title: partial.title ?? "x",
    description: "",
    status: partial.status ?? "todo",
    scheduledDates: partial.scheduledDates ?? [],
    tagIds: [],
    order: 0,
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    ...partial,
  };
}

const TODAY = "2026-05-16";

// isPastUnfinished —— 命中
eq(
  "命中：todo 单日过去",
  isPastUnfinished(
    makeTask({ status: "todo", scheduledDates: ["2026-05-15"] }),
    TODAY
  ),
  true
);
eq(
  "命中：in_progress 单日过去",
  isPastUnfinished(
    makeTask({ status: "in_progress", scheduledDates: ["2026-05-13"] }),
    TODAY
  ),
  true
);

// isPastUnfinished —— 不命中
eq(
  "不命中：scheduledDates 长度 != 1",
  isPastUnfinished(
    makeTask({ status: "todo", scheduledDates: ["2026-05-15", "2026-05-16"] }),
    TODAY
  ),
  false
);
eq(
  "不命中：日期是今天",
  isPastUnfinished(
    makeTask({ status: "todo", scheduledDates: [TODAY] }),
    TODAY
  ),
  false
);
eq(
  "不命中：日期是未来",
  isPastUnfinished(
    makeTask({ status: "todo", scheduledDates: ["2026-05-20"] }),
    TODAY
  ),
  false
);
eq(
  "不命中：done 状态",
  isPastUnfinished(
    makeTask({ status: "done", scheduledDates: ["2026-05-15"] }),
    TODAY
  ),
  false
);
eq(
  "不命中：suspended 状态",
  isPastUnfinished(
    makeTask({ status: "suspended", scheduledDates: ["2026-05-15"] }),
    TODAY
  ),
  false
);
eq(
  "不命中：archived 状态",
  isPastUnfinished(
    makeTask({ status: "archived", scheduledDates: ["2026-05-15"] }),
    TODAY
  ),
  false
);
eq(
  "不命中：scheduledDates 为空",
  isPastUnfinished(
    makeTask({ status: "todo", scheduledDates: [] }),
    TODAY
  ),
  false
);

// fillContinueDates —— 跨天填充
eq(
  "fill 跨 3 天",
  fillContinueDates(["2026-05-13"], "2026-05-16"),
  ["2026-05-13", "2026-05-14", "2026-05-15", "2026-05-16"]
);
eq(
  "fill 跨 1 天",
  fillContinueDates(["2026-05-15"], "2026-05-16"),
  ["2026-05-15", "2026-05-16"]
);
eq(
  "fill 跨月",
  fillContinueDates(["2026-04-29"], "2026-05-02"),
  ["2026-04-29", "2026-04-30", "2026-05-01", "2026-05-02"]
);
eq(
  "fill 起点 = today（实际不会触发，但保证幂等）",
  fillContinueDates(["2026-05-16"], "2026-05-16"),
  ["2026-05-16"]
);

// localStorage 读写
{
  // 简单 mock：用全局对象覆盖 globalThis.localStorage
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => mem.set(k, v),
    removeItem: (k: string) => mem.delete(k),
    clear: () => mem.clear(),
  };
  eq("初始读为 null", readLastPromptDate(), null);
  writeLastPromptDate("2026-05-16");
  eq("写入后读到", readLastPromptDate(), "2026-05-16");
}

if (fail > 0) {
  console.log(`\n${fail} 个用例失败`);
  process.exit(1);
} else {
  console.log("\n全部通过");
}
```

- [ ] **Step 2: 运行测试，确认失败（模块不存在）**

Run: `npx tsx src/lib/__pastReview.test.ts`
Expected: FAIL — `Cannot find module './pastReview'`

- [ ] **Step 3: 实现 `pastReview.ts`**

新建 `src/lib/pastReview.ts`：

```ts
/**
 * 过期未完成任务次日处理 —— 纯函数 + localStorage 工具。
 *
 * 这里不依赖 zustand / React，方便单元测试和复用。
 */

import { addDays, format, parseISO } from "date-fns";
import type { Task } from "./types";

const LS_KEY = "persistent-task:lastReviewPromptDate";

/**
 * 判断任务是否进入「过期未完成」列表：
 *   - 只排了一天（scheduledDates.length === 1）
 *   - 那一天 < 今天
 *   - status 是 todo / in_progress
 */
export function isPastUnfinished(task: Task, today: string): boolean {
  if (task.scheduledDates.length !== 1) return false;
  const d = task.scheduledDates[0];
  if (d >= today) return false;
  return task.status === "todo" || task.status === "in_progress";
}

/**
 * 「今天继续」的日期填充：把原日期到今天之间的所有日期都加上。
 * 如果原 scheduledDates 长度 ≠ 1，按调用方约定不应触发，但这里仍
 * 兜底保留原数组并去重 union 上 today。
 */
export function fillContinueDates(
  scheduledDates: string[],
  today: string
): string[] {
  if (scheduledDates.length !== 1) {
    const set = new Set(scheduledDates);
    set.add(today);
    return Array.from(set).sort();
  }
  const start = scheduledDates[0];
  if (start >= today) {
    return [start];
  }
  const out: string[] = [];
  let cur = parseISO(start);
  const end = parseISO(today);
  while (cur.getTime() <= end.getTime()) {
    out.push(format(cur, "yyyy-MM-dd"));
    cur = addDays(cur, 1);
  }
  return out;
}

/** 读上一次"已经向用户弹过提醒"的日期；不存在返回 null。 */
export function readLastPromptDate(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

/** 写入"已经向用户弹过提醒"的日期。失败时静默忽略（隐私模式 / 配额）。 */
export function writeLastPromptDate(date: string): void {
  try {
    localStorage.setItem(LS_KEY, date);
  } catch {
    /* noop */
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx tsx src/lib/__pastReview.test.ts`
Expected: PASS — 输出"全部通过"

- [ ] **Step 5: Commit**

```bash
git add src/lib/pastReview.ts src/lib/__pastReview.test.ts
git commit -m "feat(past-review): add pure helpers + tests"
```

---

## Task 3: taskStore 新增 `reviewPastTask` action

**Files:**
- Modify: `src/store/taskStore.ts`

- [ ] **Step 1: 在 store interface 中加 action 签名**

打开 `src/store/taskStore.ts`。当前文件中：

- 第 7 行 `import type { ... }` 处补一个导入：把 `TaskReviewAction, TaskReviewEntry` 加进来
- 在 `interface TaskStoreState` 的 `removePomodoro` 之前（即 `// pomodoros` 块上方）加一行：

```ts
  /** 处理某条过期未完成任务（已完成 / 今天继续 / 挂起），同时追加 reviewLog */
  reviewPastTask: (
    id: string,
    action: TaskReviewAction,
    reason?: string
  ) => void;
```

- [ ] **Step 2: 在 store 实现里加该 action（接在 `removeFromDate`/`scheduleForDate` 段之后，`addPomodoro` 之前）**

在 `moveSchedule` action 实现完之后（约第 219 行 `}`,后面）插入：

```ts
  reviewPastTask(id, action, reason) {
    const target = get().tasks.find((t) => t.id === id);
    if (!target) return;
    const today = isoDate();
    const existing = target.reviewLog ?? [];
    const entry: TaskReviewEntry = reason
      ? { date: today, action, reason }
      : { date: today, action };
    const reviewLog: TaskReviewEntry[] = [...existing, entry];

    if (action === "done") {
      get().updateTask(id, {
        status: "done",
        completedAt: new Date().toISOString(),
        reviewLog,
      });
      return;
    }
    if (action === "suspend") {
      get().updateTask(id, { status: "suspended", reviewLog });
      return;
    }
    // continue：填充 scheduledDates，状态保持 todo / in_progress
    const next = fillContinueDates(target.scheduledDates, today);
    get().updateTask(id, { scheduledDates: next, reviewLog });
  },
```

并在文件顶部 import 区追加：

```ts
import { fillContinueDates } from "@/lib/pastReview";
```

更新 `import type { ... }`，把 `TaskReviewAction, TaskReviewEntry` 一起加上。

- [ ] **Step 3: 编译检查**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: 写一个最小集成测试（可选，纯类型与 dispatch 已被 tsc 覆盖；跳过）**

跳过 — 该 action 只是把已测试的纯函数粘合到 zustand 上，编译通过即可。

- [ ] **Step 5: Commit**

```bash
git add src/store/taskStore.ts
git commit -m "feat(store): add reviewPastTask action"
```

---

## Task 4: pastReviewStore（对话框开关 + 提醒日期记录）

**Files:**
- Create: `src/store/pastReviewStore.ts`

- [ ] **Step 1: 实现 store**

新建 `src/store/pastReviewStore.ts`：

```ts
/**
 * 「过期未完成任务」对话框开关 + 今日是否已弹过的状态。
 *
 * 真值来源：
 *   - lastPromptDate 持久化在 localStorage（pastReview.ts 提供 read/write）。
 *   - open 是 UI 临时态，不持久化。
 */

import { create } from "zustand";
import {
  readLastPromptDate,
  writeLastPromptDate,
} from "@/lib/pastReview";
import { isoDate } from "@/lib/utils";

interface PastReviewState {
  open: boolean;
  lastPromptDate: string | null;

  /** 打开对话框（不会自动改 lastPromptDate；后者由 markPromptedToday 控制） */
  openDialog: () => void;
  /** 关闭对话框 */
  closeDialog: () => void;
  /** 记录"今天已经向用户弹过"，避免同一天再次自动弹 */
  markPromptedToday: () => void;
  /** 是否需要在启动 / 跨日时自动弹 */
  shouldAutoPrompt: () => boolean;
}

export const usePastReviewStore = create<PastReviewState>((set, get) => ({
  open: false,
  lastPromptDate: readLastPromptDate(),

  openDialog() {
    set({ open: true });
  },
  closeDialog() {
    set({ open: false });
  },
  markPromptedToday() {
    const today = isoDate();
    writeLastPromptDate(today);
    set({ lastPromptDate: today });
  },
  shouldAutoPrompt() {
    return get().lastPromptDate !== isoDate();
  },
}));
```

- [ ] **Step 2: 编译检查**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/store/pastReviewStore.ts
git commit -m "feat(store): add pastReviewStore"
```

---

## Task 5: ReasonPromptDialog（二级原因输入）

**Files:**
- Create: `src/components/task/ReasonPromptDialog.tsx`

- [ ] **Step 1: 实现组件**

新建 `src/components/task/ReasonPromptDialog.tsx`：

```tsx
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";

interface ReasonPromptDialogProps {
  open: boolean;
  /** 标题，例如「今天继续：写周报」*/
  title: string;
  /** 输入框 placeholder */
  placeholder?: string;
  /** 提交按钮文案，例如「确认继续」/「确认挂起」*/
  confirmText: string;
  onCancel: () => void;
  /** 用户确认时回调；reason 为空字符串视作未填写 */
  onConfirm: (reason: string) => void;
}

export function ReasonPromptDialog({
  open,
  title,
  placeholder = "原因（可选）",
  confirmText,
  onCancel,
  onConfirm,
}: ReasonPromptDialogProps) {
  const [reason, setReason] = useState("");

  // 打开时清空，避免与上一次的输入串味
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      widthClass="max-w-sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onConfirm(reason.trim())}
            autoFocus
          >
            {confirmText}
          </button>
        </>
      }
    >
      <textarea
        className="w-full resize-none rounded-md border border-ink-200/70 bg-white px-3 py-2 text-sm text-ink-700 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none"
        rows={3}
        placeholder={placeholder}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Modal>
  );
}
```

- [ ] **Step 2: 编译检查**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/task/ReasonPromptDialog.tsx
git commit -m "feat(task): add ReasonPromptDialog"
```

---

## Task 6: PastTaskReviewDialog（主列表对话框）

**Files:**
- Create: `src/components/task/PastTaskReviewDialog.tsx`

- [ ] **Step 1: 实现组件**

新建 `src/components/task/PastTaskReviewDialog.tsx`：

```tsx
import { useMemo, useState } from "react";
import { Check, PauseCircle, RotateCcw } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Modal } from "@/components/ui/Modal";
import { ReasonPromptDialog } from "./ReasonPromptDialog";
import { useTaskStore } from "@/store/taskStore";
import { usePastReviewStore } from "@/store/pastReviewStore";
import { isPastUnfinished } from "@/lib/pastReview";
import { isoDate } from "@/lib/utils";
import type { Task, TaskReviewAction } from "@/lib/types";

/**
 * 过期未完成任务次日处理 —— 主对话框。
 *
 * 数据驱动：从 taskStore 实时算 pastUnfinished 列表，
 * 每次处理一条 → 列表自动收缩（行用 store 状态变化触发的 re-render 移除）。
 * 列表清空时自动关闭主对话框。
 */
export function PastTaskReviewDialog() {
  const open = usePastReviewStore((s) => s.open);
  const closeDialog = usePastReviewStore((s) => s.closeDialog);

  const tasks = useTaskStore((s) => s.tasks);
  const reviewPastTask = useTaskStore((s) => s.reviewPastTask);

  const today = isoDate();
  const list = useMemo<Task[]>(
    () =>
      tasks
        .filter((t) => isPastUnfinished(t, today))
        .sort((a, b) =>
          a.scheduledDates[0].localeCompare(b.scheduledDates[0])
        ),
    [tasks, today]
  );

  // 二级对话框状态
  const [pending, setPending] = useState<{
    taskId: string;
    action: "continue" | "suspend";
  } | null>(null);

  // 主对话框打开但列表已经空了 → 自动关闭
  if (open && list.length === 0) {
    queueMicrotask(() => closeDialog());
  }

  function handleDone(taskId: string) {
    reviewPastTask(taskId, "done");
  }

  function openReason(taskId: string, action: "continue" | "suspend") {
    setPending({ taskId, action });
  }

  function confirmReason(reason: string) {
    if (!pending) return;
    const finalReason = reason || undefined;
    reviewPastTask(pending.taskId, pending.action, finalReason);
    setPending(null);
  }

  const pendingTask = pending
    ? list.find((t) => t.id === pending.taskId)
    : null;
  const reasonTitle =
    pending && pendingTask
      ? `${pending.action === "continue" ? "今天继续" : "挂起"}：${pendingTask.title}`
      : "";
  const reasonConfirm = pending?.action === "continue" ? "确认继续" : "确认挂起";

  return (
    <>
      <Modal
        open={open}
        onClose={closeDialog}
        title={`待处理的过期任务（${list.length}）`}
        widthClass="max-w-xl"
        footer={
          <button type="button" className="btn-secondary" onClick={closeDialog}>
            稍后再说
          </button>
        }
      >
        <ul className="divide-y divide-ink-200/70">
          {list.map((t) => {
            const date = format(parseISO(t.scheduledDates[0]), "M/d");
            return (
              <li
                key={t.id}
                className="flex items-center gap-3 py-2.5"
                data-testid="past-review-row"
              >
                <span className="flex-1 truncate text-sm text-ink-700">
                  {t.title}
                </span>
                <span className="shrink-0 text-xs text-ink-400">{date}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <IconBtn
                    label="已完成"
                    color="text-emerald-600 hover:bg-emerald-50"
                    onClick={() => handleDone(t.id)}
                  >
                    <Check className="h-4 w-4" />
                  </IconBtn>
                  <IconBtn
                    label="今天继续"
                    color="text-brand-600 hover:bg-brand-50"
                    onClick={() => openReason(t.id, "continue")}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </IconBtn>
                  <IconBtn
                    label="挂起"
                    color="text-ink-500 hover:bg-ink-100"
                    onClick={() => openReason(t.id, "suspend")}
                  >
                    <PauseCircle className="h-4 w-4" />
                  </IconBtn>
                </div>
              </li>
            );
          })}
        </ul>
      </Modal>

      <ReasonPromptDialog
        open={pending !== null}
        title={reasonTitle}
        confirmText={reasonConfirm}
        onCancel={() => setPending(null)}
        onConfirm={confirmReason}
      />
    </>
  );
}

interface IconBtnProps {
  label: string;
  color: string;
  onClick: () => void;
  children: React.ReactNode;
}

function IconBtn({ label, color, onClick, children }: IconBtnProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`rounded-md p-1.5 transition-colors ${color}`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: 编译检查**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/task/PastTaskReviewDialog.tsx
git commit -m "feat(task): add PastTaskReviewDialog"
```

---

## Task 7: TopBar（顶栏 + 红点徽标按钮）

**Files:**
- Create: `src/components/layout/TopBar.tsx`
- Modify: `src/components/layout/AppLayout.tsx`

- [ ] **Step 1: 实现 TopBar**

新建 `src/components/layout/TopBar.tsx`：

```tsx
import { useMemo } from "react";
import { BellRing } from "lucide-react";
import { useTaskStore } from "@/store/taskStore";
import { usePastReviewStore } from "@/store/pastReviewStore";
import { isPastUnfinished } from "@/lib/pastReview";
import { isoDate } from "@/lib/utils";

/**
 * 应用顶栏。当前唯一职责是放「待处理过期任务」入口。
 *
 * 红点徽标条数 = 当前过期未完成任务数。条数为 0 时整个按钮不渲染。
 */
export function TopBar() {
  const tasks = useTaskStore((s) => s.tasks);
  const openDialog = usePastReviewStore((s) => s.openDialog);

  const today = isoDate();
  const count = useMemo(
    () => tasks.filter((t) => isPastUnfinished(t, today)).length,
    [tasks, today]
  );

  return (
    <header className="flex h-12 shrink-0 items-center justify-end border-b border-ink-200/70 bg-white px-4">
      {count > 0 && (
        <button
          type="button"
          onClick={openDialog}
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-500 hover:bg-ink-100 hover:text-ink-700"
          title={`${count} 个过期未完成任务待处理`}
          aria-label={`${count} 个过期未完成任务待处理`}
        >
          <BellRing className="h-4 w-4" />
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-medium leading-none text-white">
            {count > 99 ? "99+" : count}
          </span>
        </button>
      )}
    </header>
  );
}
```

- [ ] **Step 2: 把 TopBar + 主对话框挂到 AppLayout**

打开 `src/components/layout/AppLayout.tsx`。完整替换为：

```tsx
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { PastTaskReviewDialog } from "@/components/task/PastTaskReviewDialog";

export function AppLayout() {
  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <PastTaskReviewDialog />
    </div>
  );
}
```

- [ ] **Step 3: 编译检查**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/TopBar.tsx src/components/layout/AppLayout.tsx
git commit -m "feat(layout): add TopBar with past-review entry"
```

---

## Task 8: 启动 + 跨日触发（App.tsx）

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 在 hydrate 完成后检查并自动弹**

打开 `src/App.tsx`。找到原有的 `useEffect(() => { void hydrateTags(); void hydrateTasks(); }, ...)`（约第 20-23 行），把整个 effect 替换为：

```tsx
  // 启动时加载数据，加载完毕后判断是否需要弹"待处理过期任务"
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all([hydrateTags(), hydrateTasks()]);
      if (cancelled) return;
      checkAndAutoPrompt();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 跨日（应用持续打开）也要触发一次：
  //   - visibilitychange：用户切回应用前台
  //   - 5 分钟轮询：纯前台情况下也能感知日期变化
  useEffect(() => {
    function onVis() {
      if (document.visibilityState === "visible") checkAndAutoPrompt();
    }
    document.addEventListener("visibilitychange", onVis);
    const timer = window.setInterval(checkAndAutoPrompt, 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(timer);
    };
  }, []);
```

并在文件顶部 import 区追加：

```tsx
import { usePastReviewStore } from "@/store/pastReviewStore";
import { isPastUnfinished } from "@/lib/pastReview";
import { isoDate } from "@/lib/utils";
```

在组件外（紧贴 import 之后、`export default function App()` 之前）加一个独立的辅助函数：

```tsx
function checkAndAutoPrompt() {
  const past = usePastReviewStore.getState();
  if (!past.shouldAutoPrompt()) return;
  // 只查一次 store，不订阅
  const { tasks } = useTaskStore.getState();
  const today = isoDate();
  const hasPast = tasks.some((t) => isPastUnfinished(t, today));
  if (!hasPast) return;
  past.openDialog();
  past.markPromptedToday();
}
```

注意：原文件中已经有 `import { useTaskStore } from "@/store/taskStore";`，无需重复。如果不存在 `import { isoDate }`，按上面补全。

- [ ] **Step 2: 编译检查**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): auto-prompt past review on hydrate + day change"
```

---

## Task 9: 后端 (Web) — 持久化 reviewLog

**Files:**
- Modify: `src/lib/webDb/schema.ts`
- Modify: `src/lib/webDb/sqliteDb.ts`
- Modify: `src/lib/webDb/sqliteAdapter.ts`

- [ ] **Step 1: schema 加列**

打开 `src/lib/webDb/schema.ts`。找到 `tasks` 表的 `CREATE TABLE`（约第 26-39 行），在 `updated_at   TEXT NOT NULL` 后加一列：

```sql
    review_log   TEXT
```

完整改动：

```sql
CREATE TABLE IF NOT EXISTS tasks (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'todo',
    priority     TEXT NOT NULL DEFAULT 'p2',
    "order"      INTEGER NOT NULL DEFAULT 0,
    doc_url      TEXT,
    doc_title    TEXT,
    color        TEXT,
    completed_at TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    review_log   TEXT
);
```

- [ ] **Step 2: sqliteDb.ts 加 ensureColumn 调用**

Run 一次确认 ensureColumn 当前所在位置：

```bash
grep -n "ensureColumn\|ALTER TABLE\|review_log" src/lib/webDb/sqliteDb.ts
```

Expected: 找到既有 `ensureColumn` 调用集中处（多个旧字段补齐）。如果文件中尚无 `ensureColumn`，按以下结构在 `migrate()` / 初始化逻辑里追加：

```ts
ensureColumn(db, "tasks", "review_log", "TEXT");
```

具体行号以当前文件为准。如果该文件目前完全靠 `SCHEMA_SQL` + `IF NOT EXISTS` 创建表（即没有处理"老库加新列"的代码），则需要新增 `ensureColumn` 函数：

```ts
function ensureColumn(
  db: import("sql.js").Database,
  table: string,
  column: string,
  decl: string
) {
  const cols = db.exec(`PRAGMA table_info(${table})`);
  const names: string[] =
    cols[0]?.values.map((row) => String(row[1])) ?? [];
  if (!names.includes(column)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
```

并在加载 schema 后调用 `ensureColumn(db, "tasks", "review_log", "TEXT")`。

- [ ] **Step 3: sqliteAdapter.ts 读写 reviewLog**

打开 `src/lib/webDb/sqliteAdapter.ts`。

(a) `listTasks`（第 65-86 行附近）：

把 SELECT 列加 `review_log`：

```ts
const taskRows = query<Row>(
  `SELECT id, title, description, status, priority, "order",
          doc_url, doc_title, color, completed_at, created_at, updated_at,
          review_log
   FROM tasks`
);
```

在 mapping 中追加 `reviewLog` 字段（在 `updatedAt: s(r.updated_at),` 之后）：

```ts
reviewLog: parseReviewLog(r.review_log),
```

并在文件顶部辅助函数处加：

```ts
import type { TaskReviewEntry } from "../types";

function parseReviewLog(v: unknown): TaskReviewEntry[] | undefined {
  if (v == null) return undefined;
  try {
    const parsed = JSON.parse(String(v));
    return Array.isArray(parsed) ? (parsed as TaskReviewEntry[]) : undefined;
  } catch {
    return undefined;
  }
}
```

(b) `upsertTask`（第 115-148 行附近）：

把 INSERT 字段列、占位符、参数都各加一项 `review_log`：

```ts
run(
  `INSERT INTO tasks (
      id, title, description, status, priority, "order",
      doc_url, doc_title, color, completed_at, created_at, updated_at,
      review_log
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      status = excluded.status,
      priority = excluded.priority,
      "order" = excluded."order",
      doc_url = excluded.doc_url,
      doc_title = excluded.doc_title,
      color = excluded.color,
      completed_at = excluded.completed_at,
      updated_at = excluded.updated_at,
      review_log = excluded.review_log`,
  [
    task.id,
    task.title,
    task.description,
    task.status,
    task.priority ?? "p2",
    task.order,
    task.docUrl ?? null,
    task.docTitle ?? null,
    task.color ?? null,
    task.completedAt ?? null,
    task.createdAt,
    task.updatedAt,
    task.reviewLog && task.reviewLog.length > 0
      ? JSON.stringify(task.reviewLog)
      : null,
  ]
);
```

- [ ] **Step 4: 编译检查**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 启动 web dev 验证 hydrate 不报错**

Run: `npm run dev`
Expected: 控制台无 SQLite 列错误；任务列表正常加载。手动 Ctrl+C 终止。

- [ ] **Step 6: Commit**

```bash
git add src/lib/webDb/schema.ts src/lib/webDb/sqliteDb.ts src/lib/webDb/sqliteAdapter.ts
git commit -m "feat(webdb): persist Task.reviewLog as JSON column"
```

---

## Task 10: 后端 (Tauri) — 持久化 reviewLog

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: db.rs 加列 + ensure_column**

打开 `src-tauri/src/db.rs`。在 `tasks` 表的 `CREATE TABLE` 中（约第 50-62 行），把 `updated_at   TEXT NOT NULL` 改为：

```sql
                updated_at   TEXT NOT NULL,
                review_log   TEXT
```

并在 `ensure_column(conn, "tasks", "color", "TEXT")?;` 之后追加：

```rust
ensure_column(conn, "tasks", "review_log", "TEXT")?;
```

- [ ] **Step 2: models.rs 加字段**

打开 `src-tauri/src/models.rs`。在 `Task` struct（第 36-60 行）的 `pub updated_at: String,` 之后追加：

```rust
    /// 次日处理日志 JSON 字符串。前端会 JSON.parse / JSON.stringify。
    /// 兼容旧数据：缺失或 null 视作 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_log: Option<String>,
```

- [ ] **Step 3: commands.rs 读写**

打开 `src-tauri/src/commands.rs`。

(a) `list_tasks`（第 26-124 行）：

修改 SELECT：

```rust
let mut stmt = conn
    .prepare(
        r#"
        SELECT id, title, description, status, priority, "order",
               doc_url, doc_title, color, completed_at, created_at, updated_at,
               review_log
        FROM tasks
        "#,
    )
    .map_err(to_err)?;
```

修改 `query_map` 解构与 push：

```rust
let task_rows = stmt
    .query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, i32>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<String>>(8)?,
            row.get::<_, Option<String>>(9)?,
            row.get::<_, String>(10)?,
            row.get::<_, String>(11)?,
            row.get::<_, Option<String>>(12)?, // review_log
        ))
    })
    .map_err(to_err)?;

let mut tasks: Vec<Task> = Vec::new();
for r in task_rows {
    let (
        id,
        title,
        description,
        status,
        priority,
        order,
        doc_url,
        doc_title,
        color,
        completed_at,
        created_at,
        updated_at,
        review_log,
    ) = r.map_err(to_err)?;
    tasks.push(Task {
        id,
        title,
        description,
        status: TaskStatus::from_str(&status),
        priority: TaskPriority::from_str(&priority),
        scheduled_dates: vec![],
        tag_ids: vec![],
        order,
        color,
        doc_url,
        doc_title,
        completed_at,
        created_at,
        updated_at,
        review_log,
    });
}
```

(b) `upsert_task`（第 126-189 行）：

修改 INSERT：

```rust
tx.execute(
    r#"
    INSERT INTO tasks (
        id, title, description, status, priority, "order",
        doc_url, doc_title, color, completed_at, created_at, updated_at,
        review_log
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
    ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        status = excluded.status,
        priority = excluded.priority,
        "order" = excluded."order",
        doc_url = excluded.doc_url,
        doc_title = excluded.doc_title,
        color = excluded.color,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at,
        review_log = excluded.review_log
    "#,
    params![
        task.id,
        task.title,
        task.description,
        task.status.as_str(),
        task.priority.as_str(),
        task.order,
        task.doc_url,
        task.doc_title,
        task.color,
        task.completed_at,
        task.created_at,
        task.updated_at,
        task.review_log,
    ],
)
.map_err(to_err)?;
```

- [ ] **Step 4: Tauri 端编译检查**

Run: `cd src-tauri && cargo check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/models.rs src-tauri/src/commands.rs
git commit -m "feat(tauri): persist Task.reviewLog as JSON column"
```

---

## Task 11: 端到端手动验证

**Files:** 无（仅手动测试）

- [ ] **Step 1: 启动 web dev**

```bash
npm run dev
```

打开浏览器访问 `http://localhost:5173`（或 vite 实际给出的地址）。

- [ ] **Step 2: 准备测试数据**

在「任务管理」中新建若干任务，至少包括：

- 一个 todo 状态、scheduledDates 单日是昨天的任务（"过期未完成"）
- 一个 todo 状态、scheduledDates 单日是今天的任务（不应进入列表）
- 一个 todo 状态、scheduledDates 是 [昨天, 今天] 的多日任务（不应进入列表）
- 一个 done 状态、scheduledDates 单日是昨天的任务（不应进入列表）

如果直接生成数据麻烦，可以打开 DevTools Application → Local Storage 删除 `persistent-task:lastReviewPromptDate` 后重启验证自动弹窗逻辑；或在 DevTools Console 用 `useTaskStore.getState().updateTask(<id>, { scheduledDates: ['<过去日期>'] })` 把现有任务改成过期。

- [ ] **Step 3: 验证启动自动弹**

刷新页面 → 期待"待处理的过期任务"对话框自动弹出，仅包含上面构造的"过期 todo 单日"项。

- [ ] **Step 4: 验证三种动作**

- 点 ✓ → 任务从列表消失；切到该任务详情，确认 status=done 且 reviewLog 多了一条 `{action: "done"}`
- 点 ↻ → 二级原因对话框弹出，标题"今天继续：xxx"。填一个原因 → 确认 → 主列表行消失；任务 scheduledDates 变成 [原日期, ..., 今天] 全段
- 点 ⏸ → 二级对话框，留空原因 → 确认 → 行消失；任务 status=suspended，reviewLog 多一条无 reason 的记录

- [ ] **Step 5: 验证关闭重入**

主对话框中保留若干行，点"稍后再说"关闭。验证：

- 顶栏右上角出现 BellRing 图标 + 红点（数字 = 剩余条数）
- 点击图标 → 主对话框重新弹出，列表内容一致
- 处理完最后一条 → 主对话框自动关闭，顶栏图标消失

- [ ] **Step 6: 验证当天不重复自动弹**

主对话框关闭（不论已处理多少）后，刷新页面 → 不应再次自动弹出。手动点击顶栏图标可重开。

- [ ] **Step 7: 持久化验证**

刷新页面（在 web 端会触发 hydrate） → 任务的状态、scheduledDates、reviewLog 都正确保留。

如果有 Tauri 桌面环境：`npm run tauri:dev` 重复 step 2-7 的核心验证。

- [ ] **Step 8: Commit（如有调整）**

如果验证过程发现问题并修复，commit 修复。如无调整，跳过。

---

## Self-Review

**Spec coverage 检查：**

| Spec 要求 | 对应任务 |
|---|---|
| `reviewLog` 字段类型定义 | Task 1 |
| 触发条件 `isPastUnfinished` | Task 2 |
| `lastReviewPromptDate` localStorage | Task 2、Task 4 |
| 启动 + visibilitychange + 5 分钟定时器 | Task 8 |
| `reviewPastTask` 三种动作的副作用 | Task 3 |
| 「今天继续」填充原日期到今天 | Task 2、Task 3 |
| 列表对话框 + 行内三图标 | Task 6 |
| 二级原因输入对话框 | Task 5 |
| 顶栏图标 + 红点徽标 + 条数 | Task 7 |
| 列表为 0 时主对话框关闭 | Task 6 |
| 列表为 0 时顶栏图标隐藏 | Task 7 |
| 数据持久化（前后端 SQLite） | Task 9、Task 10 |
| 端到端验证 | Task 11 |

**Placeholder scan:** 无 TBD / TODO；所有"按当前文件为准"处只用于行号引用，代码内容完整。

**Type consistency:**
- `TaskReviewAction` = `"done" | "continue" | "suspend"` 在 Task 1 定义，Task 3 / Task 5 / Task 6 全部一致使用
- `reviewPastTask(id, action, reason?)` 签名在 Task 3 定义，Task 6 调用一致
- `isPastUnfinished(task, today)` 在 Task 2 定义，Task 6 / Task 7 / Task 8 调用一致
- `fillContinueDates` 在 Task 2 定义，Task 3 调用一致
- 前端 `Task.reviewLog?: TaskReviewEntry[]` 与后端 SQLite TEXT 列在 Task 9 / Task 10 通过 JSON.stringify ↔ JSON.parse 边界转换一致

---
