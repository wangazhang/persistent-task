// src/routes/data/tables/EventsTable.tsx
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { getAdapter } from "@/lib/dataAdapter";
import { KNOWN_TYPES, type EventType } from "@/lib/analytics/registry";
import type { AnalyticsEvent, EventFilter } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 200;

const TYPE_GROUPS: Record<string, EventType[]> = {
  task: KNOWN_TYPES.filter((t) => t.startsWith("task.")),
  pomodoro: KNOWN_TYPES.filter((t) => t.startsWith("pomodoro.")),
  tag: KNOWN_TYPES.filter((t) => t.startsWith("tag.")),
  ui: KNOWN_TYPES.filter((t) => t.startsWith("ui.")),
  app: KNOWN_TYPES.filter((t) => t.startsWith("app.")),
};

function todayIso(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function EventsTable() {
  // 默认只显示任务相关事件;不必每次进来都看 UI 噪声
  const [types, setTypes] = useState<EventType[]>(() => [...TYPE_GROUPS.task]);
  const [from, setFrom] = useState<string>(todayIso().from);
  const [to, setTo] = useState<string>(todayIso().to);
  const [entityId, setEntityId] = useState<string>("");
  const [rows, setRows] = useState<AnalyticsEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filter: EventFilter = useMemo(
    () => ({
      types: types.length > 0 ? types : undefined,
      from,
      to,
      entityId: entityId.trim() || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [types, from, to, entityId, offset]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAdapter()
      .queryEvents(filter)
      .then((res) => {
        if (cancelled) return;
        if (offset === 0) setRows(res);
        else setRows((prev) => [...prev, ...res]);
        setHasMore(res.length === PAGE_SIZE);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [JSON.stringify(filter)]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    setOffset(0);
  };

  const toggleType = (t: EventType) => {
    setOffset(0);
    setTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  /**
   * 点击 group 标签的行为（独立切换,不影响其他 group）：
   *   - 当前 group 全部已选 → 取消该组所有
   *   - 否则 → 把该组所有加进选择
   * 多个 group 之间叠加（不是排他）。
   */
  const onGroupClick = (group: keyof typeof TYPE_GROUPS) => {
    setOffset(0);
    const groupTypes = TYPE_GROUPS[group];
    const allSelected = groupTypes.every((t) => types.includes(t));
    setTypes((prev) => {
      const others = prev.filter((t) => !groupTypes.includes(t));
      return allSelected ? others : [...others, ...groupTypes];
    });
  };

  const clearTypes = () => {
    setOffset(0);
    setTypes([]);
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {/* 过滤栏 */}
      <div className="rounded-lg border border-ink-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <input
            type="datetime-local"
            value={from.slice(0, 16)}
            onChange={(e) => { setOffset(0); setFrom(new Date(e.target.value).toISOString()); }}
            className="rounded border border-ink-200 px-2 py-1"
          />
          <span className="text-ink-400">→</span>
          <input
            type="datetime-local"
            value={to.slice(0, 16)}
            onChange={(e) => { setOffset(0); setTo(new Date(e.target.value).toISOString()); }}
            className="rounded border border-ink-200 px-2 py-1"
          />
          <input
            type="text"
            placeholder="entity_id"
            value={entityId}
            onChange={(e) => { setOffset(0); setEntityId(e.target.value); }}
            className="rounded border border-ink-200 px-2 py-1 w-40"
          />
          <button
            type="button"
            onClick={refresh}
            className="ml-auto inline-flex items-center gap-1 rounded border border-ink-200 px-2 py-1 hover:bg-ink-50"
          >
            <RefreshCw className="h-3 w-3" />刷新
          </button>
        </div>

        {/* 类型分组多选 */}
        <div className="mt-3 space-y-1">
          {(Object.entries(TYPE_GROUPS) as [keyof typeof TYPE_GROUPS, EventType[]][]).map(([group, ts]) => {
            const allSelected = ts.length > 0 && ts.every((t) => types.includes(t));
            return (
              <div key={group} className="flex items-start gap-1.5">
                <button
                  type="button"
                  onClick={() => onGroupClick(group)}
                  className={cn(
                    "w-16 shrink-0 py-0.5 text-left text-[11px] uppercase",
                    allSelected ? "font-semibold text-brand-700" : "text-ink-400 hover:text-ink-600"
                  )}
                  title={allSelected ? "取消全选这一组" : "全选这一组"}
                >
                  {group}
                </button>
                <div className="flex flex-1 flex-wrap items-center gap-1.5">
                  {ts.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleType(t)}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px]",
                        types.includes(t)
                          ? "border-brand-500 bg-brand-50 text-brand-700"
                          : "border-ink-200 text-ink-500 hover:bg-ink-50"
                      )}
                    >
                      {t.split(".")[1]}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="pt-1 text-[11px] text-ink-400">
            {types.length === 0 ? (
              <span>未选 = 显示全部事件</span>
            ) : (
              <button
                type="button"
                onClick={clearTypes}
                className="text-ink-500 underline-offset-2 hover:underline"
              >
                清空筛选(显示全部)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 列表 */}
      <div className="rounded-lg border border-ink-200 bg-white">
        {error && <div className="p-3 text-xs text-rose-500">加载失败：{error}</div>}
        {!error && rows.length === 0 && !loading && (
          <div className="p-3 text-xs text-ink-400">无事件</div>
        )}
        <ul className="divide-y divide-ink-100">
          {rows.map((e) => {
            const open = expanded.has(e.id);
            return (
              <li key={e.id} className="px-3 py-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => toggleExpand(e.id)}
                  className="flex w-full items-center gap-2 text-left"
                >
                  {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <span className="text-ink-400">{e.occurredAt.slice(11, 19)}</span>
                  <span className="font-mono text-ink-700">{e.type}</span>
                  {e.entityType && (
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-600">
                      {e.entityType}:{e.entityId}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-ink-400">
                    {e.source}
                  </span>
                </button>
                {open && (
                  <pre className="mt-1 ml-5 overflow-x-auto rounded bg-ink-50 p-2 text-[11px] text-ink-700">
                    {JSON.stringify(e.props, null, 2)}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between border-t border-ink-100 px-3 py-2 text-[11px] text-ink-500">
          <span>{loading ? "加载中…" : `已加载 ${rows.length} 条`}</span>
          {hasMore && !loading && (
            <button
              type="button"
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              className="rounded border border-ink-200 px-2 py-1 hover:bg-ink-50"
            >
              加载更多
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
