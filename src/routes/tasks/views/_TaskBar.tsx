// src/routes/tasks/views/_TaskBar.tsx
//
// 月视图中单条跨天任务色带。
//   - 颜色优先级：task.color（用户自定义）→ STATUS_BAR_CLASS（系统状态色）
//     即使覆盖了 task.color，done 状态的 line-through 仍然生效（语义独立）
//   - 仅 isRunStart=true 时显示标题；续接段保留色块但不重复标题
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

/** 色带在 cell 内的起始 y（避开日期号行 + gap）*/
const BAR_TOP_OFFSET_PX = 24;

/**
 * 列布局公式（与 MonthView 周行 grid-cols-7 gap-1.5 对齐）：
 *   一列宽 = (容器宽度 - 6 * 6px gap) / 7 = (100% - 36px) / 7
 *   一格步进 = 一列宽 + 6px gap
 * 色带跨多列时 width 包含中间 gap，让相邻列在 gap 处视觉贯穿。
 */
const COL_WIDTH = "(100% - 36px) / 7";
const COL_STEP = `((${COL_WIDTH}) + 6px)`;

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
  const useTaskColor = !!task.color;
  const statusClass = STATUS_BAR_CLASS[task.status] ?? STATUS_BAR_CLASS.todo;
  const span = segment.endCol - segment.startCol + 1;
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
        // 绝对定位浮在 cell 之上，跨多列时 width 包含中间 gap 视觉贯穿。
        // pointerEvents:auto 抗住父层 pointer-events:none（cell 点击穿透但色带自身可点）。
        position: "absolute",
        pointerEvents: "auto",
        left: `calc(${segment.startCol} * ${COL_STEP})`,
        width: `calc(${span} * (${COL_WIDTH}) + ${span - 1} * 6px)`,
        top: BAR_TOP_OFFSET_PX + segment.row * BAR_ROW_STEP_PX,
        ...(useTaskColor ? { backgroundColor: task.color, color: "white" } : null),
      }}
      className={cn(
        "group relative h-4 px-2 text-left text-[11px] leading-4 truncate transition-all cursor-pointer",
        "hover:shadow-md hover:-translate-y-px",
        // task.color 优先；否则用状态色。done 的 line-through 始终生效（语义独立）
        useTaskColor
          ? task.status === "done" && "line-through"
          : statusClass,
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
