import { useEffect, useState } from "react";
import { X as XIcon } from "lucide-react";
import type { Task, TaskPriority, TaskStatus } from "@/lib/types";
import { useTagStore } from "@/store/tagStore";
import { useTaskStore } from "@/store/taskStore";
import { alert as dialogAlert } from "@/store/dialogStore";
import { cn, isoDate } from "@/lib/utils";
import { PRESET_COLORS } from "@/lib/colors";
import { parseTaskProgress } from "@/lib/taskProgress";
import { Modal } from "@/components/ui/Modal";
import { PriorityPicker } from "@/components/ui/PriorityPicker";
import { TagHierarchyPicker } from "@/components/ui/TagHierarchyPicker";
import { ChevronDown, ChevronRight } from "lucide-react";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { isContiguous } from "@/lib/dateRange";
import { RichDescription } from "@/components/ui/RichDescription";
import { ProgressRing } from "@/components/ui/ProgressRing";

interface TaskEditorProps {
  open: boolean;
  task?: Task | null;
  /** 默认排期日期；新建时使用 */
  defaultDate?: string;
  onClose: () => void;
}

export function TaskEditor({
  open,
  task,
  defaultDate,
  onClose,
}: TaskEditorProps) {
  const tags = useTagStore((s) => s.tags);

  const addTask = useTaskStore((s) => s.addTask);
  const updateTask = useTaskStore((s) => s.updateTask);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("p2");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [docUrl, setDocUrl] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [scheduledDates, setScheduledDates] = useState<string[]>([]);
  const [newDate, setNewDate] = useState(defaultDate ?? isoDate());
  // undefined = 未设（按优先级/状态色降级）；string = 用户选定 hex
  const [color, setColor] = useState<string | undefined>(undefined);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // 初始化 / 切换 task
  useEffect(() => {
    if (!open) return;
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
    // 不连续日期时自动展开进阶面板，避免用户感觉日期"消失了"
    const initial = task ? task.scheduledDates : defaultDate ? [defaultDate] : [isoDate()];
    setAdvancedOpen(initial.length > 1 && !isContiguous(initial));
  }, [open, task, defaultDate]);

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
      await dialogAlert({ title: "无法保存", message: "任务标题不能为空。" });
      return;
    }
    // 100% 子任务 → 自动 done。仅当当前 status 还不是 done 时联动，
    // 避免覆盖用户已显式标完成的 completedAt。
    // 反向：已 done 的任务里再添加未完成子任务（done < total）→ 自动回到 in_progress，
    // 并清掉 completedAt，避免「父任务显示已完成、却还存在未勾选子项」的状态错位。
    const progress = parseTaskProgress(description);
    let nextStatus = status;
    let completedAt: string | undefined;
    let clearCompletedAt = false;
    if (progress && progress.total > 0 && progress.done === progress.total) {
      if (status !== "done") {
        nextStatus = "done";
        completedAt = new Date().toISOString();
      }
    } else if (progress && progress.total > 0 && progress.done < progress.total) {
      if (status === "done") {
        nextStatus = "in_progress";
        clearCompletedAt = true;
      }
    }
    const payload: Partial<Task> = {
      title: title.trim(),
      description: description.trim(),
      status: nextStatus,
      priority,
      tagIds,
      docUrl: docUrl.trim() || undefined,
      docTitle: docTitle.trim() || undefined,
      color,
      // 即使 status === "done" 也保留 scheduledDates：
      // 这样取消完成或恢复时跨天信息不会丢失
      scheduledDates,
    };
    if (completedAt) payload.completedAt = completedAt;
    if (clearCompletedAt) payload.completedAt = undefined;
    if (task) {
      updateTask(task.id, payload);
    } else {
      addTask({ title: title.trim(), ...payload });
    }
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? "编辑任务" : "新建任务"}
      widthClass="max-w-xl"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} type="button">
            取消
          </button>
          <button className="btn-primary" onClick={save} type="button">
            保存
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div>
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

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs font-medium text-ink-500">
              任务简述（支持子任务：输入 <code className="rounded bg-ink-100 px-1 text-[11px]">[ ]</code> 加空格自动转勾选框）
            </label>
            {(() => {
              const p = parseTaskProgress(description);
              if (!p) return null;
              return (
                <span className="flex items-center gap-1.5 text-[11px] text-ink-500">
                  <ProgressRing percent={p.percent} size={28} stroke={3} />
                  {p.done}/{p.total}
                </span>
              );
            })()}
          </div>
          <RichDescription value={description} onChange={setDescription} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-ink-500">
            状态
          </label>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                {
                  v: "todo",
                  l: "待办",
                  selected: "bg-ink-500 text-white border-ink-500",
                  unselected:
                    "bg-ink-50 text-ink-600 border-ink-200 hover:bg-ink-100",
                },
                {
                  v: "in_progress",
                  l: "进行中",
                  selected: "bg-warning-500 text-white border-warning-500",
                  unselected:
                    "bg-warning-50 text-warning-600 border-warning-500/40 hover:bg-warning-50",
                },
                {
                  v: "suspended",
                  l: "挂起",
                  selected: "bg-paused-500 text-white border-paused-500",
                  unselected:
                    "bg-paused-50 text-paused-600 border-paused-500/40 hover:bg-paused-100",
                },
                {
                  v: "done",
                  l: "已完成",
                  selected: "bg-success-500 text-white border-success-500",
                  unselected:
                    "bg-success-50 text-success-600 border-success-500/40 hover:bg-success-50",
                },
              ] as {
                v: TaskStatus;
                l: string;
                selected: string;
                unselected: string;
              }[]
            ).map(({ v, l, selected, unselected }) => (
              <button
                key={v}
                type="button"
                onClick={() => setStatus(v)}
                className={cn(
                  "btn border",
                  status === v ? `${selected} shadow-sm` : unselected
                )}
              >
                {l}
              </button>
            ))}
          </div>
          {status === "suspended" && (
            <p className="mt-1 text-[11px] text-paused-600">
              挂起任务不会出现在「今日」中，但保留排期记录
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-ink-500">
            优先级
          </label>
          <div className="flex items-center gap-2">
            <PriorityPicker
              priority={priority}
              onChange={setPriority}
              size="md"
            />
            <span className="text-[11px] text-ink-400">
              P0 紧急 · P1 重要 · P2 一般（默认）
            </span>
          </div>
        </div>

        <div>
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
                  color === c ? "ring-2 ring-ink-700" : "hover:ring-1 hover:ring-ink-300"
                )}
                title={c}
              />
            ))}
          </div>
          <p className="mt-1 text-[11px] text-ink-400">
            不设 = 按优先级 / 状态色显示
          </p>
        </div>

        <div>
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
              />
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
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

        <div>
          <label className="mb-1 block text-xs font-medium text-ink-500">
            排期日期
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker
              value={scheduledDates}
              onChange={setScheduledDates}
            />
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
      </div>
    </Modal>
  );
}
