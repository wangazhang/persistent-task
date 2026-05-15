# 跨天任务排期 UX 优化 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用范围日期选择器 + 月视图拖拽，把"设置跨天任务"从 N 次点击降到 2 次点击。

**Architecture:** 三个独立切片：(1) 纯逻辑工具 + 单测；(2) 自定义日历范围 picker 组件，TaskEditor 集成；(3) MonthView 框选新建 + 色带边缘 resize。每片独立 commit。

**Tech Stack:** React 18 + TypeScript + zustand + dnd-kit + date-fns + Tailwind。复用项目现有 Modal/StatusPicker popover 模式。测试沿用 `npx tsx __xxx.test.ts` 路径（项目无 vitest）。

**Spec：** [docs/superpowers/specs/2026-05-14-cross-day-scheduling-ux-design.md](../specs/2026-05-14-cross-day-scheduling-ux-design.md)

---

## File Structure

| 文件 | 角色 | 切片 |
|------|------|------|
| `src/lib/dateRange.ts` | 纯函数：expandRange / isContiguous / getRange / preset* | 1 |
| `src/lib/__dateRange.test.ts` | 工具函数单测（tsx 直跑） | 1 |
| `src/components/ui/DateRangePicker.tsx` | 范围 picker 组件（触发器 + 弹层日历） | 2 |
| `src/components/task/TaskEditor.tsx` | 替换排期区域，加折叠区 | 2 |
| `src/routes/tasks/views/_monthDragRange.ts` | 框选/resize 纯计算函数 | 3 |
| `src/routes/tasks/views/__monthDragRange.test.ts` | 拖拽计算单测 | 3 |
| `src/routes/tasks/views/MonthView.tsx` | 接入框选层 + 快速新建气泡 | 3 |
| `src/routes/tasks/views/_TaskBar.tsx` | 加左/右 resize handle | 3 |
| `src/routes/tasks/views/_QuickCreateBubble.tsx` | 拖选完弹的小气泡组件 | 3 |

---

# 切片 1 · DateRange 工具函数

### Task 1.1：建立 dateRange 工具

**Files:**
- Create: `src/lib/dateRange.ts`

- [ ] **Step 1: 写工具函数**

```ts
// src/lib/dateRange.ts
import {
  addDays,
  differenceInCalendarDays,
  format,
  parseISO,
  startOfWeek,
} from "date-fns";

/**
 * 把起止 ISO 日期展开成连续 ISO 数组（含两端）。
 * 起点 > 终点时自动交换。
 */
export function expandRange(start: string, end: string): string[] {
  let s = parseISO(start);
  let e = parseISO(end);
  if (s.getTime() > e.getTime()) {
    [s, e] = [e, s];
  }
  const days = differenceInCalendarDays(e, s);
  const out: string[] = [];
  for (let i = 0; i <= days; i++) {
    out.push(format(addDays(s, i), "yyyy-MM-dd"));
  }
  return out;
}

/**
 * 判断 ISO 日期数组是否构成连续区间（任意排列）。
 * 空数组 / 单元素 → true。
 */
export function isContiguous(dates: string[]): boolean {
  if (dates.length <= 1) return true;
  const sorted = [...dates].sort();
  const start = parseISO(sorted[0]);
  for (let i = 1; i < sorted.length; i++) {
    const expected = format(addDays(start, i), "yyyy-MM-dd");
    if (sorted[i] !== expected) return false;
  }
  return true;
}

/** 取一组日期的 min/max；空数组返回 null。 */
export function getRange(
  dates: string[]
): { start: string; end: string } | null {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  return { start: sorted[0], end: sorted[sorted.length - 1] };
}

/** 预设：今天。 */
export function presetToday(): string[] {
  return [format(new Date(), "yyyy-MM-dd")];
}

/** 预设：明天。 */
export function presetTomorrow(): string[] {
  return [format(addDays(new Date(), 1), "yyyy-MM-dd")];
}

/** 预设：本周一 ~ 本周日（7 天）。 */
export function presetThisWeek(): string[] {
  const monday = startOfWeek(new Date(), { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) =>
    format(addDays(monday, i), "yyyy-MM-dd")
  );
}

/** 预设：下周一 ~ 下周日（7 天）。 */
export function presetNextWeek(): string[] {
  const nextMonday = addDays(
    startOfWeek(new Date(), { weekStartsOn: 1 }),
    7
  );
  return Array.from({ length: 7 }, (_, i) =>
    format(addDays(nextMonday, i), "yyyy-MM-dd")
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/dateRange.ts
git commit -m "feat(dateRange): expandRange / isContiguous / preset utils"
```

---

### Task 1.2：dateRange 单测

**Files:**
- Create: `src/lib/__dateRange.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/lib/__dateRange.test.ts
// 用法：npx tsx src/lib/__dateRange.test.ts
import {
  expandRange,
  isContiguous,
  getRange,
  presetToday,
  presetTomorrow,
  presetThisWeek,
  presetNextWeek,
} from "./dateRange";

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

// expandRange 基础
eq(
  "expandRange 4 天",
  expandRange("2026-05-11", "2026-05-14"),
  ["2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14"]
);

// expandRange 自动交换
eq(
  "expandRange 起 > 止 自动交换",
  expandRange("2026-05-14", "2026-05-11"),
  ["2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14"]
);

// expandRange 同一天
eq(
  "expandRange 同一天",
  expandRange("2026-05-11", "2026-05-11"),
  ["2026-05-11"]
);

// isContiguous
eq(
  "isContiguous 连续 true",
  isContiguous(["2026-05-11", "2026-05-12", "2026-05-13"]),
  true
);
eq(
  "isContiguous 不连续 false",
  isContiguous(["2026-05-11", "2026-05-13"]),
  false
);
eq("isContiguous 空 true", isContiguous([]), true);
eq("isContiguous 单元素 true", isContiguous(["2026-05-11"]), true);
eq(
  "isContiguous 乱序但连续",
  isContiguous(["2026-05-13", "2026-05-11", "2026-05-12"]),
  true
);

// getRange
eq("getRange 空 null", getRange([]), null);
eq(
  "getRange min/max",
  getRange(["2026-05-13", "2026-05-11", "2026-05-15"]),
  { start: "2026-05-11", end: "2026-05-15" }
);

// preset 长度
eq("presetToday 1 天", presetToday().length, 1);
eq("presetTomorrow 1 天", presetTomorrow().length, 1);
eq("presetThisWeek 7 天", presetThisWeek().length, 7);
eq("presetNextWeek 7 天", presetNextWeek().length, 7);

// preset 连续性
eq(
  "presetThisWeek 连续",
  isContiguous(presetThisWeek()),
  true
);
eq(
  "presetNextWeek 紧接 thisWeek",
  presetNextWeek()[0] >
    presetThisWeek()[presetThisWeek().length - 1],
  true
);

if (fail > 0) {
  console.log(`\n${fail} 项失败`);
  process.exit(1);
} else {
  console.log("\n全部通过");
}
```

- [ ] **Step 2: 跑测试**

Run: `npx tsx src/lib/__dateRange.test.ts`
Expected: `全部通过`

- [ ] **Step 3: 提交**

```bash
git add src/lib/__dateRange.test.ts
git commit -m "test(dateRange): expand/contiguous/preset coverage"
```

---

# 切片 2 · DateRangePicker 组件 + TaskEditor 集成

### Task 2.1：DateRangePicker 组件

**Files:**
- Create: `src/components/ui/DateRangePicker.tsx`

- [ ] **Step 1: 写组件**

```tsx
// src/components/ui/DateRangePicker.tsx
import { useEffect, useRef, useState } from "react";
import {
  addMonths,
  endOfMonth,
  format,
  getDay,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { zhCN } from "date-fns/locale";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  expandRange,
  getRange,
  isContiguous,
  presetNextWeek,
  presetThisWeek,
  presetToday,
  presetTomorrow,
} from "@/lib/dateRange";

interface Props {
  value: string[];
  onChange: (dates: string[]) => void;
  className?: string;
}

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

export function DateRangePicker({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  // 弹层中正在选择的"待定"区间。null = 还没开始新一轮选。
  const [pending, setPending] = useState<{ start: string; end: string | null } | null>(
    null
  );
  // 弹层翻页用的"当前显示月"（不影响 value）。
  const initialCursor = (() => {
    const r = getRange(value);
    return r ? parseISO(r.start) : new Date();
  })();
  const [cursor, setCursor] = useState<Date>(initialCursor);
  const containerRef = useRef<HTMLDivElement>(null);

  // 每次打开重置 pending 并把 cursor 对齐到当前 value
  useEffect(() => {
    if (open) {
      setPending(null);
      const r = getRange(value);
      if (r) setCursor(parseISO(r.start));
    }
  }, [open, value]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 触发器文案
  const range = getRange(value);
  const contiguous = isContiguous(value);
  const triggerLabel = (() => {
    if (!range) return "未排期";
    if (range.start === range.end) {
      return `${range.start}（周${WEEKDAY_LABELS[(getDay(parseISO(range.start)) + 6) % 7]}）`;
    }
    const days = value.length;
    const suffix = contiguous ? `（${days} 天）` : `（${days} 天 · 不连续）`;
    return `${range.start} → ${range.end}${suffix}`;
  })();

  function commitRange(start: string, end: string) {
    onChange(expandRange(start, end));
    setOpen(false);
    setPending(null);
  }

  function clickDay(iso: string) {
    if (!pending) {
      setPending({ start: iso, end: null });
      return;
    }
    if (pending.end === null) {
      // 第二点 = 终点
      commitRange(pending.start, iso);
      return;
    }
    // 已有完整待定 → 视为重新开始
    setPending({ start: iso, end: null });
  }

  function applyPreset(dates: string[]) {
    onChange(dates);
    setOpen(false);
    setPending(null);
  }
  function clearAll() {
    onChange([]);
    setOpen(false);
    setPending(null);
  }

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-xs transition-colors",
          range ? "text-ink-700 hover:border-brand-300" : "text-ink-400 hover:border-ink-300"
        )}
      >
        <CalendarIcon className="h-3.5 w-3.5" />
        <span>{triggerLabel}</span>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-[280px] rounded-lg border border-ink-200 bg-white p-3 shadow-card"
          style={{ top: "100%", left: 0 }}
        >
          {/* 月份导航 */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setCursor((d) => addMonths(d, -1))}
              className="rounded p-1 text-ink-500 hover:bg-ink-100"
              aria-label="上个月"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium text-ink-700">
              {format(cursor, "yyyy 年 M 月", { locale: zhCN })}
            </span>
            <button
              type="button"
              onClick={() => setCursor((d) => addMonths(d, 1))}
              className="rounded p-1 text-ink-500 hover:bg-ink-100"
              aria-label="下个月"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* 预设 chips */}
          <div className="mb-2 flex flex-wrap gap-1">
            <PresetChip label="今天" onClick={() => applyPreset(presetToday())} />
            <PresetChip label="明天" onClick={() => applyPreset(presetTomorrow())} />
            <PresetChip label="本周" onClick={() => applyPreset(presetThisWeek())} />
            <PresetChip label="下周" onClick={() => applyPreset(presetNextWeek())} />
            <PresetChip label="清空" onClick={clearAll} danger />
          </div>

          {/* 日历网格 */}
          <CalendarGrid
            cursor={cursor}
            value={value}
            pending={pending}
            onPick={clickDay}
          />

          <p className="mt-2 text-[11px] text-ink-400">
            {pending && pending.end === null ? "再点一天作为终点" : "点起点 → 点终点"}
          </p>
        </div>
      )}
    </div>
  );
}

function PresetChip({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-0.5 text-[11px] transition-colors",
        danger
          ? "text-rose-600 hover:bg-rose-50"
          : "bg-ink-100 text-ink-700 hover:bg-brand-100 hover:text-brand-700"
      )}
    >
      {label}
    </button>
  );
}

function CalendarGrid({
  cursor,
  value,
  pending,
  onPick,
}: {
  cursor: Date;
  value: string[];
  pending: { start: string; end: string | null } | null;
  onPick: (iso: string) => void;
}) {
  // 6 周 × 7 列网格，含上/下月延伸
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }
  const valueSet = new Set(value);
  const r = getRange(value);
  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] text-ink-400">
        {WEEKDAY_LABELS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((d) => {
          const iso = format(d, "yyyy-MM-dd");
          const inMonth =
            d >= monthStart && d <= monthEnd;
          const inValue = valueSet.has(iso);
          // 已选区间端点
          const isStart = r?.start === iso;
          const isEnd = r?.end === iso;
          // 待定起点
          const isPendingStart = pending?.start === iso;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onPick(iso)}
              className={cn(
                "h-7 rounded text-[11px] transition-colors",
                inMonth ? "text-ink-700" : "text-ink-300",
                isPendingStart
                  ? "bg-brand-600 font-semibold text-white"
                  : isStart || isEnd
                  ? "bg-brand-500 font-semibold text-white"
                  : inValue
                  ? "bg-brand-100 text-brand-700"
                  : "hover:bg-ink-100"
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add src/components/ui/DateRangePicker.tsx
git commit -m "feat(ui): DateRangePicker with calendar popover and presets"
```

---

### Task 2.2：TaskEditor 接入 picker + 进阶折叠

**Files:**
- Modify: `src/components/task/TaskEditor.tsx`

- [ ] **Step 1: 加导入**

在文件顶部 import 区追加：

```ts
import { ChevronDown, ChevronRight } from "lucide-react";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { isContiguous } from "@/lib/dateRange";
```

- [ ] **Step 2: 加折叠展开 state**

在 `const [newDate, setNewDate] = useState(...)` 这一行下面追加：

```ts
const [advancedOpen, setAdvancedOpen] = useState(false);
```

并在 `useEffect` 内 `setNewDate(...)` 之后追加：

```ts
// 不连续日期时自动展开进阶面板，避免用户感觉日期"消失了"
const initial = task ? task.scheduledDates : defaultDate ? [defaultDate] : [isoDate()];
setAdvancedOpen(initial.length > 1 && !isContiguous(initial));
```

- [ ] **Step 3: 替换排期日期 JSX**

把 `<div>` 块（`<label>排期日期...</label>` 那一段，TaskEditor.tsx 234-275 行）整段替换为：

```tsx
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-500">
            排期日期
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker
              value={scheduledDates}
              onChange={setScheduledDates}
            />
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="inline-flex items-center gap-0.5 text-[11px] text-ink-500 hover:text-ink-700"
            >
              {advancedOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              单独添加
            </button>
          </div>

          {advancedOpen && (
            <div className="mt-2 rounded-md border border-dashed border-ink-200 p-2">
              {scheduledDates.length > 1 && !isContiguous(scheduledDates) && (
                <p className="mb-1 text-[11px] text-ink-400">
                  当前日期不连续，建议在此精细管理
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {scheduledDates.map((d) => (
                  <span
                    key={d}
                    className="chip border border-brand-200 bg-brand-50 text-brand-700"
                  >
                    {d}
                    <button
                      type="button"
                      onClick={() => removeDate(d)}
                      className="ml-0.5 text-brand-500 hover:text-brand-700"
                    >
                      ✕
                    </button>
                  </span>
                ))}
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    className="input h-7 w-auto py-0 text-xs"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-secondary h-7 px-2 py-0 text-xs"
                    onClick={addDate}
                  >
                    添加
                  </button>
                </div>
              </div>
            </div>
          )}

          {status === "done" && scheduledDates.length === 0 && (
            <p className="mt-1 text-[11px] text-ink-400">
              已完成任务暂无排期；如需让其重新出现在某天列表，可在此添加日期
            </p>
          )}
        </div>
```

- [ ] **Step 4: 类型 + 构建检查**

Run: `npx tsc -b --noEmit`
Expected: 0 errors

- [ ] **Step 5: 人工 dogfood**

在 dev（`bri5hitgu`）里：
- 新建任务 → 点 picker → 点 5/11 → 点 5/14 → 触发器显示 `2026-05-11 → 2026-05-14（4 天）`
- 编辑该任务 → picker 显示同样区间，进阶折叠收起
- 展开折叠 → 删除中间一天 5/12 → picker 文案变为 `2026-05-11 → 2026-05-14（3 天 · 不连续）`，并停留在展开态
- 关闭弹层用 Esc 或点外部

- [ ] **Step 6: 提交**

```bash
git add src/components/task/TaskEditor.tsx
git commit -m "feat(editor): replace date chips with DateRangePicker + advanced fallback"
```

---

# 切片 3 · MonthView 拖拽交互

### Task 3.1：拖拽计算工具 + 测试

**Files:**
- Create: `src/routes/tasks/views/_monthDragRange.ts`
- Create: `src/routes/tasks/views/__monthDragRange.test.ts`

- [ ] **Step 1: 写工具**

```ts
// src/routes/tasks/views/_monthDragRange.ts
//
// 月视图拖拽相关纯计算函数：
//   - 框选新建：限同一周内
//   - 色带 resize：clamp 起止
//
// 这里只做日期算术，不耦合 React 事件 / DOM。

import { format, parseISO } from "date-fns";

/**
 * 同周框选：startISO 与 endISO 必须在同一周（约定周一为周首）。
 * 跨周时回退到 startISO 所在周的最右一天作为终点。
 *
 * 调用方负责传入"同周"的判断结果（cells 二维数组持有），
 * 这里只关注语义：起 > 止时交换；同周时直接用；不同周时退回。
 */
export interface RangeFromDrag {
  start: string;
  end: string;
  truncated: boolean; // 是否因跨周被裁剪
}

export function rangeFromDrag(
  startISO: string,
  endISO: string,
  weekEndOfStartISO: string
): RangeFromDrag {
  let s = startISO;
  let e = endISO;
  // 同周判断由 weekEndOfStartISO 隐含：endISO <= weekEndOfStartISO ⇔ 同周
  let truncated = false;
  if (e > weekEndOfStartISO) {
    e = weekEndOfStartISO;
    truncated = true;
  }
  // 起点理论上始终 ≤ 终点（拖拽时按方向给出），但为保险起见交换
  if (parseISO(s).getTime() > parseISO(e).getTime()) {
    [s, e] = [e, s];
  }
  return { start: s, end: e, truncated };
}

/**
 * Resize 色带：拖动 end 端点。
 * 拖到比 start 还早 → clamp 成单日（end = start）。
 */
export function clampResizeEnd(start: string, draftEnd: string): string {
  return parseISO(draftEnd).getTime() < parseISO(start).getTime()
    ? start
    : draftEnd;
}

/**
 * Resize 色带：拖动 start 端点。
 * 拖到比 end 还晚 → clamp 成单日（start = end）。
 */
export function clampResizeStart(draftStart: string, end: string): string {
  return parseISO(draftStart).getTime() > parseISO(end).getTime()
    ? end
    : draftStart;
}

/** 给定一组连续日期与新的起止，返回新的连续日期数组。 */
export function resizeContiguous(
  newStart: string,
  newEnd: string
): string[] {
  // 复用 expandRange 即可
  return expandRangeInline(newStart, newEnd);
}

/** 内联 expand 避免循环 import；与 lib/dateRange.expandRange 一致。 */
function expandRangeInline(start: string, end: string): string[] {
  let s = parseISO(start);
  let e = parseISO(end);
  if (s.getTime() > e.getTime()) [s, e] = [e, s];
  const out: string[] = [];
  for (let cur = new Date(s); cur <= e; cur.setDate(cur.getDate() + 1)) {
    out.push(format(cur, "yyyy-MM-dd"));
  }
  return out;
}
```

- [ ] **Step 2: 写测试**

```ts
// src/routes/tasks/views/__monthDragRange.test.ts
// 用法：npx tsx src/routes/tasks/views/__monthDragRange.test.ts
import {
  clampResizeEnd,
  clampResizeStart,
  rangeFromDrag,
  resizeContiguous,
} from "./_monthDragRange";

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

// 同周框选
eq(
  "同周 col2→col5",
  rangeFromDrag("2026-05-13", "2026-05-15", "2026-05-17"),
  { start: "2026-05-13", end: "2026-05-15", truncated: false }
);

// 跨周框选 → 截断到当周末
eq(
  "跨周回退",
  rangeFromDrag("2026-05-13", "2026-05-20", "2026-05-17"),
  { start: "2026-05-13", end: "2026-05-17", truncated: true }
);

// 起 > 止 → 交换
eq(
  "起>止 交换",
  rangeFromDrag("2026-05-15", "2026-05-13", "2026-05-17"),
  { start: "2026-05-13", end: "2026-05-15", truncated: false }
);

// resize end clamp
eq(
  "resizeEnd 拖到 start 之前 → clamp 成 start",
  clampResizeEnd("2026-05-12", "2026-05-10"),
  "2026-05-12"
);
eq(
  "resizeEnd 正常",
  clampResizeEnd("2026-05-12", "2026-05-15"),
  "2026-05-15"
);

// resize start clamp
eq(
  "resizeStart 拖到 end 之后 → clamp 成 end",
  clampResizeStart("2026-05-20", "2026-05-15"),
  "2026-05-15"
);

// resize 后展开
eq(
  "resizeContiguous 4 天",
  resizeContiguous("2026-05-11", "2026-05-14"),
  ["2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14"]
);

if (fail > 0) {
  console.log(`\n${fail} 项失败`);
  process.exit(1);
} else {
  console.log("\n全部通过");
}
```

- [ ] **Step 3: 跑测试**

Run: `npx tsx src/routes/tasks/views/__monthDragRange.test.ts`
Expected: `全部通过`

- [ ] **Step 4: 提交**

```bash
git add src/routes/tasks/views/_monthDragRange.ts src/routes/tasks/views/__monthDragRange.test.ts
git commit -m "feat(month): drag range pure utils + tests"
```

---

### Task 3.2：QuickCreateBubble 组件

**Files:**
- Create: `src/routes/tasks/views/_QuickCreateBubble.tsx`

- [ ] **Step 1: 写组件**

```tsx
// src/routes/tasks/views/_QuickCreateBubble.tsx
//
// 月视图拖选完成后浮在屏上的小气泡：
//   - 显示选中区间
//   - 一行 input：回车创建，Esc / 点外部取消
import { useEffect, useRef, useState } from "react";

interface Props {
  start: string;
  end: string;
  truncated: boolean;
  /** 屏幕坐标，气泡左上角 */
  x: number;
  y: number;
  onCreate: (title: string) => void;
  onCancel: () => void;
}

export function QuickCreateBubble({
  start,
  end,
  truncated,
  x,
  y,
  onCreate,
  onCancel,
}: Props) {
  const [title, setTitle] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onCancel();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onCancel]);

  const days = (() => {
    const a = new Date(start);
    const b = new Date(end);
    return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
  })();

  return (
    <div
      ref={ref}
      className="fixed z-50 w-[260px] rounded-lg border border-ink-200 bg-white p-2.5 shadow-card"
      style={{ left: x, top: y }}
    >
      <div className="mb-1.5 text-[11px] text-ink-500">
        {start === end ? start : `${start} → ${end}（${days} 天）`}
        {truncated && <span className="ml-1 text-amber-600">· 单次拖选限本周</span>}
      </div>
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && title.trim()) {
            onCreate(title.trim());
          }
        }}
        placeholder="快速新建任务（Enter 创建 · Esc 取消）"
        className="input w-full text-xs"
      />
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add src/routes/tasks/views/_QuickCreateBubble.tsx
git commit -m "feat(month): QuickCreateBubble for drag-to-create"
```

---

### Task 3.3：MonthView 接入框选层

**Files:**
- Modify: `src/routes/tasks/views/MonthView.tsx`

- [ ] **Step 1: 加导入**

文件顶部 import 区追加（与既有 dnd-kit / TaskBar 等并列）：

```ts
import { useDndContext } from "@dnd-kit/core";
import { rangeFromDrag } from "./_monthDragRange";
import { QuickCreateBubble } from "./_QuickCreateBubble";
import { useTaskStore } from "@/store/taskStore";
```

（`useTaskStore` 若已 import 则跳过。）

- [ ] **Step 2: 在 MonthView 主组件内加状态**

在 `MonthView` 组件函数体内（紧挨着已有的 `const [activeTask, setActiveTask] = useState<Task | null>(null);` 之类下方）追加：

```ts
// 框选状态：null = 未拖；记录起止 ISO + 鼠标抬起坐标供气泡定位
const [dragSel, setDragSel] = useState<
  | null
  | {
      startISO: string;
      currentISO: string;
      weekEndISO: string;
    }
>(null);
const [bubble, setBubble] = useState<
  | null
  | { start: string; end: string; truncated: boolean; x: number; y: number }
>(null);
const addTask = useTaskStore((s) => s.addTask);
```

- [ ] **Step 3: 给每个 weekRow 容器加鼠标事件**

把 `{Array.from({ length: 6 }, (_, weekRow) => { ... return ( <div key={weekRow} className="flex flex-col gap-1"> ...` 那一段（MonthView.tsx 175 行附近）的外层 div 改为：

```tsx
            <div
              key={weekRow}
              className="flex flex-col gap-1"
              onMouseDown={(e) => {
                // 只响应空白格鼠标按下；button 元素自己 stopPropagation
                const cell = (e.target as Element).closest("[data-cell-iso]");
                if (!cell) return;
                const iso = (cell as HTMLElement).dataset.cellIso!;
                const weekDaysISO = weekDays.map((d) => format(d, "yyyy-MM-dd"));
                const weekEndISO = weekDaysISO[weekDaysISO.length - 1];
                setDragSel({ startISO: iso, currentISO: iso, weekEndISO });
              }}
              onMouseMove={(e) => {
                if (!dragSel) return;
                const el = document
                  .elementFromPoint(e.clientX, e.clientY)
                  ?.closest("[data-cell-iso]") as HTMLElement | null;
                if (el && el.dataset.cellIso) {
                  setDragSel((prev) =>
                    prev ? { ...prev, currentISO: el.dataset.cellIso! } : prev
                  );
                }
              }}
              onMouseUp={(e) => {
                if (!dragSel) return;
                const r = rangeFromDrag(
                  dragSel.startISO,
                  dragSel.currentISO,
                  dragSel.weekEndISO
                );
                setDragSel(null);
                setBubble({
                  start: r.start,
                  end: r.end,
                  truncated: r.truncated,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
            >
```

- [ ] **Step 4: 在 DroppableDayCell 加 data-cell-iso + 拖选高亮**

打开 DroppableDayCell（MonthView.tsx 同文件下方），在它的最外层 div 上加：

```tsx
data-cell-iso={iso}
```

然后在 className 拼接里追加（在 `selected` 那一组之后）：

```tsx
,
// dragSelHighlight 由父级通过 prop 传入
dragHighlight && "ring-2 ring-brand-300"
```

并在 props 类型 + 函数签名加 `dragHighlight?: boolean`。父级渲染时计算：

```tsx
{weekDays.map((day) => {
  const dayISO = format(day, "yyyy-MM-dd");
  const inDrag =
    dragSel != null &&
    ((dayISO >= dragSel.startISO && dayISO <= dragSel.currentISO) ||
      (dayISO >= dragSel.currentISO && dayISO <= dragSel.startISO));
  return (
    <DroppableDayCell
      key={day.toISOString()}
      day={day}
      cursor={cursor}
      selectedISO={date}
      info={dayMap.get(dayISO)}
      maxScale={maxInMonth}
      onPick={onDateChange}
      coveredTaskIds={bars.coveredTaskIds}
      dragHighlight={inDrag}
    />
  );
})}
```

- [ ] **Step 5: 在 DndContext 拾起卡片时禁用框选**

在 MonthView 顶部加：

```ts
function PointerEventsGuard({ children }: { children: React.ReactNode }) {
  const { active } = useDndContext();
  return (
    <div className={active ? "pointer-events-none" : undefined}>
      {children}
    </div>
  );
}
```

把 6 周的网格外层包一层 `<PointerEventsGuard>`。这样 dnd-kit 拖卡片时框选层不响应。

- [ ] **Step 6: 渲染气泡**

在 `</DndContext>` 之前（return 语句的末尾区域）加：

```tsx
{bubble && (
  <QuickCreateBubble
    start={bubble.start}
    end={bubble.end}
    truncated={bubble.truncated}
    x={bubble.x}
    y={bubble.y}
    onCreate={(title) => {
      const dates = bubble.start === bubble.end
        ? [bubble.start]
        : (() => {
            const arr: string[] = [];
            for (
              let cur = new Date(bubble.start);
              cur <= new Date(bubble.end);
              cur.setDate(cur.getDate() + 1)
            ) {
              arr.push(format(cur, "yyyy-MM-dd"));
            }
            return arr;
          })();
      addTask({ title, scheduledDates: dates });
      setBubble(null);
    }}
    onCancel={() => setBubble(null)}
  />
)}
```

- [ ] **Step 7: 类型 + 构建**

Run: `npx tsc -b --noEmit`
Expected: 0 errors

- [ ] **Step 8: 人工 dogfood**

- 月视图在某周空白格按下鼠标，横拖 3 格放开 → 出小气泡
- 输入「OKR 草稿」回车 → 该周新出现一条 3 天色带
- 跨周拖：起点周一拖到下周三 → 气泡显示当周末日期 + "单次拖选限本周"
- 拖一张已有任务卡到日历格（dnd-kit）→ 框选不应被触发

- [ ] **Step 9: 提交**

```bash
git add src/routes/tasks/views/MonthView.tsx
git commit -m "feat(month): drag-select on empty cells to create cross-day task"
```

---

### Task 3.4：TaskBar 加 resize handle

**Files:**
- Modify: `src/routes/tasks/views/_TaskBar.tsx`
- Modify: `src/routes/tasks/views/MonthView.tsx`（透传 onResize）

- [ ] **Step 1: 改 TaskBar**

完整替换 `src/routes/tasks/views/_TaskBar.tsx` 文件内容为：

```tsx
// src/routes/tasks/views/_TaskBar.tsx
//
// 月视图中单条跨天任务色带。
//   - 颜色按状态
//   - 仅 isRunStart=true 时显示标题
//   - 圆角条件：左圆 ⇔ isRunStart，右圆 ⇔ isRunEnd
//   - 连续任务两端各 6px resize handle
//
// 单击 = onClick；双击 = onEdit；handle 拖动 = onResize。

import { useRef } from "react";
import type { Task, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { BarSegment } from "./_monthBars";
import { isContiguous } from "@/lib/dateRange";

const STATUS_BAR_CLASS: Record<TaskStatus, string> = {
  todo: "bg-sky-500 text-white",
  in_progress: "bg-warning-500 text-white",
  suspended: "bg-paused-400 text-white",
  done: "bg-ink-300 text-white line-through",
  archived: "bg-ink-200 text-ink-500",
};

const BAR_ROW_STEP_PX = 18;

interface TaskBarProps {
  segment: BarSegment;
  task: Task;
  onClick: () => void;
  onEdit?: (task: Task) => void;
  /** 拖 resize：返回新的 [start, end]（端点 ISO）。 */
  onResize?: (taskId: string, edge: "start" | "end", clientX: number) => void;
}

export function TaskBar({ segment, task, onClick, onEdit, onResize }: TaskBarProps) {
  const colorClass = STATUS_BAR_CLASS[task.status] ?? STATUS_BAR_CLASS.todo;
  const showHandles =
    !!onResize &&
    isContiguous(task.scheduledDates) &&
    task.scheduledDates.length > 0;
  const draggingEdge = useRef<null | "start" | "end">(null);

  function startDrag(edge: "start" | "end", e: React.MouseEvent) {
    if (!onResize) return;
    e.stopPropagation();
    e.preventDefault();
    draggingEdge.current = edge;
    function move(ev: MouseEvent) {
      if (!draggingEdge.current) return;
      onResize!(task.id, draggingEdge.current, ev.clientX);
    }
    function up() {
      draggingEdge.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  return (
    <div
      data-task-bar={task.id}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEdit?.(task);
      }}
      title={task.title}
      style={{
        gridRow: 1,
        gridColumn: `${segment.startCol + 1} / span ${segment.endCol - segment.startCol + 1}`,
        marginTop: segment.row * BAR_ROW_STEP_PX,
      }}
      className={cn(
        "group relative h-4 px-2 text-left text-[11px] leading-4 truncate transition-all cursor-pointer",
        "hover:shadow-md hover:-translate-y-px",
        colorClass,
        segment.isRunStart ? "rounded-l-md" : "rounded-l-none",
        segment.isRunEnd ? "rounded-r-md" : "rounded-r-none"
      )}
    >
      {segment.isRunStart && showHandles && (
        <span
          onMouseDown={(e) => startDrag("start", e)}
          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/60"
        />
      )}
      {segment.isRunStart ? task.title : " "}
      {segment.isRunEnd && showHandles && (
        <span
          onMouseDown={(e) => startDrag("end", e)}
          className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/60"
        />
      )}
    </div>
  );
}
```

注意：根元素从 `<button>` 改为 `<div>`，保留 `cursor-pointer`，避免 button 内嵌 button 报告 hydration warning。

- [ ] **Step 2: MonthView 接 onResize**

在 MonthView 内（addTask 之后）加：

```ts
const updateTask = useTaskStore((s) => s.updateTask);
const monthGridRef = useRef<HTMLDivElement>(null);

function handleBarResize(taskId: string, edge: "start" | "end", clientX: number) {
  const grid = monthGridRef.current;
  if (!grid) return;
  // 用 elementFromPoint 找到鼠标当前覆盖的 cell
  // clientY 取 grid 中线即可（resize 是水平向）
  const rect = grid.getBoundingClientRect();
  const probeY = rect.top + rect.height / 2;
  const cell = document
    .elementFromPoint(clientX, probeY)
    ?.closest("[data-cell-iso]") as HTMLElement | null;
  if (!cell?.dataset.cellIso) return;
  const targetISO = cell.dataset.cellIso;
  const t = taskById.get(taskId);
  if (!t || t.scheduledDates.length === 0) return;
  const sorted = [...t.scheduledDates].sort();
  const start = sorted[0];
  const end = sorted[sorted.length - 1];
  const newStart = edge === "start" ? (targetISO > end ? end : targetISO) : start;
  const newEnd = edge === "end" ? (targetISO < start ? start : targetISO) : end;
  // 重新展开为连续区间
  const arr: string[] = [];
  for (
    let cur = new Date(newStart);
    cur <= new Date(newEnd);
    cur.setDate(cur.getDate() + 1)
  ) {
    arr.push(format(cur, "yyyy-MM-dd"));
  }
  updateTask(taskId, { scheduledDates: arr });
}
```

把月历最外层的 `<div>` 加 `ref={monthGridRef}`（即包裹 6 个 weekRow 的容器）。

把每个 `<TaskBar ... />` 处加 prop：

```tsx
onResize={handleBarResize}
```

- [ ] **Step 3: 类型 + 构建**

Run: `npx tsc -b --noEmit`
Expected: 0 errors

- [ ] **Step 4: 人工 dogfood**

- 月视图悬停一条连续色带 → 两端浮现细白竖条
- 拖右端从 5/14 拖到 5/16 → 色带延伸到 5/16，TaskEditor 中能看到 6 天连续区间
- 拖左端越过右端 → clamp 成单日
- 不连续日期任务（用编辑器手动构造） → 色带不显示 handle

- [ ] **Step 5: 提交**

```bash
git add src/routes/tasks/views/_TaskBar.tsx src/routes/tasks/views/MonthView.tsx
git commit -m "feat(month): drag bar edges to resize cross-day range"
```

---

### Task 3.5：合并到主干

**Files:** 无文件改动

- [ ] **Step 1: 切换到 main worktree 合并**

```bash
cd /Users/qianzhang/Documents/03_work/06_yehu/02_project/123_persistent-task/src/persistent-task
git merge --ff-only persistent-task-icon
git log --oneline -8
```

Expected: fast-forward 成功，最近 8 条 commit 包含本次 7 个新 commit + spec/plan 文档。

---

## 自查

- **Spec 覆盖：**
  - § 1 DateRangePicker → Task 2.1
  - § 2 TaskEditor 集成 → Task 2.2
  - § 3 月视图框选 → Task 3.3；resize → Task 3.4
  - § 4 边界（clamp / 不连续不显示 handle / 跨周截断 / 时区字符串） → 散落在 1.1 / 3.1 / 3.4
  - § 5 测试 → Task 1.2、3.1
  - § 6 切片划分 → 与本计划三大节对齐
- **占位符扫描：** 无 TBD/TODO；每段代码均完整可粘贴。
- **类型一致性：** `expandRange` / `isContiguous` / `getRange` 在 Task 1.1 定义，2.1 / 2.2 引用一致；`rangeFromDrag` / `clampResize*` 在 3.1 定义，3.3 / 3.4 引用一致；`onResize` 签名 `(taskId, edge, clientX)` 在 TaskBar 与 MonthView 两处保持一致。

---
