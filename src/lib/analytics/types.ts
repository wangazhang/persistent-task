// src/lib/analytics/types.ts
/**
 * 一条已定型的事件记录（落库前/读出后的统一形态）。
 */
export interface AnalyticsEvent {
  id: string;
  type: string;
  /** ISO8601 本地时间，例如 2026-05-16T10:23:11+08:00 */
  occurredAt: string;
  entityType: string | null;
  entityId: string | null;
  sessionId: string;
  source: "auto" | "manual";
  /** 自由 JSON;读出时已 parse,写入时由适配层 stringify */
  props: Record<string, unknown>;
}

export interface EventFilter {
  types?: string[];
  entityType?: string;
  entityId?: string;
  sessionId?: string;
  /** ISO8601, 包含 */
  from?: string;
  /** ISO8601, 包含 */
  to?: string;
  /** 默认 200, 最大 2000 */
  limit?: number;
  offset?: number;
}

export type EventGroupBy = "day" | "hour" | "type";

export interface EventCountRow {
  /** day: 'YYYY-MM-DD' / hour: '00'..'23' / type: 事件 type */
  key: string;
  count: number;
}
