/**
 * AI 快速录入小窗（独立 webview）—— Spotlight / Raycast 风格。
 *
 * 设计：
 * - 毛玻璃半透明面板 + 深色边框 + 大圆角，强对比明确层级
 * - 输入态：超大输入框，标题区像聚焦的搜索框
 * - 确认态：卡片淡入，键盘流贯穿（Tab/↑↓ 切焦点、空格切勾选、
 *   Cmd+Backspace 删卡片、Cmd+Enter 提交）
 * - 完成态：成功动画 + 自动关窗
 *
 * 键盘契约：
 * - Esc          退出
 * - Cmd/Ctrl+↩  解析（输入态）/ 提交（确认态）
 * - Cmd/Ctrl+,   去设置（错误态）
 *
 * 数据流：
 * - 解析无副作用 → 直接 invoke parse_quick_input
 * - 入库经事件回 main → emit("quick-record:commit") + 等待 "quick-record:committed"
 * - 未配 Key → "去设置"按钮 → emit("quick-record:goto-settings") → main navigate
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronUp,
  Sparkles,
  Trash2,
  Check,
  Loader2,
  ArrowLeft,
  CornerDownLeft,
} from "lucide-react";
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
    if (phase === "input") {
      textareaRef.current?.focus();
    }
  }, [phase]);

  const closeWindow = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().hide();
    } catch (err) {
      console.error("[quick-record] hide window failed", err);
    }
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
        await closeWindow();
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
  }, [closeWindow]);

  const tagLite = useMemo(
    () => tags.map((t) => ({ id: t.id, name: t.name })),
    [tags]
  );

  const handleParse = useCallback(async () => {
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
  }, [text, phase, tagLite]);

  const handleCommit = useCallback(async () => {
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
  }, [drafts]);

  const handleGotoSettings = useCallback(async () => {
    await emitQuickRecordGotoSettings();
    await closeWindow();
  }, [closeWindow]);

  // 全局键盘契约
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc：随时关窗
      if (e.key === "Escape") {
        e.preventDefault();
        void closeWindow();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      // Cmd+,：错误态时去设置
      if (mod && e.key === "," && error === ERR_AI_NOT_CONFIGURED) {
        e.preventDefault();
        void handleGotoSettings();
        return;
      }
      // Cmd+Enter：解析（输入态）/ 提交（确认态）
      if (mod && e.key === "Enter") {
        e.preventDefault();
        if (phase === "input") {
          void handleParse();
        } else if (phase === "confirm") {
          void handleCommit();
        }
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeWindow, error, handleGotoSettings, handleParse, handleCommit, phase]);

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

  function handleBack() {
    setPhase("input");
    setError(null);
    // 保留 text 让用户改写
  }

  const selectedCount = drafts.filter((d) => d.selected).length;
  const totalCount = drafts.length;

  return (
    <div className="h-screen w-screen p-0 flex items-stretch justify-stretch bg-transparent">
      <div className="qr-window-enter h-full w-full flex flex-col overflow-hidden rounded-2xl border border-white/40 bg-white/95 backdrop-blur-2xl shadow-[0_24px_60px_-12px_rgba(15,23,42,0.45),0_8px_24px_-8px_rgba(15,23,42,0.25)]">
        {/* 头部：拖拽区 + 状态指示 */}
        <header
          className="flex items-center justify-between px-5 pt-4 pb-3 select-none"
          data-tauri-drag-region
        >
          <div className="flex items-center gap-2.5 pointer-events-none">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 shadow-sm">
              <Sparkles className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-[13px] font-semibold text-ink-800">
                {phase === "confirm" || phase === "committing"
                  ? `识别出 ${totalCount} 个任务`
                  : phase === "done"
                  ? "录入成功"
                  : "AI 快速录入"}
              </span>
              <span className="text-[11px] text-ink-400">
                {phase === "confirm"
                  ? "勾选并编辑后录入"
                  : phase === "parsing"
                  ? "正在解析…"
                  : phase === "committing"
                  ? "正在录入…"
                  : phase === "done"
                  ? `已录入 ${committedCount} 个任务`
                  : "把想法写下来，AI 会帮你拆成任务"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 pointer-events-auto">
            {phase === "confirm" && (
              <button
                onClick={handleBack}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-500 hover:bg-ink-100 hover:text-ink-700 transition-colors"
                title="返回重写（保留原文）"
              >
                <ArrowLeft className="h-3 w-3" />
                重写
              </button>
            )}
            <Kbd>esc</Kbd>
          </div>
        </header>

        {/* 主体 */}
        {phase === "done" ? (
          <DonePane count={committedCount} />
        ) : phase === "confirm" || phase === "committing" ? (
          <>
            <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-2">
              {drafts.map((d, idx) => (
                <DraftCardRow
                  key={d.localId}
                  draft={d}
                  index={idx}
                  tags={tags}
                  onToggleSelect={() => toggleSelect(d.localId)}
                  onRemove={() => removeCard(d.localId)}
                  onToggleNewTag={(name) => toggleNewTag(d.localId, name)}
                  onChange={(key, val) => updateField(d.localId, key, val)}
                />
              ))}
            </div>
            <ConfirmFooter
              selectedCount={selectedCount}
              totalCount={totalCount}
              committing={phase === "committing"}
              onCommit={handleCommit}
            />
          </>
        ) : (
          <>
            <div className="flex-1 px-5 py-1 flex flex-col">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={phase === "parsing"}
                placeholder="比如：明天下午做用户访谈、准备问题清单，紧急；周五前交季度报告初稿……"
                className="flex-1 w-full resize-none bg-transparent text-[15px] leading-relaxed text-ink-800 placeholder:text-ink-300 outline-none disabled:opacity-60"
              />
            </div>
            {error && <ErrorRow error={error} onGotoSettings={handleGotoSettings} />}
            <InputFooter
              parsing={phase === "parsing"}
              tagsHydrated={tagsHydrated}
              canParse={!!text.trim()}
              onParse={handleParse}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 子组件
// ──────────────────────────────────────────────────────────────

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center rounded-md border border-ink-200/80 bg-ink-50/70 px-1.5 py-0.5 text-[10px] font-medium text-ink-500 shadow-[inset_0_-1px_0_rgba(15,23,42,0.04)] min-w-[18px]">
      {children}
    </kbd>
  );
}

function DonePane({ count }: { count: number }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 pb-8">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-success-500 to-success-600 shadow-lg shadow-success-500/30">
        <Check className="h-7 w-7 text-white" strokeWidth={3} />
      </div>
      <div className="text-center">
        <div className="text-base font-semibold text-ink-800">已录入 {count} 个任务</div>
        <div className="text-xs text-ink-400 mt-0.5">即将关闭…</div>
      </div>
    </div>
  );
}

function ErrorRow({
  error,
  onGotoSettings,
}: {
  error: string;
  onGotoSettings: () => void;
}) {
  if (error === ERR_AI_NOT_CONFIGURED) {
    return (
      <div className="mx-5 mb-2 flex items-center justify-between gap-3 rounded-lg border border-rose-200/70 bg-rose-50/60 px-3 py-2">
        <span className="text-[12.5px] text-rose-700">
          未配置 AI Key，去「高级」页设置后再来
        </span>
        <button
          onClick={onGotoSettings}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-700 transition-colors"
        >
          去设置
          <Kbd>⌘ ,</Kbd>
        </button>
      </div>
    );
  }
  return (
    <div className="mx-5 mb-2 rounded-lg border border-rose-200/70 bg-rose-50/60 px-3 py-2 text-[12.5px] text-rose-700">
      {error}
    </div>
  );
}

function InputFooter({
  parsing,
  tagsHydrated,
  canParse,
  onParse,
}: {
  parsing: boolean;
  tagsHydrated: boolean;
  canParse: boolean;
  onParse: () => void;
}) {
  return (
    <footer className="flex items-center justify-between px-5 pb-4 pt-3 border-t border-ink-100/80">
      <span className="text-[11px] text-ink-400 inline-flex items-center gap-1.5">
        {!tagsHydrated && (
          <span className="qr-pulse">标签加载中…</span>
        )}
        {tagsHydrated && (
          <>
            按 <Kbd>⌘</Kbd> <Kbd>↩</Kbd> 解析
          </>
        )}
      </span>
      <button
        disabled={!canParse || parsing}
        onClick={onParse}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium text-white transition-all",
          "bg-gradient-to-b from-brand-500 to-brand-600 shadow-sm shadow-brand-600/20",
          "hover:from-brand-500 hover:to-brand-700 hover:shadow-md hover:shadow-brand-600/30",
          "active:scale-[0.98]",
          "disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
        )}
      >
        {parsing ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            解析中
          </>
        ) : (
          <>
            <Sparkles className="h-3.5 w-3.5" />
            解析
          </>
        )}
      </button>
    </footer>
  );
}

function ConfirmFooter({
  selectedCount,
  totalCount,
  committing,
  onCommit,
}: {
  selectedCount: number;
  totalCount: number;
  committing: boolean;
  onCommit: () => void;
}) {
  return (
    <footer className="flex items-center justify-between px-5 pb-4 pt-3 border-t border-ink-100/80">
      <span className="text-[11px] text-ink-400">
        已勾选 {selectedCount} / {totalCount}
      </span>
      <button
        disabled={selectedCount === 0 || committing}
        onClick={onCommit}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium text-white transition-all",
          "bg-gradient-to-b from-brand-500 to-brand-600 shadow-sm shadow-brand-600/20",
          "hover:from-brand-500 hover:to-brand-700 hover:shadow-md hover:shadow-brand-600/30",
          "active:scale-[0.98]",
          "disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
        )}
      >
        {committing ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            录入中
          </>
        ) : (
          <>
            录入 {selectedCount > 0 ? selectedCount : ""} 个任务
            <Kbd>⌘</Kbd>
            <CornerDownLeft className="h-3 w-3 text-ink-300" />
          </>
        )}
      </button>
    </footer>
  );
}

interface DraftCardRowProps {
  draft: DraftCard;
  index: number;
  tags: Tag[];
  onToggleSelect: () => void;
  onRemove: () => void;
  onToggleNewTag: (name: string) => void;
  onChange: <K extends keyof DraftCard>(key: K, val: DraftCard[K]) => void;
}

function DraftCardRow({
  draft: d,
  index,
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
    if (titleLocal !== d.title) onChange("title", titleLocal);
  }

  return (
    <div
      className={cn(
        "qr-card-enter group relative rounded-xl border bg-white px-3 py-2.5 transition-all",
        d.selected
          ? "border-ink-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_2px_8px_-2px_rgba(15,23,42,0.06)]"
          : "border-ink-200/50 bg-ink-50/50 opacity-55"
      )}
      style={{ animationDelay: `${Math.min(index * 40, 240)}ms` }}
    >
      <div className="flex items-start gap-2.5">
        {/* 勾选 —— 自定义样式，跟原生 checkbox 不同 */}
        <button
          type="button"
          onClick={onToggleSelect}
          className={cn(
            "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-md border transition-all",
            d.selected
              ? "border-brand-600 bg-brand-600 shadow-sm shadow-brand-600/30"
              : "border-ink-300 bg-white hover:border-ink-400"
          )}
          aria-label={d.selected ? "取消勾选" : "勾选"}
        >
          {d.selected && <Check className="h-2.5 w-2.5 text-white" strokeWidth={4} />}
        </button>

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
                e.stopPropagation();
                setTitleLocal(titleSnapshot.current);
                e.currentTarget.blur();
              }
            }}
            className={cn(
              "w-full bg-transparent text-[14px] font-medium text-ink-800 outline-none",
              "rounded-md border border-transparent px-1.5 -mx-1.5 py-0.5",
              "focus:border-brand-300 focus:bg-brand-50/30",
              "placeholder:text-ink-300"
            )}
            placeholder="任务标题"
          />

          {/* 优先级 + 日期：横排，空间不够会自动换行 */}
          <div className="flex flex-wrap items-center gap-1.5">
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

          {/* 已匹配标签 */}
          {tags.length > 0 && (
            <TagHierarchyPicker
              mode="multi"
              value={d.matchedTagIds}
              onChange={(next) => onChange("matchedTagIds", next)}
              tagsOverride={tags}
            />
          )}

          {/* 新建标签建议（amber 的 opt-in 复选框） */}
          {d.newTagNames.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10.5px] font-medium uppercase tracking-wider text-ink-400">
                建议新建
              </span>
              {d.newTagNames.map((name) => {
                const checked = d.selectedNewTagNames.has(name);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => onToggleNewTag(name)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] transition-all",
                      checked
                        ? "border-amber-300 bg-amber-50 text-amber-700"
                        : "border-ink-200 bg-white text-ink-400 line-through opacity-60 hover:opacity-100"
                    )}
                  >
                    <span>#{name}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* 描述：折叠/展开 */}
          <DescriptionField
            value={d.description}
            expanded={d.descriptionExpanded}
            onToggle={() =>
              onChange("descriptionExpanded", !d.descriptionExpanded)
            }
            onChange={(next) => onChange("description", next)}
          />
        </div>

        {/* 删除按钮：hover 显示 */}
        <button
          onClick={onRemove}
          className="shrink-0 mt-0.5 flex h-6 w-6 items-center justify-center rounded-md text-ink-300 opacity-0 transition-all hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100"
          title="移除此卡片"
          aria-label="移除此卡片"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────

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
      return (
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-0.5 text-[11px] text-ink-400 hover:text-ink-600 transition-colors"
        >
          <ChevronDown className="h-3 w-3" />
          添加描述
        </button>
      );
    }
    return (
      <div className="flex items-start gap-1">
        <p className="flex-1 text-[12.5px] text-ink-500 line-clamp-1">{value}</p>
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-ink-400 hover:text-ink-600 transition-colors"
          aria-label="展开描述"
        >
          <ChevronDown className="h-3 w-3" />
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
        placeholder="补充描述…"
        className="w-full resize-y rounded-md border border-ink-200 bg-white px-2 py-1.5 text-[12.5px] text-ink-700 outline-none focus:border-brand-300"
      />
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-0.5 text-[11px] text-ink-400 hover:text-ink-600 transition-colors"
        aria-label="收起描述"
      >
        <ChevronUp className="h-3 w-3" />
        收起
      </button>
    </div>
  );
}
