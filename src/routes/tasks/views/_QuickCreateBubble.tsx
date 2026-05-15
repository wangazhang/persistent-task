// src/routes/tasks/views/_QuickCreateBubble.tsx
//
// 月视图拖选完成后浮在屏上的小气泡：
//   - 显示选中区间
//   - 一行 input：回车创建，Esc / 点外部取消
import { useEffect, useRef, useState } from "react";

interface Props {
  start: string;
  end: string;
  truncated: boolean;
  /** 屏幕坐标，气泡左上角 */
  x: number;
  y: number;
  onCreate: (title: string) => void;
  onCancel: () => void;
}

export function QuickCreateBubble({
  start,
  end,
  truncated,
  x,
  y,
  onCreate,
  onCancel,
}: Props) {
  const [title, setTitle] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onCancel();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onCancel]);

  const days = (() => {
    const a = new Date(start);
    const b = new Date(end);
    return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
  })();

  return (
    <div
      ref={ref}
      className="fixed z-50 w-[260px] rounded-lg border border-ink-200 bg-white p-2.5 shadow-card"
      style={{ left: x, top: y }}
    >
      <div className="mb-1.5 text-[11px] text-ink-500">
        {start === end ? start : `${start} → ${end}（${days} 天）`}
        {truncated && <span className="ml-1 text-amber-600">· 单次拖选限本周</span>}
      </div>
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && title.trim()) {
            onCreate(title.trim());
          }
        }}
        placeholder="快速新建任务（Enter 创建 · Esc 取消）"
        className="input w-full text-xs"
      />
    </div>
  );
}
