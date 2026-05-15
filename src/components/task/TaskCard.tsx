import { useState } from "react";
import { addDays } from "date-fns";
import {
  CalendarPlus,
  ExternalLink,
  GripVertical,
  PauseCircle,
  Pencil,
  Timer,
  Trash2,
} from "lucide-react";
import type { Task, TaskPriority } from "@/lib/types";
import { useTagStore } from "@/store/tagStore";
import { useTaskStore } from "@/store/taskStore";
import { confirm as dialogConfirm } from "@/store/dialogStore";
import { cn, isoDate } from "@/lib/utils";
import { PRESET_COLORS } from "@/lib/colors";
import { TagChip } from "@/components/ui/TagChip";
import { StatusPicker } from "@/components/ui/StatusPicker";
import { PriorityPicker } from "@/components/ui/PriorityPicker";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { descriptionPreview, parseTaskProgress } from "@/lib/taskProgress";

interface TaskCardProps {
  task: Task;
  /** 拖拽手柄绑定（dnd-kit listeners）*/
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  isDragging?: boolean;
  onEdit?: (task: Task) => void;
  onStartPomodoro?: (task: Task) => void;
  /** 是否在「今日」上下文渲染（影响一些细节，如 ✓ 完成按钮）*/
  forDate?: string;
}

export function TaskCard({
  task,
  dragHandleProps,
  isDragging,
  onEdit,
  onStartPomodoro,
}: TaskCardProps) {
  const tagsById = useTagStore((s) => s.byId());
  const toggleStatus = useTaskStore((s) => s.toggleStatus);
  const updateTask = useTaskStore((s) => s.updateTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const scheduleForDate = useTaskStore((s) => s.scheduleForDate);

  const isDone = task.status === "done";
  const isSuspended = task.status === "suspended";
  const progress = parseTaskProgress(task.description);
  const descPreview = descriptionPreview(task.description);
  const priority: TaskPriority = task.priority ?? "p2";

  // 右键菜单状态：null = 关闭；{x, y} = 在该坐标打开
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  async function confirmDelete() {
    const ok = await dialogConfirm({
      title: "删除任务",
      message: `确定删除任务「${task.title}」？此操作不可撤销。`,
      confirmText: "删除",
      danger: true,
    });
    if (ok) deleteTask(task.id);
  }

  /** 构造右键菜单项 */
  function buildMenuItems(): ContextMenuItem[] {
    const today = isoDate();
    const tomorrow = isoDate(addDays(new Date(), 1));
    const inToday = task.scheduledDates.includes(today);
    const inTomorrow = task.scheduledDates.includes(tomorrow);
    const items: ContextMenuItem[] = [];
    if (onEdit) {
      items.push({
        label: "编辑",
        icon: Pencil,
        onClick: () => onEdit(task),
      });
    }
    if (onStartPomodoro && !isDone && !isSuspended) {
      items.push({
        label: "启动番茄钟",
        icon: Timer,
        onClick: () => onStartPomodoro(task),
      });
    }
    items.push({
      label: inToday ? "已在今天" : "复制到今天",
      icon: CalendarPlus,
      disabled: inToday,
      onClick: () => scheduleForDate(task.id, today),
    });
    items.push({
      label: inTomorrow ? "已在明天" : "复制到明天",
      icon: CalendarPlus,
      disabled: inTomorrow,
      onClick: () => scheduleForDate(task.id, tomorrow),
    });
    items.push({
      label: "删除任务",
      icon: Trash2,
      danger: true,
      onClick: () => void confirmDelete(),
    });
    return items;
  }

  // 左侧色条优先级：
  //   1. 挂起态（紫色细条，所有其他都让位）
  //   2. task.color（用户自定义颜色，4px 实色）
  //   3. priorityBar（按 P0/P1 系统语义色，P2 无）
  const priorityBar =
    priority === "p0"
      ? "border-l-4 border-l-rose-400"
      : priority === "p1"
      ? "border-l-4 border-l-amber-400"
      : ""; // p2 不加条，保持视觉轻
  const useTaskColor = !!task.color && !isSuspended;

  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onDoubleClick={(e) => {
        if (!onEdit) return;
        // 双击交互控件（checkbox / picker / 行尾按钮）不应触发编辑
        const t = e.target as Element | null;
        if (t?.closest("button, input, select, textarea, [role='button']")) return;
        onEdit(task);
      }}
      style={useTaskColor ? { borderLeft: `4px solid ${task.color}` } : undefined}
      className={cn(
        "group flex items-start gap-2 rounded-xl border bg-white p-3 transition-shadow",
        isDragging
          ? "border-brand-300 shadow-lg"
          : "border-ink-200/70 shadow-soft hover:shadow-card",
        // 已完成：整体调暗；挂起：左侧加竖条 + 轻微调暗
        isDone && "opacity-60",
        isSuspended &&
          "border-l-2 border-l-paused-300 bg-paused-50/30 opacity-90",
        // 优先级 P0/P1 的左竖条；挂起态优先于优先级；task.color 优先于 priorityBar
        !isSuspended && !useTaskColor && priorityBar
      )}
    >
      {/* 拖拽手柄 */}
      {dragHandleProps && (
        <button
          type="button"
          {...dragHandleProps}
          className="mt-1 cursor-grab touch-none text-ink-300 hover:text-ink-500 active:cursor-grabbing"
          aria-label="拖动排序"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}

      {/* 完成 checkbox：挂起时显示暂停图标，否则显示空圆 / 勾 */}
      <button
        type="button"
        onClick={() => toggleStatus(task.id)}
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          isDone
            ? "border-success-500 bg-success-500"
            : isSuspended
            ? "border-paused-400 bg-paused-50 text-paused-500 hover:border-paused-500"
            : "border-ink-300 hover:border-brand-500"
        )}
        aria-label={
          isDone
            ? "标记为未完成"
            : isSuspended
            ? "从挂起恢复（标记完成）"
            : "标记为完成"
        }
        title={
          isDone
            ? "标记为未完成"
            : isSuspended
            ? "标记完成（恢复挂起请用右侧状态选择器）"
            : "标记完成"
        }
      >
        {isDone && (
          <svg viewBox="0 0 20 20" fill="white" className="h-full w-full">
            <path
              fillRule="evenodd"
              d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 111.4-1.4L8.5 12l6.8-6.7a1 1 0 011.4 0z"
              clipRule="evenodd"
            />
          </svg>
        )}
        {isSuspended && <PauseCircle className="h-3 w-3" />}
      </button>

      {/* 主体 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div
              className={cn(
                "truncate text-sm font-medium text-ink-800",
                isDone && "line-through",
                isSuspended && "text-ink-600"
              )}
            >
              {task.title}
            </div>
            {descPreview && (
              <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs leading-relaxed text-ink-500">
                {descPreview}
              </p>
            )}
          </div>
          {/* 进度环：仅当 description 含子任务时显示。常驻可见（不随 hover 隐藏）。*/}
          {progress && (
            <div className="shrink-0" title={`子任务 ${progress.done}/${progress.total} 已完成`}>
              <ProgressRing percent={progress.percent} size={28} stroke={3} />
            </div>
          )}
          {/* 行尾操作 */}
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {onStartPomodoro && !isDone && !isSuspended && (
              <button
                type="button"
                title="开始番茄钟"
                onClick={() => onStartPomodoro(task)}
                className="rounded p-1 text-ink-400 hover:bg-brand-50 hover:text-brand-600"
              >
                <Timer className="h-4 w-4" />
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                title="编辑任务"
                onClick={() => onEdit(task)}
                className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              title="删除任务"
              onClick={() => void confirmDelete()}
              className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* 元信息：状态选择器 + 优先级 + 标签 + 文档 + 跨天提示 */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatusPicker
            status={task.status}
            onChange={(next) => toggleStatus(task.id, next)}
          />
          <PriorityPicker
            priority={priority}
            onChange={(next) => updateTask(task.id, { priority: next })}
          />
          {task.tagIds.map((tid) => {
            const t = tagsById.get(tid);
            return t ? <TagChip key={tid} tag={t} /> : null;
          })}
          {task.docUrl && (
            <a
              href={task.docUrl}
              target="_blank"
              rel="noreferrer"
              className="chip border border-ink-200 bg-white text-ink-600 hover:border-brand-300 hover:text-brand-600"
            >
              <ExternalLink className="h-3 w-3" />
              {task.docTitle || "关联文档"}
            </a>
          )}
          {task.scheduledDates.length > 1 && (
            <span className="chip bg-ink-50 text-ink-500">
              跨 {task.scheduledDates.length} 天
            </span>
          )}
        </div>
      </div>

      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menu ? buildMenuItems() : []}
        colorPicker={
          menu
            ? {
                current: task.color,
                presets: PRESET_COLORS,
                onChange: (c) => updateTask(task.id, { color: c }),
              }
            : undefined
        }
        onClose={() => setMenu(null)}
      />
    </div>
  );
}
