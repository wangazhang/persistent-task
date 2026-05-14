import { useMemo, useState } from "react";
import {
  addWeeks,
  eachDayOfInterval,
  endOfWeek,
  format,
  isToday,
  startOfWeek,
  subWeeks,
} from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { TaskCard } from "@/components/task/TaskCard";
import type { Task, TaskPriority } from "@/lib/types";
import { cn, isoDate } from "@/lib/utils";
import { useTaskStore } from "@/store/taskStore";
import { usePomodoroStore } from "@/store/pomodoroStore";
import {
  isDragTask,
  isDropDay,
  modeFromEvent,
  taskSorter,
  useTagFilterSet,
} from "./_helpers";
import { DraggableTaskCard } from "./_DraggableTaskCard";

/**
 * Week View（纵向 7 行 + 行内任务也纵向堆叠）。
 *
 *   ┌──────────┬──────────────────────────────────────────────┐
 *   │ 周一 11   │ ┌────────────────────────────────────────┐  │
 *   │ 1/2      │ │ TaskCard 1                              │  │
 *   │          │ ├────────────────────────────────────────┤  │
 *   │          │ │ TaskCard 2                              │  │
 *   │          │ └────────────────────────────────────────┘  │
 *   │          │ + 新建                                       │
 *   ├──────────┼──────────────────────────────────────────────┤
 *   │ 周二 12   │ ...                                          │
 *
 * 行内多个任务按 priority -> status -> order 排序后纵向 stack（一日一列）。
 *
 * 按用户决策，每行只显示 active 任务（todo / in_progress），
 * 挂起 / 完成 / 归档不在本视图出现 —— 想管理那些请回到「今日」或「月」视图。
 *
 * 跨行拖拽 = 改期（move）；Alt = add（保留源 + 加目标）；Shift = replace（重置为目标）。
 * 整行（含左侧日期标识）都是 droppable，drop 目标更大更好命中。
 *
 * 卡片直接复用 TaskCard（DraggableTaskCard 包装）—— 保持与「今日」「月」选中日相同视觉密度，
 * 用户在不同 view 间切换不需要重新适应任务卡的信息层级。
 */

interface Props {
  date: string;
  tags: string[];
  onDateChange: (iso: string) => void;
  onEdit: (t: Task) => void;
  onNewTaskOnDate: (iso: string) => void;
}

interface DayBucket {
  /** 该日全部任务（含已完成 / 挂起），用于顶部计数 */
  all: Task[];
  /** 仅 active 任务（todo / in_progress），渲染在行内 */
  active: Task[];
  total: number;
  done: number;
}

export function WeekView({
  date,
  tags,
  onDateChange,
  onEdit,
  onNewTaskOnDate,
}: Props) {
  const navigate = useNavigate();
  const tasks = useTaskStore((s) => s.tasks);
  const moveSchedule = useTaskStore((s) => s.moveSchedule);
  const addTask = useTaskStore((s) => s.addTask);
  const tagFilter = useTagFilterSet(tags);

  // 当前周以 date 为锚（周一开始）
  const weekStart = useMemo(
    () => startOfWeek(new Date(date), { weekStartsOn: 1 }),
    [date]
  );
  const weekEnd = useMemo(
    () => endOfWeek(new Date(date), { weekStartsOn: 1 }),
    [date]
  );
  const days = useMemo(
    () => eachDayOfInterval({ start: weekStart, end: weekEnd }),
    [weekStart, weekEnd]
  );

  /**
   * 把当前周 7 天每天的任务桶算出来。
   * 标签筛选作用于"是否计入"：被过滤掉的任务对总数 / active 都不贡献。
   */
  const buckets = useMemo(() => {
    const passTag = (t: Task) =>
      !tagFilter || t.tagIds.some((id) => tagFilter.has(id));

    const map = new Map<string, DayBucket>();
    for (const day of days) {
      map.set(format(day, "yyyy-MM-dd"), {
        all: [],
        active: [],
        total: 0,
        done: 0,
      });
    }
    for (const t of tasks) {
      if (!passTag(t)) continue;
      for (const d of t.scheduledDates) {
        const bucket = map.get(d);
        if (!bucket) continue;
        bucket.all.push(t);
        bucket.total += 1;
        if (t.status === "done") bucket.done += 1;
        if (t.status === "todo" || t.status === "in_progress") {
          bucket.active.push(t);
        }
      }
    }
    for (const b of map.values()) b.active.sort(taskSorter);
    return map;
  }, [days, tasks, tagFilter]);

  // ---- 拖拽状态 ----
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [mode, setMode] = useState<"move" | "add" | "replace">("move");

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
    }
  }

  const selectTask = usePomodoroStore((s) => s.selectTask);
  const setType = usePomodoroStore((s) => s.setType);
  function startPomodoroFor(t: Task) {
    setType("focus");
    selectTask(t.id);
    navigate("/pomodoro");
  }

  // 顶部周标题
  const title = useMemo(() => {
    if (weekStart.getMonth() === weekEnd.getMonth()) {
      return `${format(weekStart, "yyyy 年 M 月")} · ${format(weekStart, "d")}—${format(weekEnd, "d")} 日`;
    }
    return `${format(weekStart, "yyyy 年 M 月 d 日")} — ${format(weekEnd, "M 月 d 日")}`;
  }, [weekStart, weekEnd]);

  // 周总计
  const weekTotals = useMemo(() => {
    let total = 0;
    let done = 0;
    for (const b of buckets.values()) {
      total += b.total;
      done += b.done;
    }
    return { total, done };
  }, [buckets]);

  function shiftWeek(dir: -1 | 1) {
    const next = dir === 1 ? addWeeks(weekStart, 1) : subWeeks(weekStart, 1);
    // 把选中日跟随移动到新周的同一星期几（保持视觉一致）
    const sel = new Date(date);
    const dayIdx = (sel.getDay() + 6) % 7; // 周一=0
    const nextSel = new Date(next);
    nextSel.setDate(next.getDate() + dayIdx);
    onDateChange(isoDate(nextSel));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {/* 标题 + 翻周 */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-ink-700">{title}</div>
          <div className="text-[11px] text-ink-400">
            本周共 {weekTotals.total} 项排期，已完成 {weekTotals.done} 项 · 拖动卡片到其他行即可改期
            <span className="ml-1 hidden sm:inline">
              (Alt = 复制到 / Shift = 整体替换)
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-ink-200 p-1.5 text-ink-500 hover:bg-ink-50"
            onClick={() => shiftWeek(-1)}
            aria-label="上一周"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-lg border border-ink-200 p-1.5 text-ink-500 hover:bg-ink-50"
            onClick={() => shiftWeek(1)}
            aria-label="下一周"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-secondary ml-1 text-xs"
            onClick={() => onDateChange(isoDate())}
          >
            回到今天
          </button>
        </div>
      </div>

      {/* 7 行：每行一天 */}
      <div className="flex flex-col gap-2">
        {days.map((day) => {
          const iso = format(day, "yyyy-MM-dd");
          const bucket = buckets.get(iso)!;
          return (
            <WeekRow
              key={iso}
              day={day}
              iso={iso}
              bucket={bucket}
              isSelected={iso === date}
              onSelect={() => onDateChange(iso)}
              onEdit={onEdit}
              onNewTask={() => onNewTaskOnDate(iso)}
              onQuickAdd={(title, priority) =>
                addTask({
                  title,
                  scheduledDates: [iso],
                  priority,
                  tagIds: tags.length === 1 ? [tags[0]] : [],
                })
              }
              onStartPomodoro={startPomodoroFor}
            />
          );
        })}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="relative w-[28rem] cursor-grabbing">
            <TaskCard task={activeTask} isDragging />
            <span
              className={cn(
                "pointer-events-none absolute -right-2 -bottom-2 rounded px-1.5 py-0.5 text-[10px] font-medium text-white shadow",
                mode === "replace"
                  ? "bg-rose-500"
                  : mode === "add"
                  ? "bg-amber-500"
                  : "bg-brand-500"
              )}
            >
              {mode === "replace" ? "替换" : mode === "add" ? "追加" : "改期"}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * 一日行：周视图的核心单元。
 *
 * 整行（左侧日期标识 + 右侧任务区）都是 droppable，被任务卡拖入时高亮整行；
 * 右侧任务区改为纵向 stack，每张卡复用 DraggableTaskCard（=TaskCard + 拖拽包装），
 * 与「今日」「月」选中日的卡片视觉一致。
 *
 * 行末尾是「+ 新建」入口（轻量级行内输入；双击进详细编辑器）。
 */
function WeekRow({
  day,
  iso,
  bucket,
  isSelected,
  onSelect,
  onEdit,
  onNewTask,
  onQuickAdd,
  onStartPomodoro,
}: {
  day: Date;
  iso: string;
  bucket: DayBucket;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: (t: Task) => void;
  onNewTask: () => void;
  onQuickAdd: (title: string, priority: TaskPriority) => void;
  onStartPomodoro: (t: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `daycell:${iso}`,
    data: { type: "daycell", iso },
  });
  const today = isToday(day);
  const isWeekend = day.getDay() === 0 || day.getDay() === 6;

  // 行内快速添加（轻量级，不弹编辑器）
  const [quickInput, setQuickInput] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);

  // 折叠：默认只展示前 VISIBLE_LIMIT 条 active，超出折成"还有 N 条"
  // 让"忙日"垂直占位可控；展开后显示全部，再次点击收起
  const VISIBLE_LIMIT = 3;
  const [expanded, setExpanded] = useState(false);
  const overflow = bucket.active.length > VISIBLE_LIMIT;
  const visibleTasks =
    expanded || !overflow
      ? bucket.active
      : bucket.active.slice(0, VISIBLE_LIMIT);
  const hiddenCount = bucket.active.length - VISIBLE_LIMIT;

  function commitQuick() {
    const v = quickInput.trim();
    if (!v) {
      setQuickOpen(false);
      return;
    }
    onQuickAdd(v, "p2");
    setQuickInput("");
    // 保留 quickOpen，允许连续输入
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex gap-3 rounded-xl border bg-white p-3 transition-colors",
        isOver
          ? "border-brand-500 bg-brand-50/40 ring-2 ring-brand-300"
          : isSelected
          ? "border-brand-400 ring-2 ring-brand-100"
          : "border-ink-200/70"
      )}
    >
      {/* 左侧日期标识：固定宽度，sticky 让长日列表滚动时仍可见 */}
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex w-20 shrink-0 flex-col items-start self-start rounded-md px-2 py-1 text-left transition-colors hover:bg-ink-50",
          today && "bg-brand-50/70"
        )}
        title={`选中 ${iso}`}
      >
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn(
              "text-xs font-medium",
              today ? "text-brand-700" : isWeekend ? "text-ink-400" : "text-ink-600"
            )}
          >
            {format(day, "EEE", { locale: zhCN })}
          </span>
          <span
            className={cn(
              "text-xl font-semibold tabular-nums leading-none",
              today
                ? "text-brand-700"
                : isWeekend
                ? "text-ink-400"
                : "text-ink-800"
            )}
          >
            {format(day, "d")}
          </span>
        </div>
        <span
          className={cn(
            "mt-1 text-[11px] tabular-nums",
            bucket.total === 0
              ? "text-ink-300"
              : bucket.done === bucket.total
              ? "text-success-600"
              : "text-ink-500"
          )}
        >
          {bucket.total === 0 ? "—" : `${bucket.done}/${bucket.total}`}
        </span>
      </button>

      {/* 右侧任务区：纵向 stack */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {bucket.active.length === 0 ? (
          <div className="py-1 text-[11px] text-ink-300">—— 空 ——</div>
        ) : (
          <>
            {visibleTasks.map((t) => (
              <DraggableTaskCard
                key={t.id}
                task={t}
                fromDate={iso}
                onEdit={onEdit}
                onStartPomodoro={onStartPomodoro}
              />
            ))}
            {overflow && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex h-7 w-fit items-center gap-1 rounded-md px-2 text-[11px] text-ink-500 hover:bg-ink-100 hover:text-ink-700"
                aria-expanded={expanded}
              >
                <ChevronDown
                  className={cn(
                    "h-3 w-3 transition-transform",
                    expanded && "rotate-180"
                  )}
                />
                {expanded ? "收起" : `还有 ${hiddenCount} 条`}
              </button>
            )}
          </>
        )}
        {/* 行末快速添加 */}
        {quickOpen ? (
          <input
            autoFocus
            className="h-8 w-full max-w-md rounded-md border border-brand-300 bg-white px-2 text-[12px] outline-none focus:border-brand-500"
            placeholder="任务标题，回车保存…"
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitQuick();
              } else if (e.key === "Escape") {
                setQuickOpen(false);
                setQuickInput("");
              }
            }}
            onBlur={() => {
              if (!quickInput.trim()) setQuickOpen(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setQuickOpen(true)}
            onDoubleClick={onNewTask}
            className="flex h-7 w-fit items-center gap-1 rounded-md border border-dashed border-ink-200 px-2 text-[11px] text-ink-400 hover:border-brand-400 hover:bg-brand-50/40 hover:text-brand-600"
            aria-label="在这一天快速新建任务"
            title="单击：快速新建；双击：打开详细编辑器"
          >
            <Plus className="h-3 w-3" />
            新建
          </button>
        )}
      </div>
    </div>
  );
}
