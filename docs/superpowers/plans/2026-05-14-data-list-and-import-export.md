# 数据列表查看与导入导出 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「持续任务」中新增 `/data` 页（统一查看任务/标签/番茄三类数据的只读表格），以及基于原生 SQLite 文件的全量导入导出能力。

**Architecture:** Web 端（sql.js + IndexedDB）单页 Tab 表格 + 顶栏导入/导出按钮；导入走「文件 → 校验 → 双重确认 → 覆盖 IndexedDB → reload」流程；导出走 `db.export()` → Blob → 下载。`pomodoros` 已在 `taskStore` 中，不动 store。

**Tech Stack:** React 18 / TypeScript / Vite / Tailwind / Zustand / react-router-dom / sql.js / lucide-react。无新增依赖。

**项目根目录:** `/Users/qianzhang/Documents/03_work/06_yehu/02_project/123_persistent-task/src/persistent-task-export-and-import`（下文所有路径均相对此根目录）

**测试策略:** 本项目无现成单元测试基建（无 vitest/jest）。本计划全部用「跑 dev server + 浏览器手动验证」做检查，每个任务末尾都给出明确的浏览器验证步骤。不要为此项目引入测试框架（YAGNI）。

---

## Task 1：sqliteDb.ts 暴露 export/replace 两个底层函数

**Files:**
- Modify: `src/lib/webDb/sqliteDb.ts`

- [ ] **Step 1: 在 sqliteDb.ts 末尾追加两个导出函数**

打开 `src/lib/webDb/sqliteDb.ts`，在文件末尾（`resetDb` 之后）追加：

```ts
/* ────────────────────────────────────────────────────────────
 * 备份 / 还原（供 dbBackup.ts 使用）
 * ──────────────────────────────────────────────────────────── */

/** 导出当前 db 的完整字节（SQLite 文件格式）*/
export function exportSqliteBytes(): Uint8Array {
  return getDb().export();
}

/**
 * 用传入字节替换当前 db。
 *
 * 流程：
 *   1. 关闭当前内存中的 db 实例
 *   2. 把字节写回 IndexedDB
 *
 * 调用方负责在替换完成后 location.reload()，让 main.tsx
 * 重新走 initWebDb() 从 IndexedDB 加载新库。
 */
export async function replaceSqliteBytes(bytes: Uint8Array): Promise<void> {
  if (db) {
    db.close();
    db = null;
  }
  await idbPut(bytes);
}
```

- [ ] **Step 2: TypeScript 类型检查**

Run: `npx tsc -b`
Expected: 无新增报错（如果之前就有遗留报错，不应该有新增）。如果失败请截取报错并修复。

- [ ] **Step 3: 启动 dev server 确认无加载错误**

Run: `npm run dev`
Expected: vite 启动成功，浏览器打开 `http://localhost:5173`，控制台无新增报错，原有 `/tasks` 页面仍正常。

- [ ] **Step 4: 提交**

```bash
git add src/lib/webDb/sqliteDb.ts
git commit -m "feat(webDb): expose exportSqliteBytes / replaceSqliteBytes"
```

---

## Task 2：dbBackup.ts 实现导出 + 校验 + 覆盖导入流程

**Files:**
- Create: `src/lib/dbBackup.ts`

- [ ] **Step 1: 新建 src/lib/dbBackup.ts**

```ts
/**
 * 整库导入导出（Web 端）。
 *
 * 导出：sqliteDb.export() → 下载 .sqlite 文件
 * 导入：选文件 → 校验 → 双重确认 → 覆盖 IndexedDB → reload
 *
 * 校验三段：
 *   1) 文件头 16 字节 = "SQLite format 3\0"
 *   2) sql.js 能成功打开
 *   3) 含 tasks / tags / pomodoros 三张表
 */

import initSqlJs from "sql.js/dist/sql-wasm.js";
import type { SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import {
  exportSqliteBytes,
  replaceSqliteBytes,
} from "./webDb/sqliteDb";
import { alert, confirm } from "@/store/dialogStore";

const SQLITE_MAGIC = "SQLite format 3\0";
const REQUIRED_TABLES = ["tasks", "tags", "pomodoros"] as const;
const MAX_BYTES = 200 * 1024 * 1024; // 200MB

let SQL: SqlJsStatic | null = null;
async function getSql(): Promise<SqlJsStatic> {
  if (!SQL) SQL = await initSqlJs({ locateFile: () => wasmUrl });
  return SQL;
}

function formatTs(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}`
  );
}

/** 触发浏览器下载，文件名带时间戳，避免覆盖 */
export function exportDbToFile(): void {
  const bytes = exportSqliteBytes();
  const blob = new Blob([bytes], { type: "application/x-sqlite3" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `persistent-task-${formatTs(new Date())}.sqlite`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 字节流是否为合法的 SQLite 文件（仅校验文件头）*/
function hasSqliteMagic(bytes: Uint8Array): boolean {
  if (bytes.length < SQLITE_MAGIC.length) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) {
    if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

interface ValidateResult {
  ok: boolean;
  reason?: string;
}

/** 真打开一次确认结构正确（用完即关，不污染主 db 实例）*/
async function validateBytes(bytes: Uint8Array): Promise<ValidateResult> {
  if (!hasSqliteMagic(bytes)) {
    return { ok: false, reason: "文件不是 SQLite 格式" };
  }
  let tmp: ReturnType<SqlJsStatic["Database"]["prototype"]["close"]> extends void
    ? InstanceType<SqlJsStatic["Database"]>
    : InstanceType<SqlJsStatic["Database"]>;
  try {
    const SqlMod = await getSql();
    tmp = new SqlMod.Database(bytes);
  } catch {
    return { ok: false, reason: "无法打开为 SQLite 数据库" };
  }
  try {
    const stmt = tmp.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    );
    const found = new Set<string>();
    while (stmt.step()) {
      const row = stmt.getAsObject() as { name?: string };
      if (row.name) found.add(row.name);
    }
    stmt.free();
    for (const t of REQUIRED_TABLES) {
      if (!found.has(t)) {
        return { ok: false, reason: `缺少必需的表：${t}` };
      }
    }
    return { ok: true };
  } finally {
    tmp.close();
  }
}

export interface ImportCounts {
  tasks: number;
  tags: number;
  pomodoros: number;
}

/**
 * 走完整导入流程：
 *   1. 大小 / 头 / 结构校验
 *   2. 双重确认（带当前数据计数）
 *   3. 写回 IndexedDB
 *   4. location.reload()
 *
 * 任何用户取消 / 校验失败都会以「不刷新」结束，原数据保持不变。
 *
 * @param currentCounts 当前内存中的三类计数，用于二次确认提示
 */
export async function importDbFromFile(
  file: File,
  currentCounts: ImportCounts
): Promise<void> {
  if (file.size > MAX_BYTES) {
    await alert({
      title: "导入失败",
      message: `备份文件过大（${(file.size / 1024 / 1024).toFixed(
        1
      )}MB），上限 200MB。`,
    });
    return;
  }

  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  const validation = await validateBytes(bytes);
  if (!validation.ok) {
    await alert({
      title: "导入失败",
      message: `文件不是合法的持续任务备份：${validation.reason}`,
    });
    return;
  }

  const ok = await confirm({
    title: "覆盖导入",
    message:
      `导入会用文件中的数据完全替换当前所有任务、标签、番茄记录，且不可撤销。\n\n` +
      `当前数据：${currentCounts.tasks} 个任务 / ` +
      `${currentCounts.tags} 个标签 / ` +
      `${currentCounts.pomodoros} 条番茄。\n\n确认继续？`,
    confirmText: "覆盖导入",
    cancelText: "取消",
    danger: true,
  });
  if (!ok) return;

  await replaceSqliteBytes(bytes);
  location.reload();
}
```

- [ ] **Step 2: TypeScript 编译检查**

Run: `npx tsc -b`
Expected: 通过。

> 注意：`ValidateResult` 函数里 `tmp` 的类型注解使用了条件类型获取 sql.js 的 Database 实例类型；如果 tsc 抱怨这段拗口的写法，简化为
> ```ts
> let tmp: import("sql.js").Database;
> ```

- [ ] **Step 3: 浏览器手动验证（仅文件存在）**

Run: `npm run dev`
- 打开 `http://localhost:5173`，控制台不应有报错。
- 这一步只是确认新文件被 vite 正确加载，**功能验证在后续任务接入 UI 后做**。

- [ ] **Step 4: 提交**

```bash
git add src/lib/dbBackup.ts
git commit -m "feat(backup): exportDbToFile and importDbFromFile with validation"
```

---

## Task 3：搭出 DataPage 路由骨架 + Sidebar 入口

**Files:**
- Create: `src/routes/data/DataPage.tsx`
- Create: `src/routes/data/useDataUrlState.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: 新建 useDataUrlState.ts**

```ts
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

export type DataTab = "tasks" | "tags" | "pomodoros";

const VALID: DataTab[] = ["tasks", "tags", "pomodoros"];

export function useDataUrlState(): {
  tab: DataTab;
  setTab: (t: DataTab) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("tab");
  const tab: DataTab =
    raw && (VALID as string[]).includes(raw) ? (raw as DataTab) : "tasks";

  const setTab = useCallback(
    (t: DataTab) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (t === "tasks") params.delete("tab");
          else params.set("tab", t);
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  return { tab, setTab };
}
```

- [ ] **Step 2: 新建 DataPage.tsx 骨架（不带表格，仅 tab 区）**

```tsx
import { useTaskStore } from "@/store/taskStore";
import { useTagStore } from "@/store/tagStore";
import { cn } from "@/lib/utils";
import { useDataUrlState, type DataTab } from "./useDataUrlState";

interface TabDef {
  key: DataTab;
  label: string;
  count: number;
}

export function DataPage() {
  const tasks = useTaskStore((s) => s.tasks);
  const pomodoros = useTaskStore((s) => s.pomodoros);
  const tags = useTagStore((s) => s.tags);
  const { tab, setTab } = useDataUrlState();

  const tabs: TabDef[] = [
    { key: "tasks", label: "任务", count: tasks.length },
    { key: "tags", label: "标签", count: tags.length },
    { key: "pomodoros", label: "番茄", count: pomodoros.length },
  ];

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-ink-800">数据</h1>
        {/* 导入/导出按钮区在 Task 5 接入，这里先留空占位 */}
        <div className="flex items-center gap-2" />
      </header>

      <div className="mb-4 inline-flex overflow-hidden rounded-lg border border-ink-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "px-3 py-1.5 text-xs transition-colors",
              tab === t.key
                ? "bg-brand-600 text-white"
                : "bg-white text-ink-600 hover:bg-ink-50"
            )}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {/* 表格区在后续任务填入 */}
      <div className="rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-400">
        {tab === "tasks" && "任务表格 · 待 Task 4 实现"}
        {tab === "tags" && "标签表格 · 待 Task 6 实现"}
        {tab === "pomodoros" && "番茄表格 · 待 Task 7 实现"}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 在 App.tsx 注册 /data 路由**

打开 `src/App.tsx`，在顶部 import 处加入：

```tsx
import { DataPage } from "@/routes/data/DataPage";
```

在 `<Route path="stats" element={<Stats />} />` 之后插入：

```tsx
<Route path="data" element={<DataPage />} />
```

完整的 Routes 块应该长这样（仅展示新增行的上下文）：

```tsx
<Route path="tasks" element={<TasksHub />} />
<Route path="tags" element={<TagsPage />} />
<Route path="pomodoro" element={<Pomodoro />} />
<Route path="stats" element={<Stats />} />
<Route path="data" element={<DataPage />} />
<Route
  path="*"
  element={<Navigate to="/tasks?view=today" replace />}
/>
```

- [ ] **Step 4: 在 Sidebar.tsx 加导航项**

打开 `src/components/layout/Sidebar.tsx`，在 `import` 区把 `Database` 加入：

```tsx
import {
  BarChart3,
  Database,
  ListTodo,
  Tags,
  Timer,
  Trash2,
} from "lucide-react";
```

把 `NAV_ITEMS` 改为：

```tsx
const NAV_ITEMS = [
  { to: "/tasks?view=today", path: "/tasks", label: "任务", icon: ListTodo },
  { to: "/tags", path: "/tags", label: "标签管理", icon: Tags },
  { to: "/pomodoro", path: "/pomodoro", label: "番茄时钟", icon: Timer },
  { to: "/stats", path: "/stats", label: "统计面板", icon: BarChart3 },
  { to: "/data", path: "/data", label: "数据", icon: Database },
];
```

- [ ] **Step 5: 浏览器手动验证**

Run: `npm run dev`（若已运行则跳过）
- 打开 `http://localhost:5173`，左侧侧边栏底部出现「数据」入口（Database 图标）。
- 点击「数据」→ URL 变为 `/data`，主区显示标题「数据」+ 三个 tab（任务 N / 标签 M / 番茄 K），N/M/K 与现有 /tasks、/tags、/stats 显示的总数一致。
- 点击不同 tab：URL 切换为 `/data?tab=tags` / `/data?tab=pomodoros`，默认 tasks 时无 `?tab=` 参数。
- 刷新页面，tab 选中态保留。
- 控制台无报错。

- [ ] **Step 6: 提交**

```bash
git add src/App.tsx src/components/layout/Sidebar.tsx src/routes/data/
git commit -m "feat(data): scaffold /data route with tabs and sidebar entry"
```

---

## Task 4：通用 DataTable 组件 + 任务表

**Files:**
- Create: `src/routes/data/DataTable.tsx`
- Create: `src/routes/data/tables/TasksTable.tsx`
- Modify: `src/routes/data/DataPage.tsx`

> 重要：任务行点击需要打开现有的 `TaskEditor`。`TaskEditor` 在 `src/components/task/TaskEditor.tsx`，受控属性是 `open / task / onClose`（参考 `TasksHub` 使用方式）。本任务把 editor 状态放在 `DataPage` 层（与 TasksHub 一致），通过 prop 传给 `TasksTable`。

- [ ] **Step 1: 新建 DataTable.tsx**

```tsx
import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  label: string;
  /** 单元格渲染。默认返回 row[key] 的字符串 */
  render?: (row: T) => ReactNode;
  /** 排序值。返回 string / number；不提供则该列不可排序 */
  sortValue?: (row: T) => string | number;
  /** 列宽 / 截断等额外 className */
  className?: string;
  /** 列头 className（默认与单元格相同）*/
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  /** 每个函数返回一段参与搜索的文本，全部 lower-case includes 匹配 */
  searchKeys: ((row: T) => string)[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** 默认排序：列 key + 方向；未提供则按原顺序 */
  defaultSort?: { key: string; dir: "asc" | "desc" };
  /** 搜索框 placeholder */
  searchPlaceholder?: string;
}

const PAGE_SIZE = 50;

export function DataTable<T>(props: DataTableProps<T>) {
  const {
    columns,
    rows,
    searchKeys,
    getRowId,
    onRowClick,
    defaultSort,
    searchPlaceholder = "搜索…",
  } = props;

  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<string | null>(
    defaultSort?.key ?? null
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">(
    defaultSort?.dir ?? "desc"
  );

  // 切换列：未选 → desc → asc → 回默认
  function toggleSort(col: Column<T>) {
    if (!col.sortValue) return;
    if (sortKey !== col.key) {
      setSortKey(col.key);
      setSortDir("desc");
      return;
    }
    if (sortDir === "desc") {
      setSortDir("asc");
      return;
    }
    // 已经 asc → 回到 defaultSort（如果有）或清空
    if (defaultSort) {
      setSortKey(defaultSort.key);
      setSortDir(defaultSort.dir);
    } else {
      setSortKey(null);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      searchKeys.some((fn) => fn(r).toLowerCase().includes(q))
    );
  }, [rows, searchKeys, query]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    if (!col || !col.sortValue) return filtered;
    const dirSign = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va < vb) return -1 * dirSign;
      if (va > vb) return 1 * dirSign;
      return 0;
    });
  }, [filtered, columns, sortKey, sortDir]);

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount);
  const pageRows = sorted.slice(
    (clampedPage - 1) * PAGE_SIZE,
    clampedPage * PAGE_SIZE
  );

  // 搜索变化时回第 1 页
  function handleQueryChange(v: string) {
    setQuery(v);
    setPage(1);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-ink-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3">
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-64 max-w-full rounded border border-ink-200 px-3 py-1.5 text-xs text-ink-700 focus:border-brand-500 focus:outline-none"
        />
        <span className="text-xs text-ink-400">共 {total} 条</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-ink-50 text-ink-500">
            <tr>
              {columns.map((c) => {
                const sortable = !!c.sortValue;
                const active = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-left font-medium",
                      sortable && "cursor-pointer select-none hover:text-ink-700",
                      c.headerClassName ?? c.className
                    )}
                    onClick={() => sortable && toggleSort(c)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {sortable && active && (
                        sortDir === "asc" ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-ink-400"
                >
                  暂无数据
                </td>
              </tr>
            )}
            {pageRows.map((row) => (
              <tr
                key={getRowId(row)}
                className={cn(
                  "border-t border-ink-100 transition-colors hover:bg-ink-50",
                  onRowClick && "cursor-pointer"
                )}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-ink-700",
                      c.className
                    )}
                  >
                    {c.render ? c.render(row) : String((row as any)[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-3 border-t border-ink-200 px-4 py-2 text-xs text-ink-500">
          <button
            type="button"
            disabled={clampedPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded border border-ink-200 px-2 py-1 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            上一页
          </button>
          <span>
            {clampedPage} / {pageCount}
          </span>
          <button
            type="button"
            disabled={clampedPage >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            className="rounded border border-ink-200 px-2 py-1 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 新建 TasksTable.tsx**

```tsx
import { ExternalLink } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useTaskStore } from "@/store/taskStore";
import { useTagStore } from "@/store/tagStore";
import type { Task, TaskPriority } from "@/lib/types";
import { DataTable, type Column } from "../DataTable";

const PRIORITY_META: Record<TaskPriority, { label: string; cls: string }> = {
  p0: { label: "P0 紧急", cls: "text-red-600" },
  p1: { label: "P1 重要", cls: "text-warning-600" },
  p2: { label: "P2 一般", cls: "text-ink-500" },
};

function fmtDateTime(iso: string): string {
  // iso 形如 2026-05-14T10:30:00.000Z；按本地时间渲染
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function fmtDates(dates: string[]): string {
  if (dates.length === 0) return "—";
  if (dates.length <= 3) return dates.join(", ");
  return `${dates.slice(0, 3).join(", ")}…`;
}

export function TasksTable({ onOpenTask }: { onOpenTask: (t: Task) => void }) {
  const tasks = useTaskStore((s) => s.tasks);
  const tagMap = useTagStore((s) => s.byId());

  function tagsText(t: Task): string {
    if (t.tagIds.length === 0) return "—";
    return t.tagIds
      .map((id) => tagMap.get(id)?.name ?? id)
      .join(", ");
  }

  const columns: Column<Task>[] = [
    {
      key: "title",
      label: "标题",
      sortValue: (t) => t.title.toLowerCase(),
      render: (t) => (
        <span className="block max-w-[260px] truncate text-ink-800" title={t.title}>
          {t.title}
        </span>
      ),
      className: "min-w-0",
    },
    {
      key: "status",
      label: "状态",
      sortValue: (t) => t.status,
      render: (t) => <StatusBadge status={t.status} />,
    },
    {
      key: "priority",
      label: "优先级",
      sortValue: (t) => t.priority ?? "p2",
      render: (t) => {
        const m = PRIORITY_META[t.priority ?? "p2"];
        return <span className={m.cls}>{m.label}</span>;
      },
    },
    {
      key: "scheduledDates",
      label: "排期",
      render: (t) => fmtDates(t.scheduledDates),
    },
    {
      key: "tagIds",
      label: "标签",
      render: (t) => (
        <span
          className="block max-w-[180px] truncate"
          title={tagsText(t)}
        >
          {tagsText(t)}
        </span>
      ),
    },
    {
      key: "doc",
      label: "文档",
      render: (t) => {
        if (!t.docUrl) return <span className="text-ink-300">—</span>;
        return (
          <a
            href={t.docUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex max-w-[140px] items-center gap-1 truncate text-brand-600 hover:underline"
            title={t.docTitle ?? t.docUrl}
          >
            <span className="truncate">{t.docTitle ?? t.docUrl}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        );
      },
    },
    {
      key: "createdAt",
      label: "创建",
      sortValue: (t) => t.createdAt,
      render: (t) => fmtDateTime(t.createdAt),
    },
    {
      key: "updatedAt",
      label: "更新",
      sortValue: (t) => t.updatedAt,
      render: (t) => fmtDateTime(t.updatedAt),
    },
  ];

  return (
    <DataTable<Task>
      columns={columns}
      rows={tasks}
      searchKeys={[
        (t) => t.title,
        (t) => t.description,
        (t) => t.docTitle ?? "",
      ]}
      getRowId={(t) => t.id}
      onRowClick={onOpenTask}
      defaultSort={{ key: "createdAt", dir: "desc" }}
      searchPlaceholder="按标题/简述/文档名搜索…"
    />
  );
}
```

- [ ] **Step 3: 在 DataPage 中接入任务表 + TaskEditor**

替换 `src/routes/data/DataPage.tsx` 全文：

```tsx
import { useState } from "react";
import { TaskEditor } from "@/components/task/TaskEditor";
import { useTaskStore } from "@/store/taskStore";
import { useTagStore } from "@/store/tagStore";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDataUrlState, type DataTab } from "./useDataUrlState";
import { TasksTable } from "./tables/TasksTable";

interface TabDef {
  key: DataTab;
  label: string;
  count: number;
}

export function DataPage() {
  const tasks = useTaskStore((s) => s.tasks);
  const pomodoros = useTaskStore((s) => s.pomodoros);
  const tags = useTagStore((s) => s.tags);
  const { tab, setTab } = useDataUrlState();

  const [editing, setEditing] = useState<Task | null>(null);

  const tabs: TabDef[] = [
    { key: "tasks", label: "任务", count: tasks.length },
    { key: "tags", label: "标签", count: tags.length },
    { key: "pomodoros", label: "番茄", count: pomodoros.length },
  ];

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-ink-800">数据</h1>
        <div className="flex items-center gap-2" />
      </header>

      <div className="mb-4 inline-flex overflow-hidden rounded-lg border border-ink-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "px-3 py-1.5 text-xs transition-colors",
              tab === t.key
                ? "bg-brand-600 text-white"
                : "bg-white text-ink-600 hover:bg-ink-50"
            )}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {tab === "tasks" && <TasksTable onOpenTask={(t) => setEditing(t)} />}
      {tab === "tags" && (
        <div className="rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-400">
          标签表格 · 待 Task 6 实现
        </div>
      )}
      {tab === "pomodoros" && (
        <div className="rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-400">
          番茄表格 · 待 Task 7 实现
        </div>
      )}

      <TaskEditor
        open={!!editing}
        task={editing}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
```

- [ ] **Step 4: TypeScript 编译检查**

Run: `npx tsc -b`
Expected: 通过。如果 `TaskEditor` 的 props 不匹配，打开 `src/components/task/TaskEditor.tsx` 查看其实际 props 签名，调整调用即可（参考 `src/routes/tasks/TasksHub.tsx` 中现有用法）。

- [ ] **Step 5: 浏览器手动验证**

打开 `http://localhost:5173/data`：
- 任务表展示所有任务，行数 = sidebar tab 上的「任务 N」。
- 顶部搜索：输入任意任务标题片段，行数过滤、底部「共 X 条」更新；清空搜索恢复。
- 点击「标题」列头：按字母升 → 再点降 → 再点回默认（createdAt desc）。
- 点击「更新」列头：按更新时间排序。
- 点击任意行：弹出 TaskEditor 且预填当前任务字段，关闭后回到表格。
- 「文档」列存在 docUrl 时点击图标 → 新标签打开 URL，不会触发行点击。
- 任务数 > 50 时显示分页器；点击「下一页」翻页。

- [ ] **Step 6: 提交**

```bash
git add src/routes/data/
git commit -m "feat(data): tasks table with DataTable component"
```

---

## Task 5：ImportExportBar 接入导入/导出按钮

**Files:**
- Create: `src/routes/data/ImportExportBar.tsx`
- Modify: `src/routes/data/DataPage.tsx`

- [ ] **Step 1: 新建 ImportExportBar.tsx**

```tsx
import { useRef } from "react";
import { Download, Upload } from "lucide-react";
import { exportDbToFile, importDbFromFile } from "@/lib/dbBackup";
import { useTaskStore } from "@/store/taskStore";
import { useTagStore } from "@/store/tagStore";

export function ImportExportBar() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleExport() {
    exportDbToFile();
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 重置 input 让用户能连续选同一个文件
    e.target.value = "";
    if (!file) return;
    const counts = {
      tasks: useTaskStore.getState().tasks.length,
      tags: useTagStore.getState().tags.length,
      pomodoros: useTaskStore.getState().pomodoros.length,
    };
    await importDbFromFile(file, counts);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={openFilePicker}
        className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-700 transition-colors hover:border-ink-300 hover:bg-ink-50"
        title="从备份 .sqlite 文件覆盖导入"
      >
        <Upload className="h-3.5 w-3.5" />
        导入
      </button>
      <button
        type="button"
        onClick={handleExport}
        className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-700 transition-colors hover:border-ink-300 hover:bg-ink-50"
        title="导出当前数据库为 .sqlite 文件"
      >
        <Download className="h-3.5 w-3.5" />
        导出
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".sqlite,.db,application/x-sqlite3"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
```

- [ ] **Step 2: 在 DataPage header 里挂上 ImportExportBar**

在 `src/routes/data/DataPage.tsx`：
- import 顶部加入 `import { ImportExportBar } from "./ImportExportBar";`
- 把 header 里的空 `<div className="flex items-center gap-2" />` 替换为 `<ImportExportBar />`：

```tsx
<header className="mb-4 flex items-center justify-between gap-4">
  <h1 className="text-2xl font-semibold text-ink-800">数据</h1>
  <ImportExportBar />
</header>
```

- [ ] **Step 3: TypeScript 编译检查**

Run: `npx tsc -b`
Expected: 通过。

- [ ] **Step 4: 浏览器手动验证 · 导出**

打开 `http://localhost:5173/data`：
- 右上角出现「导入」「导出」两个按钮。
- 点击「导出」→ 浏览器下载 `persistent-task-YYYY-MM-DD-HHmm.sqlite`。
- 文件大小 > 0；用 `file <下载路径>` 命令应识别为 `SQLite 3.x database`：
  ```bash
  file ~/Downloads/persistent-task-*.sqlite
  ```

- [ ] **Step 5: 浏览器手动验证 · 导入（成功路径）**

- 点击「导入」→ 系统文件选择器打开。
- 选刚刚导出的 `.sqlite` 文件 → 弹出双重确认对话框，标题「覆盖导入」，提示文案带当前任务/标签/番茄计数，按钮「覆盖导入」/「取消」。
- 点「取消」→ 关闭对话框，无副作用，数据不变。
- 再次点「导入」→ 选同一文件 → 点「覆盖导入」→ 页面 reload，数据保持不变（因为是导出再导回）。

- [ ] **Step 6: 浏览器手动验证 · 导入（失败路径）**

- 准备一个非 SQLite 文件，比如 `echo "not sqlite" > /tmp/fake.sqlite`。
- 点击「导入」→ 选 `/tmp/fake.sqlite` → 弹「导入失败 · 文件不是合法的持续任务备份：文件不是 SQLite 格式」对话框，按确定。
- 数据保持不变，无 reload。

- [ ] **Step 7: 浏览器手动验证 · 缺关键表的 SQLite**

构造一个不含 tasks 表的 SQLite：

```bash
sqlite3 /tmp/empty.sqlite "CREATE TABLE foo (x);"
```

- 点击「导入」→ 选 `/tmp/empty.sqlite` → 弹「导入失败 · 文件不是合法的持续任务备份：缺少必需的表：tasks」。

- [ ] **Step 8: 提交**

```bash
git add src/routes/data/
git commit -m "feat(data): import/export buttons wired to dbBackup"
```

---

## Task 6：标签表

**Files:**
- Create: `src/routes/data/tables/TagsTable.tsx`
- Modify: `src/routes/data/DataPage.tsx`

- [ ] **Step 1: 新建 TagsTable.tsx**

```tsx
import { useTagStore } from "@/store/tagStore";
import { useTaskStore } from "@/store/taskStore";
import type { Tag } from "@/lib/types";
import { DataTable, type Column } from "../DataTable";

export function TagsTable() {
  const tags = useTagStore((s) => s.tags);
  const tagMap = useTagStore((s) => s.byId());
  const tasks = useTaskStore((s) => s.tasks);

  // 计算每个 tag 的使用次数（直接用，不缓存）。
  function useCountOf(tagId: string): number {
    return tasks.filter((t) => t.tagIds.includes(tagId)).length;
  }

  const columns: Column<Tag>[] = [
    {
      key: "color",
      label: "颜色",
      render: (t) => (
        <span
          className="inline-block h-3 w-3 rounded-full"
          style={{ backgroundColor: t.color }}
          title={t.color}
        />
      ),
    },
    {
      key: "name",
      label: "名称",
      sortValue: (t) => t.name.toLowerCase(),
      render: (t) => <span className="text-ink-800">{t.name}</span>,
    },
    {
      key: "parent",
      label: "父标签",
      sortValue: (t) =>
        t.parentId ? (tagMap.get(t.parentId)?.name ?? "").toLowerCase() : "",
      render: (t) => {
        if (!t.parentId) return <span className="text-ink-300">—</span>;
        return tagMap.get(t.parentId)?.name ?? t.parentId;
      },
    },
    {
      key: "order",
      label: "同层排序",
      sortValue: (t) => t.order,
    },
    {
      key: "useCount",
      label: "使用次数",
      sortValue: (t) => useCountOf(t.id),
      render: (t) => useCountOf(t.id),
    },
  ];

  return (
    <DataTable<Tag>
      columns={columns}
      rows={tags}
      searchKeys={[(t) => t.name]}
      getRowId={(t) => t.id}
      defaultSort={{ key: "name", dir: "asc" }}
      searchPlaceholder="按标签名搜索…"
    />
  );
}
```

- [ ] **Step 2: 在 DataPage 接入标签 tab**

`src/routes/data/DataPage.tsx`：
- 顶部 import 加 `import { TagsTable } from "./tables/TagsTable";`
- 把渲染 tags tab 的占位 div 替换为：

```tsx
{tab === "tags" && <TagsTable />}
```

- [ ] **Step 3: TypeScript 编译检查**

Run: `npx tsc -b`
Expected: 通过。

- [ ] **Step 4: 浏览器手动验证**

打开 `/data?tab=tags`：
- 标签表展示所有标签，行数 = tab 上的「标签 M」。
- 颜色列显示圆点，颜色与 `/tags` 页一致。
- 父标签：根标签显示 "—"，子标签显示父名。
- 「使用次数」列：手工核对一两个标签：在 `/tasks` 中按该标签过滤后的任务数 == 此列值。
- 排序列头可以点击切换。
- 搜索框过滤工作正常。
- 点击行 **不** 应该有反应（无 onRowClick）。

- [ ] **Step 5: 提交**

```bash
git add src/routes/data/
git commit -m "feat(data): tags table with use-count column"
```

---

## Task 7：番茄表

**Files:**
- Create: `src/routes/data/tables/PomodorosTable.tsx`
- Modify: `src/routes/data/DataPage.tsx`

- [ ] **Step 1: 新建 PomodorosTable.tsx**

```tsx
import { Check, X } from "lucide-react";
import { useTaskStore } from "@/store/taskStore";
import type { PomodoroSession, PomodoroType } from "@/lib/types";
import { fmtDuration } from "@/lib/utils";
import { DataTable, type Column } from "../DataTable";

const TYPE_LABEL: Record<PomodoroType, string> = {
  focus: "专注",
  short_break: "短休",
  long_break: "长休",
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function PomodorosTable() {
  const sessions = useTaskStore((s) => s.pomodoros);
  const tasks = useTaskStore((s) => s.tasks);

  const taskTitleById = new Map<string, string>();
  for (const t of tasks) taskTitleById.set(t.id, t.title);

  function taskTitle(s: PomodoroSession): string {
    if (!s.taskId) return "";
    return taskTitleById.get(s.taskId) ?? s.taskId;
  }

  const columns: Column<PomodoroSession>[] = [
    {
      key: "startedAt",
      label: "开始",
      sortValue: (s) => s.startedAt,
      render: (s) => fmtDateTime(s.startedAt),
    },
    {
      key: "endedAt",
      label: "结束",
      sortValue: (s) => s.endedAt,
      render: (s) => fmtDateTime(s.endedAt),
    },
    {
      key: "type",
      label: "类型",
      sortValue: (s) => s.type,
      render: (s) => TYPE_LABEL[s.type],
    },
    {
      key: "durationSec",
      label: "时长",
      sortValue: (s) => s.durationSec,
      render: (s) => fmtDuration(s.durationSec),
    },
    {
      key: "completed",
      label: "完成",
      sortValue: (s) => (s.completed ? 1 : 0),
      render: (s) =>
        s.completed ? (
          <Check className="h-3.5 w-3.5 text-success-600" />
        ) : (
          <X className="h-3.5 w-3.5 text-ink-400" />
        ),
    },
    {
      key: "task",
      label: "关联任务",
      sortValue: (s) => taskTitle(s).toLowerCase(),
      render: (s) => {
        const title = taskTitle(s);
        if (!title) return <span className="text-ink-300">—</span>;
        return (
          <span className="block max-w-[260px] truncate" title={title}>
            {title}
          </span>
        );
      },
    },
  ];

  return (
    <DataTable<PomodoroSession>
      columns={columns}
      rows={sessions}
      searchKeys={[(s) => taskTitle(s)]}
      getRowId={(s) => s.id}
      defaultSort={{ key: "startedAt", dir: "desc" }}
      searchPlaceholder="按关联任务名搜索…"
    />
  );
}
```

- [ ] **Step 2: 在 DataPage 接入番茄 tab**

`src/routes/data/DataPage.tsx`：
- 顶部 import 加 `import { PomodorosTable } from "./tables/PomodorosTable";`
- 把渲染 pomodoros tab 的占位 div 替换为：

```tsx
{tab === "pomodoros" && <PomodorosTable />}
```

- [ ] **Step 3: TypeScript 编译检查**

Run: `npx tsc -b`
Expected: 通过。

- [ ] **Step 4: 浏览器手动验证**

打开 `/data?tab=pomodoros`：
- 番茄表展示所有番茄会话，行数 = tab 上的「番茄 K」。
- 「开始」列按时间倒序（最新在上）。
- 「类型」列正确显示中文：专注 / 短休 / 长休。
- 「时长」列形如 `25m` / `5m`。
- 「完成」列显示对勾或叉。
- 「关联任务」列：有 taskId 时显示任务标题（如果任务已删除则显示 id），无 taskId 时显示 "—"。
- 列头点击可切换排序。
- 搜索按任务名能过滤。
- 如果当前没有番茄记录，显示「暂无数据」空状态。

- [ ] **Step 5: 提交**

```bash
git add src/routes/data/
git commit -m "feat(data): pomodoros table"
```

---

## Task 8：端到端导入导出回归

**Files:**
- 仅手工验证，无代码改动。

> 这一步是最终的功能完整性回归。前置任务里的局部验证只看本任务点，这里把所有验证点合并成一条端到端流。

- [ ] **Step 1: 启动 dev server 并清理已有数据，建立可识别基线**

Run: `npm run dev`
- 在 `/tasks` 创建一个标题为「**EXPORT-IMPORT-TEST**」的任务，加一个标签，关联一个 doc URL。
- 在 `/pomodoro` 跑 1 个完整或部分番茄（让 pomodoros 至少有 1 条）。

- [ ] **Step 2: 导出**

- 进 `/data` → 点「导出」→ 文件下载完成。
- `file ~/Downloads/persistent-task-*.sqlite` 输出含 `SQLite 3.x database`。

- [ ] **Step 3: 验证文件结构（命令行）**

```bash
sqlite3 ~/Downloads/persistent-task-*.sqlite ".tables"
```

Expected：输出包含 `tasks tags pomodoros task_dates task_tags`。

```bash
sqlite3 ~/Downloads/persistent-task-*.sqlite "SELECT title FROM tasks WHERE title='EXPORT-IMPORT-TEST';"
```

Expected：输出 `EXPORT-IMPORT-TEST`。

- [ ] **Step 4: 修改数据制造差异**

- 回到浏览器 `/tasks`，把 `EXPORT-IMPORT-TEST` 任务标题改成「**DIRTY**」。
- 在 `/data` 上方任务 tab 的搜索框确认看到 `DIRTY`，看不到 `EXPORT-IMPORT-TEST`。

- [ ] **Step 5: 导入刚刚的备份**

- 在 `/data` 点「导入」→ 选刚才下载的 `.sqlite`。
- 弹出双重确认对话框，文案说明会覆盖、带当前计数。
- 点「覆盖导入」→ 页面 reload。
- reload 后，搜索框查 `EXPORT-IMPORT-TEST` 找得到（说明导入成功），查 `DIRTY` 找不到（说明本地脏改动被覆盖）。
- 番茄 tab：番茄会话条数与导出时一致。

- [ ] **Step 6: 跨数据库的清空 + 还原**

- 在 sidebar 底部点「清空数据」→ 确认 → 页面 reload。
- `/data` 三个 tab 都显示空（0 / 0 / 0）。
- 再次点「导入」选刚才的备份 → 覆盖导入 → reload。
- 三个 tab 计数恢复到导出时的状态。

- [ ] **Step 7: 删除测试任务清理环境**

- 删除 `EXPORT-IMPORT-TEST` 任务、对应标签、番茄记录（如果是测试期间生成的）。

- [ ] **Step 8: 最终 commit（如果有 doc 改动则提交）**

如果在测试过程中没有任何代码改动，**跳过**此步。

```bash
git status
# 若 working tree clean，无需 commit
```

---

## Self-Review 记录

- **Spec 覆盖**：
  - 路由 /data + Sidebar 入口 → Task 3
  - DataTable 组件（排序/搜索/分页/行点击）→ Task 4
  - 任务 / 标签 / 番茄三张表 → Task 4 / 6 / 7
  - 导出 .sqlite + 文件名时间戳 → Task 2 / 5
  - 导入校验（magic / 打开 / 关键表） → Task 2
  - 200MB 上限 → Task 2
  - 双重确认 + 覆盖 → Task 2 / 5
  - reload 重 hydrate → Task 2（importDbFromFile 内 location.reload()）
  - URL state（仅 ?tab=...） → Task 3
  - TaskEditor 行点击复用 → Task 4
- **Placeholder 扫描**：无 TBD / TODO / "类似上文" 句式。所有代码块完整。
- **类型一致**：
  - `Column<T>`、`DataTableProps<T>` 在 Task 4 定义后，Task 6 / 7 中以 `Column<Tag>` / `Column<PomodoroSession>` 形式直接复用，命名一致。
  - `exportSqliteBytes` / `replaceSqliteBytes` 在 Task 1 定义、Task 2 直接使用，签名一致。
  - `importDbFromFile(file, counts)` 在 Task 2 定义、Task 5 调用，参数 `ImportCounts` 形状一致。
- **测试**：项目无单测基建，每个任务给出明确的浏览器/命令行验证步骤。Task 8 收尾做端到端回归。

---

完成所有 Task 后，整个 `/data` 页 + SQLite 整库导入导出能力即可上线。Tauri 桁面端按 spec 约定本期不动。
