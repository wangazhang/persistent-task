import { useMemo, useState } from "react";
import { eachDayOfInterval, format, startOfMonth, subDays } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn, fmtDuration, isoDate } from "@/lib/utils";
import { useEventCount } from "@/lib/analytics/useEventStats";
import { useTagStore } from "@/store/tagStore";
import { useTaskStore } from "@/store/taskStore";

type RangeKey = "7d" | "30d" | "month" | "year";

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "month", label: "本月" },
  { value: "year", label: "本年" },
];

/**
 * 根据范围 key 解析出 [start, end] 日期区间（含端点，按天）
 */
function rangeOf(range: RangeKey): { start: Date; end: Date } {
  const end = new Date();
  if (range === "7d") return { start: subDays(end, 6), end };
  if (range === "30d") return { start: subDays(end, 29), end };
  if (range === "month") return { start: startOfMonth(end), end };
  // year
  return { start: new Date(end.getFullYear(), 0, 1), end };
}

export function Stats() {
  const tasks = useTaskStore((s) => s.tasks);
  const pomos = useTaskStore((s) => s.pomodoros);
  const tags = useTagStore((s) => s.tags);
  const collectDescendants = useTagStore((s) => s.collectDescendants);

  const [range, setRange] = useState<RangeKey>("7d");
  const { start, end } = useMemo(() => rangeOf(range), [range]);

  // —— 概览 KPI —— //
  const kpi = useMemo(() => {
    const startStr = isoDate(start);
    const endStr = isoDate(end);
    const inRange = (iso?: string) =>
      !!iso && iso.slice(0, 10) >= startStr && iso.slice(0, 10) <= endStr;

    const completed = tasks.filter(
      (t) => t.status === "done" && inRange(t.completedAt)
    );
    const pomosInRange = pomos.filter((p) =>
      inRange(p.startedAt)
    );
    const focusSec = pomosInRange
      .filter((p) => p.type === "focus")
      .reduce((s, p) => s + p.durationSec, 0);
    const focusCount = pomosInRange.filter(
      (p) => p.type === "focus" && p.completed
    ).length;
    return {
      completedCount: completed.length,
      focusSec,
      focusCount,
      totalTasks: tasks.length,
    };
  }, [tasks, pomos, start, end]);

  // —— 每日趋势 —— //
  const dailyTrend = useMemo(() => {
    const days = eachDayOfInterval({ start, end });
    return days.map((day) => {
      const dStr = isoDate(day);
      const completed = tasks.filter(
        (t) => t.status === "done" && t.completedAt?.startsWith(dStr)
      ).length;
      const focusSec = pomos
        .filter((p) => p.type === "focus" && p.startedAt.startsWith(dStr))
        .reduce((s, p) => s + p.durationSec, 0);
      return {
        date: format(day, "MM-dd"),
        completed,
        focusMin: Math.round(focusSec / 60),
      };
    });
  }, [tasks, pomos, start, end]);

  // —— 按标签维度 —— //
  const tagStats = useMemo(() => {
    const startStr = isoDate(start);
    const endStr = isoDate(end);
    const inRange = (iso?: string) =>
      !!iso && iso.slice(0, 10) >= startStr && iso.slice(0, 10) <= endStr;

    return tags
      .filter((t) => t.parentId === null) // 顶级标签：聚合自身 + 后代
      .map((root) => {
        const ids = new Set(collectDescendants(root.id));
        const taskList = tasks.filter((t) =>
          t.tagIds.some((id) => ids.has(id))
        );
        const completed = taskList.filter(
          (t) => t.status === "done" && inRange(t.completedAt)
        ).length;
        const focusSec = pomos
          .filter((p) => {
            if (!inRange(p.startedAt)) return false;
            if (p.type !== "focus") return false;
            const task = p.taskId
              ? tasks.find((x) => x.id === p.taskId)
              : null;
            if (!task) return false;
            return task.tagIds.some((id) => ids.has(id));
          })
          .reduce((s, p) => s + p.durationSec, 0);
        return {
          name: root.name,
          color: root.color,
          taskCount: taskList.length,
          completed,
          focusSec,
        };
      })
      .filter((s) => s.taskCount > 0 || s.focusSec > 0);
  }, [tasks, pomos, tags, start, end, collectDescendants]);

  // —— 完成情况分布 —— //
  const statusDistribution = useMemo(() => {
    const map: Record<string, number> = {
      待办: 0,
      进行中: 0,
      挂起: 0,
      已完成: 0,
    };
    for (const t of tasks) {
      if (t.status === "todo") map["待办"]++;
      else if (t.status === "in_progress") map["进行中"]++;
      else if (t.status === "suspended") map["挂起"]++;
      else if (t.status === "done") map["已完成"]++;
    }
    return [
      { name: "待办", value: map["待办"], color: "#94a3b8" },
      { name: "进行中", value: map["进行中"], color: "#f59e0b" },
      { name: "挂起", value: map["挂起"], color: "#8b5cf6" },
      { name: "已完成", value: map["已完成"], color: "#10b981" },
    ];
  }, [tasks]);

  const fromIso = useMemo(
    () => new Date(start.getFullYear(), start.getMonth(), start.getDate()).toISOString(),
    [start]
  );
  const toIso = useMemo(() => {
    const e = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59);
    return e.toISOString();
  }, [end]);

  const created = useEventCount(
    { types: ["task.created"], from: fromIso, to: toIso },
    "hour"
  );
  const rescheduled = useEventCount(
    { types: ["task.rescheduled"], from: fromIso, to: toIso },
    "hour"
  );

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-800">统计面板</h1>
          <p className="mt-1 text-sm text-ink-500">
            完成情况、投入时长、标签分布的多维度统计
          </p>
        </div>
        <div className="flex gap-1.5">
          {RANGE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setRange(o.value)}
              className={cn(
                "btn",
                range === o.value
                  ? "bg-brand-600 text-white"
                  : "bg-white border border-ink-200 text-ink-600 hover:bg-ink-50"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </header>

      {/* KPI 卡片 */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label="完成任务"
          value={String(kpi.completedCount)}
          sub={`本范围内`}
        />
        <Kpi
          label="专注时长"
          value={fmtDuration(kpi.focusSec)}
          sub={`完成 ${kpi.focusCount} 个番茄`}
        />
        <Kpi
          label="任务总数"
          value={String(kpi.totalTasks)}
          sub="所有时间"
        />
        <Kpi
          label="日均专注"
          value={fmtDuration(
            Math.round(kpi.focusSec / Math.max(1, dailyTrend.length))
          )}
          sub={`基于 ${dailyTrend.length} 天`}
        />
      </div>

      {/* 趋势 + 状态饼图 */}
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="card md:col-span-2 p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink-700">
            每日完成与专注趋势
          </h3>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={dailyTrend} margin={{ top: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  yAxisId="left"
                  dataKey="completed"
                  name="完成任务数"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  yAxisId="right"
                  dataKey="focusMin"
                  name="专注分钟"
                  fill="#6366f1"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink-700">任务状态分布</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={statusDistribution}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {statusDistribution.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 标签维度 */}
      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink-700">
          按标签维度（顶级标签聚合）
        </h3>
        {tagStats.length === 0 ? (
          <div className="py-8 text-center text-sm text-ink-400">
            本范围内没有数据
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart
                  data={tagStats.map((t) => ({
                    name: t.name,
                    完成: t.completed,
                    任务数: t.taskCount,
                    color: t.color,
                  }))}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "#64748b" }}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    width={64}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="任务数" fill="#cbd5e1" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="完成" fill="#10b981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="space-y-2">
              {tagStats.map((s) => (
                <div
                  key={s.name}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-200/70 bg-white px-3 py-2"
                >
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="text-sm font-medium text-ink-800">
                      {s.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-ink-500">
                    <span className="whitespace-nowrap">
                      {s.taskCount} 任务
                    </span>
                    <span className="whitespace-nowrap text-success-600">
                      {s.completed} 完成
                    </span>
                    <span className="whitespace-nowrap text-brand-600">
                      {fmtDuration(s.focusSec)} 专注
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* —— 任务添加节奏 —— */}
      <section className="mt-8 rounded-2xl border border-ink-200/60 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-ink-700">任务添加节奏（按小时）</h2>
        {created.loading ? (
          <div className="text-xs text-ink-400">加载中…</div>
        ) : created.error ? (
          <div className="text-xs text-rose-500">加载失败</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={fillHours(created.data)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="key" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* —— 改期时段分布 —— */}
      <section className="mt-6 rounded-2xl border border-ink-200/60 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-ink-700">改期时段分布（按小时）</h2>
        {rescheduled.loading ? (
          <div className="text-xs text-ink-400">加载中…</div>
        ) : rescheduled.error ? (
          <div className="text-xs text-rose-500">加载失败</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={fillHours(rescheduled.data)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="key" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* —— 标签完成率排行 —— */}
      <section className="mt-6 rounded-2xl border border-ink-200/60 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-ink-700">标签完成率 Top 10</h2>
        <TagCompletionRanking start={start} end={end} />
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="card px-4 py-3.5">
      <div className="text-[11px] uppercase tracking-wider text-ink-400">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-ink-800">
        {value}
      </div>
      {sub && <div className="text-xs text-ink-400">{sub}</div>}
    </div>
  );
}

/** 把 hour 桶补齐 0..23,空缺按 0 计 */
function fillHours(rows: { key: string; count: number }[]): { key: string; count: number }[] {
  const map = new Map(rows.map((r) => [r.key, r.count]));
  return Array.from({ length: 24 }, (_, h) => {
    const key = String(h).padStart(2, "0");
    return { key, count: map.get(key) ?? 0 };
  });
}

function TagCompletionRanking({ start, end }: { start: Date; end: Date }) {
  const tasks = useTaskStore((s) => s.tasks);
  const tags = useTagStore((s) => s.tags);

  const data = useMemo(() => {
    const startStr = isoDate(start), endStr = isoDate(end);
    const inRange = (iso?: string) =>
      !!iso && iso.slice(0, 10) >= startStr && iso.slice(0, 10) <= endStr;

    return tags
      .map((tag) => {
        const tagged = tasks.filter((t) => (t.tagIds ?? []).includes(tag.id));
        const completed = tagged.filter(
          (t) => t.status === "done" && inRange(t.completedAt)
        );
        return {
          name: tag.name,
          total: tagged.length,
          completed: completed.length,
          rate: tagged.length === 0 ? 0 : completed.length / tagged.length,
        };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 10);
  }, [tasks, tags, start, end]);

  if (data.length === 0) return <div className="text-xs text-ink-400">暂无数据</div>;

  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 26)}>
      <BarChart data={data} layout="vertical" margin={{ left: 60 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
        <YAxis type="category" dataKey="name" width={80} />
        <Tooltip formatter={(v: number) => `${Math.round(v * 100)}%`} />
        <Bar dataKey="rate" fill="#10b981" />
      </BarChart>
    </ResponsiveContainer>
  );
}
