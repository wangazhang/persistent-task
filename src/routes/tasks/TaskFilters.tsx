import { useMemo } from "react";
import { Search, X } from "lucide-react";
import { TagHierarchyPicker } from "@/components/ui/TagHierarchyPicker";
import type { TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useTagStore } from "@/store/tagStore";
import { useTaskStore } from "@/store/taskStore";

/**
 * 任务管理页（/tasks）共享的过滤条。
 *
 * 受 TasksHub 控制（状态在 URL 里），可按 view 类型选择性隐藏某些子项。
 * 设计取向：极简——chip 自身已表达"选中/未选"，不再外挂说明文字。
 */

interface Props {
  status: TaskStatus | "all";
  onStatus: (next: TaskStatus | "all") => void;
  tags: string[];
  onTags: (next: string[]) => void;
  q: string;
  onQ: (next: string) => void;
  showSearch?: boolean;
  showStatus?: boolean;
  showTags?: boolean;
}

const STATUS_FILTERS: { value: TaskStatus | "all"; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "todo", label: "待办" },
  { value: "in_progress", label: "进行中" },
  { value: "suspended", label: "挂起" },
  { value: "done", label: "已完成" },
];

export function TaskFilters({
  status,
  onStatus,
  tags,
  onTags,
  q,
  onQ,
  showSearch = true,
  showStatus = true,
  showTags = true,
}: Props) {
  const tasks = useTaskStore((s) => s.tasks);
  const tagsById = useTagStore((s) => s.byId());
  const collectDescendants = useTagStore((s) => s.collectDescendants);

  const taskCountByTag = useMemo(() => {
    const map = new Map<string, number>();
    for (const tag of tagsById.values()) {
      const ids = new Set(collectDescendants(tag.id));
      let n = 0;
      for (const t of tasks) {
        if (t.tagIds.some((id) => ids.has(id))) n++;
      }
      map.set(tag.id, n);
    }
    return map;
  }, [tasks, tagsById, collectDescendants]);

  if (!showSearch && !showStatus && !showTags) return null;

  return (
    <div className="card mb-4 space-y-2 px-3 py-2">
      {showSearch && (
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-ink-400" />
          <input
            className="input"
            placeholder="搜索任务（支持标题、简述、文档名、标签名）"
            value={q}
            onChange={(e) => onQ(e.target.value)}
          />
        </div>
      )}

      {showStatus && (
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => onStatus(f.value)}
              className={cn(
                "chip border",
                status === f.value
                  ? "border-brand-300 bg-brand-50 text-brand-700"
                  : "border-ink-200 bg-white text-ink-600 hover:border-ink-300"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {showTags && (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <TagHierarchyPicker
              mode="multi"
              value={tags}
              onChange={onTags}
              countByTagId={taskCountByTag}
            />
          </div>
          {tags.length > 0 && (
            <button
              type="button"
              onClick={() => onTags([])}
              title="清除标签筛选"
              aria-label="清除标签筛选"
              className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
