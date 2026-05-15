# 双击日期弹任务浮窗 + 拖拽改期 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 月/周/年视图双击日期 → 浮窗显示当天任务，浮窗内任务卡可拖到本视图任意日期格上完成移动 / 复制 / 替换。

**Architecture:** 复用现有 `TaskCard` + `DraggableTaskCard` + dnd-kit + `moveSchedule`。新增一个 portal 浮窗组件 `_DayTasksPopover`。年视图本来不在 dnd-kit 体系内，需补 DndContext + drop target。

**Tech Stack:** React 18 + TS + dnd-kit + Tailwind + date-fns。沿用 MonthView 的 mode 状态机和 `modeFromEvent` helper。

**Spec：** [docs/superpowers/specs/2026-05-15-day-tasks-popover-design.md](../specs/2026-05-15-day-tasks-popover-design.md)

---

## File Structure

| 文件 | 角色 | 切片 |
|------|------|------|
| `src/routes/tasks/views/_DayTasksPopover.tsx` | 浮窗：portal + 定位 + 列表 + 空状态 | 1 |
| `src/routes/tasks/views/MonthView.tsx` | 双击格子 → 开浮窗，关闭时清状态 | 2 |
| `src/routes/tasks/views/WeekView.tsx` | 双击日期标识按钮 → 开浮窗 | 2 |
| `src/routes/tasks/views/YearView.tsx` | 双击日格 → 开浮窗；并补 DndContext + droppable + mode | 3 |

---

# 切片 1 · DayTasksPopover 组件

### Task 1.1：组件骨架（不含拖动）

**Files:**
- Create: `src/routes/tasks/views/_DayTasksPopover.tsx`

- [ ] **Step 1: 创建文件**

EXACT 内容：

```tsx
// src/routes/tasks/views/_DayTasksPopover.tsx
//
// 双击月/周/年视图的某一天弹出此浮窗：
//   - portal 挂 body，避免被父 overflow 截断
//   - 显示当天任务列表（用 DraggableTaskCard 复用拖拽 + 单击/双击/右键菜单）
//   - 拖动期间整窗 opacity-30 pointer-events-none，让用户看清下方目标格
//   - 关闭：Esc / 点浮窗外 / 拖动成功
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { format, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";
import { X, Plus } from "lucide-react";
import { useDndContext } from "@dnd-kit/core";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DraggableTaskCard } from "./_DraggableTaskCard";

interface Props {
  iso: string;
  tasks: Task[];
  /** 触发器格子的屏幕矩形，用来定位 */
  anchor: DOMRect;
  onClose: () => void;
  onEdit: (t: Task) => void;
  onStartPomodoro?: (t: Task) => void;
  onNewTask?: (iso: string) => void;
}

const POP_W = 320;
const POP_MAX_H = 440;

export function DayTasksPopover({
  iso,
  tasks,
  anchor,
  onClose,
  onEdit,
  onStartPomodoro,
  onNewTask,
}: Props) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const { active } = useDndContext();
  const dragging = !!active;

  // 定位：默认 anchor 右下；越界翻转
  useLayoutEffect(() => {
    function place() {
      const m = 8;
      // 默认右下
      let left = anchor.right + m;
      let top = anchor.top;
      if (left + POP_W > window.innerWidth - m) {
        // 翻到左侧
        left = Math.max(m, anchor.left - POP_W - m);
      }
      if (top + POP_MAX_H > window.innerHeight - m) {
        top = Math.max(m, window.innerHeight - POP_MAX_H - m);
      }
      setPos({ top, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  // Esc + 点外部关闭（拖动期间不响应外部点击，避免误关）
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !dragging) onClose();
    }
    function onMouseDown(e: MouseEvent) {
      if (dragging) return;
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [dragging, onClose]);

  if (!pos) return null;

  const day = parseISO(iso);
  const weekday = format(day, "EEEE", { locale: zhCN });
  const dateLabel = format(day, "yyyy-MM-dd");

  return createPortal(
    <div
      ref={popRef}
      className={cn(
        "fixed z-[60] flex flex-col rounded-xl border border-ink-200 bg-white shadow-xl transition-opacity",
        dragging ? "pointer-events-none opacity-30" : "opacity-100"
      )}
      style={{
        top: pos.top,
        left: pos.left,
        width: POP_W,
        maxHeight: POP_MAX_H,
      }}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between gap-2 border-b border-ink-200/70 px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-ink-800">{dateLabel}</span>
          <span className="text-[11px] text-ink-400">{weekday}</span>
          <span className="text-[11px] text-ink-400">· {tasks.length} 项</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-ink-400">
            拖动:移动 · ⌥拖:复制 · ⇧拖:替换
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            aria-label="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto p-2">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6">
            <p className="text-xs text-ink-400">这天没有任务</p>
            {onNewTask && (
              <button
                type="button"
                onClick={() => onNewTask(iso)}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-ink-300 px-2.5 py-1 text-xs text-ink-500 hover:border-brand-400 hover:text-brand-600"
              >
                <Plus className="h-3 w-3" /> 新建任务
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            {tasks.map((t) => (
              <DraggableTaskCard
                key={t.id}
                task={t}
                fromDate={iso}
                onEdit={onEdit}
                onStartPomodoro={onStartPomodoro ?? (() => {})}
              />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
```

- [ ] **Step 2: 类型检查**

```bash
cd /Users/qianzhang/Documents/03_work/06_yehu/02_project/123_persistent-task/src/persistent-task-icon
npx tsc -b --noEmit
```

预期：仅遗留 TS6310（tsconfig.node.json）。无新错误。

- [ ] **Step 3: 提交**

```bash
git add src/routes/tasks/views/_DayTasksPopover.tsx
git commit -m "feat(views): DayTasksPopover with portal + dnd-aware fade"
```

## Context

仓库：`/Users/qianzhang/Documents/03_work/06_yehu/02_project/123_persistent-task/src/persistent-task-icon`
分支：`persistent-task-icon`

`DraggableTaskCard` 已存在（`./_DraggableTaskCard`），data 形如 `{ type:"task", taskId, fromDate }`，刚好对接现有 handleDragEnd。`useDndContext` 用来读取当前是否有 active drag，控制浮窗淡出。

---

# 切片 2 · 月视图 / 周视图触发

### Task 2.1：MonthView 双击格子开浮窗

**Files:**
- Modify: `src/routes/tasks/views/MonthView.tsx`

- [ ] **Step 1: 加 import**

确保已 import 以下（按需追加）：

```ts
import { DayTasksPopover } from "./_DayTasksPopover";
```

- [ ] **Step 2: 在 MonthView 函数体内加 popover state**

紧挨已有的 `const [bubble, setBubble] = useState<...>(null);` 下方追加：

```ts
  const [popover, setPopover] = useState<
    | null
    | { iso: string; rect: DOMRect }
  >(null);
```

- [ ] **Step 3: 给 DroppableDayCell 加 onDoubleClick**

DroppableDayCell 内部那个覆盖整格的 button（`<button onClick={() => onPick(iso)}>`）追加 `onDoubleClick`，并把回调传进去。

修改 props（DroppableDayCell 的类型 + 解构）：

```ts
}: {
  day: Date;
  cursor: Date;
  selectedISO: string;
  info: DayInfo | undefined;
  maxScale: number;
  onPick: (iso: string) => void;
  onOpenPopover?: (iso: string, rect: DOMRect) => void;
  coveredTaskIds: Set<string>;
  dragHighlight?: boolean;
}) {
```

修改覆盖 button：

```tsx
      <button
        type="button"
        onClick={() => onPick(iso)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          const cell = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
          onOpenPopover?.(iso, cell);
        }}
        className="absolute inset-0 z-0 cursor-pointer rounded-lg"
        aria-label={`选中 ${iso}`}
      />
```

- [ ] **Step 4: 父级传 onOpenPopover**

在月视图渲染 DroppableDayCell 处加 prop：

```tsx
                    <DroppableDayCell
                      ...
                      onOpenPopover={(iso, rect) => setPopover({ iso, rect })}
                    />
```

- [ ] **Step 5: 渲染 DayTasksPopover**

在 `</DndContext>` 之前（与 QuickCreateBubble 同级），加：

```tsx
      {popover && (
        <DayTasksPopover
          iso={popover.iso}
          tasks={(dayMap.get(popover.iso)?.list ?? [])}
          anchor={popover.rect}
          onClose={() => setPopover(null)}
          onEdit={(t) => {
            setPopover(null);
            onEdit(t);
          }}
          onStartPomodoro={startPomodoroFor}
          onNewTask={onNewTaskOnDate}
        />
      )}
```

注意：`dayMap.get(iso)?.list` 是当天任务数组，按现有结构。如果字段名不是 `list`，请按实际名取（搜索 `dayMap` 类型定义后确认；常见是 `list` / `tasks`）。

- [ ] **Step 6: 拖动成功后关闭浮窗**

修改既有的 `handleDragEnd`：

```ts
  function handleDragEnd(e: DragEndEvent) {
    setActiveTask(null);
    const a = e.active.data.current;
    const o = e.over?.data.current;
    if (isDragTask(a) && isDropDay(o)) {
      moveSchedule(a.taskId, a.fromDate, o.iso, mode);
      // 拖动改期成功后自动关闭日任务浮窗
      setPopover(null);
    }
  }
```

- [ ] **Step 7: 类型检查 + dogfood**

```bash
npx tsc -b --noEmit
```

dev 里月视图双击任意格子 → 浮窗弹出。把浮窗里的任务拖到另一格 → 浮窗关闭，任务挪过去。按 Option/Alt + 拖 → 复制（原日期保留）。

- [ ] **Step 8: 提交**

```bash
git add src/routes/tasks/views/MonthView.tsx
git commit -m "feat(month): double-click day to popover with drag-to-reschedule"
```

---

### Task 2.2：WeekView 双击日期标识开浮窗

**Files:**
- Modify: `src/routes/tasks/views/WeekView.tsx`

- [ ] **Step 1: 加 import**

```ts
import { DayTasksPopover } from "./_DayTasksPopover";
```

- [ ] **Step 2: WeekView 主组件内加 state**

```ts
  const [popover, setPopover] = useState<
    | null
    | { iso: string; rect: DOMRect }
  >(null);
```

- [ ] **Step 3: 给"日期标识 button"加 onDoubleClick**

在 WeekView 文件中找到这段（约 378–386 行附近）：

```tsx
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex w-20 shrink-0 flex-col items-start self-start rounded-md px-2 py-1 text-left transition-colors hover:bg-ink-50",
          today && "bg-brand-50/70"
        )}
        title={`选中 ${iso}`}
      >
```

改为（加 onDoubleClick，并把回调通过新增 props 传入）：

```tsx
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onOpenPopover?.(iso, e.currentTarget.getBoundingClientRect());
        }}
        className={cn(
          "flex w-20 shrink-0 flex-col items-start self-start rounded-md px-2 py-1 text-left transition-colors hover:bg-ink-50",
          today && "bg-brand-50/70"
        )}
        title={`选中 ${iso}（双击查看任务）`}
      >
```

子组件（包含这个 button 的）类型加 `onOpenPopover?: (iso: string, rect: DOMRect) => void;`，并从 props 里解构使用。

- [ ] **Step 4: 父级 WeekView 传 onOpenPopover**

把 `onOpenPopover={(iso, rect) => setPopover({ iso, rect })}` 传进去。

- [ ] **Step 5: 渲染 DayTasksPopover**

在 WeekView return 末尾、关闭 `</DndContext>` 之前（如果有）或最外层 fragment 之前，加：

```tsx
      {popover && (
        <DayTasksPopover
          iso={popover.iso}
          tasks={(dayMap.get(popover.iso)?.list ?? [])}
          anchor={popover.rect}
          onClose={() => setPopover(null)}
          onEdit={(t) => {
            setPopover(null);
            onEdit(t);
          }}
          onStartPomodoro={startPomodoroFor}
          onNewTask={onNewTaskOnDate}
        />
      )}
```

- [ ] **Step 6: 拖动成功后关闭浮窗**

修改 WeekView 中已有的 handleDragEnd（搜 `moveSchedule` 即可定位），在调用 `moveSchedule(...)` 后追加：

```ts
      setPopover(null);
```

- [ ] **Step 7: 类型检查 + dogfood**

周视图双击某日左侧"日期标识" → 浮窗弹出在按钮旁边；任务拖到其他天 → 自动关浮窗 + 任务挪走。

- [ ] **Step 8: 提交**

```bash
git add src/routes/tasks/views/WeekView.tsx
git commit -m "feat(week): double-click day label to popover with drag-to-reschedule"
```

---

# 切片 3 · 年视图

### Task 3.1：YearView 接入 DndContext + droppable + 浮窗

年视图原本没在 dnd-kit 体系内，本任务一次到位地补全：DndContext 包裹 + 日格 useDroppable + mode 状态机 + 双击浮窗。

**Files:**
- Modify: `src/routes/tasks/views/YearView.tsx`

- [ ] **Step 1: 加 import**

```ts
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDndContext,
  useDroppable,
  useSensor,
  useSensors,
  DragOverlay,
} from "@dnd-kit/core";
import { useTaskStore } from "@/store/taskStore";
import { isDragTask, isDropDay, modeFromEvent } from "./_helpers";
import { TaskCard } from "@/components/task/TaskCard";
import { DayTasksPopover } from "./_DayTasksPopover";
import type { Task } from "@/lib/types";
```

（已 import 的去重）

- [ ] **Step 2: YearView 主组件内加 state + sensors + handlers**

```ts
  const moveSchedule = useTaskStore((s) => s.moveSchedule);
  const tasks = useTaskStore((s) => s.tasks);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [mode, setMode] = useState<"move" | "add" | "replace">("move");
  const [popover, setPopover] = useState<
    | null
    | { iso: string; rect: DOMRect }
  >(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor)
  );

  function handleDragStart(e: DragStartEvent) {
    const d = e.active.data.current;
    if (isDragTask(d)) {
      setActiveTask(tasks.find((t) => t.id === d.taskId) ?? null);
      setMode(modeFromEvent(e.activatorEvent));
    }
  }
  function handleDragEnd(e: DragEndEvent) {
    setActiveTask(null);
    const a = e.active.data.current;
    const o = e.over?.data.current;
    if (isDragTask(a) && isDropDay(o)) {
      moveSchedule(a.taskId, a.fromDate, o.iso, mode);
      setPopover(null);
    }
  }
```

- [ ] **Step 3: 包 DndContext**

把 YearView 的 return JSX 整体 wrap：

```tsx
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {/* 原 return JSX 保持不变 */}
      ...
      <DragOverlay dropAnimation={null}>
        {activeTask ? <TaskCard task={activeTask} isDragging /> : null}
      </DragOverlay>
      {popover && (
        <DayTasksPopover
          iso={popover.iso}
          tasks={tasks.filter((t) => t.scheduledDates.includes(popover.iso))}
          anchor={popover.rect}
          onClose={() => setPopover(null)}
          onEdit={(t) => {
            setPopover(null);
            onEdit(t);
          }}
        />
      )}
    </DndContext>
  );
```

- [ ] **Step 4: 把日格 button 改为 droppable + 双击**

YearView 文件中渲染日格的那个 `<button>` —— 现有签名形如：

```tsx
            <button
              type="button"
              onClick={() => onClickDay(iso)}
              ...
            >
```

抽出一个新组件 `DroppableYearCell`：

```tsx
function DroppableYearCell({
  iso,
  onClickDay,
  onOpenPopover,
  children,
  className,
  title,
  style,
}: {
  iso: string;
  onClickDay: (iso: string) => void;
  onOpenPopover: (iso: string, rect: DOMRect) => void;
  children: React.ReactNode;
  className?: string;
  title?: string;
  style?: React.CSSProperties;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `daycell:${iso}`,
    data: { type: "daycell", iso },
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onClickDay(iso)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onOpenPopover(iso, e.currentTarget.getBoundingClientRect());
      }}
      title={title}
      style={style}
      className={cn(
        className,
        isOver && "ring-2 ring-brand-500"
      )}
    >
      {children}
    </button>
  );
}
```

把原有 `<button onClick={() => onClickDay(iso)}>...</button>` 替换为 `<DroppableYearCell iso={iso} onClickDay={onClickDay} onOpenPopover={(iso, rect) => setPopover({ iso, rect })} ...>...</DroppableYearCell>`。把原 button 上的 className / title / style 透传。

注意：内层组件可能拿不到 `setPopover` —— 把 `onOpenPopover` prop 一路传到 MonthCard / DroppableYearCell。

- [ ] **Step 5: 类型检查 + dogfood**

```bash
npx tsc -b --noEmit
```

年视图双击任意小日格 → 浮窗弹出；任务拖到其他日格 → 落在新日期，浮窗自动关闭。Option/Alt 切复制语义。

- [ ] **Step 6: 提交**

```bash
git add src/routes/tasks/views/YearView.tsx
git commit -m "feat(year): DndContext + droppable + double-click popover with drag-to-reschedule"
```

---

# 切片 4 · 合并到主干

### Task 4.1

**Files:** 无文件改动

- [ ] **Step 1: 切到 main worktree 合并**

```bash
cd /Users/qianzhang/Documents/03_work/06_yehu/02_project/123_persistent-task/src/persistent-task
git fetch
git status
# 若 main 与 persistent-task-icon 已分叉（很可能）：
git merge --no-ff persistent-task-icon -m "Merge branch 'persistent-task-icon': day tasks popover"
# 若 ff 可行：
git merge --ff-only persistent-task-icon
git log --oneline -8
```

预期：合并干净（最坏情况是再来一次小冲突，但本切片只新增浮窗 + 改三个视图的 onDoubleClick，与最近主干变更冲突概率较低）。

---

## 自查

- **Spec 覆盖：**
  - § 1 浮窗 → Task 1.1
  - § 2 拖拽（数据形 / drop targets / 修饰键）→ Task 2.1（月）/ 2.2（周）/ 3.1（年）。复用现有 `DraggableTaskCard` 与各视图既有 handleDragEnd
  - § 3 触发器 → 月（Task 2.1 step 3）/ 周（Task 2.2 step 3）/ 年（Task 3.1 step 4）
  - § 4 状态 → 每个视图加 `popover` state
  - § 5 边界 → 拖动成功关浮窗（每个 view 的 handleDragEnd）；空状态走 `onNewTask`；同时只一个浮窗（state 单值）；Esc + 点外部
  - § 6 测试 → 仅人工 dogfood，不写 e2e
  - § 7 切片 → 与本计划 4 节对齐
- **占位符：** 无
- **类型一致性：** `DayTasksPopover` 的 `tasks: Task[]` 在三处调用点全用相同形态；`DraggableTaskCard` 的 `fromDate` 一律传 `iso`；`onOpenPopover: (iso, rect) => void` 三处签名一致；`moveSchedule(taskId, fromDate, toDate, mode)` 既有 store action，未改

---
