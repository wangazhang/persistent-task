import { Check, Trash2, X } from "lucide-react";
import { useTaskStore } from "@/store/taskStore";
import { confirm as dialogConfirm } from "@/store/dialogStore";
import type { PomodoroSession, PomodoroType } from "@/lib/types";
import { fmtDuration } from "@/lib/utils";
import { DataTable, type Column } from "../DataTable";

const TYPE_LABEL: Record<PomodoroType, string> = {
  focus: "专注",
  short_break: "短休",
  long_break: "长休",
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function PomodorosTable() {
  const sessions = useTaskStore((s) => s.pomodoros);
  const tasks = useTaskStore((s) => s.tasks);
  const removePomodoro = useTaskStore((s) => s.removePomodoro);

  const taskTitleById = new Map<string, string>();
  for (const t of tasks) taskTitleById.set(t.id, t.title);

  function taskTitle(s: PomodoroSession): string {
    if (!s.taskId) return "";
    return taskTitleById.get(s.taskId) ?? s.taskId;
  }

  async function handleDelete(s: PomodoroSession) {
    const title = taskTitle(s);
    const subject = title ? `「${title}」的番茄记录` : "该番茄记录";
    const ok = await dialogConfirm({
      title: "删除番茄记录",
      message: `删除${subject}吗？此操作不可撤销。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    removePomodoro(s.id);
  }

  const columns: Column<PomodoroSession>[] = [
    {
      key: "startedAt",
      label: "开始",
      sortValue: (s) => s.startedAt,
      render: (s) => fmtDateTime(s.startedAt),
    },
    {
      key: "endedAt",
      label: "结束",
      sortValue: (s) => s.endedAt,
      render: (s) => fmtDateTime(s.endedAt),
    },
    {
      key: "type",
      label: "类型",
      sortValue: (s) => s.type,
      render: (s) => TYPE_LABEL[s.type],
    },
    {
      key: "durationSec",
      label: "时长",
      sortValue: (s) => s.durationSec,
      render: (s) => fmtDuration(s.durationSec),
    },
    {
      key: "completed",
      label: "完成",
      sortValue: (s) => (s.completed ? 1 : 0),
      render: (s) =>
        s.completed ? (
          <Check className="h-3.5 w-3.5 text-success-600" />
        ) : (
          <X className="h-3.5 w-3.5 text-ink-400" />
        ),
    },
    {
      key: "task",
      label: "关联任务",
      sortValue: (s) => taskTitle(s).toLowerCase(),
      render: (s) => {
        const title = taskTitle(s);
        if (!title) return <span className="text-ink-300">—</span>;
        return (
          <span className="block max-w-[260px] truncate" title={title}>
            {title}
          </span>
        );
      },
    },
    {
      key: "actions",
      label: "操作",
      render: (s) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleDelete(s);
          }}
          title="删除番茄记录"
          aria-label="删除番茄记录"
          className="inline-flex items-center justify-center rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ),
    },
  ];

  return (
    <DataTable<PomodoroSession>
      columns={columns}
      rows={sessions}
      searchKeys={[(s) => taskTitle(s)]}
      getRowId={(s) => s.id}
      defaultSort={{ key: "startedAt", dir: "desc" }}
      searchPlaceholder="按关联任务名搜索…"
    />
  );
}
