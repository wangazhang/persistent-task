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

/** 单条色带 lane 步长：h-4 (16px) + 2px gap */
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
  /** 点击色带：通常切换 DaySection 到 task 起始日 */
  onClick: () => void;
  /** 双击色带：打开编辑器 */
  onEdit?: (task: Task) => void;
}

export function TaskBar({ segment, task, onClick, onEdit }: TaskBarProps) {
  const colorClass = STATUS_BAR_CLASS[task.status] ?? STATUS_BAR_CLASS.todo;
  const span = segment.endCol - segment.startCol + 1;
  return (
    <button
      type="button"
      data-task-bar={task.id}
      onClick={(e) => {
        e.stopPropagation(); // 不触发下方 DayCell 的点击
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
      }}
      className={cn(
        "h-4 px-2 text-left text-[11px] leading-4 truncate transition-all",
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
