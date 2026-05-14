import { useTagStore } from "@/store/tagStore";
import { useTaskStore } from "@/store/taskStore";
import type { Tag } from "@/lib/types";
import { DataTable, type Column } from "../DataTable";

export function TagsTable() {
  const tags = useTagStore((s) => s.tags);
  const tagMap = useTagStore((s) => s.byId());
  const tasks = useTaskStore((s) => s.tasks);

  function countOf(tagId: string): number {
    return tasks.filter((t) => t.tagIds.includes(tagId)).length;
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
