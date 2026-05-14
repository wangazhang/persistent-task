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
  row: number;         // lane index（0 或 1）：跨周 task 的所有 segment 共享同一 lane
}

export interface WeekBars {
  segments: BarSegment[];      // 按 row 顺序，每个 task 至多一组 segment
  overflowCount: number;       // 第 N 条起合并为 +N
  coveredTaskIds: Set<string>; // 该周色带覆盖的 taskIds
}

const MAX_BARS_PER_WEEK = 2;
const MAX_LANES = MAX_BARS_PER_WEEK;

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
          row: -1, // 在 lane 分配阶段填充
        });
        cursorRow += 1;
        cursorCol = 0;
      }
    }

    if (segments.length > 0) perTask.push({ task: t, segments });
  }

  // ---- lane 分配阶段 ----
  // 目标：跨周 task 的所有 segment 锁定在同一 lane（行号），保证视觉上色带在
  // 不同周之间不会上下错位。算法：按 "task 首段 weekRow 升序 + taskSorter" 排序，
  // 给每个 task 分配它出现的所有 weekRow 都空闲的最低 lane。
  const orderedTasks = [...perTask].sort((a, b) => {
    const ra = a.segments[0].weekRow;
    const rb = b.segments[0].weekRow;
    if (ra !== rb) return ra - rb;
    return taskSorter(a.task, b.task);
  });

  // laneOccupied[weekRow][lane] = true 表示该 weekRow 的该 lane 已被占用
  const laneOccupied: boolean[][] = Array.from(
    { length: 6 },
    () => Array(MAX_LANES).fill(false)
  );

  for (const x of orderedTasks) {
    const weekRowsTouched = Array.from(
      new Set(x.segments.map((s) => s.weekRow))
    );

    // 找最低可用 lane：必须在所有 weekRowsTouched 上都空闲
    let assigned = -1;
    for (let lane = 0; lane < MAX_LANES; lane++) {
      if (weekRowsTouched.every((wr) => !laneOccupied[wr][lane])) {
        assigned = lane;
        break;
      }
    }

    if (assigned === -1) {
      // 找不到 lane：丢弃整个 task，每个 weekRow overflow + 1
      for (const wr of weekRowsTouched) weeks[wr].overflowCount += 1;
      continue;
    }

    // 占座 + 落 segment
    for (const wr of weekRowsTouched) laneOccupied[wr][assigned] = true;
    for (const seg of x.segments) {
      seg.row = assigned;
      weeks[seg.weekRow].segments.push(seg);
      weeks[seg.weekRow].coveredTaskIds.add(x.task.id);
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
