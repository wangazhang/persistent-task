// src/lib/analytics/registry.ts
/**
 * 事件 registry。
 *
 * 隐私约定（接入新事件时必读）：
 *   - 不写明文 task title,只写 entity_id
 *   - 搜索查询只记 queryLength,不记内容
 *   - props 中如出现 url,只记 host,不记 path/query
 */

import type { TaskPriority } from "../types";

export type EventMap = {
  // task domain
  "task.created":           { taskId: string; priority: TaskPriority; tagIds: string[]; hasDoc: boolean };
  "task.updated":           { taskId: string; fields: string[] };
  "task.completed":         { taskId: string };
  "task.uncompleted":       { taskId: string };
  "task.deleted":           { taskId: string };
  "task.scheduled":         { taskId: string; date: string };
  "task.unscheduled":       { taskId: string; date: string };
  "task.rescheduled":       { taskId: string; fromDate: string; toDate: string; mode: "move" | "add" | "replace" };
  "task.tagged":            { taskId: string; tagId: string };
  "task.untagged":          { taskId: string; tagId: string };
  "task.priority_changed":  { taskId: string; from: TaskPriority; to: TaskPriority };
  "task.reordered":         { date: string; count: number };

  // pomodoro domain
  "pomodoro.started":       { taskId?: string; type: "focus" | "short_break" | "long_break" };
  "pomodoro.completed":     { taskId?: string; type: "focus" | "short_break" | "long_break"; durationSec: number };
  "pomodoro.cancelled":     { taskId?: string; type: "focus" | "short_break" | "long_break"; elapsedSec: number };

  // tag domain
  "tag.created":            { tagId: string; parentId: string | null; color: string };
  "tag.renamed":            { tagId: string };
  "tag.deleted":            { tagId: string; cascadeCount: number };
  "tag.moved":              { tagId: string; newParentId: string | null };

  // ui domain
  "ui.route.enter":         { route: string };
  "ui.dialog.open":         { dialog: string };
  "ui.popover.open":        { popover: string; date?: string };
  "ui.search.used":         { queryLength: number };
  "ui.export":              { kind: "db" };
  "ui.import":              { kind: "db" };

  // app domain
  "app.launched":           { platform: "tauri" | "web" };
  "app.hydrated":           { platform: "tauri" | "web"; durationMs: number };
};

export type EventType = keyof EventMap;

export const KNOWN_TYPES: EventType[] = [
  "task.created", "task.updated", "task.completed", "task.uncompleted",
  "task.deleted", "task.scheduled", "task.unscheduled", "task.rescheduled",
  "task.tagged", "task.untagged", "task.priority_changed", "task.reordered",
  "pomodoro.started", "pomodoro.completed", "pomodoro.cancelled",
  "tag.created", "tag.renamed", "tag.deleted", "tag.moved",
  "ui.route.enter", "ui.dialog.open", "ui.popover.open", "ui.search.used",
  "ui.export", "ui.import",
  "app.launched", "app.hydrated",
];

const KNOWN_SET = new Set<string>(KNOWN_TYPES);

export function isKnownType(t: string): t is EventType {
  return KNOWN_SET.has(t);
}

/**
 * 从 props 抽出 (entity_type, entity_id),约定字段名：
 *   taskId   -> ('task', value)
 *   tagId    -> ('tag', value)
 *   route    -> ('route', value)
 *   popover  -> ('popover', value)
 *   dialog   -> ('dialog', value)
 * 都没命中则返回 (null, null)。
 */
export function entityFromProps(
  props: Record<string, unknown>
): { entityType: string | null; entityId: string | null } {
  const pairs: Array<[string, string]> = [
    ["taskId", "task"],
    ["tagId", "tag"],
    ["route", "route"],
    ["popover", "popover"],
    ["dialog", "dialog"],
  ];
  for (const [key, type] of pairs) {
    const v = props[key];
    if (typeof v === "string" && v.length > 0) {
      return { entityType: type, entityId: v };
    }
  }
  return { entityType: null, entityId: null };
}
