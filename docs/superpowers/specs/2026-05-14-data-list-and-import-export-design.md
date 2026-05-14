# 数据列表查看与导入导出 · 设计文档

日期：2026-05-14
分支：`persistent-task-export-and-import`

## 目标

在「持续任务」中增加：

1. 统一的「数据」页，以表格形式查看任务 / 标签 / 番茄三类原始数据。
2. 整库导入导出能力，文件格式为原生 SQLite（与项目存储一致，零格式转换）。

## 范围

- 仅 Web 端（sql.js + IndexedDB）。Tauri 桁面端本期不实现，与 Web 共享 schema 后续可补。
- 表格仅供只读查看（任务行可点击复用 `TaskEditor`），不在表格内做行内编辑。
- 导入策略：**完全覆盖**，双重确认。不做合并 / 选择性导入。
- 导出格式：原生 `.sqlite` 文件。不做 JSON / CSV 旁路输出。

## 架构

### 路由与入口

- 新增路由 `/data`，元素 `<DataPage />`，注册在 `src/App.tsx`。
- Sidebar (`src/components/layout/Sidebar.tsx`) 在「番茄时钟」「统计面板」之后新增「数据」入口，图标 `Database` (lucide-react)。

### 文件结构

新增：
```
src/routes/data/
  DataPage.tsx              # 顶栏（标题 + 导入/导出）+ tab + 当前表格
  DataTable.tsx             # 通用只读表格：列配置 + 排序 + 搜索 + 分页
  tables/
    TasksTable.tsx          # 任务列定义 + 行点击进 TaskEditor
    TagsTable.tsx           # 标签列定义
    PomodorosTable.tsx      # 番茄列定义
  ImportExportBar.tsx       # 导入/导出按钮区
  useDataUrlState.ts        # ?tab=tasks|tags|pomodoros 读写 hook
src/lib/
  dbBackup.ts               # exportDb() / importDb()：校验 + reload 流程
```

修改：
- `src/App.tsx`：注册 `/data` 路由。
- `src/components/layout/Sidebar.tsx`：新增导航项。
- `src/lib/webDb/sqliteDb.ts`：导出 `exportSqliteBytes()` / `replaceSqliteBytes()`。
- `src/store/pomodoroStore.ts`：新增 `sessions: PomodoroSession[]` 字段及 `hydrate()`（当前 store 仅含运行态）。

### 数据流

- 读：`DataPage` 通过 `useTaskStore`、`useTagStore`、`usePomodoroStore` 拿到三类列表，不引入新的 adapter 接口。
- 导出：`sqliteDb.export()` → `Uint8Array` → Blob → 下载。
- 导入：File → ArrayBuffer → 校验 → 替换 IndexedDB 中库 blob → `location.reload()` 让所有 store 重新 hydrate。

## 表格与列

### `DataTable<T>` 通用组件

Props：
- `columns: Column<T>[]`：`{ key, label, render?, sortValue?, className? }`
- `rows: T[]`
- `searchKeys: ((row: T) => string)[]`：每个返回参与搜索的字符串
- `getRowId: (row: T) => string`
- `onRowClick?: (row: T) => void`
- `defaultSort?: { key, dir: 'asc' | 'desc' }`

内部状态：`sortKey / sortDir / query / page`，`pageSize = 50`。

行为：
- 列头点击：未排序 → desc → asc → 未排序（回到 `defaultSort`）。
- 顶部搜索框：`query.trim().toLowerCase()` 对所有 `searchKeys(row)` 做 `includes` 匹配。
- 分页器：上一页 / `n / total` / 下一页。
- 行 hover：`hover:bg-ink-50`；有 `onRowClick` 时 `cursor-pointer`。
- 切换 tab 时 page 重置为 1（由 `DataPage` 在 tab 切换时 remount `DataTable` 实现，最简）。

### 任务表

| 列 | 字段 | 渲染 |
| - | - | - |
| 标题 | `title` | 文本，`truncate` |
| 状态 | `status` | `StatusBadge`（复用现有组件） |
| 优先级 | `priority ?? 'p2'` | 文字 + 现有颜色规则 |
| 排期 | `scheduledDates` | 前 3 项逗号拼接，超出加 "…" |
| 标签 | `tagIds` | 通过 tagStore 查名，逗号拼接 |
| 文档 | `docTitle / docUrl` | 文字 + 外链图标；空则 "—" |
| 创建 | `createdAt` | `yyyy-MM-dd HH:mm` |
| 更新 | `updatedAt` | `yyyy-MM-dd HH:mm` |

- `searchKeys`：`title`、`description`、`docTitle`
- `defaultSort`：`createdAt desc`
- `onRowClick`：打开 `TaskEditor` 编辑该任务

### 标签表

| 列 | 字段 |
| - | - |
| 颜色 | `color` 圆点 |
| 名称 | `name` |
| 父标签 | tagStore 查 `parentId` 名称；根标签 "—" |
| 同层排序 | `order` |
| 使用次数 | `tasks.filter(t => t.tagIds.includes(tag.id)).length` |

- `searchKeys`：`name`
- `defaultSort`：`name asc`
- 行不可点击（标签编辑仍走 `/tags`）

### 番茄表

| 列 | 字段 |
| - | - |
| 开始 | `startedAt` |
| 结束 | `endedAt` |
| 类型 | `type`（focus / short_break / long_break）|
| 时长 | `fmtDuration(durationSec)` |
| 完成 | `completed`（✓ / ✗） |
| 任务 | `taskId` → taskStore 查标题；空 "—" |

- `searchKeys`：关联任务标题
- `defaultSort`：`startedAt desc`
- 行不可点击

## 导入导出

### 导出

`ImportExportBar` 顶部右侧按钮，调用 `dbBackup.exportDb()`：

```ts
async function exportDb(): Promise<void> {
  const bytes = await exportSqliteBytes();
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
```

文件名：`persistent-task-YYYY-MM-DD-HHmm.sqlite`（本地时间）。

### 导入

按钮触发隐藏 `<input type="file" accept=".sqlite,.db,application/x-sqlite3">`，选中后：

1. `readAsArrayBuffer` → `Uint8Array`
2. **大小硬上限 200MB**，超过弹错误对话框（用现有 `dialogStore.confirm`，只显示「确定」）。
3. **格式校验**：
   - 前 16 字节必须等于 `"SQLite format 3\0"`（ASCII，最后一位 null 字节）。
   - `new SQL.Database(bytes)` 能成功打开。
   - `SELECT name FROM sqlite_master WHERE type='table'` 结果必须包含 `tasks`、`tags`、`pomodoros`。
   - 任一失败 → 关闭该临时 db 实例，弹错误：「文件不是合法的持续任务备份」。
4. **双重确认**（`confirm({ danger: true })`）：
   > 导入会用文件中的数据完全替换当前所有任务、标签、番茄记录，且不可撤销。
   > 当前共 N 个任务 / M 个标签 / K 条番茄。
   > 确认继续？
   按钮：「覆盖导入」/「取消」。
5. 确认后：
   - 关闭旧 `sqliteDb` 实例。
   - 调 `replaceSqliteBytes(bytes)`：直接覆盖 IndexedDB 中库 blob。
   - `location.reload()`。
6. reload 后 `main.tsx` → `initAdapter()` → 从 IndexedDB 读新 bytes → store hydrate 显示新数据。

### `sqliteDb.ts` 改造

新增两个导出函数（实现细节依赖现有 `sqliteDb.ts` 内部 db 实例 + IndexedDB 写函数；不改动调用方）：

```ts
export async function exportSqliteBytes(): Promise<Uint8Array>;
export async function replaceSqliteBytes(bytes: Uint8Array): Promise<void>;
```

`dbBackup.ts` 是更高层封装，负责校验 + 用户确认 + reload。

## UI 布局

```
┌────────────────────────────────────────────────────────────┐
│ 数据                                       [导入] [导出 ↓] │
├────────────────────────────────────────────────────────────┤
│ [任务 N] [标签 M] [番茄 K]                                  │
├────────────────────────────────────────────────────────────┤
│ 🔎 搜索...                                     共 N 条      │
├────────────────────────────────────────────────────────────┤
│ 标题 ↑  状态  优先级  排期  标签  创建  更新                │
│ ──────────────────────────────────────────────────────      │
│ ...最多 50 行...                                            │
├────────────────────────────────────────────────────────────┤
│                            上一页  1/8  下一页              │
└────────────────────────────────────────────────────────────┘
```

- 容器：`mx-auto max-w-5xl px-8 py-8`（与 TasksHub 一致）。
- tab 视觉复用 TasksHub 顶部 tab 样式。
- tab 标签后挂计数 `(N)`。
- 标题列 `min-w-0 truncate`；其他列 `whitespace-nowrap`。
- 切换 tab 重置 page=1。
- 搜索框与分页只走会话态，不进 URL。
- URL state：仅 `?tab=tasks|tags|pomodoros`，缺省 `tasks`。

## 边界与失败

| 场景 | 处理 |
| - | - |
| 用户取消文件选择 | 静默，不做任何事 |
| 文件不是 SQLite | 弹错误「文件不是合法的持续任务备份」 |
| SQLite 但缺关键表 | 同上 |
| 文件 > 200MB | 弹错误「备份文件过大」 |
| 导入过程刷新 / 断电 | IndexedDB 写入是原子的，要么完整覆盖要么保持旧数据；无需额外事务 |

## 测试（手动 QA 清单）

1. 打开 `/data`，3 个 tab 数据条数与现有 TasksHub / Tags / Stats 一致。
2. 列头点击：未排序 → desc → asc → 默认，行序变化正确。
3. 搜索：输入关键字，行数过滤、计数同步。
4. 分页：1/8 → 8/8，最后一页 ≤ 50 行。
5. 任务行点击 → `TaskEditor` 弹出且字段填充正确。
6. 导出 → 浏览器下载 `persistent-task-{ts}.sqlite`。
7. 用刚导出的文件再导入 → 双重确认 → reload → 数据一致。
8. 选 `.txt` 文件 → 弹错误。
9. 用 `sqlite3` 手造一个没有 `tasks` 表的 SQLite 文件 → 弹错误。
10. 用另一份不同的备份导入 → reload → 数据被完全替换。

## 不做（YAGNI）

- 表格行内编辑。
- 合并 / 选择性导入。
- CSV / JSON 旁路导出。
- Tauri 侧导入导出（本期）。
- toast / 通知系统（现有项目无，引入即过度工程；下载和 reload 本身可见）。
- 导入预览（已有文件校验 + 双重确认，足够）。

## 改动清单

新增：
- `src/routes/data/DataPage.tsx`
- `src/routes/data/DataTable.tsx`
- `src/routes/data/tables/TasksTable.tsx`
- `src/routes/data/tables/TagsTable.tsx`
- `src/routes/data/tables/PomodorosTable.tsx`
- `src/routes/data/ImportExportBar.tsx`
- `src/routes/data/useDataUrlState.ts`
- `src/lib/dbBackup.ts`

修改：
- `src/App.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/lib/webDb/sqliteDb.ts`
- `src/store/pomodoroStore.ts`
