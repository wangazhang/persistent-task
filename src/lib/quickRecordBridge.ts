/**
 * 独立 AI 快速录入窗口桥。
 *
 * quick-record webview 只解析（解析无副作用，纯 invoke）；入库走事件回 main：
 *   小窗  --commit-->   main  -- addTag/addTask -->  store/adapter
 *   小窗  <--committed-- main  （成功条数）
 *
 * 这一约束沿用 taskEditorBridge 注释里写明的"避免多 webview 各自写库导致状态分叉"铁律。
 */

import { isTauri } from "./dataAdapter";
import type { TaskPriority } from "./types";

const QUICK_RECORD_LABEL = "quick-record";
const EV_COMMIT = "quick-record:commit";
const EV_COMMITTED = "quick-record:committed";

/** AI 解析后的任务草稿（与 Rust commands::ai::ParsedTaskDraft 同构） */
export interface ParsedTaskDraft {
  title: string;
  description: string;
  priority: TaskPriority;
  scheduledDates: string[];
  matchedTagIds: string[];
  newTagNames: string[];
}

/**
 * 用户在确认态勾选并准备入库的任务草稿。
 *
 * 对解析结果做了用户的二次编辑：
 * - 勾选状态决定是否进入此列表（未勾选不入）
 * - selectedNewTagNames 是用户真正想新建的子集（从 newTagNames 里勾选）
 *   ——这样多张卡片命中同一个新标签名时，main 侧可以做"建一次，多卡共用"的去重
 */
export interface QuickRecordCommitDraft {
  title: string;
  description: string;
  priority: TaskPriority;
  scheduledDates: string[];
  matchedTagIds: string[];
  selectedNewTagNames: string[];
}

export interface QuickRecordCommitPayload {
  drafts: QuickRecordCommitDraft[];
}

export interface QuickRecordCommittedPayload {
  /** 实际成功入库的任务条数（main 侧统计）*/
  count: number;
  /** 实际新建的标签条数（多卡命中同名只算一次）*/
  newTagCount: number;
}

// ── 开窗 ──

export async function openQuickRecordWindow(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_quick_record");
}

// ── commit: 小窗 → main ──

export async function emitQuickRecordCommit(
  payload: QuickRecordCommitPayload
): Promise<void> {
  if (!isTauri()) return;
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo("main", EV_COMMIT, payload);
}

export async function listenQuickRecordCommit(
  handler: (payload: QuickRecordCommitPayload) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<QuickRecordCommitPayload>(EV_COMMIT, (e) => handler(e.payload));
}

// ── committed: main → 小窗 ──

export async function emitQuickRecordCommitted(
  payload: QuickRecordCommittedPayload
): Promise<void> {
  if (!isTauri()) return;
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo(QUICK_RECORD_LABEL, EV_COMMITTED, payload);
}

export async function listenQuickRecordCommitted(
  handler: (payload: QuickRecordCommittedPayload) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<QuickRecordCommittedPayload>(EV_COMMITTED, (e) =>
    handler(e.payload)
  );
}
