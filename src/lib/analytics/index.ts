// src/lib/analytics/index.ts
/**
 * 埋点对外 API。
 *
 * 业务/UI 代码只 import { track, flushNow } from "@/lib/analytics"
 * 其他符号属内部实现,不导出。
 */
import { getAdapter } from "../dataAdapter";
import { uid } from "../utils";
import { createBuffer, type Buffer } from "./buffer";
import { entityFromProps, isKnownType, type EventMap } from "./registry";
import { sessionManager } from "./session";
import type { AnalyticsEvent } from "./types";

const CRITICAL = new Set<string>([
  "app.launched",
  "pomodoro.completed",
]);

let buffer: Buffer | null = null;

function getBuffer(): Buffer {
  if (buffer) return buffer;
  buffer = createBuffer({
    threshold: 50,
    intervalMs: 2000,
    criticalTypes: CRITICAL,
    writer: async (batch) => {
      await getAdapter().insertEvents(batch);
    },
  });
  return buffer;
}

export interface TrackOptions {
  source?: "auto" | "manual";
}

/**
 * 显式埋点入口。强类型:type 必须在 EventMap 中,props 类型严格匹配。
 *
 * 不阻塞业务,异常仅在 dev 模式 console.warn。
 */
export function track<K extends keyof EventMap>(
  type: K,
  props: EventMap[K],
  opts: TrackOptions = {}
): void {
  try {
    if (!isKnownType(type)) {
      if (import.meta.env?.DEV) {
        console.warn(`[analytics] unknown type: ${type}`);
      }
      return;
    }
    const propsObj = (props ?? {}) as Record<string, unknown>;
    const { entityType, entityId } = entityFromProps(propsObj);
    const event: AnalyticsEvent = {
      id: uid("evt-"),
      type,
      occurredAt: new Date().toISOString(),
      entityType,
      entityId,
      sessionId: sessionManager.touch(),
      source: opts.source ?? "manual",
      props: propsObj,
    };
    getBuffer().push(event);
  } catch (err) {
    if (import.meta.env?.DEV) {
      console.warn("[analytics] track() failed", err);
    }
  }
}

/** 立即把 buffer 写出（退出钩子用） */
export async function flushNow(): Promise<void> {
  if (buffer) await buffer.flushNow();
}

/** 当前 sessionId（调试用） */
export function currentSessionId(): string {
  return sessionManager.current();
}

// 重导出供 store 中间件使用
export { withTracking } from "./middleware";
export type { EventMap, EventType } from "./registry";
