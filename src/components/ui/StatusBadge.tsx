import type { TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_META: Record<
  TaskStatus,
  { label: string; className: string }
> = {
  todo: {
    label: "待办",
    className: "bg-ink-100 text-ink-600",
  },
  in_progress: {
    label: "进行中",
    className: "bg-warning-50 text-warning-600",
  },
  suspended: {
    label: "挂起",
    className: "bg-paused-50 text-paused-600",
  },
  done: {
    label: "已完成",
    className: "bg-success-50 text-success-600",
  },
  archived: {
    label: "已归档",
    className: "bg-ink-100 text-ink-400 line-through",
  },
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={cn("chip", meta.className)}>{meta.label}</span>
  );
}
