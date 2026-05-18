/**
 * 任务状态选择按钮组（待办 / 进行中 / 挂起 / 已完成），4 色与外部图标语义一致：
 *   - todo        → ink     (中性灰)
 *   - in_progress → warning (橙)
 *   - suspended   → paused  (紫)
 *   - done        → success (绿)
 *
 * TaskEditor 与 TaskEditorWindow 共用一份配色，避免两边漂移。
 */

import type { TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Item {
  v: TaskStatus;
  l: string;
  selected: string;
  unselected: string;
}

const ITEMS: Item[] = [
  {
    v: "todo",
    l: "待办",
    selected: "bg-ink-500 text-white border-ink-500",
    unselected: "bg-ink-50 text-ink-600 border-ink-200 hover:bg-ink-100",
  },
  {
    v: "in_progress",
    l: "进行中",
    selected: "bg-warning-500 text-white border-warning-500",
    unselected:
      "bg-warning-50 text-warning-600 border-warning-500/40 hover:bg-warning-50",
  },
  {
    v: "suspended",
    l: "挂起",
    selected: "bg-paused-500 text-white border-paused-500",
    unselected:
      "bg-paused-50 text-paused-600 border-paused-500/40 hover:bg-paused-100",
  },
  {
    v: "done",
    l: "已完成",
    selected: "bg-success-500 text-white border-success-500",
    unselected:
      "bg-success-50 text-success-600 border-success-500/40 hover:bg-success-50",
  },
];

interface Props {
  value: TaskStatus;
  onChange: (v: TaskStatus) => void;
  /** 紧凑模式（按钮内边距更小，用于 popup 等空间紧张场景）*/
  compact?: boolean;
  className?: string;
}

export function StatusButtonGroup({ value, onChange, compact, className }: Props) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {ITEMS.map(({ v, l, selected, unselected }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "inline-flex items-center justify-center rounded-lg border text-xs font-medium transition-colors",
            compact ? "px-2.5 py-1" : "px-3 py-1.5",
            value === v ? `${selected} shadow-sm` : unselected
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
