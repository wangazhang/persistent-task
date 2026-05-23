import { CalendarDays, ListTodo } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskSurfaceMode } from "../useTaskUrlState";

interface ViewFaceToggleProps {
  mode: TaskSurfaceMode;
  onChange: (mode: TaskSurfaceMode) => void;
}

const OPTIONS: Array<{
  mode: TaskSurfaceMode;
  label: string;
  icon: typeof CalendarDays;
}> = [
  { mode: "time", label: "时间视图", icon: CalendarDays },
  { mode: "tasks", label: "任务视图", icon: ListTodo },
];

export function ViewFaceToggle({ mode, onChange }: ViewFaceToggleProps) {
  return (
    <div
      className="inline-flex overflow-hidden rounded-lg border border-ink-200 bg-white"
      aria-label="切换时间视图和任务视图"
    >
      {OPTIONS.map(({ mode: value, label, icon: Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            className={cn(
              "inline-flex h-8 w-10 items-center justify-center transition-colors",
              active
                ? "bg-brand-600 text-white"
                : "bg-white text-ink-500 hover:bg-ink-50 hover:text-ink-700"
            )}
            aria-label={label}
            aria-pressed={active}
            title={label}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
