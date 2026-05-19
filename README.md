# [](https://)持续任务 · Persistent Task

桌面端任务管理系统：每日任务、跨日贯穿、拖拽优先级、番茄时钟、标签树、统计面板。

## 功能清单


| # | 需求                                   | UI 状态   | 数据状态     |
| - | -------------------------------------- | --------- | ------------ |
| 1 | 记录每日任务 + 完成情况 + 关联外部文档 | ✅ 已实现 | LocalStorage |
| 2 | 任务简述                               | ✅ 已实现 | LocalStorage |
| 3 | 任务可贯穿多日，每天都能看到           | ✅ 已实现 | LocalStorage |
| 4 | 拖动改变任务优先级（同日内排序）       | ✅ 已实现 | LocalStorage |
| 5 | 任务进入番茄时钟（25/5/15、绑定任务）  | ✅ 已实现 | LocalStorage |
| 6 | 标签树 CRUD + 按标签查找（含子标签）   | ✅ 已实现 | LocalStorage |
| 7 | 多维度统计（年月日 / 标签 / 状态）     | ✅ 已实现 | LocalStorage |

> Demo first 阶段：所有 UI 已贯通、数据走 `LocalStorageAdapter`。
> 切换到 Tauri+SQLite 后端时，只需替换 `src/lib/dataAdapter.ts` 中 `TauriAdapter` 的实现，业务代码无需改动。

## 技术栈

- **Tauri 2** + Rust 后端（SQLite via `rusqlite`，已预留 schema）
- **React 18** + **TypeScript** + **Vite**
- **TailwindCSS** 设计系统（`brand` 靛蓝主色 / `success` / `warning` / `ink` 中性灰）
- **Zustand** 状态管理（task / tag / pomodoro 三个 store）
- **@dnd-kit** 拖拽排序
- **Recharts** 统计图表
- **date-fns** 日期处理（中文 locale）
- **lucide-react** 图标

## 目录结构

```
persistent-task/
├── src/                           # React 前端
│   ├── App.tsx                    # 路由 + 启动加载
│   ├── main.tsx
│   ├── styles/index.css           # Tailwind + 全局样式
│   ├── lib/
│   │   ├── types.ts               # Task / Tag / PomodoroSession 等模型
│   │   ├── mockData.ts            # 首启种子数据
│   │   ├── dataAdapter.ts         # 数据访问抽象（关键：mock <-> tauri 切换点）
│   │   └── utils.ts               # cn / isoDate / fmtClock / fmtDuration
│   ├── store/
│   │   ├── taskStore.ts           # 任务 CRUD + 排序 + 跨日 + 番茄记录
│   │   ├── tagStore.ts            # 标签树 + 后代收集
│   │   └── pomodoroStore.ts       # 番茄钟状态机
│   ├── components/
│   │   ├── layout/                # Sidebar / AppLayout
│   │   ├── ui/                    # Modal / TagChip / StatusBadge
│   │   └── task/                  # TaskCard / TaskEditor
│   └── routes/
│       ├── Today.tsx              # 今日任务（拖拽排序、快速新建）
│       ├── Tasks.tsx              # 全部任务（搜索 + 标签/状态筛选）
│       ├── Tags.tsx               # 标签树管理
│       ├── Pomodoro.tsx           # 番茄时钟（圆环 + 历史会话）
│       └── Stats.tsx              # 统计面板（趋势 / 分布 / 标签维度）
└── src-tauri/                     # Tauri 2 Rust 后端
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── build.rs
    ├── capabilities/default.json
    └── src/
        ├── main.rs
        ├── lib.rs                 # Tauri 入口
        ├── models.rs              # 与前端 types.ts 同构的 Rust 类型
        └── db.rs                  # SQLite schema + 迁移（已预留，未接入）
```

## 安装与运行

### 1. 安装前端依赖

```bash
npm install
# 或 pnpm install
```

### 2. 浏览器开发（推荐入门）

```bash
npm run dev
```

打开 [http://localhost:1420](http://localhost:1420)。数据会持久化到浏览器 LocalStorage（key 前缀 `pt:`）。

### 3. 桌面端开发（Tauri）

需要 Rust 工具链，已确认本机 Rust 1.88。首次运行 Cargo 会下载依赖、编译 SQLite，比较耗时。

```bash
npm run tauri:dev
```

### 4. 桌面端打包（生产）

> 打包前需要先生成应用图标，然后启用 `tauri.conf.json` 中的 `bundle.active`。

```bash
# 准备一个 1024x1024 的 PNG，用 Tauri 的图标生成器：
npx @tauri-apps/cli icon path/to/your-icon.png

# 然后修改 tauri.conf.json：
#   "bundle": { "active": true, "icon": ["icons/32x32.png", ...] }
npm run tauri:build
```

## 数据模型

### Task（任务）

```ts
{
  id: string;
  title: string;
  description: string;          // 任务简述
  status: "todo" | "in_progress" | "done" | "archived";
  scheduledDates: string[];     // 任务出现在哪些天（yyyy-MM-dd）
  tagIds: string[];
  order: number;                // 同日内排序权重
  docUrl?: string;              // 关联外部文档（钉钉/飞书/任意 URL）
  docTitle?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

> **跨日逻辑**：任务在 `scheduledDates` 中的每一天都会出现在「今日任务」页。
> 标记完成时清空 `scheduledDates`、写入 `completedAt`；重新打开时回填到今天。

### Tag（标签，树形结构）

```ts
{
  id: string;
  name: string;
  parentId: string | null;      // null 表示根标签
  color: string;                // hex
  order: number;
}
```

按标签查找时，选中父标签会自动包含所有后代标签的任务（见 `tagStore.collectDescendants`）。

### PomodoroSession（番茄会话）

```ts
{
  id: string;
  taskId?: string;              // 可选关联任务
  type: "focus" | "short_break" | "long_break";
  durationSec: number;          // 实际投入秒数（中断时即记录已用时长）
  completed: boolean;
  startedAt: string;
  endedAt: string;
}
```

## 接入 Tauri + SQLite 的迁移指南

当前 demo 阶段使用 `LocalStorageAdapter`。要切换到 SQLite：

### 第 1 步：在 Tauri 启动时注入 SQLite 状态

修改 `src-tauri/src/lib.rs`：

```rust
.setup(|app| {
    let db_path = app.path().app_data_dir()?.join("persistent-task.db");
    let state = crate::db::AppState::open(db_path)?;
    app.manage(state);
    Ok(())
})
```

### 第 2 步：新增 `src-tauri/src/commands.rs`

为每个 store 操作写一个 `#[tauri::command]` 函数，例如：

```rust
#[tauri::command]
pub fn list_tasks(state: State<AppState>) -> Result<Vec<Task>, String> { ... }

#[tauri::command]
pub fn upsert_task(state: State<AppState>, task: Task) -> Result<(), String> { ... }
```

并在 `lib.rs` 的 `.invoke_handler(tauri::generate_handler![...])` 中注册。

### 第 3 步：替换前端 `TauriAdapter` 实现

把 `src/lib/dataAdapter.ts` 中 `TauriAdapter` 的占位 TODO 替换为：

```ts
import { invoke } from "@tauri-apps/api/core";

class TauriAdapter implements DataAdapter {
  async listTasks() {
    return await invoke<Task[]>("list_tasks");
  }
  async upsertTask(t: Task) {
    await invoke("upsert_task", { task: t });
  }
  // ... 其他方法
}
```

由于 `getAdapter()` 在 Tauri 环境会自动选用 `TauriAdapter`，前端业务代码、store、组件**都不需要改动**。

### 第 4 步：清理 LocalStorage 数据（可选）

切换后浏览器中老数据可在控制台执行 `localStorage.clear()` 清掉。

## 设计偏好

- **视觉**：浅色优先、低饱和、卡片化、柔和阴影
- **交互**：键盘可达（Escape 关闭弹窗）、拖拽手柄显式可见、空态有引导
- **配色**：靛蓝（专注）+ 翠绿（完成）+ 琥珀（进行中）

## 路线图（建议）

- [ ]  接入 SQLite（按上文 4 步走）
- [ ]  暗色模式
- [ ]  任务子任务（嵌套 todo）
- [ ]  重复任务规则（每天 / 每周）
- [ ]  数据导入导出（JSON/CSV）
- [ ]  系统托盘 + 全局快捷键启动番茄钟
- [ ]  钉钉文档 OAuth 自动获取标题

---

## MCP（Model Context Protocol）接入

桌面 app 内置了一个本地 MCP 服务，让你的 AI agent（Claude Desktop / Cursor / Claude Code / 任意 MCP 客户端）能够读写当前的任务、标签、番茄记录。**无需暴露到公网，全部走 `127.0.0.1`**。

### 启用步骤

1. 启动桌面 app：`npm run tauri:dev`（开发态）或运行打包后的 `.app`
2. 侧边栏底部点击 **「高级」**
3. 打开 **「启用 MCP 服务」** 胶囊开关
4. 服务默认监听 `http://127.0.0.1:7321/mcp`，端口冲突时自动 `+1` 最多试 10 次，实际端口在 UI 上显示
5. 决定是否开启 **「允许写工具」**（默认关；开启后 agent 才能创建/修改/删除数据）
6. **不推荐**开启 **「允许危险工具」**（数据库导入/清空，会动整个 DB；执行前会自动备份到 `backups/`）

### 客户端配置

#### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）：

```json
{
  "mcpServers": {
    "persistent-task": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:7321/mcp"
    }
  }
}
```

也可以直接在桌面 app 高级页面点 **「复制」** 按钮，已经按当前端口生成好。

#### Cursor / 其他支持 streamable-http 的客户端

URL 同样填 `http://127.0.0.1:7321/mcp`，type 设 `streamable-http` 或 `http`（视客户端而定）。

#### 备用：stdio 模式（仅支持 stdio 的客户端）

```json
{
  "mcpServers": {
    "persistent-task": {
      "command": "/绝对路径/到/persistent-task",
      "args": ["--mcp"]
    }
  }
}
```

- 开发态二进制：`<repo>/src-tauri/target/debug/persistent-task`
- 打包后（macOS）：`/Applications/持续任务.app/Contents/MacOS/持续任务`

stdio 模式独立于 GUI 进程，不需要 GUI 开着；通过 SQLite WAL 与 GUI 并发安全。

### 工具清单（31 个）

| 域 | 工具 | 写权限 | 危险 |
|---|---|---|---|
| 元 | `ping` | — | — |
| **Task** | `list_tasks` `get_task` `search_tasks` `get_today_tasks` `get_tasks_by_date_range` | — | — |
| | `create_task` `update_task` `delete_task` `set_task_status` | ✅ | — |
| | `schedule_task_for_date` `unschedule_task_from_date` `move_task_schedule` | ✅ | — |
| | `reorder_tasks_for_date` `review_past_task` | ✅ | — |
| **Tag** | `list_tags` `get_tag_tree` | — | — |
| | `create_tag` `update_tag` `delete_tag` `move_tag` | ✅ | — |
| **Pomodoro** | `list_pomodoros` | — | — |
| | `log_pomodoro` `delete_pomodoro` | ✅ | — |
| **Analytics** | `get_daily_stats` `get_tag_stats` `query_events` `count_events` | — | — |
| **Admin** | `export_db` | — | — |
| | `replace_db` `clear_all` | ✅ | ⚠️ |

所有工具都用 camelCase 入参，输出是结构化 JSON（带 schema）。在 agent 里直接说"创建一条明天的任务"它会找到 `create_task` + `schedule_task_for_date` 自己组合调用。

### Resources（5 个只读 URI）

让 agent 在对话开头读取上下文，比一次性调多个工具更省 token：

| URI | 类型 | 说明 |
|---|---|---|
| `task://today` | markdown | 今日所有任务（含跨天延续） |
| `task://overdue` | markdown | 待处置的过期任务，配合 `review_past_task` 用 |
| `tag://tree` | markdown | 标签树 |
| `stats://summary` | json | 最近 30 天聚合（日维度 + 标签维度） |
| `schema://types` | json | 数据模型 JSON Schema，便于 agent 自校验 |

### 安全机制（中度方案）

| 机制 | 行为 |
|---|---|
| 写权限闸 | 默认关。GUI「高级」里勾选「允许写工具」才放行 |
| 危险权限闸 | 默认关。需要先勾「允许写工具」，再勾「允许危险工具」 |
| 限流 | 写工具 ≤ 60 次/分钟，危险工具 ≤ 5 次/分钟（滑动窗口） |
| 自动备份 | `replace_db` / `clear_all` 执行前先复制 DB 到 `<app_data_dir>/backups/persistent-task-<ts>.db`，保留最近 20 份 |
| 审计日志 | 所有成功的写工具调用都会落 `events` 表（`type=mcp.tool.invoked`、`sessionId=mcp`），可用 `query_events` 反查"哪个 agent 改了什么" |
| 绑定 | 只监听 `127.0.0.1`，不会被局域网访问 |
| 并发 | SQLite WAL + `busy_timeout=5000`，GUI 和 MCP 可同时读写同一份 DB |

### 故障排查

- **端口冲突**：UI 显示的端口与你期望的不同。`7321` 被占用时会自动尝试 `7322`、`7323`...，确认 agent 端配置用了实际端口
- **agent 调写工具拒绝**：错误信息会明确指向"请在桌面 app 的「高级」菜单中打开「允许写工具」"
- **找不到 MCP 二进制（stdio 模式）**：用绝对路径；开发态在 `src-tauri/target/debug/persistent-task`
- **修改了端口但服务没生效**：端口字段在服务运行时是灰色的，需要先停止服务再改

### 实现位置

- Rust 端 MCP server：`src-tauri/src/mcp/`
  - `mod.rs` — 入口、WAL 启用、stdio 模式
  - `server.rs` — `PersistentTaskMcpServer` + ServerHandler
  - `control.rs` — HTTP 启停管理（端口自适应、独立 tokio runtime）
  - `tools/` — 5 个子模块、31 个工具
  - `resources.rs` — 5 个 Resources 生成
  - `security.rs` — 滑动窗口限流 + 自动备份
  - `audit.rs` — 写工具审计日志
- 业务逻辑共享层：`src-tauri/src/commands/core.rs`（Tauri commands 和 MCP 工具都调它）
- 前端「高级」页面：`src/routes/AdvancedPage.tsx`
