/**
 * review_log 字段的编解码。
 *
 * tasks.review_log 列在 SQLite 里以 **JSON 字符串** 存储（两端 schema 一致），
 * 而内存中的 Task.reviewLog 是结构化数组 TaskReviewEntry[]。
 *
 * 历史教训：Web 端（sqliteAdapter）与 Tauri 端（dataAdapter）各自实现序列化，
 * Tauri 端曾漏掉转换，直接把数组发给期望 Option<String> 的 Rust 命令，
 * 导致带 reviewLog 的 upsert 静默失败（过期待办的处理写不进库）。
 * 现统一走这一份编解码，杜绝两端口径不一致。
 */

import type { TaskReviewEntry } from "./types";

/** DB / IPC 取回的 review_log（JSON 字符串或已是数组）→ 结构化数组 */
export function parseReviewLog(v: unknown): TaskReviewEntry[] | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v as TaskReviewEntry[];
  try {
    const parsed = JSON.parse(String(v));
    return Array.isArray(parsed) ? (parsed as TaskReviewEntry[]) : undefined;
  } catch {
    return undefined;
  }
}

/** 结构化数组 → 落库用的 JSON 字符串；空 / 无则返回 undefined（对应 SQL NULL / Rust None） */
export function serializeReviewLog(
  log?: TaskReviewEntry[]
): string | undefined {
  return log && log.length > 0 ? JSON.stringify(log) : undefined;
}
