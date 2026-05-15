import { ExternalLink, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useTaskStore } from "@/store/taskStore";
import { useTagStore } from "@/store/tagStore";
import { confirm as dialogConfirm } from "@/store/dialogStore";
import type { Task, TaskPriority } from "@/lib/types";
import { DataTable, type Column } from "../DataTable";

const PRIORITY_META: Record<TaskPriority, { label: string; cls: string }> = {
  p0: { label: "P0 紧急", cls: "text-red-600" },
  p1: { label: "P1 重要", cls: "text-warning-600" },
  p2: { label: "P2 一般", cls: "text-ink-500" },
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

function fmtDates(dates: string[]): string {
  if (dates.length === 0) return "—";
  if (dates.length <= 3) return dates.join(", ");
  return `${dates.slice(0, 3).join(", ")}…`;
}

export function TasksTable({ onOpenTask }: { onOpenTask: (t: Task) => void }) {
  const tasks = useTaskStore((s) => s.tasks);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const tagMap = useTagStore((s) => s.byId());

  function tagsText(t: Task): string {
    if (t.tagIds.length === 0) return "—";
    return t.tagIds
      .map((id) => tagMap.get(id)?.name ?? id)
      .join(", ");
  }

  async function handleDelete(t: Task) {
    const ok = await dialogConfirm({
      title: "删除任务",
      message: `删除任务「${t.title}」吗？\n关联的番茄记录会保留但解除关联。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    deleteTask(t.id);
  }

  const columns: Column<Task>[] = [
    {
      key: "title",
      label: "标题",
      sortValue: (t) => t.title.toLowerCase(),
      render: (t) => (
        <span className="block max-w-[260px] truncate text-ink-800" title={t.title}>
          {t.title}
        </span>
      ),
      className: "min-w-0",
    },
    {
      key: "status",
      label: "状态",
      sortValue: (t) => t.status,
      render: (t) => <StatusBadge status={t.status} />,
    },
    {
      key: "priority",
      label: "优先级",
      sortValue: (t) => t.priority ?? "p2",
      render: (t) => {
        const m = PRIORITY_META[t.priority ?? "p2"];
        return <span className={m.cls}>{m.label}</span>;
      },
    },
    {
      key: "scheduledDates",
      label: "排期",
      render: (t) => fmtDates(t.scheduledDates),
    },
    {
      key: "tagIds",
      label: "标签",
      render: (t) => (
        <span
          className="block max-w-[180px] truncate"
          title={tagsText(t)}
        >
          {tagsText(t)}
        </span>
      ),
    },
    {
      key: "doc",
      label: "文档",
      render: (t) => {
        if (!t.docUrl) return <span className="text-ink-300">—</span>;
        return (
          <a
            href={t.docUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex max-w-[140px] items-center gap-1 truncate text-brand-600 hover:underline"
            title={t.docTitle ?? t.docUrl}
          >
            <span className="truncate">{t.docTitle ?? t.docUrl}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        );
      },
    },
    {
      key: "createdAt",
      label: "创建",
      sortValue: (t) => t.createdAt,
      render: (t) => fmtDateTime(t.createdAt),
    },
    {
      key: "updatedAt",
      label: "更新",
      sortValue: (t) => t.updatedAt,
      render: (t) => fmtDateTime(t.updatedAt),
    },
    {
      key: "actions",
      label: "操作",
      render: (t) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleDelete(t);
          }}
          title="删除任务"
          aria-label="删除任务"
          className="inline-flex items-center justify-center rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ),
    },
  ];

  return (
    <DataTable<Task>
      columns={columns}
      rows={tasks}
      searchKeys={[
        (t) => t.title,
        (t) => t.description,
        (t) => t.docTitle ?? "",
      ]}
      getRowId={(t) => t.id}
      onRowClick={onOpenTask}
      defaultSort={{ key: "createdAt", dir: "desc" }}
      searchPlaceholder="按标题/简述/文档名搜索…"
    />
  );
}
