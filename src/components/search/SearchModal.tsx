import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, Hash, Search, X } from "lucide-react";
import type { Task, Tag } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useTagStore } from "@/store/tagStore";
import { useTaskStore } from "@/store/taskStore";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { track } from "@/lib/analytics";

/**
 * 任务搜索 Modal（命令面板风格）。
 *
 * 入口：右上角 [搜索] 按钮 / 全局快捷键 Cmd-K (Win: Ctrl-K)
 *
 * 设计要点：
 * - 输入框 autoFocus；防抖 100ms 后过滤，避免大数据集逐字符 re-render
 * - 命中字段：title / description / 任一关联 tagName，OR 关系
 * - 命中片段在 title / description 里高亮（不在 tag 名上做高亮，因为 tag 是 chip）
 * - 空查询：fallback 显示「最近更新的 10 个任务」
 * - 键盘：↑ ↓ 切换选中、Enter 打开编辑器（外部回调）、Esc 关闭
 * - 选中行带 brand 背景；列表区域可滚动且自动 scrollIntoView 选中行
 * - 已归档任务默认不出现在搜索结果中（archived 等同隐藏）
 *
 * 这个 modal 是"只读 + 跳转"，不在内部做修改 —— 选中后由外部决定怎么处理。
 */

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  /** 用户回车 / 点击命中项时触发，外部一般用来打开 TaskEditor。 */
  onOpenTask: (task: Task) => void;
}

interface ResultItem {
  task: Task;
  /** 命中详情，用于在 UI 上 explain why */
  hits: {
    title: boolean;
    description: boolean;
    /** 命中的标签名（可能多个，用于解释为什么这个任务进入结果）*/
    tagNames: string[];
  };
}

export function SearchModal({ open, onClose, onOpenTask }: SearchModalProps) {
  const tasks = useTaskStore((s) => s.tasks);
  const tagsById = useTagStore((s) => s.byId());

  // 输入与去抖
  const [raw, setRaw] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => {
      const q = raw.trim();
      setQuery(q);
      if (q) track("ui.search.used", { queryLength: q.length });
    }, 100);
    return () => clearTimeout(id);
  }, [raw]);

  // 选中索引
  const [active, setActive] = useState(0);

  // 打开时重置状态 + 聚焦输入框
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setRaw("");
      setQuery("");
      setActive(0);
      // 等 modal 挂载完成
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // 过滤 + 排序
  const results = useMemo<ResultItem[]>(() => {
    const q = query.toLowerCase();
    const candidates = tasks.filter((t) => t.status !== "archived");

    // 空查询 fallback：按 updatedAt 倒序 top 10
    if (!q) {
      return [...candidates]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 10)
        .map((task) => ({
          task,
          hits: { title: false, description: false, tagNames: [] },
        }));
    }

    const out: ResultItem[] = [];
    for (const task of candidates) {
      const titleHit = task.title.toLowerCase().includes(q);
      const descHit = task.description.toLowerCase().includes(q);
      const tagNames: string[] = [];
      for (const id of task.tagIds) {
        const t = tagsById.get(id);
        if (t && t.name.toLowerCase().includes(q)) tagNames.push(t.name);
      }
      if (titleHit || descHit || tagNames.length > 0) {
        out.push({ task, hits: { title: titleHit, description: descHit, tagNames } });
      }
    }
    // 排序：title 命中优先 > tag 命中 > description 命中；
    // 同优先级再按 updatedAt 倒序
    return out.sort((a, b) => {
      const score = (r: ResultItem) =>
        (r.hits.title ? 3 : 0) +
        (r.hits.tagNames.length > 0 ? 2 : 0) +
        (r.hits.description ? 1 : 0);
      const ds = score(b) - score(a);
      if (ds !== 0) return ds;
      return b.task.updatedAt.localeCompare(a.task.updatedAt);
    });
  }, [tasks, tagsById, query]);

  // 重置选中（结果变了时把 active clamp 回 0）
  useEffect(() => {
    setActive(0);
  }, [query]);

  // 自动滚动选中行进入视野
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !listRef.current) return;
    const row = listRef.current.querySelector<HTMLElement>(
      `[data-search-index="${active}"]`
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [active, open, results.length]);

  // 键盘：↑↓ Enter Esc
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[active];
      if (r) {
        onOpenTask(r.task);
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[10vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {/* 输入区 */}
        <div className="flex items-center gap-2 border-b border-ink-200/70 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-ink-400" />
          <input
            ref={inputRef}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="搜索任务标题、描述、标签名…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-300"
          />
          {raw && (
            <button
              type="button"
              onClick={() => {
                setRaw("");
                inputRef.current?.focus();
              }}
              className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              aria-label="清除"
              title="清除"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <kbd className="hidden rounded border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[10px] text-ink-500 sm:inline">
            Esc
          </kbd>
        </div>

        {/* 结果区 */}
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-ink-400">
              {query ? (
                <>
                  没有找到与「<span className="font-medium text-ink-600">{query}</span>」匹配的任务。
                  <div className="mt-1 text-xs text-ink-300">
                    搜索范围：标题 / 描述 / 标签名
                  </div>
                </>
              ) : (
                "暂无任务"
              )}
            </div>
          ) : (
            <>
              {!query && (
                <div className="px-4 pt-2 text-[11px] text-ink-400">
                  最近更新的 {results.length} 个任务
                </div>
              )}
              <ul className="py-1">
                {results.map((r, i) => (
                  <SearchResultRow
                    key={r.task.id}
                    item={r}
                    query={query}
                    active={i === active}
                    tagsById={tagsById}
                    onHover={() => setActive(i)}
                    onClick={() => {
                      onOpenTask(r.task);
                      onClose();
                    }}
                    index={i}
                  />
                ))}
              </ul>
            </>
          )}
        </div>

        {/* 底部提示 */}
        <div className="flex items-center justify-between border-t border-ink-200/70 bg-ink-50/60 px-4 py-2 text-[10px] text-ink-400">
          <span>
            {query ? `${results.length} 个结果` : `共 ${tasks.filter((t) => t.status !== "archived").length} 个任务`}
          </span>
          <span className="flex items-center gap-2">
            <kbd className="rounded border border-ink-200 bg-white px-1 py-0.5">↑</kbd>
            <kbd className="rounded border border-ink-200 bg-white px-1 py-0.5">↓</kbd>
            选择
            <kbd className="ml-1 rounded border border-ink-200 bg-white px-1 py-0.5">Enter</kbd>
            打开
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------- 子组件 ----------

function SearchResultRow({
  item,
  query,
  active,
  tagsById,
  onHover,
  onClick,
  index,
}: {
  item: ResultItem;
  query: string;
  active: boolean;
  tagsById: Map<string, Tag>;
  onHover: () => void;
  onClick: () => void;
  index: number;
}) {
  const { task, hits } = item;
  const priority = task.priority ?? "p2";
  const priorityBar =
    priority === "p0"
      ? "border-l-rose-400"
      : priority === "p1"
      ? "border-l-amber-400"
      : "border-l-transparent";

  // 排期日预览：第一日 + 跨天提示
  const firstDate = task.scheduledDates[0];
  const span = task.scheduledDates.length;

  return (
    <li>
      <button
        type="button"
        data-search-index={index}
        onMouseEnter={onHover}
        onClick={onClick}
        className={cn(
          "flex w-full items-start gap-3 border-l-2 px-4 py-2 text-left transition-colors",
          priorityBar,
          active ? "bg-brand-50/80" : "hover:bg-ink-50"
        )}
      >
        <div className="min-w-0 flex-1">
          {/* 标题行 */}
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-ink-800">
              {hits.title ? (
                <HighlightedText text={task.title} query={query} />
              ) : (
                task.title
              )}
            </span>
            <StatusBadge status={task.status} />
            {priority !== "p2" && (
              <span
                className={cn(
                  "chip",
                  priority === "p0"
                    ? "bg-rose-50 text-rose-600"
                    : "bg-amber-50 text-amber-600"
                )}
              >
                {priority.toUpperCase()}
              </span>
            )}
          </div>
          {/* 描述命中 / 标签命中片段 */}
          {hits.description && task.description && (
            <div className="mt-1 truncate text-[12px] text-ink-500">
              <HighlightedText text={task.description} query={query} />
            </div>
          )}
          {!hits.description && task.description && !hits.title && hits.tagNames.length === 0 && (
            <div className="mt-1 truncate text-[12px] text-ink-400">
              {task.description}
            </div>
          )}
          {/* meta：标签 + 日期 */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500">
            {task.tagIds.length > 0 && (
              <span className="flex flex-wrap items-center gap-1">
                <Hash className="h-3 w-3 text-ink-400" />
                {task.tagIds.map((id) => {
                  const tag = tagsById.get(id);
                  if (!tag) return null;
                  const isHit = hits.tagNames.includes(tag.name);
                  return (
                    <span
                      key={id}
                      className={cn(
                        "chip border",
                        isHit && "ring-2 ring-brand-300"
                      )}
                      style={{
                        backgroundColor: `${tag.color}1A`,
                        color: tag.color,
                        borderColor: `${tag.color}40`,
                      }}
                    >
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      {tag.name}
                    </span>
                  );
                })}
              </span>
            )}
            {firstDate && (
              <span className="flex items-center gap-1 text-ink-400">
                <Calendar className="h-3 w-3" />
                {firstDate}
                {span > 1 && <span>· 跨 {span} 天</span>}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

/**
 * 在文本中高亮 query 命中片段。
 * 简单实现：大小写不敏感分割，不做正则转义（用户输入正则保留字时 fallback 普通文本）。
 */
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const q = query.toLowerCase();
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return <>{text}</>;
  // 只高亮第一处（命中通常很短，多次出现也只标第一个，避免 UI 太花）
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-amber-200/70 px-0.5 text-ink-800">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}
