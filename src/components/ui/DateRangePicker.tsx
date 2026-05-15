// src/components/ui/DateRangePicker.tsx
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  addMonths,
  endOfMonth,
  format,
  getDay,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { zhCN } from "date-fns/locale";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  expandRange,
  getRange,
  isContiguous,
  presetNextWeek,
  presetThisWeek,
  presetToday,
  presetTomorrow,
} from "@/lib/dateRange";

interface Props {
  value: string[];
  onChange: (dates: string[]) => void;
  className?: string;
}

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

export function DateRangePicker({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  // 弹层中正在选择的"待定"区间。null = 还没开始新一轮选。
  const [pending, setPending] = useState<{ start: string; end: string | null } | null>(
    null
  );
  // 弹层翻页用的"当前显示月"（不影响 value）。
  const initialCursor = (() => {
    const r = getRange(value);
    return r ? parseISO(r.start) : new Date();
  })();
  const [cursor, setCursor] = useState<Date>(initialCursor);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // 弹层屏幕坐标（portal 渲染需要）
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);

  // 每次打开重置 pending 并把 cursor 对齐到当前 value
  useEffect(() => {
    if (open) {
      setPending(null);
      const r = getRange(value);
      if (r) setCursor(parseISO(r.start));
    }
  }, [open, value]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (containerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
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

  // 弹层定位：基于触发器位置，按可视窗口边界翻转
  useLayoutEffect(() => {
    if (!open) {
      setPopPos(null);
      return;
    }
    function place() {
      const trig = triggerRef.current;
      if (!trig) return;
      const r = trig.getBoundingClientRect();
      const W = 280;
      const H = 340; // 估算高度（导航 + 预设 + 6 行日历 + 提示）
      const margin = 4;
      // 默认向下；下方不够时向上翻
      let top = r.bottom + margin;
      if (top + H > window.innerHeight - margin) {
        top = Math.max(margin, r.top - H - margin);
      }
      // 默认左对齐；右边出界时贴右
      let left = r.left;
      if (left + W > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - W - margin);
      }
      setPopPos({ top, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // 触发器文案
  const range = getRange(value);
  const contiguous = isContiguous(value);
  const triggerLabel = (() => {
    if (!range) return "未排期";
    if (range.start === range.end) {
      return `${range.start}（周${WEEKDAY_LABELS[(getDay(parseISO(range.start)) + 6) % 7]}）`;
    }
    const days = value.length;
    const suffix = contiguous ? `（${days} 天）` : `（${days} 天 · 不连续）`;
    return `${range.start} → ${range.end}${suffix}`;
  })();

  function commitRange(start: string, end: string) {
    onChange(expandRange(start, end));
    setOpen(false);
    setPending(null);
  }

  function clickDay(iso: string) {
    if (!pending) {
      setPending({ start: iso, end: null });
      return;
    }
    if (pending.end === null) {
      // 第二点 = 终点
      commitRange(pending.start, iso);
      return;
    }
    // 已有完整待定 → 视为重新开始
    setPending({ start: iso, end: null });
  }

  function applyPreset(dates: string[]) {
    onChange(dates);
    setOpen(false);
    setPending(null);
  }
  function clearAll() {
    onChange([]);
    setOpen(false);
    setPending(null);
  }

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-xs transition-colors",
          range ? "text-ink-700 hover:border-brand-300" : "text-ink-400 hover:border-ink-300"
        )}
      >
        <CalendarIcon className="h-3.5 w-3.5" />
        <span>{triggerLabel}</span>
      </button>

      {open && popPos && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[60] w-[280px] rounded-lg border border-ink-200 bg-white p-3 shadow-card"
          style={{ top: popPos.top, left: popPos.left }}
        >
          {/* 月份导航 */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setCursor((d) => addMonths(d, -1))}
              className="rounded p-1 text-ink-500 hover:bg-ink-100"
              aria-label="上个月"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium text-ink-700">
              {format(cursor, "yyyy 年 M 月", { locale: zhCN })}
            </span>
            <button
              type="button"
              onClick={() => setCursor((d) => addMonths(d, 1))}
              className="rounded p-1 text-ink-500 hover:bg-ink-100"
              aria-label="下个月"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* 预设 chips */}
          <div className="mb-2 flex flex-wrap gap-1">
            <PresetChip label="今天" onClick={() => applyPreset(presetToday())} />
            <PresetChip label="明天" onClick={() => applyPreset(presetTomorrow())} />
            <PresetChip label="本周" onClick={() => applyPreset(presetThisWeek())} />
            <PresetChip label="下周" onClick={() => applyPreset(presetNextWeek())} />
            <PresetChip label="清空" onClick={clearAll} danger />
          </div>

          {/* 日历网格 */}
          <CalendarGrid
            cursor={cursor}
            value={value}
            pending={pending}
            onPick={clickDay}
          />

          <p className="mt-2 text-[11px] text-ink-400">
            {pending && pending.end === null ? "再点一天作为终点" : "点起点 → 点终点"}
          </p>
        </div>,
        document.body
      )}
    </div>
  );
}

function PresetChip({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-0.5 text-[11px] transition-colors",
        danger
          ? "text-rose-600 hover:bg-rose-50"
          : "bg-ink-100 text-ink-700 hover:bg-brand-100 hover:text-brand-700"
      )}
    >
      {label}
    </button>
  );
}

function CalendarGrid({
  cursor,
  value,
  pending,
  onPick,
}: {
  cursor: Date;
  value: string[];
  pending: { start: string; end: string | null } | null;
  onPick: (iso: string) => void;
}) {
  // 6 周 × 7 列网格，含上/下月延伸
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }
  const valueSet = new Set(value);
  const r = getRange(value);
  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] text-ink-400">
        {WEEKDAY_LABELS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((d) => {
          const iso = format(d, "yyyy-MM-dd");
          const inMonth =
            d >= monthStart && d <= monthEnd;
          const inValue = valueSet.has(iso);
          // 已选区间端点
          const isStart = r?.start === iso;
          const isEnd = r?.end === iso;
          // 待定起点
          const isPendingStart = pending?.start === iso;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onPick(iso)}
              className={cn(
                "h-7 rounded text-[11px] transition-colors",
                inMonth ? "text-ink-700" : "text-ink-300",
                isPendingStart
                  ? "bg-brand-600 font-semibold text-white"
                  : isStart || isEnd
                  ? "bg-brand-500 font-semibold text-white"
                  : inValue
                  ? "bg-brand-100 text-brand-700"
                  : "hover:bg-ink-100"
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
