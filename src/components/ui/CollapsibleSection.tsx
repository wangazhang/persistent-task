import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 列表分组容器：标题 + 计数 + 折叠按钮，children 自管内容。
 *
 * 用于 Today / Tasks / Calendar 中的"已挂起"、"已完成"等分组。
 * 用 useState 而非外部受控：不同页面打开折叠状态相互独立，
 * 避免一个 key 改了另一个也跟着动。
 *
 * 设计选择：折叠状态不持久化（刷新后回到默认），
 * 这样每次回到页面有"已完成 N 项"的提醒效果，又不会展开太长。
 */
interface Props {
  title: string;
  count: number;
  /** 默认是否展开。提醒型分组（如 "已挂起"）建议 true，归档型（"已完成"）建议 false */
  defaultOpen?: boolean;
  /** 计数 chip 的色调；默认 ink */
  tone?: "ink" | "paused" | "success";
  children: React.ReactNode;
  className?: string;
}

export function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  tone = "ink",
  children,
  className,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;

  const toneClass =
    tone === "paused"
      ? "bg-paused-50 text-paused-600"
      : tone === "success"
      ? "bg-success-50 text-success-600"
      : "bg-ink-100 text-ink-600";

  return (
    <section className={cn("mt-6", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-2 flex w-full items-center gap-1.5 text-left"
        aria-expanded={open}
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-ink-400 transition-transform",
            !open && "-rotate-90"
          )}
        />
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          {title}
        </span>
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
            toneClass
          )}
        >
          {count}
        </span>
      </button>
      {open && <div className="space-y-2">{children}</div>}
    </section>
  );
}
