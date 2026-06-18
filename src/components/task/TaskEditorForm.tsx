import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Flag, X as XIcon } from "lucide-react";
import type { Tag, Task, TaskDoc, TaskPriority, TaskStatus } from "@/lib/types";
import type { TaskEditorDraft } from "@/lib/taskEditorBridge";
import { cn, isoDate } from "@/lib/utils";
import { TaskDocsField } from "./TaskDocsField";
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
  /** 新建模式下预填标题（编辑已有任务时忽略，以 task.title 为准） */
  defaultTitle?: string;
  onSave: (draft: TaskEditorDraft) => void | Promise<void>;
  className?: string;
  bodyClassName?: string;
  header?: TaskEditorHeaderConfig;
  /**
   * 可选:外部传入一个 ref,组件会把"立刻冲刷一次未触发的自动保存"挂在 ref.current 上。
   * 调用方(如独立窗口)在关闭前调用一下,可避免 300ms debounce 内未来得及落库的输入丢失。
   */
  flushRef?: { current: (() => void) | null };
}

export function TaskEditorForm({
  task,
  tags,
  defaultDate,
  defaultTitle,
  onSave,
  className,
  bodyClassName,
  header,
  flushRef,
}: TaskEditorFormProps) {
  const [title, setTitle] = useState("");
  const [titleEditing, setTitleEditing] = useState(false);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("p2");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [docs, setDocs] = useState<TaskDoc[]>([]);
  const [scheduledDates, setScheduledDates] = useState<string[]>([]);
  const [newDate, setNewDate] = useState(defaultDate ?? isoDate());
  const [color, setColor] = useState<string | undefined>(undefined);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  // 最近一次成功自动保存的时间;用于在头部展示"已保存 HH:MM:SS"
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // 自动保存基础设施:
  //   - justLoadedRef:task 切换时置 true,下一次自动保存 effect 跳过(避免回写刚加载的快照)
  //   - onSaveRef:让 effect 不必把 onSave 列进依赖,防止父组件每次 re-render 都触发"保存"
  const justLoadedRef = useRef(true);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description);
      setStatus(task.status);
      setPriority(task.priority ?? "p2");
      setTagIds(task.tagIds);
      setDocs(initialDocsFromTask(task));
      setScheduledDates(task.scheduledDates);
      setColor(task.color);
    } else {
      setTitle(defaultTitle ?? "");
      setDescription("");
      setStatus("todo");
      setPriority("p2");
      setTagIds([]);
      setDocs([]);
      setScheduledDates(defaultDate ? [defaultDate] : [isoDate()]);
      setColor(undefined);
    }
    setNewDate(defaultDate ?? isoDate());
    const initial = task ? task.scheduledDates : defaultDate ? [defaultDate] : [isoDate()];
    setAdvancedOpen(initial.length > 1 && !isContiguous(initial));
    setTitleEditing(false);
    // 切换 task 后清掉之前那条任务的"已保存"提示
    setLastSavedAt(null);
    // 标记"刚刚加载",保证下一轮 auto-save effect 不会把刚 load 进来的快照再写回去
    justLoadedRef.current = true;
  }, [task, defaultDate, defaultTitle]);

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
    // 状态自动转移要同步回本地 UI,否则 StatusButtonGroup 还显示旧状态
    if (nextStatus !== status) setStatus(nextStatus);

    const draft: TaskEditorDraft = {
      title: title.trim(),
      description: description.trim(),
      status: nextStatus,
      priority,
      tagIds,
      scheduledDates,
      color: color ?? null,
      docs: cleanDocs(docs),
      ...(completedAt !== undefined ? { completedAt } : {}),
    };
    await onSaveRef.current(draft);
    setLastSavedAt(new Date());
  }

  // 字段级自动保存:任意受控字段变更后 300ms idle 触发一次 onSave。
  //   - 标题为空时不保存(等用户输入有效标题再说;不会创建"无标题任务")
  //   - 上一次切换 task 后的首轮 effect 会被 justLoadedRef 拦下,避免回写刚 load 的快照
  //   - task 切换会清掉尚未触发的 timer,防止把旧 task 的状态写到新 task
  //   - 通过 flushRef 暴露"立刻冲刷"接口,关窗时同步触发,避免丢未到点的 debounce
  const pendingDirtyRef = useRef(false);
  useEffect(() => {
    if (justLoadedRef.current) {
      justLoadedRef.current = false;
      pendingDirtyRef.current = false;
      return;
    }
    if (!title.trim()) return;
    pendingDirtyRef.current = true;
    const timer = window.setTimeout(() => {
      pendingDirtyRef.current = false;
      void save();
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, status, priority, tagIds, scheduledDates, color, docs]);

  // 把"立刻冲刷"接口挂到外部 ref;关闭窗口前可调用以避免丢失最后一拨输入
  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = () => {
      if (!pendingDirtyRef.current) return;
      pendingDirtyRef.current = false;
      void save();
    };
    return () => {
      if (flushRef) flushRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushRef, title, description, status, priority, tagIds, scheduledDates, color, docs]);

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
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-400">
              <span>{header.subtitle ?? "独立任务窗口"}</span>
              {lastSavedAt && (
                <>
                  <span aria-hidden>·</span>
                  <span
                    data-task-editor-section="saved-indicator"
                    className="text-ink-500"
                    title={`上一次自动保存:${lastSavedAt.toLocaleString()}`}
                  >
                    已保存 {formatSavedTime(lastSavedAt)}
                  </span>
                </>
              )}
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

        <TaskDocsField value={docs} onChange={setDocs} />

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
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="block text-xs font-medium text-ink-500">
              任务简述（支持子任务：输入{" "}
              <code className="rounded bg-ink-100 px-1 text-[11px]">[]</code>{" "}
              或{" "}
              <code className="rounded bg-ink-100 px-1 text-[11px]">[ ]</code>{" "}
              加空格自动转勾选框）
            </label>
            <div className="flex shrink-0 items-center gap-2">
              {/* 没有 header 时,把"已保存"提示放这里(modal 模式) */}
              {!header && lastSavedAt && (
                <span
                  data-task-editor-section="saved-indicator"
                  className="text-[11px] text-ink-500"
                  title={`上一次自动保存:${lastSavedAt.toLocaleString()}`}
                >
                  已保存 {formatSavedTime(lastSavedAt)}
                </span>
              )}
              {progress && (
                <span
                  data-task-editor-section="description-progress"
                  className="text-[11px] text-ink-500"
                >
                  {progress.done}/{progress.total} 子任务
                  {progress.inProgress > 0 ? ` · ${progress.inProgress} 进行中` : ""}
                </span>
              )}
            </div>
          </div>
          <RichDescription value={description} onChange={setDescription} />
        </div>
      </div>
    </div>
  );
}

/**
 * 老数据兼容：如果 task.docs 缺失但有老的 docUrl/docTitle，构造一个 doc[0]。
 * 新代码请用 task.docs 字段。
 */
function initialDocsFromTask(task: Task): TaskDoc[] {
  if (task.docs && task.docs.length > 0) return task.docs;
  if (task.docUrl) {
    return [
      {
        id: "doc-legacy-" + task.id,
        title: task.docTitle ?? "",
        url: task.docUrl,
      },
    ];
  }
  return [];
}

/**
 * 写入前清洗：丢掉 URL 为空的行；trim 标题/URL。
 * 标题留空允许，详情显示时退化为 URL 文本。
 */
function cleanDocs(docs: TaskDoc[]): TaskDoc[] {
  return docs
    .map((d) => ({ id: d.id, title: d.title.trim(), url: d.url.trim() }))
    .filter((d) => d.url.length > 0);
}

/** HH:MM:SS（24h）;用于头部的"已保存 HH:MM:SS"小字提示 */
function formatSavedTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour12: false });
}
