import { useMemo } from "react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Plus } from "lucide-react";
import { TaskCard } from "@/components/task/TaskCard";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import type { Task } from "@/lib/types";
import { listColumnsClass, useListColumns } from "@/lib/listColumns";
import type { DayInfo } from "./_helpers";
import { DraggableTaskCard } from "./_DraggableTaskCard";

/**
 * 选中日详情区：active / 已挂起 / 已完成 三组分组折叠。
 *
 * enableDrag=true 时（Month View 用），active 区任务卡可拖到月历格上的别的一天；
 * 已挂起 / 已完成区不参与拖拽——避免对历史归档项的误操作。
 *
 * 该组件必须挂在某个 <DndContext> 内部，外层 view 负责处理 onDragEnd。
 */

interface DaySectionProps {
  iso: string;
  info: DayInfo | undefined;
  filterActive: boolean;
  onEdit: (t: Task) => void;
  onStartPomodoro: (t: Task) => void;
  onNewTask: () => void;
  /** 启用后 active 区任务卡支持拖到月历格 */
  enableDrag?: boolean;
}

export function DaySection({
  iso,
  info,
  filterActive,
  onEdit,
  onStartPomodoro,
  onNewTask,
  enableDrag,
}: DaySectionProps) {
  const [cols] = useListColumns();
  const allTasks = info?.tasks ?? [];
  const groups = useMemo(() => {
    const active: Task[] = [];
    const suspended: Task[] = [];
    const done: Task[] = [];
    for (const t of allTasks) {
      if (t.status === "suspended") suspended.push(t);
      else if (t.status === "done" || t.status === "archived") done.push(t);
      else active.push(t);
    }
    return { active, suspended, done };
  }, [allTasks]);

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink-700">
          {format(new Date(iso), "yyyy 年 M 月 d 日 EEEE", { locale: zhCN })}
          <span className="ml-2 text-xs font-normal text-ink-400">
            {allTasks.length === 0
              ? filterActive
                ? "在当前标签筛选下没有任务"
                : "暂无任务"
              : `${allTasks.length} 个任务${
                  info && info.done > 0 ? `，已完成 ${info.done} 个` : ""
                }`}
          </span>
        </h3>
        <button type="button" className="btn-secondary text-xs" onClick={onNewTask}>
          <Plus className="h-3.5 w-3.5" />
          在这一天新建任务
        </button>
      </div>

      {allTasks.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-ink-400">
          {filterActive ? "试试清空上方的标签筛选" : "这一天没有安排任务"}
        </div>
      ) : (
        <>
          {groups.active.length > 0 && (
            <div className={listColumnsClass(cols)}>
              {groups.active.map((t) =>
                enableDrag ? (
                  <DraggableTaskCard
                    key={t.id}
                    task={t}
                    fromDate={iso}
                    onEdit={onEdit}
                    onStartPomodoro={onStartPomodoro}
                  />
                ) : (
                  <TaskCard
                    key={t.id}
                    task={t}
                    onEdit={onEdit}
                    onStartPomodoro={onStartPomodoro}
                  />
                )
              )}
            </div>
          )}
          <CollapsibleSection
            title="已挂起"
            count={groups.suspended.length}
            tone="paused"
            defaultOpen
          >
            {groups.suspended.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                onEdit={onEdit}
                onStartPomodoro={onStartPomodoro}
              />
            ))}
          </CollapsibleSection>
          <CollapsibleSection
            title="已完成"
            count={groups.done.length}
            tone="success"
            defaultOpen
          >
            {groups.done.map((t) => (
              <TaskCard key={t.id} task={t} onEdit={onEdit} />
            ))}
          </CollapsibleSection>
        </>
      )}
    </section>
  );
}

