import { useEffect, useMemo, useState } from "react";
import {
  addYears,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  setMonth,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subYears,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Task } from "@/lib/types";
import { cn, isoDate } from "@/lib/utils";
import { usePomodoroStore } from "@/store/pomodoroStore";
import { useTaskStore } from "@/store/taskStore";
import { DaySection } from "./_DaySection";
import { useDayMap, useTagFilterSet, type DayInfo } from "./_helpers";

/**
 * Year View：12 个迷你月热力图 + 选中日详情（只读，不参与拖拽）。
 *
 * 设计取舍：年视图粒度粗，拖任务到"某月"语义模糊，所以拖拽不在这里开放。
 * 想要改期请切到月/周视图。
 */

interface Props {
  date: string;
  tags: string[];
  onDateChange: (iso: string) => void;
  onSwitchToMonth: (iso: string) => void;
  onEdit: (t: Task) => void;
  onNewTaskOnDate: (iso: string) => void;
}

export function YearView({
  date,
  tags,
  onDateChange,
  onSwitchToMonth,
  onEdit,
  onNewTaskOnDate,
}: Props) {
  const navigate = useNavigate();
  const tasks = useTaskStore((s) => s.tasks);
  const tagFilter = useTagFilterSet(tags);
  const dayMap = useDayMap(tasks, tagFilter);

  const [cursor, setCursor] = useState<Date>(() => new Date(date));
  useEffect(() => {
    setCursor((cur) => {
      const sel = new Date(date);
      return cur.getFullYear() === sel.getFullYear() ? cur : sel;
    });
  }, [date]);

  const yearStart = startOfYear(cursor);
  const months = useMemo(
    () => Array.from({ length: 12 }, (_, i) => setMonth(yearStart, i)),
    [yearStart]
  );

  const maxInYear = useMemo(() => {
    let max = 0;
    for (const m of months) {
      const start = startOfMonth(m);
      const end = endOfMonth(m);
      const days = eachDayOfInterval({ start, end });
      for (const d of days) {
        const info = dayMap.get(format(d, "yyyy-MM-dd"));
        if (info && info.total > max) max = info.total;
      }
    }
    return max;
  }, [months, dayMap]);

  const selectTask = usePomodoroStore((s) => s.selectTask);
  const setType = usePomodoroStore((s) => s.setType);
  function startPomodoroFor(t: Task) {
    setType("focus");
    selectTask(t.id);
    navigate("/pomodoro");
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-end gap-2">
        <button
          type="button"
          className="rounded-lg border border-ink-200 p-1.5 text-ink-500 hover:bg-ink-50"
          onClick={() => setCursor((d) => subYears(d, 1))}
          aria-label="上一年"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="min-w-[6rem] text-center text-sm font-medium text-ink-700">
          {format(cursor, "yyyy 年")}
        </div>
        <button
          type="button"
          className="rounded-lg border border-ink-200 p-1.5 text-ink-500 hover:bg-ink-50"
          onClick={() => setCursor((d) => addYears(d, 1))}
          aria-label="下一年"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="btn-secondary ml-1 text-xs"
          onClick={() => {
            const now = new Date();
            setCursor(now);
            onDateChange(isoDate(now));
          }}
        >
          回到今天
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {months.map((m) => (
          <MiniMonth
            key={m.toISOString()}
            month={m}
            dayMap={dayMap}
            maxInYear={maxInYear}
            selectedISO={date}
            onClickDay={onDateChange}
            onClickHeader={() => onSwitchToMonth(format(m, "yyyy-MM-dd"))}
          />
        ))}
      </div>

      <DaySection
        iso={date}
        info={dayMap.get(date)}
        filterActive={tagFilter !== null}
        onEdit={onEdit}
        onStartPomodoro={startPomodoroFor}
        onNewTask={() => onNewTaskOnDate(date)}
      />
    </div>
  );
}

function MiniMonth({
  month,
  dayMap,
  maxInYear,
  selectedISO,
  onClickDay,
  onClickHeader,
}: {
  month: Date;
  dayMap: Map<string, DayInfo>;
  maxInYear: number;
  selectedISO: string;
  onClickDay: (iso: string) => void;
  onClickHeader: () => void;
}) {
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [month]);

  const totalInMonth = useMemo(() => {
    let n = 0;
    for (const d of days) {
      if (!isSameMonth(d, month)) continue;
      n += dayMap.get(format(d, "yyyy-MM-dd"))?.total ?? 0;
    }
    return n;
  }, [days, month, dayMap]);

  return (
    <div className="card p-3">
      <button
        type="button"
        onClick={onClickHeader}
        className="mb-2 flex w-full items-center justify-between text-sm font-medium text-ink-700 hover:text-brand-600"
      >
        <span>{format(month, "M 月")}</span>
        <span className="text-[11px] font-normal text-ink-400">
          {totalInMonth > 0 ? `共 ${totalInMonth} 个任务` : ""}
        </span>
      </button>
      <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] text-ink-400">
        {["一", "二", "三", "四", "五", "六", "日"].map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((d) => {
          const iso = format(d, "yyyy-MM-dd");
          const inMonth = isSameMonth(d, month);
          const today = isToday(d);
          const selected = iso === selectedISO;
          const info = dayMap.get(iso);
          const total = info?.total ?? 0;
          const heat = maxInYear > 0 ? total / maxInYear : 0;
          const heatBg =
            total > 0 ? `rgba(99, 102, 241, ${0.08 + heat * 0.35})` : undefined;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onClickDay(iso)}
              className={cn(
                "relative aspect-square rounded text-[10px] tabular-nums transition-colors",
                !inMonth && "opacity-40",
                selected
                  ? "ring-2 ring-brand-400"
                  : today
                  ? "ring-1 ring-brand-300"
                  : "hover:bg-ink-100"
              )}
              style={{ backgroundColor: heatBg }}
              title={total > 0 ? `${iso} · ${info?.done ?? 0}/${total}` : iso}
            >
              <span
                className={cn(
                  today && "font-semibold text-brand-700",
                  inMonth ? "text-ink-700" : "text-ink-400"
                )}
              >
                {format(d, "d")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
