/**
 * 过期未完成任务次日处理 —— 纯函数 + localStorage 工具。
 *
 * 这里不依赖 zustand / React，方便单元测试和复用。
 */

import { addDays, format, parseISO } from "date-fns";
import type { Task } from "./types";

const LS_KEY = "persistent-task:lastReviewPromptDate";

/**
 * 判断任务是否进入「过期未完成」列表：
 *   - 只排了一天（scheduledDates.length === 1）
 *   - 那一天 < 今天
 *   - status 是 todo / in_progress
 */
export function isPastUnfinished(task: Task, today: string): boolean {
  if (task.scheduledDates.length !== 1) return false;
  const d = task.scheduledDates[0];
  if (d >= today) return false;
  return task.status === "todo" || task.status === "in_progress";
}

/**
 * 「今天继续」的日期填充：把原日期到今天之间的所有日期都加上。
 * 如果原 scheduledDates 长度 ≠ 1，按调用方约定不应触发，但这里仍
 * 兜底保留原数组并去重 union 上 today。
 */
export function fillContinueDates(
  scheduledDates: string[],
  today: string
): string[] {
  if (scheduledDates.length !== 1) {
    const set = new Set(scheduledDates);
    set.add(today);
    return Array.from(set).sort();
  }
  const start = scheduledDates[0];
  if (start >= today) {
    return [start];
  }
  const out: string[] = [];
  let cur = parseISO(start);
  const end = parseISO(today);
  while (cur.getTime() <= end.getTime()) {
    out.push(format(cur, "yyyy-MM-dd"));
    cur = addDays(cur, 1);
  }
  return out;
}

/** 读上一次"已经向用户弹过提醒"的日期；不存在返回 null。 */
export function readLastPromptDate(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

/** 写入"已经向用户弹过提醒"的日期。失败时静默忽略（隐私模式 / 配额）。 */
export function writeLastPromptDate(date: string): void {
  try {
    localStorage.setItem(LS_KEY, date);
  } catch {
    /* noop */
  }
}
