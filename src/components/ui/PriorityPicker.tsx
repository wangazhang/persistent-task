import { useEffect, useRef, useState } from "react";
import { ChevronDown, Flag } from "lucide-react";
import type { TaskPriority } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 任务优先级选择器：chip 风格按钮 + 下拉 popover。
 *
 * 与 StatusPicker 保持同样的视觉与交互模式：
 *   - 始终显示当前优先级（P0 / P1 / P2）
 *   - 点击 chip 展开 3 选 popover
 *   - 点击外部 / 选中后自动关闭
 *
 * 视觉编码（与状态色刻意区分开）：
 *   - P0 紧急 → 玫红 rose（最强提示）
 *   - P1 重要 → 琥珀 amber（与 warning 类似但带 P1 文字区分）
 *   - P2 一般 → 中性 ink 灰（默认；最弱）
 */

interface PriorityOption {
  value: TaskPriority;
  label: string; // 短文：P0 / P1 / P2
  hint: string; // 长说明，popover 选项里显示
  /** 当前 chip 的配色（按钮主体）*/
  chipClass: string;
  /** popover 选项 hover 配色 */
  hoverClass: string;
  /** 旗帜图标颜色 */
  iconClass: string;
}

const OPTIONS: PriorityOption[] = [
  {
    value: "p0",
    label: "P0",
    hint: "紧急",
    chipClass:
      "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100",
    hoverClass: "hover:bg-rose-50",
    iconClass: "text-rose-500",
  },
  {
    value: "p1",
    label: "P1",
    hint: "重要",
    chipClass:
      "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100",
    hoverClass: "hover:bg-amber-50",
    iconClass: "text-amber-500",
  },
  {
    value: "p2",
    label: "P2",
    hint: "一般",
    chipClass:
      "bg-ink-50 text-ink-600 border border-ink-200 hover:bg-ink-100",
    hoverClass: "hover:bg-ink-50",
    iconClass: "text-ink-400",
  },
];

const OPTION_BY_VALUE = new Map(OPTIONS.map((o) => [o.value, o]));

interface Props {
  /** 当前优先级；undefined 视作 p2（默认） */
  priority: TaskPriority | undefined;
  onChange: (next: TaskPriority) => void;
  size?: "sm" | "md";
  className?: string;
}

export function PriorityPicker({
  priority,
  onChange,
  size = "sm",
  className,
}: Props) {
  const current =
    OPTION_BY_VALUE.get(priority ?? "p2") ?? OPTION_BY_VALUE.get("p2")!;

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  function pick(next: TaskPriority) {
    setOpen(false);
    if (next !== (priority ?? "p2")) onChange(next);
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
        title={`优先级：${current.label}（${current.hint}）— 点击修改`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Flag className={cn("h-3 w-3", current.iconClass)} />
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
          className="absolute left-0 top-full z-30 mt-1 min-w-[7.5rem] overflow-hidden rounded-lg border border-ink-200 bg-white py-1 shadow-card"
          onClick={(e) => e.stopPropagation()}
        >
          {OPTIONS.map((opt) => {
            const isCurrent = opt.value === (priority ?? "p2");
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
                  isCurrent ? "font-semibold text-ink-800" : "text-ink-600"
                )}
              >
                <Flag className={cn("h-3.5 w-3.5", opt.iconClass)} />
                <span className="font-medium">{opt.label}</span>
                <span className="text-[10px] text-ink-400">{opt.hint}</span>
                {isCurrent && (
                  <span className="ml-auto text-[10px] text-ink-400">当前</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
