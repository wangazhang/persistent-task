/**
 * 系统托盘 popup 窗口（label = tray-popup）。
 *
 * 数据：从主窗口通过 `tray:state` 事件接收快照（useTraySnapshot 统一管理）
 * 交互：普通动作通过 sendTrayAction emit 回主窗口；完整任务编辑走
 *      task-editor 独立窗口。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Edit3,
  ListTodo,
  Pause,
  Pencil,
  Play,
  PlayCircle,
  Square,
  Timer,
  Trash2,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useTrayPopupStore,
  type TrayMode,
  type TrayStateSnapshot,
} from "@/store/trayStore";
import { sendTrayAction } from "@/lib/trayBridge";
import { useTraySnapshot, useTransparentBody } from "@/lib/trayHooks";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { PopupFrame } from "@/components/ui/PopupFrame";
import { parseTaskProgress } from "@/lib/taskProgress";
import { cn } from "@/lib/utils";
import { openTaskEditorWindow } from "@/lib/taskEditorBridge";

type SnapshotTask = TrayStateSnapshot["todayTasks"][number];

function fmtMMSS(sec: number): string {
  const m = Math.floor(Math.max(0, sec) / 60);
  const s = Math.max(0, sec) % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function typeLabel(t: "focus" | "short_break" | "long_break"): string {
  if (t === "focus") return "专注";
  if (t === "short_break") return "短休息";
  return "长休息";
}

const POMO_TYPE_OPTIONS: Array<{
  type: "focus" | "short_break" | "long_break";
  label: string;
  minutes: number;
}> = [
  { type: "focus", label: "专注", minutes: 25 },
  { type: "short_break", label: "短休", minutes: 5 },
  { type: "long_break", label: "长休", minutes: 15 },
];

export default function TrayPopup() {
  const mode = useTrayPopupStore((s) => s.mode);
  const setMode = useTrayPopupStore((s) => s.setMode);
  const snapshot = useTrayPopupStore((s) => s.snapshot);

  useTraySnapshot("tray-popup");
  useTransparentBody();

  return (
    <PopupFrame>
      <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-3 py-2">
        <ModeSwitch mode={mode} onChange={setMode} />
        <button
          type="button"
          onClick={() => sendTrayAction({ kind: "open_main" })}
          className="text-[11px] text-ink-400 hover:text-ink-700"
        >
          打开主窗口 ↗
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {snapshot === null ? (
          <div className="flex h-full items-center justify-center text-xs text-ink-400">
            正在加载…
          </div>
        ) : mode === "tasks" ? (
          <TasksPanel snapshot={snapshot} />
        ) : (
          <PomodoroPanel snapshot={snapshot} />
        )}
      </div>
    </PopupFrame>
  );
}

function ModeSwitch({
  mode,
  onChange,
}: {
  mode: TrayMode;
  onChange: (m: TrayMode) => void;
}) {
  const tabs: { k: TrayMode; label: string; icon: React.ReactNode }[] = [
    { k: "tasks", label: "任务", icon: <ListTodo className="h-3.5 w-3.5" /> },
    { k: "pomodoro", label: "番茄", icon: <Timer className="h-3.5 w-3.5" /> },
  ];
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-ink-200 bg-ink-50/60 p-0.5">
      {tabs.map((t) => (
        <button
          key={t.k}
          type="button"
          onClick={() => onChange(t.k)}
          className={cn(
            "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            mode === t.k
              ? "bg-white text-brand-700 shadow-sm"
              : "text-ink-500 hover:text-ink-700"
          )}
          aria-pressed={mode === t.k}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

function TasksPanel({ snapshot }: { snapshot: TrayStateSnapshot }) {
  const setMode = useTrayPopupStore((s) => s.setMode);
  const [localIds, setLocalIds] = useState<string[]>(() =>
    snapshot.todayTasks.map((t) => t.id)
  );
  const lastSnapshotIdsRef = useRef<string>("");
  useEffect(() => {
    const incoming = snapshot.todayTasks.map((t) => t.id).join(",");
    if (incoming === lastSnapshotIdsRef.current) return;
    lastSnapshotIdsRef.current = incoming;
    setLocalIds(snapshot.todayTasks.map((t) => t.id));
  }, [snapshot.todayTasks]);

  const tasksById = useMemo(() => {
    const m = new Map<string, SnapshotTask>();
    for (const t of snapshot.todayTasks) m.set(t.id, t);
    return m;
  }, [snapshot.todayTasks]);

  const tasks = useMemo(
    () => localIds.map((id) => tasksById.get(id)).filter(Boolean) as SnapshotTask[],
    [localIds, tasksById]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = localIds.indexOf(active.id as string);
    const newIdx = localIds.indexOf(over.id as string);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(localIds, oldIdx, newIdx);
    setLocalIds(next);
    sendTrayAction({ kind: "reorder_today", orderedIds: next });
  }

  const [ctxMenu, setCtxMenu] = useState<{ taskId: string; x: number; y: number } | null>(null);

  function preparePomodoro(taskId: string) {
    const p = snapshot.pomodoro;
    if (p.state !== "idle" && p.taskId !== taskId) {
      window.alert("已有另一个番茄钟正在运行，请先结束当前番茄钟。");
      setMode("pomodoro");
      return;
    }
    sendTrayAction({ kind: "select_pomodoro_task", taskId });
    setMode("pomodoro");
  }

  useEffect(() => {
    if (!ctxMenu) return;
    function onAway() {
      setCtxMenu(null);
    }
    window.addEventListener("click", onAway);
    window.addEventListener("scroll", onAway, true);
    window.addEventListener("blur", onAway);
    return () => {
      window.removeEventListener("click", onAway);
      window.removeEventListener("scroll", onAway, true);
      window.removeEventListener("blur", onAway);
    };
  }, [ctxMenu]);

  return (
    <div className="px-3 py-2.5">
      <div className="mb-2 text-[11px] text-ink-400">
        今日 <span className="font-medium text-ink-700">{tasks.length}</span> 项待办
        {snapshot.doneCountToday > 0 && (
          <>
            ，已完成{" "}
            <span className="font-medium text-success-600">
              {snapshot.doneCountToday}
            </span>{" "}
            项
          </>
        )}
      </div>
      {tasks.length === 0 ? (
        <div className="py-10 text-center text-xs text-ink-400">
          今日无待办，享受片刻宁静
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={localIds} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-0.5">
              {tasks.map((t) => (
                <SortableTaskRow
                  key={t.id}
                  task={t}
                  onStartPomodoro={preparePomodoro}
                  onContextMenu={(x, y) => setCtxMenu({ taskId: t.id, x, y })}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {ctxMenu && (
        <TaskContextMenu
          taskId={ctxMenu.taskId}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onStartPomodoro={preparePomodoro}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}

function SortableTaskRow({
  task,
  onStartPomodoro,
  onContextMenu,
}: {
  task: SnapshotTask;
  onStartPomodoro: (taskId: string) => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const progress = parseTaskProgress(task.description);
  const statusDot =
    task.status === "in_progress"
      ? "bg-warning-500"
      : task.status === "suspended"
      ? "bg-paused-500"
      : "bg-ink-300";

  return (
    <li ref={setNodeRef} style={style} {...attributes}>
      <div
        className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-ink-50"
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e.clientX, e.clientY);
        }}
      >
        <button
          type="button"
          className="cursor-grab text-ink-300 hover:text-ink-500 active:cursor-grabbing"
          {...listeners}
          aria-label="拖动排序"
          title="拖动排序"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <circle cx="5" cy="3" r="1.5" />
            <circle cx="5" cy="8" r="1.5" />
            <circle cx="5" cy="13" r="1.5" />
            <circle cx="11" cy="3" r="1.5" />
            <circle cx="11" cy="8" r="1.5" />
            <circle cx="11" cy="13" r="1.5" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => sendTrayAction({ kind: "toggle_done", taskId: task.id })}
          className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 border-ink-300 transition-colors hover:border-brand-500"
          aria-label="标记完成"
          title="标记完成"
        />

        <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", statusDot)} />

        <button
          type="button"
          onClick={() => void openTaskEditorWindow({ taskId: task.id })}
          className="flex flex-1 items-center truncate text-left"
        >
          <span className="flex-1 truncate text-sm text-ink-700">{task.title}</span>
        </button>

        {progress && (
          <span className="shrink-0 text-ink-400" title={`${progress.done}/${progress.total} 已完成`}>
            <ProgressRing percent={progress.percent} size={18} stroke={2.5} showCenterText={false} />
          </span>
        )}

        <button
          type="button"
          onClick={() => onStartPomodoro(task.id)}
          className="opacity-0 transition-opacity group-hover:opacity-100 text-ink-300 hover:text-brand-600"
          aria-label="开始番茄钟"
          title="开始番茄钟"
        >
          <PlayCircle className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

function TaskContextMenu({
  taskId,
  x,
  y,
  onStartPomodoro,
  onClose,
}: {
  taskId: string;
  x: number;
  y: number;
  onStartPomodoro: (taskId: string) => void;
  onClose: () => void;
}) {
  const items: { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean }[] = [
    {
      label: "开始番茄钟",
      icon: <PlayCircle className="h-3.5 w-3.5" />,
      onClick: () => onStartPomodoro(taskId),
    },
    {
      label: "编辑",
      icon: <Pencil className="h-3.5 w-3.5" />,
      onClick: () => void openTaskEditorWindow({ taskId }),
    },
    {
      label: "标记完成",
      icon: <Edit3 className="h-3.5 w-3.5" />,
      onClick: () => sendTrayAction({ kind: "toggle_done", taskId }),
    },
    {
      label: "删除",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      onClick: () => sendTrayAction({ kind: "delete_task", taskId }),
      danger: true,
    },
  ];

  return (
    <div
      style={{ left: x, top: y }}
      className="fixed z-50 min-w-[140px] rounded-lg border border-ink-200 bg-white py-1 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          onClick={() => {
            it.onClick();
            onClose();
          }}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
            it.danger ? "text-rose-600 hover:bg-rose-50" : "text-ink-700 hover:bg-ink-50"
          )}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}

function PomodoroPanel({ snapshot }: { snapshot: TrayStateSnapshot }) {
  const p = snapshot.pomodoro;
  const remain = Math.max(0, p.targetSec - p.elapsedSec);
  const percent =
    p.targetSec === 0 ? 0 : Math.round((p.elapsedSec / p.targetSec) * 100);

  const linkedTask = snapshot.todayTasks.find((t) => t.id === p.taskId);
  const canStart = p.type !== "focus" || !!linkedTask;
  const statusText =
    p.state === "idle"
      ? "空闲"
      : p.state === "running"
      ? `${typeLabel(p.type)}中`
      : `${typeLabel(p.type)}已暂停`;

  return (
    <div className="flex h-full flex-col px-4 py-4">
      <div className="rounded-2xl border border-ink-100 bg-ink-50/50 p-3">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-ink-400">
          <Timer className="h-3.5 w-3.5" />
          当前任务
        </div>
        {linkedTask ? (
          <div className="truncate text-sm font-medium text-ink-800">
            {linkedTask.title}
          </div>
        ) : (
          <div className="text-xs text-ink-400">
            选择一个任务后再开始专注
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {POMO_TYPE_OPTIONS.map((opt) => {
          const active = p.type === opt.type;
          return (
            <button
              key={opt.type}
              type="button"
              disabled={p.state !== "idle"}
              onClick={() =>
                sendTrayAction({ kind: "set_pomodoro_type", type: opt.type })
              }
              className={cn(
                "rounded-xl border px-2 py-2 text-center transition-colors",
                active
                  ? "border-brand-200 bg-brand-50 text-brand-700"
                  : "border-ink-200 bg-white text-ink-500 hover:bg-ink-50",
                p.state !== "idle" && "cursor-not-allowed opacity-60"
              )}
              title={
                p.state === "idle"
                  ? `${opt.label} ${opt.minutes} 分钟`
                  : "计时中不能切换模式"
              }
            >
              <div className="text-xs font-medium">{opt.label}</div>
              <div className="mt-0.5 text-[11px] opacity-75">
                {opt.minutes}m
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex justify-center">
        <div className="relative h-[150px] w-[150px]">
          <ProgressRing percent={percent} size={150} stroke={8} showCenterText={false} />
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-4xl font-semibold tabular-nums text-ink-800">
              {fmtMMSS(remain)}
            </div>
            <div className="mt-1 text-[11px] text-ink-500">
              {statusText}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {p.state === "idle" && (
          <button
            type="button"
            disabled={!canStart}
            onClick={() => sendTrayAction({ kind: "pomo_start" })}
            className={cn(
              "flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700",
              !canStart && "cursor-not-allowed opacity-50 hover:bg-brand-600"
            )}
            title={canStart ? "开始计时" : "先从任务列表选择一个任务"}
          >
            <Play className="h-3.5 w-3.5" />
            开始
          </button>
        )}
        {p.state === "running" && (
          <>
            <button
              type="button"
              onClick={() => sendTrayAction({ kind: "pomo_pause" })}
              className="flex items-center gap-1 rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
            >
              <Pause className="h-3.5 w-3.5" />
              暂停
            </button>
            <button
              type="button"
              onClick={() => sendTrayAction({ kind: "pomo_stop" })}
              className="flex items-center gap-1 rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
            >
              <Square className="h-3.5 w-3.5" />
              结束
            </button>
          </>
        )}
        {p.state === "paused" && (
          <>
            <button
              type="button"
              onClick={() => sendTrayAction({ kind: "pomo_resume" })}
              className="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
            >
              <Play className="h-3.5 w-3.5" />
              继续
            </button>
            <button
              type="button"
              onClick={() => sendTrayAction({ kind: "pomo_stop" })}
              className="flex items-center gap-1 rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
            >
              <Square className="h-3.5 w-3.5" />
              结束
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => sendTrayAction({ kind: "open_pomodoro" })}
          className="flex items-center gap-1 rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
          title="在主窗口打开番茄页"
        >
          详情
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
