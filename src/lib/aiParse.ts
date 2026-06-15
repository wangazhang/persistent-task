/**
 * AI 快速录入：调用 Rust 解析命令的前端包装。
 *
 * 失败返回 { ok: false, error: string }；未配置 Key 时 error = "AI_NOT_CONFIGURED"
 * 可由前端特殊处理（引导去设置页）。
 */

import { isTauri } from "./dataAdapter";
import type { ParsedTaskDraft } from "./quickRecordBridge";

export type { ParsedTaskDraft };

/** 传给 Rust 的已有标签信息（仅 id + name，AI 据此匹配） */
export interface TagLite {
  id: string;
  name: string;
}

export type AiProvider = "anthropic" | "openai";

/** 单个 provider 的配置视图（不含明文 Key） */
export interface AiProviderView {
  hasKey: boolean;
  model: string;
  baseUrl: string;
}

/** 完整 AI 配置（两 provider 都带，与 Rust settings::AiSettingsView 同构） */
export interface AiSettings {
  provider: AiProvider;
  anthropic: AiProviderView;
  openai: AiProviderView;
}

export type ParseResult =
  | { ok: true; drafts: ParsedTaskDraft[] }
  | { ok: false; error: string };

export const ERR_AI_NOT_CONFIGURED = "AI_NOT_CONFIGURED";

/**
 * 解析用户自由文本为任务草稿。
 *
 * @param text  用户输入的自由文本
 * @param today ISO 日期 yyyy-MM-dd（相对时间换算基准）
 * @param tags  已有标签列表（AI 据此做 matchedTagIds）
 */
export async function parseQuickInput(
  text: string,
  today: string,
  tags: TagLite[]
): Promise<ParseResult> {
  if (!isTauri()) {
    return {
      ok: false,
      error: "当前环境不支持 AI 解析（仅 Tauri 模式可用）",
    };
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const drafts = await invoke<ParsedTaskDraft[]>("parse_quick_input", {
      text,
      today,
      tags,
    });
    return { ok: true, drafts };
  } catch (err) {
    const msg = String(err);
    return { ok: false, error: msg };
  }
}

/** 读取 AI 配置（两 provider 都带，不回传明文 Key） */
export async function getAiSettings(): Promise<AiSettings | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<AiSettings>("get_ai_settings");
  } catch {
    return null;
  }
}

/** 切换激活的 provider */
export async function setAiProvider(provider: AiProvider): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_ai_provider", { provider });
}

/**
 * 写入指定 provider 的配置。
 *
 * @param provider 要写哪个 provider
 * @param apiKey   传 undefined 表示不改 key；传空串表示清空（回退环境变量）
 * @param model    空串表示清空（回退该 provider 默认）
 * @param baseUrl  空串表示清空（回退该 provider 官方）
 */
export async function setAiSettings(
  provider: AiProvider,
  apiKey: string | undefined,
  model: string,
  baseUrl: string
): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_ai_settings", {
    provider,
    apiKey: apiKey ?? null,
    model,
    baseUrl,
  });
}

/**
 * 拉取当前 provider 可用的模型 id 列表。需先配好该 provider 的 Key。
 * 返回 { ok, models } 或 { ok:false, error }（error 可能是 ERR_AI_NOT_CONFIGURED）。
 */
export async function listAiModels(): Promise<
  { ok: true; models: string[] } | { ok: false; error: string }
> {
  if (!isTauri()) return { ok: false, error: "仅 Tauri 模式可用" };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const models = await invoke<string[]>("list_ai_models");
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
