import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Flag, X as XIcon } from "lucide-react";
import type { Tag, Task, TaskPriority, TaskStatus } from "@/lib/types";
import type { TaskEditorDraft } from "@/lib/taskEditorBridge";
import { cn, isoDate } from "@/lib/utils";
import { PRESET_COLORS } from "@/lib/colors";
import { parseTaskProgress } from "@/lib/taskProgress";
import { StatusButtonGroup } from "@/components/ui/StatusButtonGroup";
import { TagHierarchyPicker } from "@/components/ui/TagHierarchyPicker";
import { ChevronDown, ChevronRight } from "lucide-react";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { isContiguous } from "@/lib/dateRange";
import { RichDescription } from "@/components/ui/RichDescription";
import { ProgressRing } from "@/components/ui/ProgressRing";

const PRIORITY_OPTIONS: Array<{
  value: TaskPriority;
  label: string;
  hint: string;
  selectedClass: string;
  idleClass: string;
  iconClass: string;
}> = [
  {
    value: "p0",
    label: "P0",
    hint: "紧急",
    selectedClass: "border-rose-500 bg-rose-500 text-white shadow-sm",
    idleClass: "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
    iconClass: "text-rose-500",
  },
  {
    value: "p1",
    label: "P1",
    hint: "重要",
    selectedClass: "border-amber-500 bg-amber-500 text-white shadow-sm",
    idleClass: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
    iconClass: "text-amber-500",
  },
  {
    value: "p2",
    label: "P2",
    hint: "一般",
    selectedClass: "border-ink-500 bg-ink-500 text-white shadow-sm",
    idleClass: "border-ink-200 bg-ink-50 text-ink-600 hover:bg-ink-100",
    iconClass: "text-ink-400",
  },
];

interface TaskEditorHeaderConfig {
  modeLabel: string;
  subtitle?: string;
  onClose: () => void;
  onMouseDown?: (e: ReactMouseEvent<HTMLDivElement>) => void;
}

interface TaskEditorFormProps {
  task?: Task | null;
  tags: Tag[];
  defaultDate?: string;
  onCancel: () => void;
  onSave: (draft: TaskEditorDraft) => void | Promise<void>;
  className?: string;
  bodyClassName?: string;
  actionsClassName?: string;
  header?: TaskEditorHeaderConfig;
}

export function TaskEditorForm({
  task,
  tags,
  defaultDate,
  onCancel,
  onSave,
  className,
  bodyClassName,
  actionsClassName,
  header,
}: TaskEditorFormProps) {
  const [title, setTitle] = useState("");
  const [titleEditing, setTitleEditing] = useState(false);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("p2");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [docUrl, setDocUrl] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [scheduledDates, setScheduledDates] = useState<string[]>([]);
  const [newDate, setNewDate] = useState(defaultDate ?? isoDate());
  const [color, setColor] = useState<string | undefined>(undefined);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description);
      setStatus(task.status);
      setPriority(task.priority ?? "p2");
      setTagIds(task.tagIds);
      setDocUrl(task.docUrl ?? "");
      setDocTitle(task.docTitle ?? "");
      setScheduledDates(task.scheduledDates);
      setColor(task.color);
    } else {
      setTitle("");
      setDescription("");
      setStatus("todo");
      setPriority("p2");
      setTagIds([]);
      setDocUrl("");
      setDocTitle("");
      setScheduledDates(defaultDate ? [defaultDate] : [isoDate()]);
      setColor(undefined);
    }
    setNewDate(defaultDate ?? isoDate());
    const initial = task ? task.scheduledDates : defaultDate ? [defaultDate] : [isoDate()];
    setAdvancedOpen(initial.length > 1 && !isContiguous(initial));
    setTitleEditing(false);
  }, [task, defaultDate]);

  useEffect(() => {
    if (!titleEditing) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [titleEditing]);

  function addDate() {
    if (!newDate) return;
    setScheduledDates((prev) =>
      prev.includes(newDate) ? prev : [...prev, newDate].sort()
    );
  }

  function removeDate(d: string) {
    setScheduledDates((prev) => prev.filter((x) => x !== d));
  }

  async function save() {
    if (!title.trim()) {
      window.alert("任务标题不能为空。");
      return;
    }

    const progress = parseTaskProgress(description);
    let nextStatus = status;
    let completedAt: string | null | undefined;
    if (progress && progress.total > 0 && progress.done === progress.total) {
      if (status !== "done") {
        nextStatus = "done";
        completedAt = new Date().toISOString();
      }
    } else if (progress && progress.total > 0 && progress.done < progress.total) {
      if (status === "done") {
        nextStatus = "in_progress";
        completedAt = null;
      }
    }

    const draft: TaskEditorDraft = {
      title: title.trim(),
      description: description.trim(),
      status: nextStatus,
      priority,
      tagIds,
      scheduledDates,
      color: color ?? null,
      docUrl: docUrl.trim() || null,
      docTitle: docTitle.trim() || null,
      ...(completedAt !== undefined ? { completedAt } : {}),
    };
    await onSave(draft);
  }

  const splitLayout = Boolean(bodyClassName || actionsClassName);
  const progress = parseTaskProgress(description);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {header && (
        <div
          data-task-editor-header
          className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-2.5 select-none"
          data-tauri-drag-region
          onMouseDown={header.onMouseDown}
        >
          <div className="min-w-0 flex-1">
            {titleEditing ? (
              <input
                ref={titleInputRef}
                className="h-7 w-full rounded-md border border-ink-200 bg-white px-2 text-sm font-semibold text-ink-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                placeholder="任务标题"
                value={title}
                data-tauri-drag-region="false"
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => setTitleEditing(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setTitleEditing(false);
                  if (e.key === "Escape") {
                    setTitle(task?.title ?? "");
                    setTitleEditing(false);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                data-tauri-drag-region="false"
                onClick={() => setTitleEditing(true)}
                className="block max-w-full truncate rounded px-1 py-0.5 text-left text-sm font-semibold text-ink-800 hover:bg-ink-100"
                title="点击编辑标题"
              >
                {title.trim() || header.modeLabel}
              </button>
            )}
            <div className="mt-0.5 text-[11px] text-ink-400">
              {header.subtitle ?? "独立任务窗口"}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {progress && (
              <ProgressRing percent={progress.percent} size={36} stroke={3.5} />
            )}

            <button
              type="button"
              onClick={header.onClose}
              data-tauri-drag-region="false"
              className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              aria-label="关闭"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div className={cn("space-y-3.5", bodyClassName)}>
        {!header && (
          <div data-task-editor-section="title">
            <label className="mb-1 block text-xs font-medium text-ink-500">
              标题
            </label>
            <input
              className="input"
              placeholder="例如：完成 Q3 OKR 草稿"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
        )}

        <div
          data-task-editor-section="status-priority"
          className="grid grid-cols-[minmax(0,1fr)_minmax(16rem,max-content)] gap-6"
        >
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium text-ink-500">
              状态
            </label>
            <StatusButtonGroup value={status} onChange={setStatus} />
            {status === "suspended" && (
              <p className="mt-1 text-[11px] text-paused-600">
                挂起任务不会出现在「今日」中，但保留排期记录
              </p>
            )}
          </div>

          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium text-ink-500">
              优先级
            </label>
            <div
              data-task-editor-section="priority-options"
              className="flex flex-nowrap gap-1.5"
            >
              {PRIORITY_OPTIONS.map((option) => {
                const active = priority === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPriority(option.value)}
                    className={cn(
                      "inline-flex h-8 min-w-9 items-center justify-center gap-1 rounded-lg border px-2 text-xs font-medium transition-colors",
                      active ? option.selectedClass : option.idleClass
                    )}
                    title={`优先级：${option.label}（${option.hint}）`}
                  >
                    <Flag
                      className={cn(
                        "h-3 w-3",
                        active ? "text-white" : option.iconClass
                      )}
                    />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div data-task-editor-section="color">
          <label className="mb-1 block text-xs font-medium text-ink-500">
            颜色
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setColor(undefined)}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full border-2 border-dashed border-ink-300 text-ink-400 hover:border-ink-500 hover:text-ink-600",
                !color && "ring-2 ring-ink-700 ring-offset-2"
              )}
              title="不设颜色（按优先级 / 状态色显示）"
            >
              <XIcon className="h-3 w-3" />
            </button>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                style={{ backgroundColor: c }}
                className={cn(
                  "h-6 w-6 rounded-full ring-offset-2 transition-all hover:scale-110",
                  color === c
                    ? "ring-2 ring-ink-700"
                    : "hover:ring-1 hover:ring-ink-300"
                )}
                title={c}
              />
            ))}
          </div>
          <p className="mt-1 text-[11px] text-ink-400">
            不设 = 按优先级 / 状态色显示
          </p>
        </div>

        <div data-task-editor-section="tags">
          <label className="mb-1 block text-xs font-medium text-ink-500">
            标签
          </label>
          <div className="rounded-lg border border-ink-200 p-2.5">
            {tags.length === 0 ? (
              <div className="text-xs text-ink-400">
                暂无标签，去「标签管理」中创建
              </div>
            ) : (
              <TagHierarchyPicker
                mode="multi"
                value={tagIds}
                onChange={setTagIds}
                tagsOverride={tags}
              />
            )}
          </div>
        </div>

        <div
          data-task-editor-section="docs"
          className="grid grid-cols-2 gap-3"
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-500">
              关联文档 URL（钉钉文档 / 飞书 / 任意链接）
            </label>
            <input
              className="input"
              placeholder="https://alidocs.dingtalk.com/..."
              value={docUrl}
              onChange={(e) => setDocUrl(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-500">
              文档显示标题（可选）
            </label>
            <input
              className="input"
              placeholder="例如：Q3 OKR 草稿"
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
            />
          </div>
        </div>

        <div data-task-editor-section="schedule">
          <label className="mb-1 block text-xs font-medium text-ink-500">
            排期日期
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker value={scheduledDates} onChange={setScheduledDates} />
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="inline-flex items-center gap-0.5 text-[11px] text-ink-500 hover:text-ink-700"
            >
              {advancedOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              单独添加
            </button>
          </div>

          {advancedOpen && (
            <div className="mt-2 rounded-md border border-dashed border-ink-200 p-2">
              {scheduledDates.length > 1 && !isContiguous(scheduledDates) && (
                <p className="mb-1 text-[11px] text-ink-400">
                  当前日期不连续，建议在此精细管理
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {scheduledDates.map((d) => (
                  <span
                    key={d}
                    className="chip border border-brand-200 bg-brand-50 text-brand-700"
                  >
                    {d}
                    <button
                      type="button"
                      onClick={() => removeDate(d)}
                      className="ml-0.5 text-brand-500 hover:text-brand-700"
                    >
                      ✕
                    </button>
                  </span>
                ))}
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    className="input h-7 w-auto py-0 text-xs"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-secondary h-7 px-2 py-0 text-xs"
                    onClick={addDate}
                  >
                    添加
                  </button>
                </div>
              </div>
            </div>
          )}

          {status === "done" && scheduledDates.length === 0 && (
            <p className="mt-1 text-[11px] text-ink-400">
              已完成任务暂无排期；如需让其重新出现在某天列表，可在此添加日期
            </p>
          )}
        </div>

        <div data-task-editor-section="description">
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs font-medium text-ink-500">
              任务简述（支持子任务：输入{" "}
              <code className="rounded bg-ink-100 px-1 text-[11px]">[ ]</code>{" "}
              加空格自动转勾选框）
            </label>
            {progress && (
              <span
                data-task-editor-section="description-progress"
                className="shrink-0 text-[11px] text-ink-500"
              >
                {progress.done}/{progress.total} 子任务
                {progress.inProgress > 0 ? ` · ${progress.inProgress} 进行中` : ""}
              </span>
            )}
          </div>
          <RichDescription value={description} onChange={setDescription} />
        </div>
      </div>

      <div
        data-task-editor-section="actions"
        className={cn(
          "flex shrink-0 justify-end gap-2 border-t border-ink-200/70 pt-3",
          !splitLayout && "mt-3",
          actionsClassName
        )}
      >
        <button className="btn-secondary" onClick={onCancel} type="button">
          取消
        </button>
        <button className="btn-primary" onClick={save} type="button">
          保存
        </button>
      </div>
    </div>
  );
}
