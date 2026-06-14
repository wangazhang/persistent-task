/**
 * AI 快速录入小窗（独立 webview）。
 *
 * 阶段 3：每张确认卡片都可就地编辑——title / priority / scheduledDates /
 * matchedTagIds / description 全部受控；newTagNames（AI 建议）保持独立
 * opt-in 复选框（设计书要求用户主动确认要不要建）。
 *
 * 设计取舍：
 * - 解析无副作用 → 直接 invoke parse_quick_input
 * - 入库经事件回 main → emit("quick-record:commit") + 等待 "quick-record:committed"
 * - 未配 Key → 提示文案 + 跳「高级」按钮（main 侧 listen 到此事件再做导航/对焦）
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { useTagStore } from "@/store/tagStore";
import { isoDate, cn } from "@/lib/utils";
import {
  ERR_AI_NOT_CONFIGURED,
  parseQuickInput,
  type ParsedTaskDraft,
} from "@/lib/aiParse";
import {
  emitQuickRecordCommit,
  emitQuickRecordGotoSettings,
  listenQuickRecordCommitted,
  type QuickRecordCommitDraft,
} from "@/lib/quickRecordBridge";
import { initAdapter, isTauri } from "@/lib/dataAdapter";
import { PriorityPicker } from "@/components/ui/PriorityPicker";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { TagHierarchyPicker } from "@/components/ui/TagHierarchyPicker";
import type { Tag } from "@/lib/types";

interface DraftCard extends ParsedTaskDraft {
  /** 临时本地 id，仅用于 React key + 用户勾选/删除时的定位 */
  localId: string;
  selected: boolean;
  /** 用户勾选要新建的标签名（默认全勾，取消则不建不挂） */
  selectedNewTagNames: Set<string>;
  /** 描述折叠/展开（仅 UI 态） */
  descriptionExpanded: boolean;
}

type Phase = "input" | "parsing" | "confirm" | "committing" | "done";

export default function QuickRecordWindow() {
  const [phase, setPhase] = useState<Phase>("input");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftCard[]>([]);
  const [committedCount, setCommittedCount] = useState(0);
  const tags = useTagStore((s) => s.tags);
  const tagsHydrated = useTagStore((s) => s.hydrated);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 小窗也要 hydrate adapter 才能看到 tags（main 侧已 hydrate 过，但 webview 各自独立）
  useEffect(() => {
    void initAdapter().then(() => {
      void useTagStore.getState().hydrate();
    });
  }, []);

  // 自动聚焦输入
  useEffect(() => {
    if (phase === "input") textareaRef.current?.focus();
  }, [phase]);

  // Esc 关窗
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!isTauri()) return;
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().hide();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 监听 main 的 committed 回执
  useEffect(() => {
    let un: (() => void) | undefined;
    let disposed = false;
    listenQuickRecordCommitted((p) => {
      setCommittedCount(p.count);
      setPhase("done");
      // 1.2s 后自动关窗 + 重置（用户下次唤起又是干净状态）
      setTimeout(async () => {
        if (!isTauri()) return;
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().hide();
        // 关窗后重置（窗口下次 show 时回到 input 态）
        setPhase("input");
        setText("");
        setDrafts([]);
        setError(null);
      }, 1200);
    }).then((u) => {
      if (disposed) u();
      else un = u;
    });
    return () => {
      disposed = true;
      un?.();
    };
  }, []);

  const tagLite = useMemo(
    () => tags.map((t) => ({ id: t.id, name: t.name })),
    [tags]
  );

  async function handleParse() {
    if (!text.trim() || phase === "parsing") return;
    setError(null);
    setPhase("parsing");
    const today = isoDate();
    const result = await parseQuickInput(text, today, tagLite);
    if (!result.ok) {
      setError(result.error);
      setPhase("input");
      return;
    }
    if (result.drafts.length === 0) {
      setError("没识别出任务，换种说法或写具体点");
      setPhase("input");
      return;
    }
    setDrafts(
      result.drafts.map((d, i) => ({
        ...d,
        localId: `d-${i}`,
        selected: true,
        selectedNewTagNames: new Set(d.newTagNames),
        descriptionExpanded: false,
      }))
    );
    setPhase("confirm");
  }

  function toggleSelect(localId: string) {
    setDrafts((prev) =>
      prev.map((d) =>
        d.localId === localId ? { ...d, selected: !d.selected } : d
      )
    );
  }

  function removeCard(localId: string) {
    setDrafts((prev) => prev.filter((d) => d.localId !== localId));
  }

  function toggleNewTag(localId: string, name: string) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.localId !== localId) return d;
        const next = new Set(d.selectedNewTagNames);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return { ...d, selectedNewTagNames: next };
      })
    );
  }

  /** 通用聚合 setter：单字段 immutable 更新 */
  function updateField<K extends keyof DraftCard>(
    localId: string,
    key: K,
    val: DraftCard[K]
  ) {
    setDrafts((prev) =>
      prev.map((d) => (d.localId === localId ? { ...d, [key]: val } : d))
    );
  }

  async function handleCommit() {
    const selected = drafts.filter((d) => d.selected);
    if (selected.length === 0) return;
    setPhase("committing");
    const payload: { drafts: QuickRecordCommitDraft[] } = {
      drafts: selected.map((d) => ({
        title: d.title,
        description: d.description,
        priority: d.priority,
        scheduledDates: d.scheduledDates,
        matchedTagIds: d.matchedTagIds,
        selectedNewTagNames: Array.from(d.selectedNewTagNames),
      })),
    };
    await emitQuickRecordCommit(payload);
    // 等 main 回 committed → useEffect 里会切到 done 态
  }

  function handleBack() {
    setPhase("input");
    setError(null);
    // 保留 text 让用户改写
  }

  async function handleGotoSettings() {
    await emitQuickRecordGotoSettings();
    if (!isTauri()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
  }

  const selectedCount = drafts.filter((d) => d.selected).length;

  return (
    <div className="h-screen w-screen bg-white flex flex-col overflow-hidden rounded-xl shadow-2xl border border-ink-200">
      <header
        className="px-4 py-3 border-b border-ink-100 flex items-center justify-between select-none"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2 text-ink-800 font-medium">
          <span>✨</span>
          {phase === "confirm" ? (
            <span>识别出 {drafts.length} 个任务</span>
          ) : (
            <span>快速录入</span>
          )}
        </div>
        {phase === "confirm" ? (
          <button
            onClick={handleBack}
            className="text-sm text-brand-600 hover:underline"
          >
            ‹ 返回重写
          </button>
        ) : (
          <span className="text-xs text-ink-400">Esc</span>
        )}
      </header>

      {phase === "done" ? (
        <div className="flex-1 flex items-center justify-center text-ink-700">
          ✓ 已录入 {committedCount} 个任务
        </div>
      ) : phase === "confirm" || phase === "committing" ? (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {drafts.map((d) => (
              <DraftCardRow
                key={d.localId}
                draft={d}
                tags={tags}
                onToggleSelect={() => toggleSelect(d.localId)}
                onRemove={() => removeCard(d.localId)}
                onToggleNewTag={(name) => toggleNewTag(d.localId, name)}
                onChange={(key, val) => updateField(d.localId, key, val)}
              />
            ))}
          </div>
          <footer className="px-4 py-3 border-t border-ink-100 flex items-center justify-end gap-2">
            <button
              disabled={selectedCount === 0 || phase === "committing"}
              onClick={handleCommit}
              className="px-4 py-1.5 rounded-md bg-brand-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-700"
            >
              {phase === "committing"
                ? "录入中…"
                : `录入 ${selectedCount} 个任务`}
            </button>
          </footer>
        </>
      ) : (
        <>
          <div className="flex-1 px-4 py-3">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void handleParse();
                }
              }}
              disabled={phase === "parsing"}
              placeholder="把想做的事随便写下来，明天下午做用户访谈、准备问题清单，紧急；周五前交季度报告初稿……"
              className="w-full h-full resize-none outline-none text-ink-800 placeholder-ink-400 bg-transparent disabled:opacity-50"
            />
          </div>
          {error && (
            <div className="px-4 pb-2 text-sm text-rose-600">
              {error === ERR_AI_NOT_CONFIGURED ? (
                <div className="flex items-center justify-between gap-2">
                  <span>未配置 AI Key，请先到「高级」页设置 Anthropic API Key。</span>
                  <button
                    onClick={handleGotoSettings}
                    className="shrink-0 px-2.5 py-1 rounded-md bg-brand-600 text-white text-xs hover:bg-brand-700"
                  >
                    去设置
                  </button>
                </div>
              ) : (
                error
              )}
            </div>
          )}
          <footer className="px-4 py-3 border-t border-ink-100 flex items-center justify-between">
            <span className="text-xs text-ink-400">
              ⌘↵ 解析{!tagsHydrated && " · 标签加载中"}
            </span>
            <button
              disabled={!text.trim() || phase === "parsing"}
              onClick={handleParse}
              className="px-4 py-1.5 rounded-md bg-brand-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-700"
            >
              {phase === "parsing" ? "解析中…" : "解析"}
            </button>
          </footer>
        </>
      )}
    </div>
  );
}

// ── 单卡片子组件 ──
//
// 拆出来主要为了让 title 的"Esc 还原"能用一个 ref 锁住进入编辑前的快照，
// 并把每个 picker 的本地状态（popover 打开等）局部化，避免父组件 re-render
// 把所有卡片的 popover 都关掉。

interface DraftCardRowProps {
  draft: DraftCard;
  tags: Tag[];
  onToggleSelect: () => void;
  onRemove: () => void;
  onToggleNewTag: (name: string) => void;
  onChange: <K extends keyof DraftCard>(key: K, val: DraftCard[K]) => void;
}

function DraftCardRow({
  draft: d,
  tags,
  onToggleSelect,
  onRemove,
  onToggleNewTag,
  onChange,
}: DraftCardRowProps) {
  // 本地 title：用户敲打时不触发父 setDrafts；blur/Enter 才提交
  const [titleLocal, setTitleLocal] = useState(d.title);
  // 进入编辑前的快照，用于 Esc 还原
  const titleSnapshot = useRef(d.title);
  // 当父级 d.title 因外部变化（极少）而更新时同步本地
  useEffect(() => {
    setTitleLocal(d.title);
    titleSnapshot.current = d.title;
  }, [d.title]);

  function commitTitle() {
    const next = titleLocal;
    if (next !== d.title) onChange("title", next);
  }

  return (
    <div
      className={cn(
        "border rounded-lg p-3",
        d.selected
          ? "border-brand-200 bg-brand-50/40"
          : "border-ink-100 bg-ink-50/40 opacity-60"
      )}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={d.selected}
          onChange={onToggleSelect}
          className="mt-1.5 shrink-0"
        />
        <div className="flex-1 min-w-0 space-y-2">
          {/* 标题：blur 提交，Enter 提交，Esc 还原 */}
          <input
            type="text"
            value={titleLocal}
            onChange={(e) => setTitleLocal(e.target.value)}
            onFocus={() => {
              titleSnapshot.current = d.title;
            }}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setTitleLocal(titleSnapshot.current);
                e.currentTarget.blur();
              }
            }}
            className="w-full bg-transparent font-medium text-ink-800 outline-none border border-transparent rounded px-1 -mx-1 focus:border-brand-300 focus:bg-white"
            placeholder="任务标题"
          />

          {/* 优先级 + 日期：横排，空间不够会自动换行 */}
          <div className="flex flex-wrap items-center gap-2">
            <PriorityPicker
              priority={d.priority}
              size="sm"
              onChange={(next) => onChange("priority", next)}
            />
            <DateRangePicker
              value={d.scheduledDates}
              onChange={(next) => onChange("scheduledDates", next)}
            />
          </div>

          {/* 已匹配标签：用 TagHierarchyPicker（multi）；独立 webview 必须传 tagsOverride */}
          {tags.length > 0 && (
            <div className="rounded-md border border-ink-200 bg-white/60 p-2">
              <TagHierarchyPicker
                mode="multi"
                value={d.matchedTagIds}
                onChange={(next) => onChange("matchedTagIds", next)}
                tagsOverride={tags}
              />
            </div>
          )}

          {/* 新建标签建议：保留独立的 opt-in 复选框（不进 TagHierarchyPicker，
              因为这些标签还不存在于 tag store；设计书要求用户主动 opt-in） */}
          {d.newTagNames.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-ink-400">新建：</span>
              {d.newTagNames.map((name) => (
                <label
                  key={name}
                  className="flex items-center gap-1 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={d.selectedNewTagNames.has(name)}
                    onChange={() => onToggleNewTag(name)}
                  />
                  <span className="text-amber-600">#{name}</span>
                </label>
              ))}
            </div>
          )}

          {/* 描述：折叠/展开切换；展开后是受控 textarea */}
          <DescriptionField
            value={d.description}
            expanded={d.descriptionExpanded}
            onToggle={() =>
              onChange("descriptionExpanded", !d.descriptionExpanded)
            }
            onChange={(next) => onChange("description", next)}
          />
        </div>
        <button
          onClick={onRemove}
          className="text-ink-400 hover:text-rose-500 shrink-0"
          title="移除此卡片"
          aria-label="移除此卡片"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── 描述折叠/展开 ──
//
// 折叠态：单行 line-clamp + 展开按钮（描述为空且未展开时不显示，留一个「+ 添加描述」入口）。
// 展开态：受控 textarea + 收起按钮。

interface DescriptionFieldProps {
  value: string;
  expanded: boolean;
  onToggle: () => void;
  onChange: (next: string) => void;
}

function DescriptionField({
  value,
  expanded,
  onToggle,
  onChange,
}: DescriptionFieldProps) {
  if (!expanded) {
    if (!value) {
      // 空描述折叠态：留一个轻量入口
      return (
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-0.5 text-[11px] text-ink-400 hover:text-ink-600"
        >
          <ChevronDown className="h-3 w-3" />
          添加描述
        </button>
      );
    }
    return (
      <div className="flex items-start gap-1">
        <p className="flex-1 text-sm text-ink-600 line-clamp-1">{value}</p>
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-ink-400 hover:text-ink-600"
          aria-label="展开描述"
        >
          <ChevronDown className="h-3 w-3" />
          展开
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="添加描述…"
        className="w-full resize-y rounded-md border border-ink-200 bg-white px-2 py-1.5 text-sm text-ink-700 outline-none focus:border-brand-300"
      />
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-0.5 text-[11px] text-ink-400 hover:text-ink-600"
        aria-label="收起描述"
      >
        <ChevronUp className="h-3 w-3" />
        收起
      </button>
    </div>
  );
}

