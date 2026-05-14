import { useMemo } from "react";
import type { Task } from "@/lib/types";
import { useTagStore } from "@/store/tagStore";

/**
 * 日历类视图共享的纯工具：
 * - useDayMap：把 tasks 按"日"展开成 Map<iso, DayInfo>
 * - useTagFilterSet：把选中标签 ids 展开成"含后代"集合
 * - taskSorter：统一的日内排序规则（优先级 → 状态 → 当日 order）
 *
 * 拆到本文件是为了让 Month / Week / Year 三个视图共用同一份口径，
 * 否则各自实现一份既费心又容易走偏（比如改了排序规则只改了一处）。
 */

export interface DayInfo {
  total: number;
  done: number;
  tasks: Task[];
}

const PW = (p?: Task["priority"]) => (p === "p0" ? 0 : p === "p1" ? 1 : 2);
const SW = (s: Task["status"]) =>
  s === "in_progress" ? 0 : s === "todo" ? 1 : s === "suspended" ? 2 : 3;

export const taskSorter = (a: Task, b: Task) => {
  const dp = PW(a.priority) - PW(b.priority);
  if (dp !== 0) return dp;
  const ds = SW(a.status) - SW(b.status);
  if (ds !== 0) return ds;
  return a.order - b.order;
};

export function useDayMap(tasks: Task[], tagFilter: Set<string> | null) {
  return useMemo(() => {
    const map = new Map<string, DayInfo>();
    const passTag = (t: Task) =>
      !tagFilter || t.tagIds.some((id) => tagFilter.has(id));
    for (const t of tasks) {
      if (!passTag(t)) continue;
      for (const d of t.scheduledDates) {
        if (!map.has(d)) map.set(d, { total: 0, done: 0, tasks: [] });
        const info = map.get(d)!;
        info.total += 1;
        if (t.status === "done") info.done += 1;
        info.tasks.push(t);
      }
    }
    for (const info of map.values()) info.tasks.sort(taskSorter);
    return map;
  }, [tasks, tagFilter]);
}

export function useTagFilterSet(tags: string[]) {
  const collectDescendants = useTagStore((s) => s.collectDescendants);
  return useMemo(() => {
    if (tags.length === 0) return null;
    const set = new Set<string>();
    for (const id of tags) for (const d of collectDescendants(id)) set.add(d);
    return set;
  }, [tags, collectDescendants]);
}

/**
 * 拖拽 payload 类型守卫。
 * task: 任务卡作为拖源
 * daycell: 日历格作为拖目标
 */
export interface DragTaskData {
  type: "task";
  taskId: string;
  /** 任务卡所在的源日期；onDragEnd 用它知道从哪天移走 */
  fromDate: string;
}

export interface DropDayData {
  type: "daycell";
  iso: string;
}

export function isDragTask(data: unknown): data is DragTaskData {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: string }).type === "task"
  );
}

export function isDropDay(data: unknown): data is DropDayData {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: string }).type === "daycell"
  );
}

/**
 * 根据 PointerEvent / KeyboardEvent 的修饰键决定拖拽 mode。
 * - Shift = replace（重置 scheduledDates 为目标日）
 * - Alt   = add（保留源日 + 新增目标日）
 * - 其他   = move（默认：源日移除 + 目标日新增）
 */
export function modeFromEvent(
  ev: Event | undefined
): "move" | "add" | "replace" {
  if (!ev) return "move";
  const e = ev as Partial<KeyboardEvent & MouseEvent>;
  if (e.shiftKey) return "replace";
  if (e.altKey) return "add";
  return "move";
}
