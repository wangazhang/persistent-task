import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDot,
  PauseCircle,
} from "lucide-react";
import type { TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 任务状态选择器：chip 风格按钮 + 下拉 popover。
 *
 * - 始终显示当前状态（待办 / 进行中 / 挂起 / 已完成）
 * - 点击 chip 展开 4 个选项，点击其一直接切换
 * - 点击外部 / 选中后自动关闭
 *
 * 这里不直接调用 store，由父组件传入 onChange，方便复用与单测。
 */

interface StatusOption {
  value: TaskStatus;
  label: string;
  icon: typeof Circle;
  /** chip 主体配色（未展开时） */
  chipClass: string;
  /** popover 选项 hover 配色 */
  hoverClass: string;
  /** icon 配色（应用于 popover 选项 + 当前 chip） */
  iconClass: string;
}

const OPTIONS: StatusOption[] = [
  {
    value: "todo",
    label: "待办",
    icon: Circle,
    chipClass: "bg-ink-100 text-ink-600 hover:bg-ink-200",
    hoverClass: "hover:bg-ink-50",
    iconClass: "text-ink-500",
  },
  {
    value: "in_progress",
    label: "进行中",
    icon: CircleDot,
    chipClass: "bg-warning-50 text-warning-600 hover:bg-warning-50/80",
    hoverClass: "hover:bg-warning-50",
    iconClass: "text-warning-500",
  },
  {
    value: "suspended",
    label: "挂起",
    icon: PauseCircle,
    chipClass: "bg-paused-50 text-paused-600 hover:bg-paused-100",
    hoverClass: "hover:bg-paused-50",
    iconClass: "text-paused-500",
  },
  {
    value: "done",
    label: "已完成",
    icon: CheckCircle2,
    chipClass: "bg-success-50 text-success-600 hover:bg-success-50/80",
    hoverClass: "hover:bg-success-50",
    iconClass: "text-success-500",
  },
];

const OPTION_BY_VALUE = new Map(OPTIONS.map((o) => [o.value, o]));

interface Props {
  status: TaskStatus;
  onChange: (next: TaskStatus) => void;
  /** 紧凑模式：缩小内边距，适合在卡片元信息行 */
  size?: "sm" | "md";
  className?: string;
}

export function StatusPicker({
  status,
  onChange,
  size = "sm",
  className,
}: Props) {
  // archived 暂未在 UI 暴露，回退到 todo 显示
  const current =
    OPTION_BY_VALUE.get(status) ?? OPTION_BY_VALUE.get("todo")!;
  const Icon = current.icon;

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(next: TaskStatus) {
    setOpen(false);
    if (next !== status) onChange(next);
  }

  const padding = size === "sm" ? "px-2 py-0.5" : "px-2.5 py-1";

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "inline-flex items-center gap-1 rounded-full text-xs font-medium transition-colors",
          padding,
          current.chipClass
        )}
        title="点击修改任务状态"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Icon className={cn("h-3 w-3", current.iconClass)} />
        <span>{current.label}</span>
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 min-w-[8rem] overflow-hidden rounded-lg border border-ink-200 bg-white py-1 shadow-card"
          onClick={(e) => e.stopPropagation()}
        >
          {OPTIONS.map((opt) => {
            const OptIcon = opt.icon;
            const isCurrent = opt.value === status;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isCurrent}
                onClick={() => pick(opt.value)}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors",
                  opt.hoverClass,
                  isCurrent
                    ? "font-semibold text-ink-800"
                    : "text-ink-600"
                )}
              >
                <OptIcon className={cn("h-3.5 w-3.5", opt.iconClass)} />
                <span className="flex-1">{opt.label}</span>
                {isCurrent && (
                  <span className="text-[10px] text-ink-400">当前</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
