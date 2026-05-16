// src/lib/analytics/useEventStats.ts
import { useEffect, useState } from "react";
import { getAdapter } from "../dataAdapter";
import type { EventCountRow, EventFilter, EventGroupBy } from "./types";

export interface EventStatsState {
  data: EventCountRow[];
  loading: boolean;
  error: string | null;
}

/**
 * 调用 adapter.countEvents(filter, groupBy);filter 改变时自动重取。
 */
export function useEventCount(
  filter: EventFilter,
  groupBy: EventGroupBy
): EventStatsState {
  const [state, setState] = useState<EventStatsState>({
    data: [], loading: true, error: null,
  });
  // 用 JSON 化的 filter 作为依赖,避免对象引用稳定性问题
  const dep = JSON.stringify({ filter, groupBy });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    getAdapter()
      .countEvents(filter, groupBy)
      .then((rows) => {
        if (!cancelled) setState({ data: rows, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ data: [], loading: false, error: String(err) });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);

  return state;
}
