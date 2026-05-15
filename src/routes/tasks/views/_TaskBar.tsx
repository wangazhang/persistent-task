// src/routes/tasks/views/_TaskBar.tsx
//
// 月视图中单条跨天任务色带。
//   - 颜色按状态
//   - 仅 isRunStart=true 时显示标题
//   - 圆角条件：左圆 ⇔ isRunStart，右圆 ⇔ isRunEnd
//   - 连续任务两端各 6px resize handle
//
// 单击 = onClick；双击 = onEdit；handle 拖动 = onResize。

import { useRef } from "react";
import type { Task, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { BarSegment } from "./_monthBars";
import { isContiguous } from "@/lib/dateRange";

const STATUS_BAR_CLASS: Record<TaskStatus, string> = {
  todo: "bg-sky-500 text-white",
  in_progress: "bg-warning-500 text-white",
  suspended: "bg-paused-400 text-white",
  done: "bg-ink-300 text-white line-through",
  archived: "bg-ink-200 text-ink-500",
};

const BAR_ROW_STEP_PX = 18;

interface TaskBarProps {
  segment: BarSegment;
  task: Task;
  onClick: () => void;
  onEdit?: (task: Task) => void;
  /** 拖 resize：根据光标位置实时换算落点格子。 */
  onResize?: (
    taskId: string,
    edge: "start" | "end",
    clientX: number,
    clientY: number
  ) => void;
}

export function TaskBar({ segment, task, onClick, onEdit, onResize }: TaskBarProps) {
  const colorClass = STATUS_BAR_CLASS[task.status] ?? STATUS_BAR_CLASS.todo;
  const showHandles =
    !!onResize &&
    isContiguous(task.scheduledDates) &&
    task.scheduledDates.length > 0;
  const draggingEdge = useRef<null | "start" | "end">(null);

  function startDrag(edge: "start" | "end", e: React.MouseEvent) {
    if (!onResize) return;
    e.stopPropagation();
    e.preventDefault();
    draggingEdge.current = edge;
    function move(ev: MouseEvent) {
      if (!draggingEdge.current) return;
      onResize!(task.id, draggingEdge.current, ev.clientX, ev.clientY);
    }
    function up() {
      draggingEdge.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  return (
    <div
      data-task-bar={task.id}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEdit?.(task);
      }}
      title={task.title}
      style={{
        gridRow: 1,
        gridColumn: `${segment.startCol + 1} / span ${segment.endCol - segment.startCol + 1}`,
        marginTop: segment.row * BAR_ROW_STEP_PX,
      }}
      className={cn(
        "group relative h-4 px-2 text-left text-[11px] leading-4 truncate transition-all cursor-pointer",
        "hover:shadow-md hover:-translate-y-px",
        colorClass,
        segment.isRunStart ? "rounded-l-md" : "rounded-l-none",
        segment.isRunEnd ? "rounded-r-md" : "rounded-r-none"
      )}
    >
      {segment.isRunStart && showHandles && (
        <span
          onMouseDown={(e) => startDrag("start", e)}
          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/60"
        />
      )}
      {segment.isRunStart ? task.title : " "}
      {segment.isRunEnd && showHandles && (
        <span
          onMouseDown={(e) => startDrag("end", e)}
          className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/60"
        />
      )}
    </div>
  );
}
