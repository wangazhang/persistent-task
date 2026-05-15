// src/routes/tasks/views/_DayTasksPopover.tsx
//
// 双击月/周/年视图的某一天弹出此浮窗：
//   - portal 挂 body，避免被父 overflow 截断
//   - 显示当天任务列表（用 DraggableTaskCard 复用拖拽 + 单击/双击/右键菜单）
//   - 拖动期间整窗 opacity-30 pointer-events-none，让用户看清下方目标格
//   - 关闭：Esc / 点浮窗外 / 拖动成功
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { format, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";
import { X, Plus } from "lucide-react";
import { useDndContext } from "@dnd-kit/core";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DraggableTaskCard } from "./_DraggableTaskCard";

interface Props {
  iso: string;
  tasks: Task[];
  /** 触发器格子的屏幕矩形，用来定位 */
  anchor: DOMRect;
  onClose: () => void;
  onEdit: (t: Task) => void;
  onStartPomodoro?: (t: Task) => void;
  onNewTask?: (iso: string) => void;
}

const POP_W = 320;
const POP_MAX_H = 440;

export function DayTasksPopover({
  iso,
  tasks,
  anchor,
  onClose,
  onEdit,
  onStartPomodoro,
  onNewTask,
}: Props) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const { active } = useDndContext();
  const dragging = !!active;

  // 定位：默认 anchor 右下；越界翻转
  useLayoutEffect(() => {
    function place() {
      const m = 8;
      // 默认右下
      let left = anchor.right + m;
      let top = anchor.top;
      if (left + POP_W > window.innerWidth - m) {
        // 翻到左侧
        left = Math.max(m, anchor.left - POP_W - m);
      }
      if (top + POP_MAX_H > window.innerHeight - m) {
        top = Math.max(m, window.innerHeight - POP_MAX_H - m);
      }
      setPos({ top, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  // Esc + 点外部关闭（拖动期间不响应外部点击，避免误关）
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !dragging) onClose();
    }
    function onMouseDown(e: MouseEvent) {
      if (dragging) return;
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [dragging, onClose]);

  if (!pos) return null;

  const day = parseISO(iso);
  const weekday = format(day, "EEEE", { locale: zhCN });
  const dateLabel = format(day, "yyyy-MM-dd");

  return createPortal(
    <div
      ref={popRef}
      className={cn(
        "fixed z-[60] flex flex-col rounded-xl border border-ink-200 bg-white shadow-xl transition-opacity",
        dragging ? "pointer-events-none opacity-30" : "opacity-100"
      )}
      style={{
        top: pos.top,
        left: pos.left,
        width: POP_W,
        maxHeight: POP_MAX_H,
      }}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between gap-2 border-b border-ink-200/70 px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-ink-800">{dateLabel}</span>
          <span className="text-[11px] text-ink-400">{weekday}</span>
          <span className="text-[11px] text-ink-400">· {tasks.length} 项</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-ink-400">
            拖动:移动 · ⌥拖:复制 · ⇧拖:替换
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            aria-label="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto p-2">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6">
            <p className="text-xs text-ink-400">这天没有任务</p>
            {onNewTask && (
              <button
                type="button"
                onClick={() => onNewTask(iso)}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-ink-300 px-2.5 py-1 text-xs text-ink-500 hover:border-brand-400 hover:text-brand-600"
              >
                <Plus className="h-3 w-3" /> 新建任务
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            {tasks.map((t) => (
              <DraggableTaskCard
                key={t.id}
                task={t}
                fromDate={iso}
                onEdit={onEdit}
                onStartPomodoro={onStartPomodoro ?? (() => {})}
              />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
