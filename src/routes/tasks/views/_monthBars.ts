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
  const weeks: WeekBars[] = Array.from({ length: 6 }, () => ({
    segments: [],
    overflowCount: 0,
    coveredTaskIds: new Set<string>(),
  }));

  const isoToCoord = new Map<string, { weekRow: number; col: number }>();
  for (let i = 0; i < days.length; i++) {
    isoToCoord.set(format(days[i], "yyyy-MM-dd"), {
      weekRow: Math.floor(i / 7),
      col: i % 7,
    });
  }

  interface TaskWithSegments {
    task: Task;
    segments: BarSegment[];
  }
  const perTask: TaskWithSegments[] = [];

  for (const t of tasks) {
    if (tagFilter && !t.tagIds.some((id) => tagFilter.has(id))) continue;
    if (t.scheduledDates.length < 2) continue;

    const visibleDates = Array.from(
      new Set(t.scheduledDates.filter((d) => isoToCoord.has(d)))
    ).sort();
    if (visibleDates.length === 0) continue;

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

    const segments: BarSegment[] = [];
    for (const run of runs) {
      if (run.length < 2) continue;
      const runStart = isoToCoord.get(run[0])!;
      const runEnd = isoToCoord.get(run[run.length - 1])!;
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

  for (let row = 0; row < 6; row++) {
    const tasksThisWeek = perTask
      .filter((x) => x.segments.some((s) => s.weekRow === row))
      .map((x) => x.task)
      .sort(taskSorter);

    const kept = tasksThisWeek.slice(0, MAX_BARS_PER_WEEK);
    weeks[row].overflowCount = Math.max(0, tasksThisWeek.length - MAX_BARS_PER_WEEK);
    const keptIds = new Set(kept.map((t) => t.id));
    weeks[row].coveredTaskIds = new Set(keptIds);

    for (const x of perTask) {
      if (!keptIds.has(x.task.id)) continue;
      for (const seg of x.segments) {
        if (seg.weekRow === row) weeks[row].segments.push(seg);
      }
    }
  }

  return weeks;
}

/**
 * useMemo 包装，依赖 [days, tasks, tagFilter]。
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
