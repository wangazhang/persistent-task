# 持续任务 · Persistent Task

桌面端任务管理系统：每日任务、跨日贯穿、拖拽优先级、番茄时钟、标签树、统计面板。

## 功能清单

| # | 需求 | UI 状态 | 数据状态 |
| - | - | - | - |
| 1 | 记录每日任务 + 完成情况 + 关联外部文档 | ✅ 已实现 | LocalStorage |
| 2 | 任务简述 | ✅ 已实现 | LocalStorage |
| 3 | 任务可贯穿多日，每天都能看到 | ✅ 已实现 | LocalStorage |
| 4 | 拖动改变任务优先级（同日内排序） | ✅ 已实现 | LocalStorage |
| 5 | 任务进入番茄时钟（25/5/15、绑定任务） | ✅ 已实现 | LocalStorage |
| 6 | 标签树 CRUD + 按标签查找（含子标签） | ✅ 已实现 | LocalStorage |
| 7 | 多维度统计（年月日 / 标签 / 状态） | ✅ 已实现 | LocalStorage |

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

打开 <http://localhost:1420>。数据会持久化到浏览器 LocalStorage（key 前缀 `pt:`）。

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

- [ ] 接入 SQLite（按上文 4 步走）
- [ ] 暗色模式
- [ ] 任务子任务（嵌套 todo）
- [ ] 重复任务规则（每天 / 每周）
- [ ] 数据导入导出（JSON/CSV）
- [ ] 系统托盘 + 全局快捷键启动番茄钟
- [ ] 钉钉文档 OAuth 自动获取标题
