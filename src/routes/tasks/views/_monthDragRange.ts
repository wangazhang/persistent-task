// src/routes/tasks/views/_monthDragRange.ts
//
// 月视图拖拽相关纯计算函数：
//   - 框选新建：限同一周内
//   - 色带 resize：clamp 起止
//
// 这里只做日期算术，不耦合 React 事件 / DOM。

import { format, parseISO } from "date-fns";

/**
 * 同周框选：startISO 与 endISO 必须在同一周（约定周一为周首）。
 * 跨周时回退到 startISO 所在周的最右一天作为终点。
 *
 * 调用方负责传入"同周"的判断结果（cells 二维数组持有），
 * 这里只关注语义：起 > 止时交换；同周时直接用；不同周时退回。
 */
export interface RangeFromDrag {
  start: string;
  end: string;
  truncated: boolean; // 是否因跨周被裁剪
}

export function rangeFromDrag(
  startISO: string,
  endISO: string,
  weekEndOfStartISO: string
): RangeFromDrag {
  let s = startISO;
  let e = endISO;
  // 同周判断由 weekEndOfStartISO 隐含：endISO <= weekEndOfStartISO ⇔ 同周
  let truncated = false;
  if (e > weekEndOfStartISO) {
    e = weekEndOfStartISO;
    truncated = true;
  }
  // 起点理论上始终 ≤ 终点（拖拽时按方向给出），但为保险起见交换
  if (parseISO(s).getTime() > parseISO(e).getTime()) {
    [s, e] = [e, s];
  }
  return { start: s, end: e, truncated };
}

/**
 * Resize 色带：拖动 end 端点。
 * 拖到比 start 还早 → clamp 成单日（end = start）。
 */
export function clampResizeEnd(start: string, draftEnd: string): string {
  return parseISO(draftEnd).getTime() < parseISO(start).getTime()
    ? start
    : draftEnd;
}

/**
 * Resize 色带：拖动 start 端点。
 * 拖到比 end 还晚 → clamp 成单日（start = end）。
 */
export function clampResizeStart(draftStart: string, end: string): string {
  return parseISO(draftStart).getTime() > parseISO(end).getTime()
    ? end
    : draftStart;
}

/** 给定一组连续日期与新的起止，返回新的连续日期数组。 */
export function resizeContiguous(
  newStart: string,
  newEnd: string
): string[] {
  // 复用 expandRange 即可
  return expandRangeInline(newStart, newEnd);
}

/** 内联 expand 避免循环 import；与 lib/dateRange.expandRange 一致。 */
function expandRangeInline(start: string, end: string): string[] {
  let s = parseISO(start);
  let e = parseISO(end);
  if (s.getTime() > e.getTime()) [s, e] = [e, s];
  const out: string[] = [];
  for (let cur = new Date(s); cur <= e; cur.setDate(cur.getDate() + 1)) {
    out.push(format(cur, "yyyy-MM-dd"));
  }
  return out;
}
