/**
 * AI 快速录入小窗（独立 webview）。
 *
 * 这一版是阶段 2 的最小可用骨架——只要打通"输入→解析→勾选→提交→成功提示"主路径
 * 即可验证桥接闭环；逐张卡片的丰富编辑（PriorityPicker / DatePicker / TagChip / 描述折叠）
 * 留给阶段 3。
 *
 * 设计取舍：
 * - 解析无副作用 → 直接 invoke parse_quick_input
 * - 入库经事件回 main → emit("quick-record:commit") + 等待 "quick-record:committed"
 * - 未配 Key → 提示文案 + 跳「高级」按钮（main 侧 listen 到此事件再做导航/对焦）
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTagStore } from "@/store/tagStore";
import { isoDate } from "@/lib/utils";
import {
  ERR_AI_NOT_CONFIGURED,
  parseQuickInput,
  type ParsedTaskDraft,
} from "@/lib/aiParse";
import {
  emitQuickRecordCommit,
  listenQuickRecordCommitted,
  type QuickRecordCommitDraft,
} from "@/lib/quickRecordBridge";
import { initAdapter, isTauri } from "@/lib/dataAdapter";

interface DraftCard extends ParsedTaskDraft {
  /** 临时本地 id，仅用于 React key + 用户勾选/删除时的定位 */
  localId: string;
  selected: boolean;
  /** 用户勾选要新建的标签名（默认全勾，取消则不建不挂） */
  selectedNewTagNames: Set<string>;
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
  const tagById = useMemo(
    () => new Map(tags.map((t) => [t.id, t.name])),
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
              <div
                key={d.localId}
                className={`border rounded-lg p-3 ${
                  d.selected
                    ? "border-brand-200 bg-brand-50/40"
                    : "border-ink-100 bg-ink-50/40 opacity-60"
                }`}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={d.selected}
                    onChange={() => toggleSelect(d.localId)}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-ink-800 truncate">
                        {d.title}
                      </span>
                      <span className="text-xs text-ink-500 uppercase">
                        {d.priority}
                      </span>
                    </div>
                    {d.description && (
                      <p className="text-sm text-ink-600 mt-1 line-clamp-2">
                        {d.description}
                      </p>
                    )}
                    <div className="text-xs text-ink-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {d.scheduledDates.length > 0 && (
                        <span>📅 {d.scheduledDates.join(", ")}</span>
                      )}
                      {d.matchedTagIds.map((id) => (
                        <span key={id} className="text-brand-600">
                          #{tagById.get(id) ?? id}
                        </span>
                      ))}
                      {d.newTagNames.map((name) => (
                        <label key={name} className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={d.selectedNewTagNames.has(name)}
                            onChange={() => toggleNewTag(d.localId, name)}
                          />
                          <span className="text-amber-600">#{name}（新建）</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => removeCard(d.localId)}
                    className="text-ink-400 hover:text-rose-500 text-sm"
                    title="移除此卡片"
                  >
                    🗑
                  </button>
                </div>
              </div>
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
              {error === ERR_AI_NOT_CONFIGURED
                ? "未配置 AI Key，请先到「高级」页设置 Anthropic API Key。"
                : error}
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
