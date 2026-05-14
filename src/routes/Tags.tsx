import { Fragment, useCallback, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  ListFilter,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Modal } from "@/components/ui/Modal";
import type { Tag, TagNode } from "@/lib/types";
import { useTagStore } from "@/store/tagStore";
import { useTaskStore } from "@/store/taskStore";
import {
  alert as dialogAlert,
  confirm as dialogConfirm,
} from "@/store/dialogStore";
import { cn } from "@/lib/utils";
import { PRESET_COLORS } from "@/lib/colors";

interface EditorState {
  open: boolean;
  /** 编辑中的标签；为 null 表示新建 */
  editing: Tag | null;
  /** 新建时的父标签 id */
  parentId: string | null;
}

/* ================================================================
 * dnd-kit 数据 payload
 * ================================================================ */
type DragData = { kind: "tag"; tagId: string };
type DropData =
  | { kind: "into"; tagId: string }
  | { kind: "gap"; parentId: string | null; index: number };

const ROOT_KEY = "__root__";

export function TagsPage() {
  const navigate = useNavigate();
  const tags = useTagStore((s) => s.tags);
  const buildTree = useTagStore((s) => s.buildTree);
  const addTag = useTagStore((s) => s.addTag);
  const updateTag = useTagStore((s) => s.updateTag);
  const deleteTagCascade = useTagStore((s) => s.deleteTagCascade);
  const moveTag = useTagStore((s) => s.moveTag);
  const collectDescendants = useTagStore((s) => s.collectDescendants);

  const tasks = useTaskStore((s) => s.tasks);
  const updateTask = useTaskStore((s) => s.updateTask);

  function locateTasks(tagId: string) {
    navigate(`/tasks?tag=${encodeURIComponent(tagId)}`);
  }

  const tree = useMemo(() => buildTree(), [tags, buildTree]);

  const [editor, setEditor] = useState<EditorState>({
    open: false,
    editing: null,
    parentId: null,
  });
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);

  // 折叠状态：默认全部展开
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function openNew(parentId: string | null) {
    setEditor({ open: true, editing: null, parentId });
    setName("");
    setColor(PRESET_COLORS[0]);
  }

  function openEdit(tag: Tag) {
    setEditor({ open: true, editing: tag, parentId: tag.parentId });
    setName(tag.name);
    setColor(tag.color);
  }

  async function save() {
    if (!name.trim()) {
      await dialogAlert({ title: "无法保存", message: "标签名称不能为空。" });
      return;
    }
    if (editor.editing) {
      updateTag(editor.editing.id, { name: name.trim(), color });
    } else {
      addTag({
        name: name.trim(),
        color,
        parentId: editor.parentId,
      });
    }
    setEditor({ open: false, editing: null, parentId: null });
  }

  async function deleteTag(tag: Tag) {
    const ok = await dialogConfirm({
      title: "删除标签",
      message: `删除标签「${tag.name}」及其所有子标签吗？\n关联此标签的任务会自动解除该标签。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    const removed = deleteTagCascade(tag.id);
    const removedSet = new Set(removed);
    for (const t of tasks) {
      if (t.tagIds.some((id) => removedSet.has(id))) {
        updateTask(t.id, {
          tagIds: t.tagIds.filter((id) => !removedSet.has(id)),
        });
      }
    }
  }

  // 统计每个标签下的任务数量（含其后代标签）
  const taskCountByTag = useMemo(() => {
    const map = new Map<string, number>();
    for (const tag of tags) {
      const ids = new Set(collectDescendants(tag.id));
      let count = 0;
      for (const t of tasks) {
        if (t.tagIds.some((id) => ids.has(id))) count++;
      }
      map.set(tag.id, count);
    }
    return map;
  }, [tags, tasks, collectDescendants]);

  /* ============================================================
   * dnd-kit 配置
   * ============================================================ */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor)
  );

  function handleDragEnd(e: DragEndEvent) {
    const activeData = e.active.data.current as DragData | undefined;
    const overData = e.over?.data.current as DropData | undefined;
    if (!activeData || activeData.kind !== "tag" || !overData) return;
    const movedId = activeData.tagId;

    if (overData.kind === "into") {
      // 拖到节点行 → 变成该节点的最后一个子节点
      if (overData.tagId === movedId) return;
      moveTag(movedId, overData.tagId, Number.MAX_SAFE_INTEGER);
      // 自动展开收纳节点
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(overData.tagId);
        return next;
      });
      return;
    }

    if (overData.kind === "gap") {
      const { parentId, index } = overData;
      const target = tags.find((t) => t.id === movedId);
      if (!target) return;

      // 同 parent 调整目标 index：gap 的 index 是按"含 active 的完整列表"计的，
      // 而 moveTag 的 newIndex 语义是相对去掉 active 后的列表。
      let newIdx = index;
      if (target.parentId === parentId) {
        const siblings = tags
          .filter((t) => t.parentId === parentId)
          .sort((a, b) => a.order - b.order);
        const oldIndex = siblings.findIndex((t) => t.id === movedId);
        if (oldIndex >= 0 && oldIndex < index) newIdx = index - 1;
      }
      moveTag(movedId, parentId, newIdx);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-800">标签管理</h1>
          <p className="mt-1 text-sm text-ink-500">
            支持多级标签树。拖动手柄可重排顺序或调整层级；删除父标签时所有子标签会一并删除。
          </p>
        </div>
        <button className="btn-primary" onClick={() => openNew(null)}>
          <Plus className="h-4 w-4" />
          新建根标签
        </button>
      </header>

      {tree.length === 0 ? (
        <div className="card px-6 py-12 text-center text-sm text-ink-400">
          暂无标签，点击右上角新建一个
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragEnd={handleDragEnd}
        >
          <div className="card overflow-hidden">
            {/* 顶部第一个 gap：插到根列表最前 */}
            <GapDrop parentId={null} index={0} level={0} />
            {tree.map((node, i) => (
              <Fragment key={node.id}>
                <TagTreeNode
                  node={node}
                  level={0}
                  collapsed={collapsed}
                  toggleCollapse={toggleCollapse}
                  taskCountByTag={taskCountByTag}
                  onAddChild={openNew}
                  onEdit={openEdit}
                  onDelete={deleteTag}
                  onLocate={locateTasks}
                />
                <GapDrop parentId={null} index={i + 1} level={0} />
              </Fragment>
            ))}
          </div>
        </DndContext>
      )}

      <Modal
        open={editor.open}
        onClose={() =>
          setEditor({ open: false, editing: null, parentId: null })
        }
        title={editor.editing ? "编辑标签" : "新建标签"}
        widthClass="max-w-md"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                setEditor({ open: false, editing: null, parentId: null })
              }
            >
              取消
            </button>
            <button type="button" className="btn-primary" onClick={save}>
              保存
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-500">
              名称
            </label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-500">
              颜色
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    "h-7 w-7 rounded-full ring-offset-2 transition-all",
                    color === c
                      ? "ring-2 ring-ink-700"
                      : "hover:ring-2 hover:ring-ink-300"
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          {!editor.editing && editor.parentId && (
            <div className="text-xs text-ink-500">
              将创建为「
              {tags.find((t) => t.id === editor.parentId)?.name}」的子标签
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

/* ================================================================
 * 行间放置区：用于同级排序
 * ================================================================ */
function GapDrop({
  parentId,
  index,
  level,
}: {
  parentId: string | null;
  index: number;
  level: number;
}) {
  const id = `gap-${parentId ?? ROOT_KEY}-${index}`;
  const data: DropData = { kind: "gap", parentId, index };
  const { setNodeRef, isOver, active } = useDroppable({ id, data });
  const dragging = !!active;
  return (
    <div
      ref={setNodeRef}
      style={{ paddingLeft: `${16 + level * 24}px` }}
      className={cn(
        "transition-all",
        dragging
          ? isOver
            ? "h-7"
            : "h-2"
          : "h-0"
      )}
    >
      {dragging && (
        <div
          className={cn(
            "h-full rounded-full transition-colors",
            isOver
              ? "bg-brand-300"
              : "bg-ink-200/60"
          )}
        />
      )}
    </div>
  );
}

/* ================================================================
 * 标签节点（行 + 子树递归）
 * ================================================================ */
interface TagTreeNodeProps {
  node: TagNode;
  level: number;
  collapsed: Set<string>;
  toggleCollapse: (id: string) => void;
  taskCountByTag: Map<string, number>;
  onAddChild: (parentId: string | null) => void;
  onEdit: (tag: Tag) => void;
  onDelete: (tag: Tag) => void;
  onLocate: (tagId: string) => void;
}

function TagTreeNode(props: TagTreeNodeProps) {
  const {
    node,
    level,
    collapsed,
    toggleCollapse,
    taskCountByTag,
    onAddChild,
    onEdit,
    onDelete,
    onLocate,
  } = props;
  const expanded = !collapsed.has(node.id);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <TagRow
        node={node}
        level={level}
        expanded={expanded}
        toggleCollapse={toggleCollapse}
        taskCountByTag={taskCountByTag}
        onAddChild={onAddChild}
        onEdit={onEdit}
        onDelete={onDelete}
        onLocate={onLocate}
      />
      {hasChildren && expanded && (
        <div>
          <GapDrop parentId={node.id} index={0} level={level + 1} />
          {node.children.map((child, i) => (
            <Fragment key={child.id}>
              <TagTreeNode
                node={child}
                level={level + 1}
                collapsed={collapsed}
                toggleCollapse={toggleCollapse}
                taskCountByTag={taskCountByTag}
                onAddChild={onAddChild}
                onEdit={onEdit}
                onDelete={onDelete}
                onLocate={onLocate}
              />
              <GapDrop
                parentId={node.id}
                index={i + 1}
                level={level + 1}
              />
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================================================================
 * 单行：拖拽源 + "into" 放置区合体
 * ================================================================ */
function TagRow({
  node,
  level,
  expanded,
  toggleCollapse,
  taskCountByTag,
  onAddChild,
  onEdit,
  onDelete,
  onLocate,
}: Omit<TagTreeNodeProps, "collapsed"> & { expanded: boolean }) {
  const hasChildren = node.children.length > 0;
  const count = taskCountByTag.get(node.id) ?? 0;

  const dragData: DragData = { kind: "tag", tagId: node.id };
  const dropData: DropData = { kind: "into", tagId: node.id };
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: `tag-${node.id}`, data: dragData });
  const {
    setNodeRef: setDropRef,
    isOver,
    active,
  } = useDroppable({ id: `into-${node.id}`, data: dropData });

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      setDragRef(el);
      setDropRef(el);
    },
    [setDragRef, setDropRef]
  );

  // 自身或自身后代不能成为放置目标（但让其它判定交给 store；这里只控制视觉提示）
  const activeIsSelf = active?.id === `tag-${node.id}`;
  const showIntoHighlight = isOver && !activeIsSelf;

  return (
    <div
      ref={setRefs}
      className={cn(
        "group relative flex items-center gap-2 px-4 py-2.5 transition-colors",
        showIntoHighlight
          ? "bg-brand-100"
          : "hover:bg-ink-50",
        isDragging && "opacity-40"
      )}
      style={{ paddingLeft: `${16 + level * 24}px` }}
    >
      {/* 拖拽手柄 */}
      <button
        type="button"
        {...listeners}
        {...attributes}
        title="拖动以重排或改变层级"
        className="cursor-grab text-ink-300 hover:text-ink-500 active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* 折叠箭头 */}
      <button
        type="button"
        className="text-ink-400"
        onClick={() => toggleCollapse(node.id)}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )
        ) : (
          <span className="inline-block h-4 w-4" />
        )}
      </button>

      {/* 颜色点 */}
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: node.color }}
      />

      {/* 名字 + 任务数：可点击跳到任务列表 */}
      <button
        type="button"
        onClick={() => onLocate(node.id)}
        title="查看此标签下的全部任务"
        className="-ml-1 flex items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-white"
      >
        <span className="text-sm font-medium text-ink-800">{node.name}</span>
        <span className="text-xs text-ink-400">{count} 个任务</span>
      </button>

      {/* "拖到此处会成为子节点"的提示 */}
      {showIntoHighlight && (
        <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-brand-700 shadow-sm">
          放到此处 → 成为「{node.name}」的子标签
        </span>
      )}

      {/* 行尾 hover 操作 */}
      <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          title="查看任务"
          onClick={() => onLocate(node.id)}
          className="rounded p-1 text-ink-400 hover:bg-brand-50 hover:text-brand-600"
        >
          <ListFilter className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="新建子标签"
          onClick={() => onAddChild(node.id)}
          className="rounded p-1 text-ink-400 hover:bg-brand-50 hover:text-brand-600"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="编辑"
          onClick={() => onEdit(node)}
          className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="删除"
          onClick={() => onDelete(node)}
          className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
