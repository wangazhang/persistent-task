import { useState } from "react";
import { TaskEditor } from "@/components/task/TaskEditor";
import { useTaskStore } from "@/store/taskStore";
import { useTagStore } from "@/store/tagStore";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDataUrlState, type DataTab } from "./useDataUrlState";
import { TasksTable } from "./tables/TasksTable";
import { TagsTable } from "./tables/TagsTable";
import { ImportExportBar } from "./ImportExportBar";

interface TabDef {
  key: DataTab;
  label: string;
  count: number;
}

export function DataPage() {
  const tasks = useTaskStore((s) => s.tasks);
  const pomodoros = useTaskStore((s) => s.pomodoros);
  const tags = useTagStore((s) => s.tags);
  const { tab, setTab } = useDataUrlState();

  const [editing, setEditing] = useState<Task | null>(null);

  const tabs: TabDef[] = [
    { key: "tasks", label: "任务", count: tasks.length },
    { key: "tags", label: "标签", count: tags.length },
    { key: "pomodoros", label: "番茄", count: pomodoros.length },
  ];

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-ink-800">数据</h1>
        <ImportExportBar />
      </header>

      <div className="mb-4 inline-flex overflow-hidden rounded-lg border border-ink-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "px-3 py-1.5 text-xs transition-colors",
              tab === t.key
                ? "bg-brand-600 text-white"
                : "bg-white text-ink-600 hover:bg-ink-50"
            )}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {tab === "tasks" && <TasksTable onOpenTask={(t) => setEditing(t)} />}
      {tab === "tags" && <TagsTable />}
      {tab === "pomodoros" && (
        <div className="rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-400">
          番茄表格 · 待 Task 7 实现
        </div>
      )}

      <TaskEditor
        open={!!editing}
        task={editing}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
