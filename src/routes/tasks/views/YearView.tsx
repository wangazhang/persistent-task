import { useEffect, useMemo, useState } from "react";
import {
  addYears,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  setMonth,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subYears,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  DragOverlay,
} from "@dnd-kit/core";
import { useNavigate } from "react-router-dom";
import type { Task } from "@/lib/types";
import type { TaskSurfaceMode } from "../useTaskUrlState";
import { cn, isoDate } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { usePomodoroStore } from "@/store/pomodoroStore";
import { useTaskStore } from "@/store/taskStore";
import { TaskCard } from "@/components/task/TaskCard";
import { DayTasksPopover } from "./_DayTasksPopover";
import {
  isDragTask,
  isDropDay,
  modeFromEvent,
  useDayMap,
  useTagFilterSet,
  type DayInfo,
} from "./_helpers";
import { TaskRangeView } from "./TaskRangeView";
import { ViewFaceToggle } from "./_ViewFaceToggle";

/**
 * Year View：12 个迷你月热力图 + 选中日详情 + 双击日格弹任务浮窗。
 *
 * 浮窗内的任务可拖到本视图任意日格完成移动 / 复制（按 Option/Alt） / 替换（按 Shift）。
 */

interface Props {
  date: string;
  mode: TaskSurfaceMode;
  tags: string[];
  onDateChange: (iso: string) => void;
  onModeChange: (mode: TaskSurfaceMode) => void;
  onSwitchToMonth: (iso: string) => void;
  onEdit: (t: Task) => void;
  onNewTaskOnDate: (iso: string) => void;
}

export function YearView({
  date,
  mode,
  tags,
  onDateChange,
  onModeChange,
  onSwitchToMonth,
  onEdit,
  onNewTaskOnDate,
}: Props) {
  const navigate = useNavigate();
  const tasks = useTaskStore((s) => s.tasks);
  const moveSchedule = useTaskStore((s) => s.moveSchedule);
  const tagFilter = useTagFilterSet(tags);
  const dayMap = useDayMap(tasks, tagFilter);

  const [cursor, setCursor] = useState<Date>(() => new Date(date));
  const [todayResetKey, setTodayResetKey] = useState(0);
  useEffect(() => {
    setCursor((cur) => {
      const sel = new Date(date);
      return cur.getFullYear() === sel.getFullYear() ? cur : sel;
    });
  }, [date]);

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [dragMode, setDragMode] = useState<"move" | "add" | "replace">("move");
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
      setDragMode(modeFromEvent(e.activatorEvent));
    }
  }
  function handleDragEnd(e: DragEndEvent) {
    setActiveTask(null);
    const a = e.active.data.current;
    const o = e.over?.data.current;
    if (isDragTask(a) && isDropDay(o)) {
      moveSchedule(a.taskId, a.fromDate, o.iso, dragMode);
      setPopover(null);
    }
  }

  const yearStart = startOfYear(cursor);
  const months = useMemo(
    () => Array.from({ length: 12 }, (_, i) => setMonth(yearStart, i)),
    [yearStart]
  );

  const maxInYear = useMemo(() => {
    let max = 0;
    for (const m of months) {
      const start = startOfMonth(m);
      const end = endOfMonth(m);
      const days = eachDayOfInterval({ start, end });
      for (const d of days) {
        const info = dayMap.get(format(d, "yyyy-MM-dd"));
        if (info && info.total > max) max = info.total;
      }
    }
    return max;
  }, [months, dayMap]);

  const selectTask = usePomodoroStore((s) => s.selectTask);
  const setType = usePomodoroStore((s) => s.setType);
  function startPomodoroFor(t: Task) {
    setType("focus");
    selectTask(t.id);
    navigate("/pomodoro");
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-ink-700">
              {format(cursor, "yyyy 年")}
            </div>
            <div className="text-[11px] text-ink-400">
              {mode === "time"
                ? "双击日期查看任务；点击月份标题进入月视图"
                : "任务视图显示与本年有交集的任务，年甘特为只读总览"}
            </div>
          </div>
          <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-ink-200 p-1.5 text-ink-500 hover:bg-ink-50"
            onClick={() => setCursor((d) => subYears(d, 1))}
            aria-label="上一年"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-lg border border-ink-200 p-1.5 text-ink-500 hover:bg-ink-50"
            onClick={() => setCursor((d) => addYears(d, 1))}
            aria-label="下一年"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-secondary ml-1 text-xs"
            onClick={() => {
              const now = new Date();
              setTodayResetKey((key) => key + 1);
              setCursor(now);
              onDateChange(isoDate(now));
            }}
          >
            回到今天
          </button>
        </div>
        </div>

        {mode === "tasks" ? (
          <TaskRangeView
            rangeKind="year"
            date={format(cursor, "yyyy-MM-dd")}
            mode={mode}
            tags={tags}
            todayResetKey={todayResetKey}
            onModeChange={onModeChange}
            onEdit={onEdit}
            onStartPomodoro={startPomodoroFor}
          />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <ViewFaceToggle mode={mode} onChange={onModeChange} />
            </div>
            <div className="task-surface">
              <div className="task-surface-face task-surface-face-left grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {months.map((m) => (
                  <MiniMonth
                    key={m.toISOString()}
                    month={m}
                    dayMap={dayMap}
                    maxInYear={maxInYear}
                    selectedISO={date}
                    onClickDay={onDateChange}
                    onClickHeader={() => onSwitchToMonth(format(m, "yyyy-MM-dd"))}
                    onOpenPopover={(iso, rect) => {
                      track("ui.popover.open", { popover: "day-tasks", date: iso });
                      setPopover({ iso, rect });
                    }}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="w-72">
            <TaskCard task={activeTask} isDragging />
          </div>
        ) : null}
      </DragOverlay>

      {popover && (
        <DayTasksPopover
          iso={popover.iso}
          tasks={dayMap.get(popover.iso)?.tasks ?? []}
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
    </DndContext>
  );
}

function MiniMonth({
  month,
  dayMap,
  maxInYear,
  selectedISO,
  onClickDay,
  onClickHeader,
  onOpenPopover,
}: {
  month: Date;
  dayMap: Map<string, DayInfo>;
  maxInYear: number;
  selectedISO: string;
  onClickDay: (iso: string) => void;
  onClickHeader: () => void;
  onOpenPopover: (iso: string, rect: DOMRect) => void;
}) {
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [month]);

  const totalInMonth = useMemo(() => {
    let n = 0;
    for (const d of days) {
      if (!isSameMonth(d, month)) continue;
      n += dayMap.get(format(d, "yyyy-MM-dd"))?.total ?? 0;
    }
    return n;
  }, [days, month, dayMap]);

  return (
    <div className="card p-3">
      <button
        type="button"
        onClick={onClickHeader}
        className="mb-2 flex w-full items-center justify-between text-sm font-medium text-ink-700 hover:text-brand-600"
      >
        <span>{format(month, "M 月")}</span>
        <span className="text-[11px] font-normal text-ink-400">
          {totalInMonth > 0 ? `共 ${totalInMonth} 个任务` : ""}
        </span>
      </button>
      <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] text-ink-400">
        {["一", "二", "三", "四", "五", "六", "日"].map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((d) => {
          const iso = format(d, "yyyy-MM-dd");
          const inMonth = isSameMonth(d, month);
          const today = isToday(d);
          const selected = iso === selectedISO;
          const info = dayMap.get(iso);
          const total = info?.total ?? 0;
          const heat = maxInYear > 0 ? total / maxInYear : 0;
          const heatBg =
            total > 0 ? `rgba(99, 102, 241, ${0.08 + heat * 0.35})` : undefined;
          return (
            <DroppableYearCell
              key={iso}
              iso={iso}
              onClick={() => onClickDay(iso)}
              onDoubleClick={(rect) => onOpenPopover(iso, rect)}
              title={total > 0 ? `${iso} · ${info?.done ?? 0}/${total}（双击查看）` : `${iso}（双击查看）`}
              style={{ backgroundColor: heatBg }}
              className={cn(
                "relative aspect-square rounded text-[10px] tabular-nums transition-colors",
                !inMonth && "opacity-40",
                selected
                  ? "ring-2 ring-brand-400"
                  : today
                  ? "ring-1 ring-brand-300"
                  : "hover:bg-ink-100"
              )}
            >
              <span
                className={cn(
                  today && "font-semibold text-brand-700",
                  inMonth ? "text-ink-700" : "text-ink-400"
                )}
              >
                {format(d, "d")}
              </span>
            </DroppableYearCell>
          );
        })}
      </div>
    </div>
  );
}

function DroppableYearCell({
  iso,
  onClick,
  onDoubleClick,
  className,
  style,
  title,
  children,
}: {
  iso: string;
  onClick: () => void;
  onDoubleClick: (rect: DOMRect) => void;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `daycell:${iso}`,
    data: { type: "daycell", iso },
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick(e.currentTarget.getBoundingClientRect());
      }}
      title={title}
      style={style}
      className={cn(className, isOver && "ring-2 ring-brand-500")}
    >
      {children}
    </button>
  );
}
