import { Trash2 } from "lucide-react";
import { useTagStore } from "@/store/tagStore";
import { useTaskStore } from "@/store/taskStore";
import { confirm as dialogConfirm } from "@/store/dialogStore";
import type { Tag } from "@/lib/types";
import { DataTable, type Column } from "../DataTable";

export function TagsTable() {
  const tags = useTagStore((s) => s.tags);
  const tagMap = useTagStore((s) => s.byId());
  const deleteTagCascade = useTagStore((s) => s.deleteTagCascade);
  const tasks = useTaskStore((s) => s.tasks);
  const updateTask = useTaskStore((s) => s.updateTask);

  function countOf(tagId: string): number {
    return tasks.filter((t) => t.tagIds.includes(tagId)).length;
  }

  async function handleDelete(t: Tag) {
    const ok = await dialogConfirm({
      title: "删除标签",
      message: `删除标签「${t.name}」及其所有子标签吗？\n关联此标签的任务会自动解除该标签。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    const removed = deleteTagCascade(t.id);
    const removedSet = new Set(removed);
    for (const task of tasks) {
      if (task.tagIds.some((id) => removedSet.has(id))) {
        updateTask(task.id, {
          tagIds: task.tagIds.filter((id) => !removedSet.has(id)),
        });
      }
    }
  }

  const columns: Column<Tag>[] = [
    {
      key: "color",
      label: "颜色",
      render: (t) => (
        <span
          className="inline-block h-3 w-3 rounded-full"
          style={{ backgroundColor: t.color }}
          title={t.color}
        />
      ),
    },
    {
      key: "name",
      label: "名称",
      sortValue: (t) => t.name.toLowerCase(),
      render: (t) => <span className="text-ink-800">{t.name}</span>,
    },
    {
      key: "parent",
      label: "父标签",
      sortValue: (t) =>
        t.parentId ? (tagMap.get(t.parentId)?.name ?? "").toLowerCase() : "",
      render: (t) => {
        if (!t.parentId) return <span className="text-ink-300">—</span>;
        return tagMap.get(t.parentId)?.name ?? t.parentId;
      },
    },
    {
      key: "order",
      label: "同层排序",
      sortValue: (t) => t.order,
    },
    {
      key: "useCount",
      label: "使用次数",
      sortValue: (t) => countOf(t.id),
      render: (t) => countOf(t.id),
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
          title="删除标签（含子标签）"
          aria-label="删除标签"
          className="inline-flex items-center justify-center rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ),
    },
  ];

  return (
    <DataTable<Tag>
      columns={columns}
      rows={tags}
      searchKeys={[(t) => t.name]}
      getRowId={(t) => t.id}
      defaultSort={{ key: "name", dir: "asc" }}
      searchPlaceholder="按标签名搜索…"
    />
  );
}
