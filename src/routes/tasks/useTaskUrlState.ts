import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { TaskStatus } from "@/lib/types";
import { isoDate } from "@/lib/utils";

/**
 * 任务管理页（/tasks）的统一 URL 状态。
 *
 * 设计要点：
 * - URL 是唯一真相源：刷新 / 分享链接都能精确还原 view + 过滤组合
 * - patch() 用 replace 提交，避免污染浏览器历史栈（用户切 view 时不应产生回退步骤）
 * - 兼容老链接：
 *   1) 旧 ?tag=x 单选写法读取一次（迁移到 ?tags=x）
 *   2) 旧 ?view=calendar&grid=month 组合迁移为 ?view=month
 *   3) 已下线的 ?view=all 落回 today
 */

export type ViewMode = "today" | "week" | "month" | "year";
export type TaskSurfaceMode = "time" | "tasks";

const VIEW_VALUES: ViewMode[] = ["today", "week", "month", "year"];
const MODE_VALUES: TaskSurfaceMode[] = ["time", "tasks"];
const STATUS_VALUES: (TaskStatus | "all")[] = [
  "all",
  "todo",
  "in_progress",
  "suspended",
  "done",
  "archived",
];

export interface TaskUrlState {
  view: ViewMode;
  /** 周/月/年内部的正反面：时间格子 or 当前范围任务集合；today 忽略 */
  mode: TaskSurfaceMode;
  /** 当前选中日（yyyy-MM-dd）；today 视图忽略 */
  date: string;
  /** 状态过滤（all 表示不过滤） */
  status: TaskStatus | "all";
  /** 标签过滤（多选） */
  tags: string[];
  /** 关键词搜索 */
  q: string;
}

function parseTags(sp: URLSearchParams): string[] {
  const multi = sp.get("tags");
  if (multi) {
    return multi
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // 老链接：?tag=x
  const single = sp.get("tag");
  return single ? [single] : [];
}

function parseView(sp: URLSearchParams): ViewMode {
  const raw = sp.get("view");
  if (raw && VIEW_VALUES.includes(raw as ViewMode)) {
    return raw as ViewMode;
  }
  // 旧链接迁移：view=calendar 时按 grid 字段映射
  if (raw === "calendar") {
    const grid = sp.get("grid");
    if (grid === "year") return "year";
    if (grid === "week") return "week";
    return "month";
  }
  // 已下线的 view=all 没有时间维度，落到 today
  if (raw === "all") return "today";
  return "today";
}

function parseMode(sp: URLSearchParams, view: ViewMode): TaskSurfaceMode {
  if (view === "today") return "time";
  const raw = sp.get("mode");
  return raw && MODE_VALUES.includes(raw as TaskSurfaceMode)
    ? (raw as TaskSurfaceMode)
    : "time";
}

export function useTaskUrlState(): TaskUrlState & {
  patch: (next: Partial<TaskUrlState>) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();

  const view = parseView(searchParams);
  const mode = parseMode(searchParams, view);
  const date = searchParams.get("date") || isoDate();

  const statusRaw = searchParams.get("status");
  const status: TaskStatus | "all" =
    statusRaw && STATUS_VALUES.includes(statusRaw as TaskStatus | "all")
      ? (statusRaw as TaskStatus | "all")
      : "all";

  const tags = parseTags(searchParams);
  const q = searchParams.get("q") || "";

  const patch = useCallback(
    (next: Partial<TaskUrlState>) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          // 一旦写新 view，强制清掉历史 grid 字段
          if (next.view !== undefined) {
            params.set("view", next.view);
            params.delete("grid");
            if (next.view === "today") params.delete("mode");
          }
          if (next.mode !== undefined) params.set("mode", next.mode);
          if (next.date !== undefined) params.set("date", next.date);
          // status：default "all" 时清掉，缩短 URL
          if (next.status !== undefined) {
            if (next.status === "all") params.delete("status");
            else params.set("status", next.status);
          }
          // tags：空数组清掉
          if (next.tags !== undefined) {
            params.delete("tag"); // 永远清掉老字段
            if (next.tags.length === 0) params.delete("tags");
            else params.set("tags", next.tags.join(","));
          }
          // q：空清掉
          if (next.q !== undefined) {
            if (!next.q) params.delete("q");
            else params.set("q", next.q);
          }
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  return { view, mode, date, status, tags, q, patch };
}
