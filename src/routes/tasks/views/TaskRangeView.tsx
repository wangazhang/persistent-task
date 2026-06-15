import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { ChartGantt, Columns2, Rows3 } from "lucide-react";
import {
  differenceInCalendarDays,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
} from "date-fns";
import { zhCN } from "date-fns/locale";
import { TaskCard } from "@/components/task/TaskCard";
import type { Task } from "@/lib/types";
import { cn, isoDate } from "@/lib/utils";
import { useTaskStore } from "@/store/taskStore";
import type { TaskSurfaceMode } from "../useTaskUrlState";
import { taskSorter, useTagFilterSet } from "./_helpers";
import { ViewFaceToggle } from "./_ViewFaceToggle";
import {
  applyGanttSchedulePreview,
  buildGanttRows,
  makeScrollableGanttRange,
  makeTaskTimeRange,
  resizeContinuousSchedule,
  shiftContinuousSchedule,
  type GanttSchedulePreview,
  tasksIntersectingRange,
  type GanttSegment,
  type TaskRangeKind,
  type TaskTimeRange,
} from "./_taskRangeGantt";
import {
  useTaskViewLayout,
  type TaskViewLayout,
} from "./_taskViewLayout";

interface TaskRangeViewProps {
  rangeKind: TaskRangeKind;
  date: string;
  mode: TaskSurfaceMode;
  tags: string[];
  todayResetKey?: number;
  onModeChange: (mode: TaskSurfaceMode) => void;
  onEdit: (task: Task) => void;
  onStartPomodoro: (task: Task) => void;
}

const LAYOUT_OPTIONS: Array<{
  value: TaskViewLayout;
  label: string;
  icon: typeof Rows3;
}> = [
  { value: "single", label: "单列", icon: Rows3 },
  { value: "double", label: "双列", icon: Columns2 },
  { value: "gantt", label: "甘特", icon: ChartGantt },
];

type GroupKey = "in_progress" | "todo" | "suspended" | "done";

const GROUP_ORDER: GroupKey[] = ["in_progress", "todo", "suspended", "done"];
const GROUP_LABEL: Record<GroupKey, string> = {
  in_progress: "进行中",
  todo: "待办",
  suspended: "已挂起",
  done: "已完成",
};

function groupOf(task: Task): GroupKey | null {
  if (task.status === "archived") return null;
  if (task.status === "in_progress") return "in_progress";
  if (task.status === "suspended") return "suspended";
  if (task.status === "done") return "done";
  return "todo";
}

export function TaskRangeView({
  rangeKind,
  date,
  mode,
  tags,
  todayResetKey = 0,
  onModeChange,
  onEdit,
  onStartPomodoro,
}: TaskRangeViewProps) {
  const tasks = useTaskStore((s) => s.tasks);
  const tagFilter = useTagFilterSet(tags);
  const range = useMemo(() => makeTaskTimeRange(rangeKind, date), [rangeKind, date]);
  const filteredTasks = useMemo(() => {
    const passTag = (task: Task) =>
      !tagFilter || task.tagIds.some((id) => tagFilter.has(id));
    return tasks
      .filter((task) => task.status !== "archived" && passTag(task))
      .sort(taskSorter);
  }, [tasks, tagFilter]);
  const visibleTasks = useMemo(
    () => tasksIntersectingRange(filteredTasks, range),
    [filteredTasks, range]
  );
  const [layout, setLayout] = useTaskViewLayout();

  return (
    <section className="task-surface">
      <div className="task-surface-face task-surface-face-right">
        {/* 任务维度自己的展示方式放在父级时间标题下方，避免重复出现“任务视图”标题。 */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <ViewFaceToggle mode={mode} onChange={onModeChange} />
          <LayoutToggle value={layout} onChange={setLayout} />
        </div>

        {layout === "gantt" ? (
          <RangeGantt
            range={range}
            tasks={filteredTasks}
            todayResetKey={todayResetKey}
            onEdit={onEdit}
          />
        ) : visibleTasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-200 px-6 py-12 text-center text-sm text-ink-400">
            {tagFilter ? "当前标签筛选下没有任务" : "当前时间范围内没有任务"}
          </div>
        ) : (
          <TaskRangeList
            tasks={visibleTasks}
            layout={layout}
            onEdit={onEdit}
            onStartPomodoro={onStartPomodoro}
          />
        )}
      </div>
    </section>
  );
}

function LayoutToggle({
  value,
  onChange,
}: {
  value: TaskViewLayout;
  onChange: (value: TaskViewLayout) => void;
}) {
  return (
    <div
      className="inline-flex overflow-hidden rounded-md border border-ink-200 bg-white"
      aria-label="任务展示方式"
    >
      {LAYOUT_OPTIONS.map(({ value: option, label, icon: Icon }) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={cn(
              "inline-flex h-6 w-8 items-center justify-center transition-colors",
              active
                ? "bg-brand-600 text-white"
                : "bg-white text-ink-500 hover:bg-ink-50 hover:text-ink-700"
            )}
            aria-label={label}
            aria-pressed={active}
            title={label}
          >
            <Icon className="h-3 w-3" />
          </button>
        );
      })}
    </div>
  );
}

function TaskRangeList({
  tasks,
  layout,
  onEdit,
  onStartPomodoro,
}: {
  tasks: Task[];
  layout: Exclude<TaskViewLayout, "gantt">;
  onEdit: (task: Task) => void;
  onStartPomodoro: (task: Task) => void;
}) {
  const groups = useMemo(() => {
    const out: Record<GroupKey, Task[]> = {
      in_progress: [],
      todo: [],
      suspended: [],
      done: [],
    };
    for (const task of tasks) {
      const group = groupOf(task);
      if (group) out[group].push(task);
    }
    return out;
  }, [tasks]);

  return (
    <div className="space-y-5">
      {GROUP_ORDER.map((group) => {
        const items = groups[group];
        if (items.length === 0) return null;
        return (
          <div key={group}>
            <div className="mb-2 flex items-center gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                {GROUP_LABEL[group]}
              </span>
              <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-ink-500">
                {items.length}
              </span>
            </div>
            <div
              className={
                layout === "double"
                  ? "grid grid-cols-1 gap-2 md:grid-cols-2"
                  : "grid grid-cols-1 gap-2"
              }
            >
              {items.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onEdit={onEdit}
                  onStartPomodoro={onStartPomodoro}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RangeGantt({
  range,
  tasks,
  todayResetKey,
  onEdit,
}: {
  range: TaskTimeRange;
  tasks: Task[];
  todayResetKey: number;
  onEdit: (task: Task) => void;
}) {
  const updateTask = useTaskStore((s) => s.updateTask);
  const timelineRange = useMemo(() => makeScrollableGanttRange(range), [range]);
  const [dragPreview, setDragPreview] = useState<GanttSchedulePreview | null>(null);
  const ganttTasks = useMemo(
    () => applyGanttSchedulePreview(tasks, dragPreview),
    [tasks, dragPreview]
  );
  const rows = useMemo(
    () => buildGanttRows(ganttTasks, timelineRange),
    [ganttTasks, timelineRange]
  );
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const canEditGantt = range.kind !== "year";
  const timelineWidth = `${(timelineRange.ticks.length / range.ticks.length) * 100}%`;
  const todayISO = isoDate();
  const todayOffset = timelineOffset(timelineRange, todayISO);
  const todayLineLeft =
    todayOffset == null ? null : `${(todayOffset / timelineRange.ticks.length) * 100}%`;

  useLayoutEffect(() => {
    // 预载前后时间段后，当前范围包含今天时优先把今天线带回视口。
    const frame = window.requestAnimationFrame(() => {
      const scroll = timelineScrollRef.current;
      const timeline = timelineRef.current;
      if (!scroll || !timeline) return;
      const targetISO = isDateInsideRange(todayISO, range)
        ? todayISO
        : range.startISO;
      scrollTimelineToDate(
        scroll,
        timeline,
        timelineRange,
        targetISO,
        targetISO === todayISO ? "center" : "start"
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    range.startISO,
    range.endISO,
    rows.length,
    timelineRange,
    todayISO,
    todayResetKey,
  ]);

  function deltaFromPointer(startX: number, currentX: number): number {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const unit = rect.width / timelineRange.ticks.length;
    return Math.round((currentX - startX) / unit);
  }

  function startSegmentDrag(
    task: Task,
    segment: GanttSegment,
    action: "move" | "start" | "end",
    event: ReactMouseEvent
  ) {
    if (!canEditGantt || !segment.editable) {
      if (action === "move") onEdit(task);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    let moved = false;
    let lastDelta = 0;

    function nextDatesForDelta(delta: number): string[] {
      return action === "move"
        ? shiftContinuousSchedule(task.scheduledDates, delta)
        : resizeContinuousSchedule(task.scheduledDates, action, delta);
    }

    function onMove(moveEvent: MouseEvent) {
      if (Math.abs(moveEvent.clientX - startX) > 4) moved = true;
      const delta = deltaFromPointer(startX, moveEvent.clientX);
      if (delta === lastDelta) return;
      lastDelta = delta;
      setDragPreview(
        delta === 0
          ? null
          : {
              taskId: task.id,
              scheduledDates: nextDatesForDelta(delta),
            }
      );
    }
    function onUp(upEvent: MouseEvent) {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const delta = deltaFromPointer(startX, upEvent.clientX);
      if (!moved || delta === 0) {
        setDragPreview(null);
        if (action === "move") onEdit(task);
        return;
      }
      updateTask(task.id, { scheduledDates: nextDatesForDelta(delta) });
      setDragPreview(null);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-200 px-6 py-12 text-center text-sm text-ink-400">
        当前甘特时间轴内没有任务
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
      <div
        className="grid"
        style={{ gridTemplateColumns: "minmax(13rem, 18rem) minmax(0, 1fr)" }}
      >
        <div className="border-r border-ink-100 bg-ink-50/60">
          <div className="flex h-9 items-center border-b border-ink-100 px-3 text-xs font-medium text-ink-500">
            任务
          </div>
          {rows.map(({ task }) => (
            <button
              key={task.id}
              type="button"
              onClick={() => onEdit(task)}
              className="flex h-11 w-full min-w-0 items-center gap-2 border-b border-ink-100 px-3 text-left text-xs hover:bg-ink-50"
              title={task.title}
            >
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  task.status === "done"
                    ? "bg-ink-300"
                    : task.status === "in_progress"
                    ? "bg-warning-500"
                    : task.status === "suspended"
                    ? "bg-paused-400"
                    : "bg-brand-500"
                )}
                style={task.color ? { backgroundColor: task.color } : undefined}
              />
              <span className="truncate text-ink-700">{task.title}</span>
            </button>
          ))}
        </div>
        <div ref={timelineScrollRef} className="min-w-0 overflow-x-auto">
          <div
            ref={timelineRef}
            className="relative min-w-full"
            style={{ width: timelineWidth }}
          >
            <GanttTicks range={timelineRange} />
            {rows.map(({ task, segments }) => (
              <div
                key={task.id}
                className="relative h-11 border-b border-ink-100"
                style={timelineGridStyle(timelineRange.ticks.length)}
              >
                {segments.map((segment, index) => (
                  <GanttBar
                    key={`${task.id}-${index}-${segment.startIndex}-${segment.endIndex}`}
                    task={task}
                    segment={segment}
                    total={timelineRange.ticks.length}
                    editable={canEditGantt && segment.editable}
                    onDrag={startSegmentDrag}
                  />
                ))}
              </div>
            ))}
            {todayLineLeft && (
              <div
                className="pointer-events-none absolute inset-y-0 z-20 border-l border-rose-500/90"
                style={{ left: todayLineLeft }}
              >
                <span className="absolute left-1 top-1 rounded bg-rose-500 px-1 py-0.5 text-[10px] font-medium leading-none text-white shadow-sm">
                  今天
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function GanttTicks({ range }: { range: TaskTimeRange }) {
  return (
    <div
      className="grid h-9 border-b border-ink-100 bg-ink-50/60 text-[11px] text-ink-400"
      style={{ gridTemplateColumns: `repeat(${range.ticks.length}, minmax(0, 1fr))` }}
    >
      {range.ticks.map((tick, index) => (
        <div
          key={tick}
          className="flex items-center border-l border-ink-100 px-1 first:border-l-0"
          title={tick}
        >
          <span className="truncate">{tickLabel(range, tick, index)}</span>
        </div>
      ))}
    </div>
  );
}

function GanttBar({
  task,
  segment,
  total,
  editable,
  onDrag,
}: {
  task: Task;
  segment: GanttSegment;
  total: number;
  editable: boolean;
  onDrag: (
    task: Task,
    segment: GanttSegment,
    action: "move" | "start" | "end",
    event: ReactMouseEvent
  ) => void;
}) {
  const left = `${(segment.startIndex / total) * 100}%`;
  const width = `${((segment.endIndex - segment.startIndex + 1) / total) * 100}%`;
  const color = task.color ?? defaultBarColor(task);
  const title = editable
    ? `${task.title} · 拖动改期，拖两端调整起止`
    : `${task.title} · ${segment.editable ? "年甘特只读" : "非连续排期，请在详情中编辑"}`;

  return (
    <div
      className={cn(
        "absolute top-1/2 h-5 -translate-y-1/2 rounded-md px-2 text-[11px] leading-5 text-white shadow-sm transition-transform",
        editable ? "cursor-grab hover:-translate-y-[55%] hover:shadow-md" : "cursor-pointer opacity-80",
        task.status === "done" && "line-through"
      )}
      style={{ left, width, backgroundColor: color }}
      title={title}
      onMouseDown={(event) => onDrag(task, segment, "move", event)}
    >
      {editable && (
        <span
          className="absolute left-0 top-0 h-full w-2 cursor-ew-resize rounded-l-md bg-white/50 opacity-0 transition-opacity hover:opacity-100"
          onMouseDown={(event) => onDrag(task, segment, "start", event)}
        />
      )}
      <span className="block truncate">{task.title}</span>
      {editable && (
        <span
          className="absolute right-0 top-0 h-full w-2 cursor-ew-resize rounded-r-md bg-white/50 opacity-0 transition-opacity hover:opacity-100"
          onMouseDown={(event) => onDrag(task, segment, "end", event)}
        />
      )}
    </div>
  );
}

function timelineTickKey(range: TaskTimeRange, dateISO: string): string {
  return range.unit === "month" ? dateISO.slice(0, 7) : dateISO;
}

function isDateInsideRange(dateISO: string, range: TaskTimeRange): boolean {
  return dateISO >= range.startISO && dateISO <= range.endISO;
}

function timelineOffset(range: TaskTimeRange, dateISO: string): number | null {
  if (!isDateInsideRange(dateISO, range)) return null;
  const tick = timelineTickKey(range, dateISO);
  const index = range.ticks.indexOf(tick);
  if (index < 0) return null;
  if (range.unit === "day") return index;

  const date = parseISO(dateISO);
  const monthStart = startOfMonth(date);
  const monthDays = differenceInCalendarDays(endOfMonth(date), monthStart) + 1;
  return index + differenceInCalendarDays(date, monthStart) / monthDays;
}

function scrollTimelineToDate(
  scroll: HTMLDivElement,
  timeline: HTMLDivElement,
  range: TaskTimeRange,
  dateISO: string,
  align: "start" | "center"
) {
  const offset = timelineOffset(range, dateISO);
  if (offset == null) return;
  const unit = timeline.scrollWidth / range.ticks.length;
  const rawLeft =
    align === "center" ? unit * offset - scroll.clientWidth / 2 : unit * offset;
  const maxLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
  scroll.scrollLeft = Math.min(Math.max(0, rawLeft), maxLeft);
}

function tickLabel(range: TaskTimeRange, tick: string, index: number): string {
  const date = parseISO(range.unit === "month" ? `${tick}-01` : tick);
  if (range.unit === "month") {
    return format(date, date.getMonth() === 0 ? "yyyy年 M月" : "M月", {
      locale: zhCN,
    });
  }
  if (range.kind === "week") return format(date, "M/d EEE", { locale: zhCN });
  if (date.getDate() === 1) {
    return format(date, "M月d日", { locale: zhCN });
  }
  return index % 5 === 0 || index === range.ticks.length - 1
    ? format(date, "d")
    : "";
}

function timelineGridStyle(total: number): CSSProperties {
  return {
    backgroundImage: "linear-gradient(to right, rgba(148, 163, 184, .22) 1px, transparent 1px)",
    backgroundSize: `${100 / total}% 100%`,
  };
}

function defaultBarColor(task: Task): string {
  if (task.status === "done") return "#94a3b8";
  if (task.status === "in_progress") return "#f59e0b";
  if (task.status === "suspended") return "#a78bfa";
  return "#6366f1";
}
