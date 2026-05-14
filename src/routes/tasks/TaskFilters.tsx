import { useMemo } from "react";
import { Search, X } from "lucide-react";
import { TagChip } from "@/components/ui/TagChip";
import { TagHierarchyPicker } from "@/components/ui/TagHierarchyPicker";
import type { TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useTagStore } from "@/store/tagStore";
import { useTaskStore } from "@/store/taskStore";

/**
 * 任务管理页（/tasks）共享的过滤条。
 *
 * 受 TasksHub 控制（状态在 URL 里），可按 view 类型选择性隐藏某些子项：
 * - All view：显示 search + status + tags 三项
 * - Calendar view：只显示 tags（status / search 与日历语义不合，过滤会让色阶失真）
 * - Today view：完全不显示（保留 Today 的开盖即用心智）
 */

interface Props {
  status: TaskStatus | "all";
  onStatus: (next: TaskStatus | "all") => void;
  tags: string[];
  onTags: (next: string[]) => void;
  q: string;
  onQ: (next: string) => void;
  /** 是否显示搜索框 */
  showSearch?: boolean;
  /** 是否显示状态过滤 */
  showStatus?: boolean;
  /** 是否显示标签过滤 */
  showTags?: boolean;
  /** 标签过滤的说明文案；Calendar 想说"过滤日历可见任务"，All 想说"或语义" */
  tagHint?: string;
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
  tagHint,
}: Props) {
  const tasks = useTaskStore((s) => s.tasks);
  const tagsById = useTagStore((s) => s.byId());
  const collectDescendants = useTagStore((s) => s.collectDescendants);

  // 每个标签下的任务总数（含后代）— 显示在 picker chip 上的数字
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

  // 三个子项全关时不渲染外壳，避免空 card 占位
  if (!showSearch && !showStatus && !showTags) return null;

  return (
    <div className="card mb-4 space-y-3 p-4">
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
          <span className="text-xs text-ink-500">状态：</span>
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
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-xs text-ink-500">标签（多选）：</span>
            <span className="text-[10px] text-ink-400">
              {tagHint ?? "点 chip 选中/取消 · 点 › 展开下一级 · 多个标签为「或」"}
            </span>
          </div>
          <TagHierarchyPicker
            mode="multi"
            value={tags}
            onChange={onTags}
            countByTagId={taskCountByTag}
          />
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-ink-500">
              <span>已选：</span>
              {tags.map((id) => {
                const tag = tagsById.get(id);
                return tag ? <TagChip key={id} tag={tag} /> : null;
              })}
              <button
                type="button"
                onClick={() => onTags([])}
                className="ml-1 inline-flex items-center gap-0.5 rounded px-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              >
                <X className="h-3 w-3" />
                清空
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
