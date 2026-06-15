import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Home, X } from "lucide-react";
import type { Tag, TagNode } from "@/lib/types";
import { useTagStore } from "@/store/tagStore";
import { cn } from "@/lib/utils";
import { TagChip } from "./TagChip";

type SingleProps = {
  mode: "single";
  value: string | null;
  onChange: (next: string | null) => void;
  /** 单选模式："全部"按钮的文案，默认 "全部" */
  allLabel?: string;
};

type MultiProps = {
  mode: "multi";
  value: string[];
  onChange: (next: string[]) => void;
  allLabel?: never;
};

type Props = (SingleProps | MultiProps) & {
  /** 是否在 chip 旁显示"× 个任务"等附加信息（外部计算）*/
  countByTagId?: Map<string, number>;
  /** 独立窗口等无本地 tag store 的场景可直接传入标签快照 */
  tagsOverride?: Tag[];
  /** 紧凑模式：压缩为单行滚动布局（任务页过滤条用） */
  compact?: boolean;
  /** 自定义类名 */
  className?: string;
};

/**
 * 层级标签选择器。
 *
 * 交互：
 *   - 顶部面包屑：当前所在层级路径，可点击任一段回退
 *   - 当前层级 chip 列表：
 *       * chip 主体 → 选中（单选 = 替换，多选 = toggle）
 *       * chip 右侧的 ›  → 钻取到该标签的子层级
 *   - 单选模式额外有"全部"chip 用于清除当前选择
 *
 * 设计权衡：
 *   "选中"和"钻取"分成两个动作，避免歧义。父标签也可以被选中
 *   （单选 = 自动包含子标签的语义由调用方决定，比如 collectDescendants）。
 */
export function TagHierarchyPicker(props: Props) {
  const storeTags = useTagStore((s) => s.tags);
  const buildTree = useTagStore((s) => s.buildTree);
  const tags = props.tagsOverride ?? storeTags;
  const compact = props.compact ?? false;
  const tree = useMemo(
    () => (props.tagsOverride ? buildTagTree(props.tagsOverride) : buildTree()),
    [props.tagsOverride, buildTree]
  );
  const tagsById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  // path：当前正在浏览的祖先链。空数组 = 顶层
  // 选中标签时，自动把面包屑滚动到该标签所在层级（若与当前路径不一致则不强制改变 path）
  const [path, setPath] = useState<string[]>([]);

  // 当 value 从外部变化（比如 URL 同步），尝试调整 path 到能"看到"该选项的层级
  // 不强制：用户可能正在浏览别的层级，强行跳层会打断
  useEffect(() => {
    if (props.mode !== "single") return;
    if (!props.value) return;
    if (path.length > 0) return; // 只有处于初始顶层时才自动展开
    const tag = tagsById.get(props.value);
    if (!tag || !tag.parentId) return;
    const ancestors: string[] = [];
    let cur: Tag | undefined = tagsById.get(tag.parentId);
    while (cur) {
      ancestors.unshift(cur.id);
      cur = cur.parentId ? tagsById.get(cur.parentId) : undefined;
    }
    if (ancestors.length > 0) setPath(ancestors);
    // 仅在初次挂载且单选有值时执行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 当前层级显示的子节点
  const currentNodes: TagNode[] = useMemo(() => {
    if (path.length === 0) return tree;
    let cursor: TagNode | undefined;
    let level = tree;
    for (const id of path) {
      cursor = level.find((n) => n.id === id);
      if (!cursor) return [];
      level = cursor.children;
    }
    return level;
  }, [path, tree]);

  // 面包屑：仅在已钻入子层级时显示。根层级用 chip 行就够了，避免"全部标签"成为冗余说明文字。
  const showCrumbs = path.length > 0;
  const crumbs: { id: string | null; node: React.ReactNode }[] = [
    { id: null, node: <Home className="h-3 w-3" /> },
    ...path.map((id) => ({
      id,
      node: tagsById.get(id)?.name ?? "?",
    })),
  ];

  function isSelected(tagId: string): boolean {
    if (props.mode === "single") return props.value === tagId;
    return props.value.includes(tagId);
  }

  function toggleSelect(tagId: string) {
    if (props.mode === "single") {
      props.onChange(props.value === tagId ? null : tagId);
    } else {
      props.onChange(
        props.value.includes(tagId)
          ? props.value.filter((id) => id !== tagId)
          : [...props.value, tagId]
      );
    }
  }

  function drillInto(tagId: string) {
    setPath((p) => [...p, tagId]);
  }

  function gotoCrumb(idx: number) {
    // idx = 0 是"全部" -> path = []
    setPath((p) => p.slice(0, idx));
  }

  if (compact) {
    return (
      <div
        className={cn(
          "flex min-w-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-0.5",
          props.className
        )}
      >
        {showCrumbs && (
          <>
            {crumbs.map((c, i) => {
              const isLast = i === crumbs.length - 1;
              return (
                <div
                  key={c.id ?? "__root__"}
                  className="flex shrink-0 items-center gap-1"
                >
                  <button
                    type="button"
                    onClick={() => gotoCrumb(i)}
                    disabled={isLast}
                    className={cn(
                      "inline-flex items-center rounded px-1 py-0.5 text-xs transition-colors",
                      isLast
                        ? "font-medium text-ink-700"
                        : "text-ink-500 hover:bg-ink-100 hover:text-ink-700"
                    )}
                    title={c.id === null ? "回到全部" : undefined}
                  >
                    {c.node}
                  </button>
                  {!isLast && (
                    <ChevronRight className="h-3 w-3 shrink-0 text-ink-300" />
                  )}
                </div>
              );
            })}
            <span className="h-4 w-px shrink-0 bg-ink-100" />
          </>
        )}

        {props.mode === "single" && (
          <button
            type="button"
            onClick={() => props.onChange(null)}
            className={cn(
              "chip shrink-0 border",
              props.value === null
                ? "border-brand-300 bg-brand-50 text-brand-700"
                : "border-ink-200 bg-white text-ink-600 hover:border-ink-300"
            )}
          >
            {props.allLabel ?? "全部"}
          </button>
        )}

        {currentNodes.length === 0 && (
          <span className="shrink-0 text-xs text-ink-400">这一级没有标签</span>
        )}

        {currentNodes.map((node) => {
          const selected = isSelected(node.id);
          const hasChildren = node.children.length > 0;
          const count = props.countByTagId?.get(node.id);
          return (
            <div
              key={node.id}
              className={cn(
                "inline-flex shrink-0 items-stretch overflow-hidden rounded-full border transition-colors",
                selected
                  ? "border-brand-300 ring-2 ring-brand-200"
                  : "border-ink-200 hover:border-ink-300"
              )}
            >
              <button
                type="button"
                onClick={() => toggleSelect(node.id)}
                className="flex items-center gap-1 px-2.5 py-0.5 hover:bg-ink-50"
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: node.color }}
                />
                <span className="text-xs font-medium text-ink-700">
                  {node.name}
                </span>
                {typeof count === "number" && (
                  <span className="text-[10px] text-ink-400">{count}</span>
                )}
              </button>
              {hasChildren && (
                <button
                  type="button"
                  onClick={() => drillInto(node.id)}
                  title={`查看「${node.name}」的子标签`}
                  className="flex items-center border-l border-ink-200 px-1 text-ink-400 hover:bg-ink-50 hover:text-ink-700"
                >
                  <ChevronRight className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}

        {props.mode === "multi" && props.value.length > 0 && (
          <>
            <span className="h-4 w-px shrink-0 bg-ink-100" />
            {props.value.map((id) => {
              const tag = tagsById.get(id);
              if (!tag) return null;
              return (
                <TagChip
                  key={id}
                  tag={tag}
                  onRemove={() => toggleSelect(id)}
                  className="shrink-0 ring-1 ring-brand-200"
                />
              );
            })}
          </>
        )}
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", props.className)}>
      {/* 面包屑：只在钻入子层级时出现，根层级保持空 */}
      {showCrumbs && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <div key={c.id ?? "__root__"} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => gotoCrumb(i)}
                  disabled={isLast}
                  className={cn(
                    "inline-flex items-center rounded px-1.5 py-0.5 transition-colors",
                    isLast
                      ? "font-medium text-ink-700"
                      : "text-ink-500 hover:bg-ink-100 hover:text-ink-700"
                  )}
                  title={c.id === null ? "回到全部" : undefined}
                >
                  {c.node}
                </button>
                {!isLast && <ChevronRight className="h-3 w-3 text-ink-300" />}
              </div>
            );
          })}
          {/* 单选模式右上角"清除"按钮 */}
          {props.mode === "single" && props.value && (
            <button
              type="button"
              onClick={() => props.onChange(null)}
              className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              title="清除标签筛选"
              aria-label="清除标签筛选"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {/* 当前层级 chip 列表 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {props.mode === "single" && (
          <button
            type="button"
            onClick={() => props.onChange(null)}
            className={cn(
              "chip border",
              props.value === null
                ? "border-brand-300 bg-brand-50 text-brand-700"
                : "border-ink-200 bg-white text-ink-600 hover:border-ink-300"
            )}
          >
            {props.allLabel ?? "全部"}
          </button>
        )}

        {currentNodes.length === 0 && (
          <span className="text-xs text-ink-400">这一级没有标签</span>
        )}

        {currentNodes.map((node) => {
          const selected = isSelected(node.id);
          const hasChildren = node.children.length > 0;
          const count = props.countByTagId?.get(node.id);
          return (
            <div
              key={node.id}
              className={cn(
                "inline-flex items-stretch overflow-hidden rounded-full border transition-colors",
                selected
                  ? "border-brand-300 ring-2 ring-brand-200"
                  : "border-ink-200 hover:border-ink-300"
              )}
            >
              <button
                type="button"
                onClick={() => toggleSelect(node.id)}
                className="flex items-center gap-1 px-2.5 py-0.5 hover:bg-ink-50"
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: node.color }}
                />
                <span className="text-xs font-medium text-ink-700">
                  {node.name}
                </span>
                {typeof count === "number" && (
                  <span className="text-[10px] text-ink-400">{count}</span>
                )}
              </button>
              {hasChildren && (
                <button
                  type="button"
                  onClick={() => drillInto(node.id)}
                  title={`查看「${node.name}」的子标签`}
                  className="flex items-center border-l border-ink-200 px-1 text-ink-400 hover:bg-ink-50 hover:text-ink-700"
                >
                  <ChevronRight className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {props.mode === "multi" && props.value.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-t border-ink-100 pt-2">
          <span className="text-[11px] text-ink-400">已选：</span>
          {props.value.map((id) => {
            const tag = tagsById.get(id);
            if (!tag) return null;
            return (
              <TagChip
                key={id}
                tag={tag}
                onRemove={() => toggleSelect(id)}
                className="ring-1 ring-brand-200"
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function buildTagTree(tags: Tag[]): TagNode[] {
  const map = new Map<string, TagNode>();
  tags.forEach((t) => map.set(t.id, { ...t, children: [] }));
  const roots: TagNode[] = [];
  map.forEach((node) => {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortRecursive = (nodes: TagNode[]) => {
    nodes.sort((a, b) => a.order - b.order);
    nodes.forEach((n) => sortRecursive(n.children));
  };
  sortRecursive(roots);
  return roots;
}
