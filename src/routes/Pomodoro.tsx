import { useMemo } from "react";
import { format } from "date-fns";
import { Pause, Play, RotateCcw, Square } from "lucide-react";
import { TagChip } from "@/components/ui/TagChip";
import type { PomodoroType } from "@/lib/types";
import { fmtClock, fmtDuration, isoDate } from "@/lib/utils";
import { targetSecOf, usePomodoroStore } from "@/store/pomodoroStore";
import { useTagStore } from "@/store/tagStore";
import { useTaskStore } from "@/store/taskStore";
import { cn } from "@/lib/utils";

const TYPE_META: Record<
  PomodoroType,
  { label: string; minutes: number; color: string }
> = {
  focus: { label: "专注", minutes: 25, color: "#6366f1" },
  short_break: { label: "短休息", minutes: 5, color: "#10b981" },
  long_break: { label: "长休息", minutes: 15, color: "#f59e0b" },
};

export function Pomodoro() {
  const state = usePomodoroStore((s) => s.state);
  const type = usePomodoroStore((s) => s.type);
  const elapsedSec = usePomodoroStore((s) => s.elapsedSec);
  const taskId = usePomodoroStore((s) => s.taskId);
  const finishedFocusCount = usePomodoroStore((s) => s.finishedFocusCount);
  const setType = usePomodoroStore((s) => s.setType);
  const selectTask = usePomodoroStore((s) => s.selectTask);
  const start = usePomodoroStore((s) => s.start);
  const pause = usePomodoroStore((s) => s.pause);
  const resume = usePomodoroStore((s) => s.resume);
  const stop = usePomodoroStore((s) => s.stop);

  const tasks = useTaskStore((s) => s.tasks);
  const pomodoros = useTaskStore((s) => s.pomodoros);
  const tagsById = useTagStore((s) => s.byId());

  const target = targetSecOf(type);
  const remaining = Math.max(0, target - elapsedSec);
  const progress = Math.min(1, elapsedSec / target);
  const meta = TYPE_META[type];

  const currentTask = taskId ? tasks.find((t) => t.id === taskId) : undefined;

  // 今日番茄钟统计
  const today = isoDate();
  const todayStats = useMemo(() => {
    const todayPomos = pomodoros.filter((p) => p.startedAt.startsWith(today));
    const focusCount = todayPomos.filter(
      (p) => p.type === "focus" && p.completed
    ).length;
    const focusSec = todayPomos
      .filter((p) => p.type === "focus")
      .reduce((sum, p) => sum + p.durationSec, 0);
    return { focusCount, focusSec, totalCount: todayPomos.length };
  }, [pomodoros, today]);

  const recentSessions = useMemo(() => {
    return [...pomodoros]
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      )
      .slice(0, 12);
  }, [pomodoros]);

  // 待选任务（today + in_progress）
  const candidateTasks = useMemo(() => {
    return tasks.filter(
      (t) =>
        t.status !== "done" &&
        (t.scheduledDates.includes(today) || t.status === "in_progress")
    );
  }, [tasks, today]);

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-800">番茄时钟</h1>
        <p className="mt-1 text-sm text-ink-500">
          专注 25 分钟、休息 5 分钟，每 4 个专注后享受一次 15 分钟长休息
        </p>
      </header>

      {/* 类型切换 */}
      <div className="mb-6 flex gap-1.5">
        {(["focus", "short_break", "long_break"] as PomodoroType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            disabled={state !== "idle"}
            className={cn(
              "btn",
              type === t
                ? "bg-brand-600 text-white"
                : "bg-white border border-ink-200 text-ink-600 hover:bg-ink-50"
            )}
          >
            {TYPE_META[t].label} · {TYPE_META[t].minutes}m
          </button>
        ))}
      </div>

      {/* 计时器主体 */}
      <div className="card mb-6 flex flex-col items-center justify-center px-8 py-12">
        {/* 圆环 */}
        <CircularTimer
          progress={progress}
          color={meta.color}
          size={220}
          label={fmtClock(remaining)}
        />

        {/* 关联任务 */}
        <div className="mt-6 w-full max-w-sm">
          <label className="mb-1 block text-xs font-medium text-ink-500">
            关联任务（可选）
          </label>
          <select
            className="input"
            value={taskId ?? ""}
            onChange={(e) => selectTask(e.target.value || undefined)}
            disabled={state !== "idle"}
          >
            <option value="">— 不关联任务 —</option>
            {candidateTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          {currentTask && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {currentTask.tagIds.map((tid) => {
                const tg = tagsById.get(tid);
                return tg ? <TagChip key={tid} tag={tg} /> : null;
              })}
            </div>
          )}
        </div>

        {/* 控制按钮 */}
        <div className="mt-6 flex gap-2">
          {state === "idle" && (
            <button className="btn-primary px-6 py-2.5" onClick={start}>
              <Play className="h-4 w-4" />
              开始 {meta.label}
            </button>
          )}
          {state === "running" && (
            <>
              <button className="btn-secondary px-5" onClick={pause}>
                <Pause className="h-4 w-4" />
                暂停
              </button>
              <button className="btn-secondary px-5" onClick={stop}>
                <Square className="h-4 w-4" />
                结束
              </button>
            </>
          )}
          {state === "paused" && (
            <>
              <button className="btn-primary px-5" onClick={resume}>
                <Play className="h-4 w-4" />
                继续
              </button>
              <button className="btn-secondary px-5" onClick={stop}>
                <RotateCcw className="h-4 w-4" />
                重置
              </button>
            </>
          )}
        </div>
      </div>

      {/* 今日统计 */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat
          label="今日专注"
          value={`${todayStats.focusCount} 个`}
          sub="完成的番茄"
        />
        <Stat
          label="今日时长"
          value={fmtDuration(todayStats.focusSec)}
          sub="累计专注"
        />
        <Stat
          label="本轮长休息"
          value={`${4 - (finishedFocusCount % 4)} 次后`}
          sub="即将到来"
        />
      </div>

      {/* 最近 */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
          最近会话
        </h3>
        {recentSessions.length === 0 ? (
          <div className="card px-6 py-10 text-center text-sm text-ink-400">
            还没有番茄钟记录，开始第一个吧
          </div>
        ) : (
          <div className="card divide-y divide-ink-200/70">
            {recentSessions.map((s) => {
              const t = s.taskId ? tasks.find((x) => x.id === s.taskId) : null;
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate text-ink-800">
                      {t?.title ?? <span className="text-ink-400">— 无关联任务 —</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-400">
                      {format(new Date(s.startedAt), "MM-dd HH:mm")} ·{" "}
                      {TYPE_META[s.type].label} · {fmtDuration(s.durationSec)}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "chip",
                      s.completed
                        ? "bg-success-50 text-success-600"
                        : "bg-ink-100 text-ink-500"
                    )}
                  >
                    {s.completed ? "完成" : "中断"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-400">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-ink-800">{value}</div>
      {sub && <div className="text-xs text-ink-400">{sub}</div>}
    </div>
  );
}

interface CircularTimerProps {
  progress: number; // 0..1
  color: string;
  size: number;
  label: string;
}

function CircularTimer({ progress, color, size, label }: CircularTimerProps) {
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgb(226 232 240)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.5s linear" }}
        />
      </svg>
      <div className="absolute font-mono text-5xl font-semibold tabular-nums tracking-tight text-ink-800">
        {label}
      </div>
    </div>
  );
}
