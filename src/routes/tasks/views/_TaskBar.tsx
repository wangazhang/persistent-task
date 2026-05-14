// src/routes/tasks/views/_TaskBar.tsx
//
// 月视图中单条跨天任务色带。
//   - 颜色按状态（todo 蓝 / in_progress 橙 / suspended 紫 / done 灰+删除线 / archived 浅灰）
//   - 仅 isRunStart=true 时显示标题；续接段保留色块但不重复标题
//   - 圆角条件：左圆 ⇔ isRunStart，右圆 ⇔ isRunEnd

import type { Task, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { BarSegment } from "./_monthBars";

const STATUS_BAR_CLASS: Record<TaskStatus, string> = {
  todo: "bg-sky-500 text-white",
  in_progress: "bg-warning-500 text-white",
  suspended: "bg-paused-400 text-white",
  done: "bg-ink-300 text-white line-through",
  archived: "bg-ink-200 text-ink-500",
};

interface TaskBarProps {
  segment: BarSegment;
  task: Task;
  /** 点击色带：通常切换 DaySection 到 task 起始日 */
  onClick: () => void;
}

export function TaskBar({ segment, task, onClick }: TaskBarProps) {
  const colorClass = STATUS_BAR_CLASS[task.status] ?? STATUS_BAR_CLASS.todo;
  return (
    <button
      type="button"
      data-task-bar={task.id}
      onClick={(e) => {
        e.stopPropagation(); // 不触发下方 DayCell 的点击
        onClick();
      }}
      title={task.title}
      style={{
        gridColumn: `${segment.startCol + 1} / span ${segment.endCol - segment.startCol + 1}`,
      }}
      className={cn(
        "h-4 px-2 text-left text-[11px] leading-4 truncate transition-shadow",
        "hover:shadow-md hover:-translate-y-px",
        colorClass,
        segment.isRunStart ? "rounded-l-md" : "rounded-l-none",
        segment.isRunEnd ? "rounded-r-md" : "rounded-r-none"
      )}
    >
      {segment.isRunStart ? task.title : " " /* 续接段保留高度但不显示文字 */}
    </button>
  );
}
