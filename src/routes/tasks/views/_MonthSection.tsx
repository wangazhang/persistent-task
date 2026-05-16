import { useMemo } from "react";
import { format, isSameMonth, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";
import { TaskCard } from "@/components/task/TaskCard";
import type { Task } from "@/lib/types";
import { listColumnsClass, useListColumns } from "@/lib/listColumns";

/**
 * 本月任务清单。
 *
 * 范围：任务的 scheduledDates 与目标月份有任何交集就算"本月任务"
 *       —— 跨月任务在本月视图里也会出现，对应需求里"穿越本月"。
 * 分组：已完成 → 进行中 → 待办 → 挂起（archived 不显示）
 * 组内排序：已完成按 completedAt 倒序；其它按 updatedAt 倒序。
 * 标签筛选：调用方先在 tasks prop 里过滤好（与 MonthView 月历共用同一份筛选语义）。
 */

interface Props {
  /** 当前月份的任意一天（一般传 cursor）*/
  monthAnchor: Date;
  /** 已经按标签筛过的任务列表（MonthView 用 useTagFilterSet 过滤）*/
  tasks: Task[];
  /** 标签筛选是否激活，用于空状态提示文案 */
  filterActive: boolean;
  onEdit: (t: Task) => void;
  onStartPomodoro: (t: Task) => void;
}

type GroupKey = "done" | "in_progress" | "todo" | "suspended";

const GROUP_META: Record<
  GroupKey,
  { title: string; emptyHide: boolean; toneClass: string }
> = {
  done: {
    title: "已完成",
    emptyHide: true,
    toneClass: "bg-success-50 text-success-600",
  },
  in_progress: {
    title: "进行中",
    emptyHide: true,
    toneClass: "bg-warning-50 text-warning-600",
  },
  todo: {
    title: "待办",
    emptyHide: true,
    toneClass: "bg-ink-100 text-ink-600",
  },
  suspended: {
    title: "已挂起",
    emptyHide: true,
    toneClass: "bg-paused-50 text-paused-600",
  },
};
const GROUP_ORDER: GroupKey[] = ["done", "in_progress", "todo", "suspended"];

function groupOf(t: Task): GroupKey | null {
  if (t.status === "archived") return null;
  if (t.status === "done") return "done";
  if (t.status === "in_progress") return "in_progress";
  if (t.status === "suspended") return "suspended";
  return "todo";
}

function sortKey(t: Task): number {
  const iso = t.completedAt ?? t.updatedAt;
  return iso ? new Date(iso).getTime() : 0;
}

export function MonthSection({
  monthAnchor,
  tasks,
  filterActive,
  onEdit,
  onStartPomodoro,
}: Props) {
  const [cols] = useListColumns();

  const groups = useMemo(() => {
    const buckets: Record<GroupKey, Task[]> = {
      done: [],
      in_progress: [],
      todo: [],
      suspended: [],
    };

    for (const t of tasks) {
      // scheduledDates 与本月有交集 → 算本月任务
      const hit = t.scheduledDates.some((d) =>
        isSameMonth(parseISO(d), monthAnchor)
      );
      if (!hit) continue;

      const g = groupOf(t);
      if (!g) continue;
      buckets[g].push(t);
    }

    // 组内倒序
    for (const k of GROUP_ORDER) {
      buckets[k].sort((a, b) => sortKey(b) - sortKey(a));
    }
    return buckets;
  }, [tasks, monthAnchor]);

  const total =
    groups.done.length +
    groups.in_progress.length +
    groups.todo.length +
    groups.suspended.length;

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-baseline gap-2">
        <h3 className="text-sm font-medium text-ink-700">
          {format(monthAnchor, "yyyy 年 M 月", { locale: zhCN })} 任务汇总
        </h3>
        <span className="text-xs font-normal text-ink-400">
          {total === 0
            ? filterActive
              ? "在当前标签筛选下，本月没有任务"
              : "本月暂无任务"
            : `共 ${total} 项 · 已完成 ${groups.done.length}`}
        </span>
      </div>

      {total === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-ink-400">
          {filterActive ? "试试清空上方的标签筛选" : "这一月没有安排任务"}
        </div>
      ) : (
        <div className="space-y-5">
          {GROUP_ORDER.map((key) => {
            const items = groups[key];
            if (GROUP_META[key].emptyHide && items.length === 0) return null;
            return (
              <div key={key}>
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                    {GROUP_META[key].title}
                  </span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${GROUP_META[key].toneClass}`}
                  >
                    {items.length}
                  </span>
                </div>
                <div className={listColumnsClass(cols)}>
                  {items.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      onEdit={onEdit}
                      onStartPomodoro={onStartPomodoro}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
