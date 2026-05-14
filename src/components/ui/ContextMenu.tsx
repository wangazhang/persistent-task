import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X as XIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ContextMenuItem {
  label: string;
  icon?: LucideIcon;
  /** 危险项：红色文本 */
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/** 内嵌色板配置：菜单底部追加一行预设色 + 清除按钮 */
export interface ContextMenuColorPicker {
  /** 当前色（hex 或 undefined）。匹配的预设色会高亮 ring */
  current?: string;
  /** 9 个预设色（来自 src/lib/colors.ts） */
  presets: string[];
  /** 点击预设色 → onChange(hex)；点击清除按钮 → onChange(undefined) */
  onChange: (color: string | undefined) => void;
}

interface ContextMenuProps {
  open: boolean;
  /** 触发点的 viewport 坐标（通常来自 onContextMenu 的 e.clientX/Y） */
  x: number;
  y: number;
  items: ContextMenuItem[];
  /** 可选：菜单底部追加一行内嵌色板（用于"改颜色"） */
  colorPicker?: ContextMenuColorPicker;
  onClose: () => void;
}

/**
 * 通用右键菜单。
 *
 * 通过 portal 渲染到 body，避免被父容器的 overflow 截断。
 * 边界处理：默认从 (x, y) 向右下展开；超出 viewport 时反向贴边。
 */
export function ContextMenu({ open, x, y, items, colorPicker, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState({ x, y });

  // 打开 / 坐标变化时先放在原始位置，再用 useLayoutEffect 测量并反向贴边
  useLayoutEffect(() => {
    if (!open) return;
    setAdjusted({ x, y });
  }, [open, x, y]);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x;
    let ny = y;
    if (x + rect.width > vw - 8) nx = Math.max(8, vw - rect.width - 8);
    if (y + rect.height > vh - 8) ny = Math.max(8, vh - rect.height - 8);
    if (nx !== adjusted.x || ny !== adjusted.y) setAdjusted({ x: nx, y: ny });
    // 只在打开 / 坐标变化时调整一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, x, y]);

  // 点击外部 / ESC 关闭
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    // mousedown 比 click 更早触发，能在按钮 click 之前关闭，避免误命中
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    // 滚动时关闭：避免菜单"漂移"
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={ref}
      style={{ left: adjusted.x, top: adjusted.y }}
      className="fixed z-50 min-w-[10rem] overflow-hidden rounded-lg border border-ink-200 bg-white py-1 shadow-card"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <button
            key={i}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.onClick();
            }}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
              item.disabled
                ? "cursor-not-allowed text-ink-300"
                : item.danger
                ? "text-rose-600 hover:bg-rose-50"
                : "text-ink-700 hover:bg-ink-50"
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            <span className="flex-1">{item.label}</span>
          </button>
        );
      })}
      {colorPicker && (
        <div className="mt-1 border-t border-ink-100 px-3 pb-1.5 pt-2">
          <div className="mb-1 text-[10px] text-ink-400">颜色</div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                onClose();
                colorPicker.onChange(undefined);
              }}
              title="清除颜色（恢复默认）"
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-ink-300 text-ink-400 hover:border-ink-500 hover:text-ink-600",
                !colorPicker.current && "ring-2 ring-ink-700 ring-offset-1"
              )}
            >
              <XIcon className="h-2.5 w-2.5" />
            </button>
            {colorPicker.presets.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onClose();
                  colorPicker.onChange(c);
                }}
                title={c}
                style={{ backgroundColor: c }}
                className={cn(
                  "h-5 w-5 rounded-full transition-all hover:scale-110",
                  colorPicker.current === c &&
                    "ring-2 ring-ink-700 ring-offset-1"
                )}
              />
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
