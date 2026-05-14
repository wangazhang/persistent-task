import { useEffect, useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
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
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { TaskCard } from "@/components/task/TaskCard";
import type { Task } from "@/lib/types";
import { cn, isoDate } from "@/lib/utils";
import { useTaskStore } from "@/store/taskStore";
import { usePomodoroStore } from "@/store/pomodoroStore";
import { DaySection } from "./_DaySection";
import {
  isDragTask,
  isDropDay,
  modeFromEvent,
  useDayMap,
  useTagFilterSet,
  type DayInfo,
} from "./_helpers";
import { TaskBar } from "./_TaskBar";
import { useWeekBars } from "./_monthBars";

/**
 * Month View：
 *   上 = 6×7 月历网格（DayCell 都是 droppable）
 *   下 = 选中日详情（DaySection，active 区任务卡可拖到上方任意一天）
 *
 * 拖拽语义：
 *   默认  move    源日移除 + 目标日新增（"改期到这一天"）
 *   Alt   add     保留源日 + 目标日新增（"也在这一天做"）
 *   Shift replace scheduledDates 重置为 [目标日]（"整体改期"）
 *
 * cursor 控制翻页位置（影响月历显示哪一个月），date 控制 DaySection 显示哪一天。
 * 翻页只动 cursor，不动 date，避免"翻一下，选中日跑了"的不可预期感。
 */

interface Props {
  date: string;
  tags: string[];
  onDateChange: (iso: string) => void;
  onEdit: (t: Task) => void;
  onNewTaskOnDate: (iso: string) => void;
}

export function MonthView({
  date,
  tags,
  onDateChange,
  onEdit,
  onNewTaskOnDate,
}: Props) {
  const navigate = useNavigate();
  const tasks = useTaskStore((s) => s.tasks);
  const moveSchedule = useTaskStore((s) => s.moveSchedule);

  const tagFilter = useTagFilterSet(tags);
  const dayMap = useDayMap(tasks, tagFilter);

  const [cursor, setCursor] = useState<Date>(() => new Date(date));
  // 选中日跨月时把 cursor 跟过去；翻页只改 cursor 不改 date
  useEffect(() => {
    setCursor((cur) => {
      const sel = new Date(date);
      return isSameMonth(cur, sel) ? cur : sel;
    });
  }, [date]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const weekBars = useWeekBars(days, tasks, tagFilter);

  // O(1) task lookup for bar rendering
  const taskById = useMemo(
    () => new Map(tasks.map((t) => [t.id, t])),
    [tasks]
  );

  const maxInMonth = useMemo(() => {
    let max = 0;
    for (const d of days) {
      if (!isSameMonth(d, cursor)) continue;
      const info = dayMap.get(format(d, "yyyy-MM-dd"));
      if (info && info.total > max) max = info.total;
    }
    return max;
  }, [days, cursor, dayMap]);

  // ---- 拖拽状态 ----
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  // 修饰键在 dragStart 时锁定；松手前改键无效（避免视觉反馈与最终结果错位）
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

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <HeaderBar
        title={format(cursor, "yyyy 年 M 月")}
        onPrev={() => setCursor((d) => subMonths(d, 1))}
        onNext={() => setCursor((d) => addMonths(d, 1))}
        onToday={() => {
          const now = new Date();
          setCursor(now);
          onDateChange(isoDate(now));
        }}
      />

      {/* 月历网格 */}
      <div className="mb-1 grid grid-cols-7 gap-1.5 text-center text-xs font-medium text-ink-400">
        {["一", "二", "三", "四", "五", "六", "日"].map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: 6 }, (_, weekRow) => {
          const weekDays = days.slice(weekRow * 7, weekRow * 7 + 7);
          const bars = weekBars[weekRow];
          return (
            /*
              周行容器：relative 让色带 absolute 子层与 7 列 cell 重叠。
              DayCell 内部留出 BAR_TOP_OFFSET_PX 给色带区，摘要文字下移 mt-9。
              色带容器 pointer-events-none 让 cell 点击穿透，色带 button 自身 auto。
            */
            <div key={weekRow} className="relative grid grid-cols-7 gap-1.5">
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
              <div className="pointer-events-none absolute inset-0">
                {bars.segments.map((seg) => {
                  const task = taskById.get(seg.taskId);
                  if (!task) return null;
                  return (
                    <TaskBar
                      key={`${seg.taskId}-${seg.startCol}`}
                      segment={seg}
                      task={task}
                      onClick={() => onDateChange(task.scheduledDates[0])}
                      onEdit={onEdit}
                    />
                  );
                })}
                {bars.overflowCount > 0 && (
                  <span className="absolute bottom-1 right-2 text-[10px] text-ink-400">
                    +{bars.overflowCount} 跨天
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <DaySection
        iso={date}
        info={dayMap.get(date)}
        filterActive={tagFilter !== null}
        onEdit={onEdit}
        onStartPomodoro={startPomodoroFor}
        onNewTask={() => onNewTaskOnDate(date)}
        enableDrag
      />

      {/*
        DragOverlay：跟随光标的拖拽预览，独立挂在 body 上（不会被 overflow 截断）。
        渲染一个"展示态" TaskCard（不传 dragHandleProps，光标点击不再触发拖拽）。
        修饰键提示放在右下角，让用户看清当前是哪种语义。
      */}
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="relative w-72 cursor-grabbing">
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
              {mode === "replace"
                ? "替换"
                : mode === "add"
                ? "追加"
                : "改期"}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function HeaderBar({
  title,
  onPrev,
  onNext,
  onToday,
}: {
  title: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="text-[11px] text-ink-400">
        提示：拖动任务卡到日历格 = 改期 · Alt = 复制到 · Shift = 整体替换
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-lg border border-ink-200 p-1.5 text-ink-500 hover:bg-ink-50"
          onClick={onPrev}
          aria-label="上一月"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="min-w-[8rem] text-center text-sm font-medium text-ink-700">
          {title}
        </div>
        <button
          type="button"
          className="rounded-lg border border-ink-200 p-1.5 text-ink-500 hover:bg-ink-50"
          onClick={onNext}
          aria-label="下一月"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button type="button" className="btn-secondary ml-1 text-xs" onClick={onToday}>
          回到今天
        </button>
      </div>
    </div>
  );
}

/**
 * Droppable 月历格。
 * 视觉上几乎等同于原 DayCell：
 *  - 当前选中日 brand 描边
 *  - 任务热度色阶（基于当月最大值归一化）
 *  - 当前是 over 状态时叠加更明显的高亮（亮蓝 ring + bg）
 */
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
  const iso = format(day, "yyyy-MM-dd");
  const { setNodeRef, isOver } = useDroppable({
    id: `daycell:${iso}`,
    data: { type: "daycell", iso },
  });
  const inMonth = isSameMonth(day, cursor);
  const today = isToday(day);
  const selected = iso === selectedISO;
  const total = info?.total ?? 0;
  const done = info?.done ?? 0;
  const heat = maxScale > 0 ? total / maxScale : 0;
  const heatBg =
    total > 0 ? `rgba(99, 102, 241, ${0.06 + heat * 0.2})` : undefined;
  const fade = !inMonth;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative h-24 rounded-lg border p-1.5 transition-all",
        fade ? "opacity-50" : "",
        isOver
          ? "border-brand-500 bg-brand-50 ring-2 ring-brand-300"
          : selected
          ? "border-brand-400 ring-2 ring-brand-200"
          : "border-ink-200 hover:border-ink-300"
      )}
      style={{ backgroundColor: isOver ? undefined : heatBg }}
    >
      <button
        type="button"
        onClick={() => onPick(iso)}
        className="absolute inset-0 z-0 cursor-pointer rounded-lg"
        aria-label={`选中 ${iso}`}
      />
      <div className="relative z-10 pointer-events-none">
        <div className="flex items-center justify-between">
          <span
            className={cn(
              "inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-xs",
              today
                ? "bg-brand-600 font-semibold text-white"
                : selected
                ? "bg-brand-100 text-brand-700"
                : fade
                ? "text-ink-400"
                : "text-ink-700"
            )}
          >
            {format(day, "d")}
          </span>
          {total > 0 && (
            <span
              className={cn(
                "text-[10px] tabular-nums",
                done === total ? "text-success-600" : "text-ink-500"
              )}
            >
              {done}/{total}
            </span>
          )}
        </div>
        {info && (() => {
          const uncovered = info.tasks.filter((t) => !coveredTaskIds.has(t.id));
          if (uncovered.length === 0) return null;
          return (
            <div className="mt-9 space-y-0.5 overflow-hidden text-[11px] leading-tight">
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
      </div>
    </div>
  );
}
