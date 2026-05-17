/**
 * 独立任务编辑窗口桥。
 *
 * task-editor webview 只承载完整编辑表单；真实数据和写入仍由 main 窗口
 * 的 zustand store 处理，避免多个 webview 各自写库导致状态分叉。
 */

import type { Tag, Task, TaskPriority, TaskStatus } from "./types";
import { isTauri } from "./dataAdapter";

const EDITOR_LABEL = "task-editor";
const EV_TARGET = "task-editor:target";
const EV_REQUEST_STATE = "task-editor:request-state";
const EV_STATE = "task-editor:state";
const EV_ACTION = "task-editor:action";

export interface TaskEditorTarget {
  taskId?: string;
  defaultDate?: string;
}

export interface TaskEditorDraft {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  tagIds: string[];
  scheduledDates: string[];
  color: string | null;
  docUrl: string | null;
  docTitle: string | null;
  completedAt?: string | null;
}

export type TaskEditorAction =
  | { kind: "create_task"; draft: TaskEditorDraft }
  | { kind: "update_task"; taskId: string; draft: TaskEditorDraft };

export interface TaskEditorState {
  target: TaskEditorTarget;
  task: Task | null;
  tags: Tag[];
}

export function toTaskEditorUrl(target: TaskEditorTarget): string {
  const params = new URLSearchParams({ win: "task-editor" });
  if (target.taskId) params.set("taskId", target.taskId);
  if (target.defaultDate) params.set("defaultDate", target.defaultDate);
  return `index.html?${params.toString()}`;
}

export function parseTaskEditorTarget(search: string): TaskEditorTarget {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  const taskId = params.get("taskId") || undefined;
  const defaultDate = params.get("defaultDate") || undefined;
  return { ...(taskId ? { taskId } : {}), ...(defaultDate ? { defaultDate } : {}) };
}

export function taskEditorDraftToTaskPatch(draft: TaskEditorDraft): Partial<Task> {
  const patch: Partial<Task> = {
    title: draft.title,
    description: draft.description,
    status: draft.status,
    priority: draft.priority,
    tagIds: draft.tagIds,
    scheduledDates: draft.scheduledDates,
    color: draft.color ?? undefined,
    docUrl: draft.docUrl ?? undefined,
    docTitle: draft.docTitle ?? undefined,
  };
  if (draft.completedAt !== undefined) {
    patch.completedAt = draft.completedAt ?? undefined;
  }
  return patch;
}

export async function openTaskEditorWindow(target: TaskEditorTarget): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_task_editor", {
    taskId: target.taskId ?? null,
    defaultDate: target.defaultDate ?? null,
  });
}

export async function listenTaskEditorTarget(
  handler: (target: TaskEditorTarget) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<TaskEditorTarget>(EV_TARGET, (event) => handler(event.payload));
}

export async function emitTaskEditorTarget(target: TaskEditorTarget): Promise<void> {
  if (!isTauri()) return;
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo(EDITOR_LABEL, EV_TARGET, target);
}

export async function requestTaskEditorState(target: TaskEditorTarget): Promise<void> {
  if (!isTauri()) return;
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo("main", EV_REQUEST_STATE, target);
}

export async function listenTaskEditorStateRequest(
  handler: (target: TaskEditorTarget) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<TaskEditorTarget>(EV_REQUEST_STATE, (event) => handler(event.payload));
}

export async function emitTaskEditorState(state: TaskEditorState): Promise<void> {
  if (!isTauri()) return;
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo(EDITOR_LABEL, EV_STATE, state);
}

export async function listenTaskEditorState(
  handler: (state: TaskEditorState) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<TaskEditorState>(EV_STATE, (event) => handler(event.payload));
}

export async function sendTaskEditorAction(action: TaskEditorAction): Promise<void> {
  if (!isTauri()) return;
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo("main", EV_ACTION, action);
}

export async function listenTaskEditorAction(
  handler: (action: TaskEditorAction) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<TaskEditorAction>(EV_ACTION, (event) => handler(event.payload));
}
