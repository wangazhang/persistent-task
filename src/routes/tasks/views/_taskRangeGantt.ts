import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import type { Task } from "@/lib/types";

export type TaskRangeKind = "week" | "month" | "year";
export type GanttUnit = "day" | "month";

export interface TaskTimeRange {
  kind: TaskRangeKind;
  startISO: string;
  endISO: string;
  unit: GanttUnit;
  ticks: string[];
}

export interface GanttSegment {
  taskId: string;
  startIndex: number;
  endIndex: number;
  startISO: string;
  endISO: string;
  editable: boolean;
}

export interface GanttRow {
  task: Task;
  segments: GanttSegment[];
}

export interface GanttSchedulePreview {
  taskId: string;
  scheduledDates: string[];
}

function iso(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function sortedUniqueDates(dates: string[]): string[] {
  return Array.from(new Set(dates)).sort();
}

function daysRange(
  kind: Exclude<TaskRangeKind, "year">,
  start: Date,
  end: Date
): TaskTimeRange {
  return {
    kind,
    startISO: iso(start),
    endISO: iso(end),
    unit: "day",
    ticks: eachDayOfInterval({ start, end }).map(iso),
  };
}

function monthsRange(start: Date, end: Date): TaskTimeRange {
  const monthCount = differenceInCalendarMonths(end, start) + 1;
  return {
    kind: "year",
    startISO: iso(start),
    endISO: iso(end),
    unit: "month",
    ticks: Array.from({ length: monthCount }, (_, i) =>
      format(addMonths(start, i), "yyyy-MM")
    ),
  };
}

export function makeTaskTimeRange(
  kind: TaskRangeKind,
  anchorISO: string
): TaskTimeRange {
  const anchor = parseISO(anchorISO);
  if (kind === "week") {
    const start = startOfWeek(anchor, { weekStartsOn: 1 });
    const end = endOfWeek(anchor, { weekStartsOn: 1 });
    return daysRange(kind, start, end);
  }
  if (kind === "month") {
    const start = startOfMonth(anchor);
    const end = endOfMonth(anchor);
    return daysRange(kind, start, end);
  }

  const start = startOfYear(anchor);
  const end = endOfYear(anchor);
  return monthsRange(start, end);
}

export function makeScrollableGanttRange(focusRange: TaskTimeRange): TaskTimeRange {
  const start = parseISO(focusRange.startISO);
  const end = parseISO(focusRange.endISO);

  if (focusRange.kind === "week") {
    return daysRange("week", addWeeks(start, -4), addWeeks(end, 4));
  }
  if (focusRange.kind === "month") {
    return daysRange(
      "month",
      startOfMonth(addMonths(start, -2)),
      endOfMonth(addMonths(end, 2))
    );
  }

  // 年甘特按月预载前后年份，横向浏览时仍保留月级别总览。
  return monthsRange(addYears(start, -1), addYears(end, 1));
}

export function tasksIntersectingRange(
  tasks: Task[],
  range: Pick<TaskTimeRange, "startISO" | "endISO">
): Task[] {
  return tasks.filter((task) =>
    task.scheduledDates.some((d) => d >= range.startISO && d <= range.endISO)
  );
}

export function isContinuousSchedule(dates: string[]): boolean {
  const sorted = sortedUniqueDates(dates);
  if (sorted.length <= 1) return sorted.length === dates.length;
  for (let i = 1; i < sorted.length; i += 1) {
    if (
      differenceInCalendarDays(parseISO(sorted[i]), parseISO(sorted[i - 1])) !== 1
    ) {
      return false;
    }
  }
  return sorted.length === dates.length;
}

function dayIndex(dateISO: string, range: TaskTimeRange): number {
  return differenceInCalendarDays(parseISO(dateISO), parseISO(range.startISO));
}

function monthIndex(dateISO: string, range: TaskTimeRange): number {
  return differenceInCalendarMonths(parseISO(dateISO), parseISO(range.startISO));
}

function rangeDates(startISO: string, endISO: string): string[] {
  return eachDayOfInterval({
    start: parseISO(startISO),
    end: parseISO(endISO),
  }).map(iso);
}

function visibleContinuousSegment(task: Task, range: TaskTimeRange): GanttSegment[] {
  const sorted = sortedUniqueDates(task.scheduledDates);
  if (sorted.length === 0) return [];
  const start = sorted[0] < range.startISO ? range.startISO : sorted[0];
  const end =
    sorted[sorted.length - 1] > range.endISO ? range.endISO : sorted[sorted.length - 1];
  if (start > end) return [];
  return [
    {
      taskId: task.id,
      startISO: start,
      endISO: end,
      startIndex: dayIndex(start, range),
      endIndex: dayIndex(end, range),
      editable: range.kind !== "year",
    },
  ];
}

function visibleRuns(task: Task, range: TaskTimeRange): GanttSegment[] {
  const visible = sortedUniqueDates(
    task.scheduledDates.filter((d) => d >= range.startISO && d <= range.endISO)
  );
  if (visible.length === 0) return [];

  const out: GanttSegment[] = [];
  let runStart = visible[0];
  let prev = visible[0];
  for (let i = 1; i <= visible.length; i += 1) {
    const current = visible[i];
    const continues =
      current != null &&
      differenceInCalendarDays(parseISO(current), parseISO(prev)) === 1;
    if (continues) {
      prev = current;
      continue;
    }
    out.push({
      taskId: task.id,
      startISO: runStart,
      endISO: prev,
      startIndex: dayIndex(runStart, range),
      endIndex: dayIndex(prev, range),
      editable: false,
    });
    if (current != null) {
      runStart = current;
      prev = current;
    }
  }
  return out;
}

function yearSegment(task: Task, range: TaskTimeRange): GanttSegment[] {
  const visible = sortedUniqueDates(
    task.scheduledDates.filter((d) => d >= range.startISO && d <= range.endISO)
  );
  if (visible.length === 0) return [];
  const start = visible[0];
  const end = visible[visible.length - 1];
  return [
    {
      taskId: task.id,
      startISO: start,
      endISO: end,
      startIndex: monthIndex(start, range),
      endIndex: monthIndex(end, range),
      editable: false,
    },
  ];
}

export function buildGanttRows(tasks: Task[], range: TaskTimeRange): GanttRow[] {
  return tasksIntersectingRange(tasks, range).map((task) => {
    const segments =
      range.unit === "month"
        ? yearSegment(task, range)
        : isContinuousSchedule(task.scheduledDates)
        ? visibleContinuousSegment(task, range)
        : visibleRuns(task, range);
    return { task, segments };
  });
}

export function applyGanttSchedulePreview(
  tasks: Task[],
  preview: GanttSchedulePreview | null
): Task[] {
  if (!preview) return tasks;
  let matched = false;
  const next = tasks.map((task) => {
    if (task.id !== preview.taskId) return task;
    matched = true;
    return { ...task, scheduledDates: preview.scheduledDates };
  });
  return matched ? next : tasks;
}

export function shiftContinuousSchedule(
  dates: string[],
  deltaDays: number
): string[] {
  if (!isContinuousSchedule(dates)) return sortedUniqueDates(dates);
  return sortedUniqueDates(dates).map((d) => iso(addDays(parseISO(d), deltaDays)));
}

export function resizeContinuousSchedule(
  dates: string[],
  edge: "start" | "end",
  deltaDays: number
): string[] {
  if (!isContinuousSchedule(dates)) return sortedUniqueDates(dates);
  const sorted = sortedUniqueDates(dates);
  if (sorted.length === 0) return [];
  const start = parseISO(sorted[0]);
  const end = parseISO(sorted[sorted.length - 1]);
  const nextStart = edge === "start" ? addDays(start, deltaDays) : start;
  const nextEnd = edge === "end" ? addDays(end, deltaDays) : end;
  const clampedStart = nextStart > nextEnd ? nextEnd : nextStart;
  const clampedEnd = nextEnd < nextStart ? nextStart : nextEnd;
  if (edge === "start" && nextStart > end) return [iso(end)];
  if (edge === "end" && nextEnd < start) return [iso(start)];
  return rangeDates(iso(clampedStart), iso(clampedEnd));
}
