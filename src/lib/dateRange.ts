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
