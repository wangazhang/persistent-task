import { useEffect, useState } from "react";
import { Columns2, Plus, Rows3, Search } from "lucide-react";
import { SearchModal } from "@/components/search/SearchModal";
import { TaskEditor } from "@/components/task/TaskEditor";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useListColumns } from "@/lib/listColumns";
import { TaskFilters } from "./TaskFilters";
import { useTaskUrlState, type ViewMode } from "./useTaskUrlState";
import { TodayView } from "./views/TodayView";
import { WeekView } from "./views/WeekView";
import { MonthView } from "./views/MonthView";
import { YearView } from "./views/YearView";

/**
 * 任务管理 (/tasks) 单页入口。
 *
 * 顶栏 4 个 tab 对应 4 种视图：今日 / 周 / 月 / 年。
 * 各 view 自己管"时间维度"（cursor / 选中日），TasksHub 只负责：
 *   1) 路由 + 过滤的 URL state（useTaskUrlState）
 *   2) tab 切换 + 编辑器 modal
 *   3) 各 view 共享的搜索/状态/标签过滤条（按 view 决定可见性）
 */

interface ViewTab {
  key: ViewMode;
  label: string;
}

const VIEW_TABS: ViewTab[] = [
  { key: "today", label: "今日" },
  { key: "week", label: "周" },
  { key: "month", label: "月" },
  { key: "year", label: "年" },
];

export function TasksHub() {
  const { view, date, status, tags, q, patch } = useTaskUrlState();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [editorDefaultDate, setEditorDefaultDate] = useState<string | undefined>(
    undefined
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [columns, setColumns] = useListColumns();

  function openCreate(defaultDate?: string) {
    setEditing(null);
    setEditorDefaultDate(defaultDate);
    setEditorOpen(true);
  }
  function openEdit(t: Task) {
    setEditing(t);
    setEditorDefaultDate(undefined);
    setEditorOpen(true);
  }

  // 全局快捷键：Cmd-K / Ctrl-K 打开搜索；Cmd-N / Ctrl-N 新建任务。
  // 监听到 input/textarea 内不触发，避免覆盖用户正常输入。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      // 在 input / textarea / contenteditable 里，仅允许 Cmd-K（搜索）抢占
      const isEditable =
        tag === "input" ||
        tag === "textarea" ||
        target?.isContentEditable === true;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      } else if (!isEditable && e.key.toLowerCase() === "n") {
        e.preventDefault();
        openCreate(date);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // 依赖 date：让快捷键创建任务时落在当前选中日
  }, [date]);

  // 过滤条可见性：
  // - today: 完全不显示（保留聚焦体感）
  // - today: 显示标签过滤（与周/月/年保持一致），其他子项继续隐藏，保留 today 极简的开盖即用
  // - week / month / year: 显示标签过滤（日历语义下标签过滤会让色阶 / 任务列同步过滤）
  //   状态 / 搜索目前留在这里不放进时间维度视图，因为日历的可视化语义跟它们不正交
  //   （TODO：后续考虑搜索框跨 view 共享，搜索结果以临时列表浮层呈现）
  const filterVisibility = { show: true, search: false, status: false, tags: true };

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-ink-800">任务</h1>
          <div className="inline-flex overflow-hidden rounded-lg border border-ink-200">
            {VIEW_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => patch({ view: tab.key })}
                className={cn(
                  "px-3 py-1.5 text-xs transition-colors",
                  view === tab.key
                    ? "bg-brand-600 text-white"
                    : "bg-white text-ink-600 hover:bg-ink-50"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 单栏 / 双栏切换：影响所有任务列表的 grid 列数，偏好持久化到 localStorage */}
          <div
            className="inline-flex overflow-hidden rounded-lg border border-ink-200"
            role="group"
            aria-label="列表显示密度"
          >
            <button
              type="button"
              onClick={() => setColumns(1)}
              className={cn(
                "px-2 py-1.5 text-xs transition-colors",
                columns === 1
                  ? "bg-brand-600 text-white"
                  : "bg-white text-ink-500 hover:bg-ink-50"
              )}
              title="单栏显示"
              aria-pressed={columns === 1}
            >
              <Rows3 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setColumns(2)}
              className={cn(
                "px-2 py-1.5 text-xs transition-colors",
                columns === 2
                  ? "bg-brand-600 text-white"
                  : "bg-white text-ink-500 hover:bg-ink-50"
              )}
              title="双栏显示"
              aria-pressed={columns === 2}
            >
              <Columns2 className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* 搜索：所有 view 都可见，全局 Cmd/Ctrl+K 也能触发 */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-500 transition-colors hover:border-ink-300 hover:text-ink-700"
            title="搜索任务（Cmd/Ctrl + K）"
            aria-label="搜索任务"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">搜索</span>
            <kbd className="hidden rounded border border-ink-200 bg-ink-50 px-1 text-[10px] text-ink-400 sm:inline">
              ⌘K
            </kbd>
          </button>
          {/* today view 已有专属快速添加；其他 view 才显示「新建任务」 */}
          {view !== "today" && (
            <button
              className="btn-primary"
              onClick={() => openCreate(date)}
            >
              <Plus className="h-4 w-4" />
              新建任务
            </button>
          )}
        </div>
      </header>

      {filterVisibility.show && (
        <TaskFilters
          status={status}
          onStatus={(s) => patch({ status: s })}
          tags={tags}
          onTags={(t) => patch({ tags: t })}
          q={q}
          onQ={(s) => patch({ q: s })}
          showSearch={filterVisibility.search}
          showStatus={filterVisibility.status}
          showTags={filterVisibility.tags}
        />
      )}

      {view === "today" && (
        <TodayView tags={tags} onEdit={openEdit} onCreate={() => openCreate()} />
      )}
      {view === "week" && (
        <WeekView
          date={date}
          tags={tags}
          onDateChange={(d) => patch({ date: d })}
          onEdit={openEdit}
          onNewTaskOnDate={(d) => openCreate(d)}
        />
      )}
      {view === "month" && (
        <MonthView
          date={date}
          tags={tags}
          onDateChange={(d) => patch({ date: d })}
          onEdit={openEdit}
          onNewTaskOnDate={(d) => openCreate(d)}
        />
      )}
      {view === "year" && (
        <YearView
          date={date}
          tags={tags}
          onDateChange={(d) => patch({ date: d })}
          onSwitchToMonth={(d) => patch({ view: "month", date: d })}
          onEdit={openEdit}
          onNewTaskOnDate={(d) => openCreate(d)}
        />
      )}

      <TaskEditor
        open={editorOpen}
        task={editing}
        defaultDate={editorDefaultDate}
        onClose={() => {
          setEditorOpen(false);
          setEditorDefaultDate(undefined);
        }}
      />

      {/* 全局搜索：右上角入口 / Cmd-K 触发 */}
      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenTask={(t) => openEdit(t)}
      />
    </div>
  );
}
