/**
 * 任务关联文档字段（编辑器内嵌组件）。
 *
 * 交互：
 *   - 默认折叠：显示首个文档（标题或 URL）+ 文档数量徽标。
 *     单击 chip 在新窗口打开首个 URL。
 *   - 鼠标移入或点击「▾」按钮 → 弹出全部文档列表（仅标题文本，点击跳转）。
 *   - 列表每行尾部一枚编辑图标，点击切换为内联输入框编辑该条 title + url。
 *   - 列表底部「添加文档」按钮新增一条空白文档（自动进入编辑态）。
 *
 * 状态由父组件托管（受控）：value: TaskDoc[]，onChange: (next) => void。
 * 删除空 url 行的逻辑放在父组件 save 时统一处理（cleanDocs），本组件允许暂存空行。
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronRight, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import type { TaskDoc } from "@/lib/types";
import { cn, uid } from "@/lib/utils";

interface TaskDocsFieldProps {
  value: TaskDoc[];
  onChange: (next: TaskDoc[]) => void;
}

export function TaskDocsField({ value, onChange }: TaskDocsFieldProps) {
  const [open, setOpen] = useState(false);
  // 编辑中的 doc id；与 list 渲染中的 doc.id 匹配。新建时立刻进入编辑态。
  const [editingId, setEditingId] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  // 离开 wrapper 时延迟关闭，给鼠标从 chip 移到弹层留缓冲
  const closeTimerRef = useRef<number | null>(null);
  const cancelClose = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, 200);
  };
  useEffect(() => () => cancelClose(), []);

  // 点外面关掉弹层（hover 模式下 mouseleave 已处理；这里给"点击按钮打开后"用）
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const el = wrapperRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        setOpen(false);
        setEditingId(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const first = value[0];
  const total = value.length;
  const hasFirstUrl = !!first?.url?.trim();

  function patchDoc(id: string, p: Partial<TaskDoc>) {
    onChange(value.map((d) => (d.id === id ? { ...d, ...p } : d)));
  }

  function removeDoc(id: string) {
    onChange(value.filter((d) => d.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function addDoc() {
    const next: TaskDoc = { id: uid("doc-"), title: "", url: "" };
    onChange([...value, next]);
    setOpen(true);
    setEditingId(next.id);
  }

  return (
    <div
      data-task-editor-section="docs"
      ref={wrapperRef}
      className="relative"
    >
      <div className="mb-1 flex items-center justify-between">
        <label id={labelId} className="block text-xs font-medium text-ink-500">
          关联文档（钉钉文档 / 飞书 / 任意链接，可加多个）
        </label>
        <button
          type="button"
          onClick={addDoc}
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-ink-500 hover:bg-ink-100 hover:text-ink-700"
          aria-label="添加文档"
        >
          <Plus className="h-3 w-3" />
          添加
        </button>
      </div>

      {/* 折叠态：首个文档 chip + 右向 chevron + 气泡（向右弹出）
          关键：把气泡作为 chip-row 子元素，relative 由 chip-row 提供，
          这样 absolute left-full 是相对一小行的右沿，而不是整行 docs 区。 */}
      {total === 0 ? (
        <div
          className="rounded-md border border-dashed border-ink-200 px-2.5 py-2 text-[11px] text-ink-400"
        >
          暂未关联文档。点击「添加」挂一个 URL。
        </div>
      ) : (
        <div className="relative flex w-fit items-center gap-1">
          <ChipFirst
            doc={first!}
            extraCount={total - 1}
            disabled={!hasFirstUrl}
          />
          <button
            type="button"
            onMouseEnter={() => {
              cancelClose();
              setOpen(true);
            }}
            onMouseLeave={() => {
              if (!editingId) scheduleClose();
            }}
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700",
              open && "bg-ink-100 text-ink-700"
            )}
            aria-label={open ? "收起文档列表" : "展开文档列表"}
            aria-expanded={open}
          >
            <ChevronRight
              className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")}
            />
          </button>

          {/* 气泡：固定大小、紧贴 chevron 右侧。鼠标进入气泡取消关闭，
              离开延迟关闭 —— 让"从 chevron 滑到气泡内部"是连续 hover。 */}
          {open && (
            <div
              className="absolute left-full top-0 z-30 ml-2 flex max-h-72 w-72 flex-col overflow-hidden rounded-lg border border-ink-200 bg-white p-1.5 shadow-lg"
              role="listbox"
              aria-labelledby={labelId}
              onMouseEnter={cancelClose}
              onMouseLeave={() => {
                if (!editingId) scheduleClose();
              }}
            >
              <ul className="flex-1 space-y-1 overflow-y-auto pr-0.5">
                {value.map((doc) =>
                  editingId === doc.id ? (
                    <li key={doc.id}>
                      <DocEditRow
                        doc={doc}
                        onChange={(p) => patchDoc(doc.id, p)}
                        onDone={() => setEditingId(null)}
                        onDelete={() => removeDoc(doc.id)}
                      />
                    </li>
                  ) : (
                    <li key={doc.id}>
                      <DocViewRow
                        doc={doc}
                        onEdit={() => setEditingId(doc.id)}
                      />
                    </li>
                  )
                )}
              </ul>
              <div className="mt-1 shrink-0 border-t border-ink-100 pt-1">
                <button
                  type="button"
                  onClick={addDoc}
                  className="flex w-full items-center gap-1 rounded px-2 py-1 text-[11px] text-ink-500 hover:bg-ink-50 hover:text-ink-700"
                >
                  <Plus className="h-3 w-3" />
                  添加文档
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChipFirst({
  doc,
  extraCount,
  disabled,
}: {
  doc: TaskDoc;
  extraCount: number;
  disabled: boolean;
}) {
  const label = doc.title.trim() || doc.url.trim() || "未填写";
  const tone =
    "border border-ink-200 bg-white text-ink-700 hover:border-brand-300 hover:text-brand-700";
  const inner: ReactNode = (
    <>
      <ExternalLink className="h-3 w-3" />
      <span className="max-w-[14rem] truncate">{label}</span>
      {extraCount > 0 && (
        <span className="rounded bg-ink-100 px-1 text-[10px] text-ink-500">
          +{extraCount}
        </span>
      )}
    </>
  );
  if (disabled) {
    return (
      <span className={cn("chip cursor-default opacity-60", tone)} title="未填写 URL">
        {inner}
      </span>
    );
  }
  return (
    <a
      href={doc.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("chip", tone)}
      title={doc.url}
    >
      {inner}
    </a>
  );
}

function DocViewRow({ doc, onEdit }: { doc: TaskDoc; onEdit: () => void }) {
  const label = doc.title.trim() || doc.url.trim() || "（未填写）";
  return (
    <div className="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-ink-50">
      {doc.url.trim() ? (
        <a
          href={doc.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-ink-700 hover:text-brand-700"
          title={doc.url}
        >
          <ExternalLink className="h-3 w-3 shrink-0 text-ink-400" />
          <span className="truncate">{label}</span>
        </a>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-ink-400">
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate italic">{label}</span>
        </div>
      )}
      <button
        type="button"
        onClick={onEdit}
        className="rounded p-1 text-ink-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-ink-100 hover:text-ink-700"
        title="编辑该文档"
        aria-label="编辑该文档"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}

function DocEditRow({
  doc,
  onChange,
  onDone,
  onDelete,
}: {
  doc: TaskDoc;
  onChange: (p: Partial<TaskDoc>) => void;
  onDone: () => void;
  onDelete: () => void;
}) {
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  return (
    <div className="space-y-1 rounded-md border border-brand-200 bg-brand-50/40 p-1.5">
      <input
        ref={titleRef}
        className="input h-7 py-0 text-xs"
        placeholder="标题（可选，例：Q3 OKR 草稿）"
        value={doc.title}
        onChange={(e) => onChange({ title: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter") onDone();
          if (e.key === "Escape") onDone();
        }}
      />
      <input
        className="input h-7 py-0 text-xs"
        placeholder="https://..."
        value={doc.url}
        onChange={(e) => onChange({ url: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter") onDone();
          if (e.key === "Escape") onDone();
        }}
      />
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50"
        >
          <Trash2 className="h-3 w-3" />
          删除
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded bg-brand-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-brand-700"
        >
          完成
        </button>
      </div>
    </div>
  );
}
