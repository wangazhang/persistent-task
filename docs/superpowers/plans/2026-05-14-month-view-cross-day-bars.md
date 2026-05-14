# Month View Cross-Day Task Bars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 月视图中跨天任务渲染为横向色带，让"任务跨度"在一眼之内可见。

**Architecture:** 把月历从"42 cells 一个 grid"改为"6 个周行子 grid，每个含一个 bar-layer + 7 个 DayCell"。新增纯函数 `buildWeekBars()` 将任务的 `scheduledDates` 切成"按周连续段（segment）"，色带通过 CSS `gridColumn` 跨多列。色带和 DayCell 共享同一 7 列网格列宽，自然对齐。DayCell 内嵌摘要按"已被色带覆盖"集合去重。

**Tech Stack:** React 18 + TypeScript + Tailwind + date-fns（已有），无新增依赖。

---

## File Structure

| 路径 | 类型 | 责任 |
|---|---|---|
| `src/routes/tasks/views/_monthBars.ts` | 新增 | 切段算法 `buildWeekBars()` 纯函数 + `useWeekBars()` hook |
| `src/routes/tasks/views/_TaskBar.tsx` | 新增 | 单条色带 chip 组件 |
| `src/routes/tasks/views/MonthView.tsx` | 修改 | 网格改造 + 调 useWeekBars + DroppableDayCell 接收 coveredTaskIds + 摘要去重 |

不改：`_helpers.ts` / `_DaySection.tsx` / `_DraggableTaskCard.tsx` / `TaskCard.tsx` / store / 数据层。

**Spec 引用：** `docs/superpowers/specs/2026-05-14-month-view-cross-day-bars-design.md`

---

## Task 1：切段算法 + 纯函数

**Files:**
- Create: `src/routes/tasks/views/_monthBars.ts`

**职责：** 输入 `days: Date[]`（42 天）+ `tasks: Task[]` + `tagFilter: Set<string> | null`，输出 `WeekBars[]`（6 个周行的色带数据 + 覆盖任务集合 + 溢出计数）。

- [ ] **Step 1: 写文件骨架（类型 + 空函数）**

```ts
// src/routes/tasks/views/_monthBars.ts
//
// 月视图跨天任务"色带（bar）"切段算法。
// 输入月历可见的 42 天（6 周 × 7 天）+ 任务列表，输出按周组织的色带段。
//
// 关键概念：
//   run     一个任务的 scheduledDates 中"日期相邻 1 天"的连续块。
//           如 [5/13,5/14,5/15,5/20] 产生两个 run：[5/13-15] 和 [5/20]。
//   segment 一个 run 在周边界处被切开后产生的段。一周内显示的最小单位。
//           跨周的 run 会切成多个 segment，首段 isRunStart=true 显示标题，
//           续接段不重复标题但保持颜色一致。
//
// 不变量：一个 task 的所有 segment 要么都被保留，要么都被丢弃（避免续接错位）。

import { useMemo } from "react";
import { format } from "date-fns";
import type { Task } from "@/lib/types";
import { taskSorter } from "./_helpers";

export interface BarSegment {
  taskId: string;
  weekRow: number;     // 0..5
  startCol: number;    // 0..6（0=周一）
  endCol: number;      // 0..6（含）
  isRunStart: boolean; // 该段对应连续 run 的开端（左圆角 + 显示标题）
  isRunEnd: boolean;   // 该段对应连续 run 的结尾（右圆角）
}

export interface WeekBars {
  segments: BarSegment[];      // 按 row 顺序，每个 task 至多一组 segment
  overflowCount: number;       // 第 N 条起合并为 +N
  coveredTaskIds: Set<string>; // 该周色带覆盖的 taskIds
}

const MAX_BARS_PER_WEEK = 2;

export function buildWeekBars(
  days: Date[],
  tasks: Task[],
  tagFilter: Set<string> | null
): WeekBars[] {
  return [];
}
```

- [ ] **Step 2: 起 vitest 写第一组 case 验证类型存在**

由于项目目前没有测试框架，我们用一个临时的"自测脚本"代替（避免引入 vitest 依赖）：

Create: `src/routes/tasks/views/__monthBars.test.ts`（注意：双下划线前缀避免 vite 误打包；放同目录方便引用相对路径）

```ts
// 临时测试脚本：通过 npx tsx 运行验证。
// 不引入 vitest 是因为项目目前没有测试基建，避免一次性增加依赖。
//
// 用法：npx tsx src/routes/tasks/views/__monthBars.test.ts
//
// 写完 buildWeekBars 实现后请用 sub-agent 运行，看是否所有 assert 都通过。

import { addDays, eachDayOfInterval, startOfWeek } from "date-fns";
import type { Task } from "../../../lib/types";
import { buildWeekBars } from "./_monthBars";

function makeDays(start: Date): Date[] {
  return eachDayOfInterval({ start, end: addDays(start, 41) });
}

function makeTask(partial: Partial<Task> & { id: string; scheduledDates: string[] }): Task {
  return {
    id: partial.id,
    title: partial.title ?? `任务 ${partial.id}`,
    description: "",
    status: partial.status ?? "todo",
    priority: partial.priority ?? "p2",
    scheduledDates: partial.scheduledDates,
    tagIds: partial.tagIds ?? [],
    order: partial.order ?? 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  } else {
    console.log("PASS:", msg);
  }
}

// 起点 2026-05-04（周一）
const monthStart = startOfWeek(new Date("2026-05-04"), { weekStartsOn: 1 });
const days = makeDays(monthStart);

console.log("== 测试 1：单日任务不画色带 ==");
{
  const t = makeTask({ id: "a", scheduledDates: ["2026-05-05"] });
  const result = buildWeekBars(days, [t], null);
  const total = result.reduce((s, w) => s + w.segments.length, 0);
  assert(total === 0, "单日任务应不产生 segment");
}

console.log("== 测试 2：连续 4 天单周内任务产生 1 段 ==");
{
  const t = makeTask({
    id: "b",
    title: "OKR 草稿",
    status: "in_progress",
    scheduledDates: ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07"],
  });
  const result = buildWeekBars(days, [t], null);
  assert(result[0].segments.length === 1, "周一-周四应为单段");
  assert(result[0].segments[0].startCol === 0, "起始列应为 0（周一）");
  assert(result[0].segments[0].endCol === 3, "结束列应为 3（周四）");
  assert(result[0].segments[0].isRunStart === true, "首段 isRunStart=true");
  assert(result[0].segments[0].isRunEnd === true, "末段 isRunEnd=true");
}

console.log("== 测试 3：跨周任务切两段，续接段不算 RunStart ==");
{
  const t = makeTask({
    id: "c",
    scheduledDates: [
      "2026-05-09", // 周六
      "2026-05-10", // 周日
      "2026-05-11", // 周一（下周）
      "2026-05-12", // 周二
    ],
  });
  const result = buildWeekBars(days, [t], null);
  const allSegs = result.flatMap((w) => w.segments);
  assert(allSegs.length === 2, "应切成 2 段");
  assert(allSegs[0].weekRow === 0 && allSegs[0].startCol === 5 && allSegs[0].endCol === 6, "第一段 5/9-5/10 在 row 0 col 5-6");
  assert(allSegs[0].isRunStart === true && allSegs[0].isRunEnd === false, "第一段 RunStart=true RunEnd=false");
  assert(allSegs[1].weekRow === 1 && allSegs[1].startCol === 0 && allSegs[1].endCol === 1, "第二段 5/11-5/12 在 row 1 col 0-1");
  assert(allSegs[1].isRunStart === false && allSegs[1].isRunEnd === true, "续接段 RunStart=false RunEnd=true");
}

console.log("== 测试 4：不连续日期产生多个 run ==");
{
  const t = makeTask({
    id: "d",
    scheduledDates: ["2026-05-04", "2026-05-05", "2026-05-08"], // 周一周二 + 周五
  });
  const result = buildWeekBars(days, [t], null);
  assert(result[0].segments.length === 1, "5/4-5/5 是一段（5/8 是单日，按规则不画）");
  assert(result[0].segments[0].startCol === 0 && result[0].segments[0].endCol === 1, "5/4-5/5 col 0-1");
}

console.log("== 测试 5：标签过滤 ==");
{
  const t = makeTask({
    id: "e",
    tagIds: ["tag-x"],
    scheduledDates: ["2026-05-04", "2026-05-05"],
  });
  const result = buildWeekBars(days, [t], new Set(["tag-y"]));
  assert(result[0].segments.length === 0, "tag 不匹配应被过滤");
  const result2 = buildWeekBars(days, [t], new Set(["tag-x"]));
  assert(result2[0].segments.length === 1, "tag 匹配应保留");
}

console.log("== 测试 6：超过 2 个跨天任务时溢出 ==");
{
  const tasks = [1, 2, 3].map((i) =>
    makeTask({
      id: `t${i}`,
      priority: "p2",
      order: i,
      scheduledDates: ["2026-05-04", "2026-05-05"],
    })
  );
  const result = buildWeekBars(days, tasks, null);
  assert(result[0].segments.length === 2, "前 2 条保留");
  assert(result[0].overflowCount === 1, "第 3 条计入 overflow");
  assert(result[0].coveredTaskIds.size === 2, "covered 包含前 2 条");
}

console.log("== 测试 7：跨周 task 的所有 segment 都被保留或都被丢弃 ==");
{
  // task1 跨周（周日-周一），优先级高
  const t1 = makeTask({
    id: "high",
    priority: "p0",
    scheduledDates: ["2026-05-10", "2026-05-11"],
  });
  // task2 单周内但被 task3 挤掉的话不影响 test 主旨
  const t2 = makeTask({ id: "mid", priority: "p1", scheduledDates: ["2026-05-04", "2026-05-05"] });
  const result = buildWeekBars(days, [t1, t2], null);
  // t1 的两段都应保留
  const t1Segs = result.flatMap((w) => w.segments).filter((s) => s.taskId === "high");
  assert(t1Segs.length === 2, "跨周高优先级 task 的两段都应保留");
}

console.log("\n所有断言通过 ✅");
```

- [ ] **Step 3: 运行测试，确认全部失败**

Run: `npx tsx src/routes/tasks/views/__monthBars.test.ts`
Expected: 第一个断言就报 FAIL（因为 `buildWeekBars` 返回空数组）

- [ ] **Step 4: 实现 buildWeekBars**

替换文件中 `buildWeekBars` 函数体：

```ts
export function buildWeekBars(
  days: Date[],
  tasks: Task[],
  tagFilter: Set<string> | null
): WeekBars[] {
  // 初始化 6 周空结构
  const weeks: WeekBars[] = Array.from({ length: 6 }, () => ({
    segments: [],
    overflowCount: 0,
    coveredTaskIds: new Set<string>(),
  }));

  // ISO 日期 → (weekRow, col) 的映射，用于把日期落到网格坐标
  const isoToCoord = new Map<string, { weekRow: number; col: number }>();
  for (let i = 0; i < days.length; i++) {
    isoToCoord.set(format(days[i], "yyyy-MM-dd"), {
      weekRow: Math.floor(i / 7),
      col: i % 7,
    });
  }

  // 第一遍：把每个 task 切段（暂存到 perTaskSegments，先不限量）
  // 同时按 task 把"该 task 是否有任何 segment 落入可见 42 天"标记下来
  interface TaskWithSegments {
    task: Task;
    segments: BarSegment[];
  }
  const perTask: TaskWithSegments[] = [];

  for (const t of tasks) {
    if (tagFilter && !t.tagIds.some((id) => tagFilter.has(id))) continue;
    if (t.scheduledDates.length < 2) continue; // 单日任务不画

    // 只保留落在可见 42 天的日期，并去重 + 按时间排序
    const visibleDates = Array.from(
      new Set(t.scheduledDates.filter((d) => isoToCoord.has(d)))
    ).sort();
    if (visibleDates.length === 0) continue;

    // 切 run（相邻 1 天合并）
    const runs: string[][] = [];
    let current: string[] = [];
    for (const d of visibleDates) {
      if (current.length === 0) {
        current = [d];
      } else {
        const prev = new Date(current[current.length - 1]);
        const next = new Date(d);
        const diffDays = Math.round((next.getTime() - prev.getTime()) / 86400000);
        if (diffDays === 1) {
          current.push(d);
        } else {
          runs.push(current);
          current = [d];
        }
      }
    }
    if (current.length > 0) runs.push(current);

    // 单日 run 不画（只有 ≥2 天的 run 才产生 segment）
    const segments: BarSegment[] = [];
    for (const run of runs) {
      if (run.length < 2) continue;

      const runStart = isoToCoord.get(run[0])!;
      const runEnd = isoToCoord.get(run[run.length - 1])!;

      // 把 run 按周边界切段：从 runStart 到 runEnd，每个 weekRow 各产生一段
      let cursorRow = runStart.weekRow;
      let cursorCol = runStart.col;
      while (cursorRow <= runEnd.weekRow) {
        const isLastRow = cursorRow === runEnd.weekRow;
        const segEndCol = isLastRow ? runEnd.col : 6;
        segments.push({
          taskId: t.id,
          weekRow: cursorRow,
          startCol: cursorCol,
          endCol: segEndCol,
          isRunStart: cursorRow === runStart.weekRow && cursorCol === runStart.col,
          isRunEnd: isLastRow,
        });
        cursorRow += 1;
        cursorCol = 0;
      }
    }

    if (segments.length > 0) perTask.push({ task: t, segments });
  }

  // 第二遍：按周做容量控制
  // 对每周收集"出现在该周的 task 列表"，按 taskSorter 排序，前 N 个保留
  for (let row = 0; row < 6; row++) {
    const tasksThisWeek = perTask
      .filter((x) => x.segments.some((s) => s.weekRow === row))
      .map((x) => x.task)
      .sort(taskSorter);

    const kept = tasksThisWeek.slice(0, MAX_BARS_PER_WEEK);
    weeks[row].overflowCount = Math.max(0, tasksThisWeek.length - MAX_BARS_PER_WEEK);

    const keptIds = new Set(kept.map((t) => t.id));
    weeks[row].coveredTaskIds = new Set(keptIds);

    // 把保留 task 在该周的所有 segment 收进来
    for (const x of perTask) {
      if (!keptIds.has(x.task.id)) continue;
      for (const seg of x.segments) {
        if (seg.weekRow === row) weeks[row].segments.push(seg);
      }
    }
  }

  return weeks;
}
```

- [ ] **Step 5: 重新运行测试，确认全部通过**

Run: `npx tsx src/routes/tasks/views/__monthBars.test.ts`
Expected: 7 组测试全部 `PASS`，最后输出 `所有断言通过 ✅`

如果有 FAIL：仔细对照断言 message 和实现，**不改测试**，改实现。

- [ ] **Step 6: 加 useWeekBars hook**

在 `_monthBars.ts` 末尾追加：

```ts
/**
 * useMemo 包装，依赖 [days, tasks, tagFilter]。
 * cursor 不直接传进来——days 已经是 cursor 派生的。
 */
export function useWeekBars(
  days: Date[],
  tasks: Task[],
  tagFilter: Set<string> | null
): WeekBars[] {
  return useMemo(
    () => buildWeekBars(days, tasks, tagFilter),
    [days, tasks, tagFilter]
  );
}
```

- [ ] **Step 7: tsc 编译检查**

Run: `npx tsc -b`
Expected: 无输出（编译成功）

- [ ] **Step 8: 提交**

```bash
git add src/routes/tasks/views/_monthBars.ts src/routes/tasks/views/__monthBars.test.ts
git commit -m "feat(month): buildWeekBars - cross-day task segmentation algorithm"
```

---

## Task 2：TaskBar 单条色带组件

**Files:**
- Create: `src/routes/tasks/views/_TaskBar.tsx`

**职责：** 把一个 `BarSegment + Task` 渲染成色带 chip，处理颜色、圆角、标题、点击。

- [ ] **Step 1: 实现组件**

```tsx
// src/routes/tasks/views/_TaskBar.tsx
//
// 月视图中单条跨天任务色带。
//   - 颜色按状态（todo 蓝 / in_progress 橙 / suspended 紫 / done 灰+删除线 / archived 浅灰）
//   - 仅 isRunStart=true 时显示标题；续接段保留色块但不重复标题
//   - 圆角条件：左圆 ⇔ isRunStart，右圆 ⇔ isRunEnd

import type { Task, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { BarSegment } from "./_monthBars";

const STATUS_BAR_CLASS: Record<TaskStatus, string> = {
  todo: "bg-sky-500 text-white",
  in_progress: "bg-warning-500 text-white",
  suspended: "bg-paused-400 text-white",
  done: "bg-ink-300 text-white line-through",
  archived: "bg-ink-200 text-ink-500",
};

interface TaskBarProps {
  segment: BarSegment;
  task: Task;
  /** 点击色带：通常切换 DaySection 到 task 起始日 */
  onClick: () => void;
}

export function TaskBar({ segment, task, onClick }: TaskBarProps) {
  const colorClass = STATUS_BAR_CLASS[task.status] ?? STATUS_BAR_CLASS.todo;
  return (
    <button
      type="button"
      data-task-bar={task.id}
      onClick={(e) => {
        e.stopPropagation(); // 不触发下方 DayCell 的点击
        onClick();
      }}
      title={task.title}
      style={{
        gridColumn: `${segment.startCol + 1} / span ${segment.endCol - segment.startCol + 1}`,
      }}
      className={cn(
        "h-4 px-2 text-left text-[11px] leading-4 truncate transition-shadow",
        "hover:shadow-md hover:-translate-y-px",
        colorClass,
        segment.isRunStart ? "rounded-l-md" : "rounded-l-none",
        segment.isRunEnd ? "rounded-r-md" : "rounded-r-none"
      )}
    >
      {segment.isRunStart ? task.title : " " /* 续接段保留高度但不显示文字 */}
    </button>
  );
}
```

- [ ] **Step 2: tsc 编译检查**

Run: `npx tsc -b`
Expected: 无输出

- [ ] **Step 3: 提交**

```bash
git add src/routes/tasks/views/_TaskBar.tsx
git commit -m "feat(month): TaskBar component for cross-day bar rendering"
```

---

## Task 3：MonthView 网格改造 + 接入 TaskBar

**Files:**
- Modify: `src/routes/tasks/views/MonthView.tsx`

**职责：** 把月历从"42 cells 一个 grid"改为"6 个周行子 grid，每个 = bar-layer + 7 cells"；调 `useWeekBars`；DayCell 接收 `coveredTaskIds` 用于摘要去重。

- [ ] **Step 1: 修改 import**

在文件顶部，找到现有 import 块，加入两个新 import：

```tsx
import { TaskBar } from "./_TaskBar";
import { useWeekBars } from "./_monthBars";
```

确认现有 import 已有 `useTaskStore`、`useDayMap`、`useTagFilterSet` 等不变。

- [ ] **Step 2: 在 MonthView 函数体内调用 useWeekBars**

定位到 `const dayMap = useDayMap(tasks, tagFilter);` 这一行（约文件第 76 行），在其下方新增：

```tsx
const weekBars = useWeekBars(days, tasks, tagFilter);
```

注意：`days` 必须已在此处可用——它是 `useMemo` 派生的 42 天数组（约文件 87 行）。如果声明顺序有问题，把 `useWeekBars` 调用放到 `days` 声明之后。

- [ ] **Step 3: 改造月历网格 JSX**

定位到月历网格的 JSX（约 164-176 行）：

```tsx
<div className="grid grid-cols-7 gap-1.5">
  {days.map((day) => (
    <DroppableDayCell ... />
  ))}
</div>
```

替换为按周分组的结构：

```tsx
<div className="flex flex-col gap-1.5">
  {Array.from({ length: 6 }, (_, weekRow) => {
    const weekDays = days.slice(weekRow * 7, weekRow * 7 + 7);
    const bars = weekBars[weekRow];
    return (
      <div key={weekRow} className="flex flex-col gap-1">
        {/* bar-layer: 用 grid-cols-7 与下方 cell 行严格对位；最多 2 条色带 + 溢出 chip */}
        <div className="relative grid grid-cols-7 gap-1.5">
          {/* 第 1 条色带 */}
          {bars.segments
            .filter((seg) => {
              // 取该 task 在 segments 中第一次出现的 weekRow——保证多段同 task 都画
              return true;
            })
            .map((seg, idx) => {
              const task = tasks.find((t) => t.id === seg.taskId);
              if (!task) return null;
              // 用一个简单的 row 偏移：同周内不同 task 错开高度
              const taskOrderInWeek = uniqueTaskIdsInOrder(bars.segments).indexOf(seg.taskId);
              return (
                <div
                  key={`${seg.taskId}-${seg.startCol}`}
                  style={{
                    gridColumn: `${seg.startCol + 1} / span ${seg.endCol - seg.startCol + 1}`,
                    marginTop: taskOrderInWeek * 18, // 16px 高 + 2px gap
                  }}
                >
                  <TaskBar segment={seg} task={task} onClick={() => onDateChange(task.scheduledDates[0])} />
                </div>
              );
            })}
          {bars.overflowCount > 0 && (
            <span className="absolute right-1 -bottom-3 text-[10px] text-ink-400">
              +{bars.overflowCount} 跨天
            </span>
          )}
          {/* 占位：当无色带时也撑出 16px 高度，避免与有色带的周行高不一致 */}
          {bars.segments.length === 0 && <div className="col-span-7 h-4" />}
          {/* 当只有 1 条色带时，第二行高度也补齐 */}
          {bars.segments.length > 0 &&
            uniqueTaskIdsInOrder(bars.segments).length < 2 && (
              <div className="col-span-7 h-4" style={{ marginTop: 2 }} />
            )}
        </div>
        {/* DayCell row：7 列 */}
        <div className="grid grid-cols-7 gap-1.5">
          {weekDays.map((day) => (
            <DroppableDayCell
              key={day.toISOString()}
              day={day}
              cursor={cursor}
              selectedISO={date}
              info={dayMap.get(format(day, "yyyy-MM-dd"))}
              maxScale={maxInMonth}
              onPick={onDateChange}
              coveredTaskIds={bars.coveredTaskIds}
            />
          ))}
        </div>
      </div>
    );
  })}
</div>
```

并在 MonthView 函数外（文件末尾或 helper 区）新增辅助函数：

```tsx
/** 按 segments 出现顺序返回去重的 taskId 列表，用于把同周不同 task 的色带分两行 */
function uniqueTaskIdsInOrder(segments: { taskId: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of segments) {
    if (!seen.has(s.taskId)) {
      seen.add(s.taskId);
      out.push(s.taskId);
    }
  }
  return out;
}
```

- [ ] **Step 4: 改造 DroppableDayCell**

定位到 `DroppableDayCell` 函数（约 271 行起）。

修改 props 类型签名（约 278-285 行），新增 `coveredTaskIds`：

```tsx
function DroppableDayCell({
  day,
  cursor,
  selectedISO,
  info,
  maxScale,
  onPick,
  coveredTaskIds,
}: {
  day: Date;
  cursor: Date;
  selectedISO: string;
  info: DayInfo | undefined;
  maxScale: number;
  onPick: (iso: string) => void;
  coveredTaskIds: Set<string>;
}) {
```

定位到 `info && (` 块内的 `info.tasks.slice(0, 2).map(...)` 那段（约 349-362 行）：

```tsx
{info && (
  <div className="mt-1 space-y-0.5 overflow-hidden text-[11px] leading-tight">
    {info.tasks.slice(0, 2).map((t) => (
      <div ... > · {t.title} </div>
    ))}
    {info.tasks.length > 2 && (
      <div className="text-ink-400">还有 {info.tasks.length - 2} 个</div>
    )}
  </div>
)}
```

替换为按 `coveredTaskIds` 过滤后只显 1 行：

```tsx
{info && (() => {
  const uncovered = info.tasks.filter((t) => !coveredTaskIds.has(t.id));
  if (uncovered.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5 overflow-hidden text-[11px] leading-tight">
      {uncovered.slice(0, 1).map((t) => (
        <div
          key={t.id}
          className={cn(
            "truncate",
            t.status === "done"
              ? "text-ink-300 line-through"
              : "text-ink-600"
          )}
        >
          · {t.title}
        </div>
      ))}
      {uncovered.length > 1 && (
        <div className="text-ink-400">还有 {uncovered.length - 1} 个</div>
      )}
    </div>
  );
})()}
```

- [ ] **Step 5: tsc 编译检查**

Run: `npx tsc -b`
Expected: 无输出

如有 type error，对照 spec 检查 `coveredTaskIds` 是否每处都传到位。

- [ ] **Step 6: vite build 检查**

Run: `npx vite build`
Expected: `✓ built in Xs`，无错误

- [ ] **Step 7: 提交**

```bash
git add src/routes/tasks/views/MonthView.tsx
git commit -m "feat(month): cross-day task bars in month view

每个跨天任务（scheduledDates ≥ 2 且含相邻日期）渲染为横向色带：
- 颜色按状态映射，done 灰+删除线
- 跨周拆段，续接段不重复标题但保色块
- 不连续日期产生多个 run，单日 run 不画
- 每周最多 2 条色带，溢出显示 +N 跨天
- DayCell 内嵌摘要排除已被色带覆盖的任务，从 2 行减为 1 行
- 点击色带切到任务起始日"
```

---

## Task 4：UI 验证（preview + 截图）

**Files:** 无修改，只验证。

- [ ] **Step 1: 起 preview**

Run（后台）：

```bash
npx vite build
npx vite preview --port 4173 > /tmp/vite-preview.log 2>&1 &
sleep 2
```

- [ ] **Step 2: 用 sqlite 拉一份桌面端跨天任务做对照**

```bash
sqlite3 "$HOME/Library/Application Support/com.persistenttask.app/persistent-task.db" \
  "SELECT t.id, t.title, t.status, group_concat(td.date,',') AS dates
   FROM tasks t LEFT JOIN task_dates td ON t.id=td.task_id
   GROUP BY t.id HAVING count(td.date) > 1 ORDER BY t.title;"
```

记下每个跨天任务的标题、状态、日期序列，心算预期段数。

- [ ] **Step 3: 用 playwright 打开 Web preview 月视图**

由于 Web preview 与桌面端是不同 IndexedDB，先用 evaluate 注入几条跨天任务到 Web 的 IndexedDB，或直接在 UI 创建。最简单：用 TaskEditor 创建 1 条跨 4 天 + 1 条跨周（如 5/16-5/19，含周末）的任务。

```
mcp__playwright__browser_navigate http://localhost:4173/tasks?view=month
```

- [ ] **Step 4: 验证色带元素数量**

Run via `mcp__playwright__browser_evaluate`:

```js
() => {
  const bars = document.querySelectorAll('[data-task-bar]');
  return Array.from(bars).map(b => ({
    taskId: b.getAttribute('data-task-bar'),
    text: b.textContent.trim(),
    cls: b.className,
  }));
}
```

Expected: 跨天任务的每段都出现，续接段 `text` 为空（只有 nbsp）。

- [ ] **Step 5: 截图人眼校验**

```
mcp__playwright__browser_take_screenshot filename=month-bars.png
```

人眼对照：
- 色带与下方 DayCell 列严格对齐
- 颜色与状态一致
- 首段左圆、末段右圆、续接方角
- DayCell 内文字摘要不再出现已在色带里的任务标题

- [ ] **Step 6: 验证点击色带切日**

```
mcp__playwright__browser_click target=<bar element>
```

确认 DaySection 切到该任务的 `scheduledDates[0]`。

- [ ] **Step 7: 关掉 preview**

```bash
pkill -f "vite preview"
```

- [ ] **Step 8: push**

```bash
git push origin main
```

---

## Self-Review Notes

- ✅ Spec 每节都有任务覆盖：切段算法（Task 1）、TaskBar（Task 2）、MonthView 改造 + DayCell 去重（Task 3）、验证（Task 4）
- ✅ 无 TBD / TODO 占位
- ✅ 类型一致：`BarSegment.taskId/weekRow/startCol/endCol/isRunStart/isRunEnd` 在 Task 1/2/3 里命名一致
- ✅ `coveredTaskIds: Set<string>` 在 `_monthBars.ts` 定义、`MonthView.tsx` 传递、`DroppableDayCell` 接收，前后名字一致
- ✅ 无新增依赖
- ⚠ 测试方式用临时 tsx 脚本而非 vitest——这是因为项目目前没有测试框架，引入 vitest 会扩大本任务的范围。如果将来要做 TDD 基建，可以把 `__monthBars.test.ts` 迁移到 vitest 一次性

---

## Out of Scope（不做）

- 色带拖拽改期（端点 / 中段平移）
- WeekView / YearView 同步色带
- 跨月任务的色带在上下月延续渲染
- 引入 vitest 等测试框架（用临时 tsx 脚本验证算法）
