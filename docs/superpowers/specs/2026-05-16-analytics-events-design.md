# 事件埋点系统设计

- 日期：2026-05-16
- 范围：A（业务结果指标）+ B（行为习惯洞察）+ C（产品使用诊断）

## 1. 目标

为现有任务/番茄/标签系统加一套**统一的事件埋点**，使下列问题可以被回答：

- 哪些时段任务添加比较频繁
- 哪些标签下任务完成率高
- 用户什么时段会改期（反映规划/调整习惯）
- 任意时间窗内某个实体（任务/标签）发生过什么
- 各路由/弹层/搜索/导入导出的使用频率

非目标：

- 远程上报（这是单机本地应用，事件留本地）
- 实时仪表盘
- SQL 自由查询控制台（如有需要后续再加）

## 2. 总体架构

```
业务/UI 层
  ├─ Store actions (taskStore / pomodoroStore / tagStore / dialogStore)
  └─ UI 组件 (按钮、对话框、Route)
      │ 自动                     │ 显式 track()
      ▼                          ▼
埋点层 src/lib/analytics/
  ├─ track(type, props)         显式入口
  ├─ withTracking(mapping)      zustand 中间件
  ├─ registry                   事件类型 + props 类型 (TS discriminated union)
  ├─ buffer + flush             批写,降低写放大
  └─ session                    session_id 管理
                  │
                  ▼
数据层 (DataAdapter, 已有)
  └─ events 表 (sqlite, 双端同 schema)
                  │
                  ▼
查询层
  ├─ Stats.tsx 扩展 (3 个面板)
  └─ /data?tab=events 事件浏览 (列表 + 过滤 + JSON 详情)
```

四层职责：埋点层把"调用"和"存储"解耦，业务方只看到 `track()`；store 不需要知道埋点存在。

## 3. 数据 Schema

### 3.1 events 表

新增到 `src/lib/webDb/schema.ts` 与 `src-tauri/src/db.rs`（两端 idempotent migrate）：

```sql
CREATE TABLE IF NOT EXISTS events (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL,
    occurred_at  TEXT NOT NULL,              -- ISO8601, 客户端本地时间
    entity_type  TEXT,                       -- 'task' / 'tag' / 'pomodoro' / 'route' / null
    entity_id    TEXT,
    session_id   TEXT NOT NULL,
    source       TEXT NOT NULL,              -- 'auto' | 'manual'
    props        TEXT NOT NULL DEFAULT '{}'  -- JSON
);
CREATE INDEX IF NOT EXISTS idx_events_type      ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_occurred  ON events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_entity    ON events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_events_session   ON events(session_id);
```

设计依据：

- `type / occurred_at` 是几乎所有查询的过滤条件 → 单独索引
- `entity_type + entity_id` 提到列上是因为"某个 task 一生发生过什么"是高频问题，走 props JSON 太慢
- `session_id` 是 UI 路径分析的关键
- `source` 区分自动/手动，便于排查"这个事件怎么来的"
- 其他自定义字段全部进 `props` JSON

### 3.2 事件 Registry（首批）

| 域 | 事件 | 关键 props |
|---|---|---|
| **task** | `task.created` `task.updated` `task.completed` `task.uncompleted` `task.deleted` `task.scheduled` `task.unscheduled` `task.rescheduled` `task.tagged` `task.untagged` `task.priority_changed` `task.reordered` | priority, fromDate/toDate, fromValue/toValue, mode |
| **pomodoro** | `pomodoro.started` `pomodoro.completed` `pomodoro.cancelled` | type, durationSec, taskId |
| **tag** | `tag.created` `tag.renamed` `tag.deleted` `tag.moved` | parentId, color |
| **ui** | `ui.route.enter` `ui.dialog.open` `ui.popover.open` `ui.search.used` `ui.export` `ui.import` | route, dialog, queryLength |
| **app** | `app.launched` `app.hydrated` | platform (tauri/web), durationMs |

命名约定：`<域>.<动作>`，全小写 + 点分隔，过去时；新增类型必须先在 `registry.ts` 登记并加 props 类型。

### 3.3 行示例

```
id=u1 type=task.created occurred_at=2026-05-16T10:23:11+08:00
entity_type=task entity_id=t-abc session_id=s-xyz source=auto
props={"priority":"p1","tagIds":["work"],"hasDoc":false}
```

## 4. 埋点层

### 4.1 目录

```
src/lib/analytics/
  index.ts          对外只导出 track / identifySession / flushNow
  registry.ts       EventMap (discriminated union) + 类型校验
  buffer.ts         内存队列 + flush 策略
  middleware.ts     withTracking(mapping)
  session.ts        session_id 生成与续期
  __tests__/
    buffer.test.ts
    middleware.test.ts
    registry.test.ts
```

### 4.2 显式 SDK

```ts
import { track } from "@/lib/analytics";

track("ui.popover.open", {
  popover: "day-tasks",
  date: "2026-05-16",
});
```

`track()` 行为：

1. 校验 `type` 已注册（dev 模式 console.warn，prod 静默）
2. 组装事件对象（id / occurred_at / session_id / source='manual' 自动填）
3. 从 props 约定字段抽 `entity_type` / `entity_id`：`taskId` → task、`tagId` → tag、`route` → route 等（约定见 registry）
4. 推入内存 buffer
5. fire-and-forget，不阻塞业务

### 4.3 Store 中间件

```ts
export const useTaskStore = create<TaskStoreState>()(
  withTracking({
    addTask:      (ret) => [["task.created", { taskId: ret.id, priority: ret.priority }]],
    toggleStatus: (_, [id, st]) => [[st === "done" ? "task.completed" : "task.uncompleted", { taskId: id }]],
    moveSchedule: (_, [id, from, to, mode]) => [["task.rescheduled", { taskId: id, fromDate: from, toDate: to, mode }]],
    // updateTask 是单 action 多语义,用 prev/next diff 拆成多事件
    updateTask:   (_, [id, patch], { prev, next }) => {
      const out: Array<[string, object]> = [];
      if (patch.priority && prev.priority !== next.priority) {
        out.push(["task.priority_changed", { taskId: id, from: prev.priority, to: next.priority }]);
      }
      if (patch.tagIds) {
        const added = next.tagIds.filter(t => !prev.tagIds.includes(t));
        const removed = prev.tagIds.filter(t => !next.tagIds.includes(t));
        added.forEach(tagId => out.push(["task.tagged",   { taskId: id, tagId }]));
        removed.forEach(tagId => out.push(["task.untagged", { taskId: id, tagId }]));
      }
      // 兜底 task.updated 仍然发出, 携带 fields 列表
      out.push(["task.updated", { taskId: id, fields: Object.keys(patch) }]);
      return out;
    },
    // ...
  })((set, get) => ({ /* 原 store 体 */ }))
);
```

中间件契约：

- mapper 签名：`(returnValue, args, { prev, next }) => Array<[type, props]>`
- 返回空数组表示该次调用不打点；返回多元素表示一次 action 发多事件
- 中间件负责快照 `prev`（action 前 store 状态切片）和 `next`（action 后），mapper 可按需 diff
- 未映射的 action 透传，不打点
- mapper 抛异常只在 dev console.warn，业务不受影响

### 4.4 Buffer + Flush

| 触发条件 | 时机 |
|---|---|
| 阈值 | buffer ≥ 50 条 |
| 时间 | 每 2s 检查，有就 flush |
| 关键事件 | `app.launched` / `pomodoro.completed` 立即 flush |
| 退出 | `beforeunload`（Web）/ Tauri 关闭钩子 同步 flush |

`flush()` 通过 `DataAdapter.insertEvents(events[])` 一次性事务批写。

### 4.5 Session

- 启动时 `session.ts` 生成 `s-<uid>`，挂在内存
- 闲置 30 分钟（无 track 调用）后下次 track 自动起新 session
- 仅内存保存，不持久化

### 4.6 漏埋兜底（开发期工具）

- Registry 在 dev 模式提供 `verifyCoverage()`：列出 store 每个 action 是否在 mapping，缺的 console.warn
- 仅开发期使用，不上线检测

## 5. 数据层

### 5.1 DataAdapter 扩展

```ts
export interface DataAdapter {
  // ... 原有方法

  insertEvents(events: AnalyticsEvent[]): Promise<void>;
  queryEvents(filter: EventFilter): Promise<AnalyticsEvent[]>;
  countEvents(filter: EventFilter, groupBy: "day" | "hour" | "type"): Promise<Array<{ key: string; count: number }>>;
}

export interface EventFilter {
  types?: string[];
  entityType?: string;
  entityId?: string;
  sessionId?: string;
  from?: string;     // occurred_at >=
  to?: string;       // occurred_at <=
  limit?: number;    // 默认 200
  offset?: number;
}

export interface AnalyticsEvent {
  id: string;
  type: string;
  occurredAt: string;
  entityType: string | null;
  entityId: string | null;
  sessionId: string;
  source: "auto" | "manual";
  props: Record<string, unknown>;  // 读时 JSON.parse, 写时 JSON.stringify
}
```

### 5.2 双端实现

| 端 | 实现 | 关键点 |
|---|---|---|
| **Web** | `src/lib/webDb/sqliteAdapter.ts` | sql.js 事务批 INSERT；写完按现有机制持久化整库到 IndexedDB |
| **Tauri** | `src-tauri/src/commands.rs` + `db.rs` | 新增 `insert_events / query_events / count_events`；rusqlite 事务；filter 参数化 SQL |

### 5.3 Schema migrate

`CREATE TABLE IF NOT EXISTS events ...` 双端写在各自 migrate 里，老用户首启自动建表，无需写 column-add 逻辑。

### 5.4 导入导出

`events` 表跟着现有 `exportDb / replaceDb` 一起走，备份与恢复天然包含事件历史。

### 5.5 SQL 示例

```sql
-- 任务添加时段分布（Stats 面板 1）
SELECT strftime('%H', occurred_at, 'localtime') AS hour, COUNT(*) AS c
FROM events WHERE type='task.created' AND occurred_at >= ? AND occurred_at < ?
GROUP BY hour ORDER BY hour;

-- 标签完成率（Stats 面板 2）
SELECT t.id, t.title,
  EXISTS(SELECT 1 FROM events e WHERE e.type='task.completed' AND e.entity_id=t.id) AS done
FROM tasks t
JOIN task_tags tt ON tt.task_id=t.id
WHERE tt.tag_id=?;

-- 改期时段分布（Stats 面板 3）
SELECT strftime('%H', occurred_at, 'localtime') AS hour, COUNT(*) AS c
FROM events WHERE type='task.rescheduled' AND occurred_at >= ? AND occurred_at < ?
GROUP BY hour ORDER BY hour;

-- 事件浏览主查询
SELECT * FROM events
WHERE (?1 IS NULL OR type IN (?1))
  AND (?2 IS NULL OR occurred_at >= ?2)
  AND (?3 IS NULL OR occurred_at <= ?3)
  AND (?4 IS NULL OR entity_id = ?4)
ORDER BY occurred_at DESC LIMIT ? OFFSET ?;
```

### 5.6 错误处理

- `insertEvents` 失败：buffer 不清空，下次 flush 重试；连续 3 次失败丢弃这批并 log，避免 buffer 无限增长
- `queryEvents` 失败：UI 显示空态 + 错误信息，不抛全局
- Tauri IPC 序列化沿用项目现有 serde camelCase 约定

## 6. 查询层 UI

### 6.1 Stats.tsx 三个新面板

在现有 KPI / 趋势图下方新增：

| 面板 | 数据源 | 展示 |
|---|---|---|
| 任务添加节奏 | `countEvents({types:['task.created'], from, to}, 'hour')` | 24 小时柱状图 |
| 标签完成率排行 | `tasks` + `task_tags` + `events: task.completed` | Top10 标签横向条形（完成数/总数） |
| 改期时段分布 | `countEvents({types:['task.rescheduled'], from, to}, 'hour')` | 24 小时柱状图 |

实现要点：

- 新增 `useEventStats(range)` hook：调 adapter 接口，结果在组件 state（不进 zustand —— 派生数据只读）
- 加载态独立 spinner 区块，不影响其他 KPI
- 失败时该面板"加载失败"占位，整页继续可用
- 复用现有 `RangeKey`（7d/30d/month/year）

业务结果指标（完成数、番茄时长等）继续用现有内存数据，不走 events —— 它们更准更快；events 主要服务 B/C 类问题。

### 6.2 事件浏览：作为 `/data` 第 4 个 tab

DataPage 现有 tabs：任务 / 标签 / 番茄 → 新增 **事件**。

- 新组件 `routes/data/tables/EventsTable.tsx`
- URL state 扩展 `useDataUrlState`：`tab` 增加 `events`
- 顶部过滤栏：类型多选（按域分组）+ 日期范围（默认今天）+ entity_id 搜索框 + 刷新按钮
- 行展示：折叠态 `时间 / 类型 / entity_type:entity_id`；点击展开看完整 props（JSON 格式化）
- 行内跳转：`entity_type=task` 时右侧加按钮跳到任务编辑器（复用现有 `TaskEditor`）
- 分页：每页 200，"加载更多"追加
- 总数：单独调 `countEvents` 求和，与列表查询解耦

不做实时刷新，靠手动按钮 —— 这是个排查工具，不是监控大盘。

## 7. 实施分阶段

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P1 数据层** | events 表双端 schema + DataAdapter 接口 + Web/Tauri 实现 + IPC commands | 单测：批量 insert + 多 filter 查询；导出导入带 events |
| **P2 埋点层** | registry / track / buffer / session / withTracking + 单测 | 单测全过；dev 手动 track 能在 DB 看到行 |
| **P3 接入** | 4 个 store 接 middleware；UI 关键点显式 track（路由 enter / popover open / search / export-import / app launched） | 主路径跑一遍，DB 事件齐全；对照 registry 逐项核查 |
| **P4 查询 UI** | Stats 三新面板 + DataPage events tab | 真机操作产生事件后三张图能反映、事件列表能过滤 |

每阶段独立可验收，不要求一次合大 PR。

## 8. 已知风险与未决项

1. **库体积增长**：A+B+C 全量埋点长期累积可观。当前不做老化，依赖现有 `clearAll()`；若半年后 events 体积超 50MB，再加 `events.cleanupBefore(date)` 接口
2. **props 命名漂移**：JSON 字段没有运行时校验。靠 `registry.ts` TS 强类型 + dev 模式 `verifyCoverage()` 兜底，不上 prod 校验
3. **隐私**：事件可能带敏感字段。约定：
   - **不写明文 task title**，只写 `entity_id`
   - 搜索查询只记 `queryLength`，不记内容
   - 这些约束写进 `registry.ts` 注释，作为新事件接入时的检查项
4. **session 超时阈值**：30 分钟空闲是经验值，可在 `session.ts` 顶部常量调整

## 9. 不做的事

- 远程上报 / 跨设备聚合
- 自由 SQL 控制台（C 选项的查询界面）
- 实时刷新 / 推送
- 重排期任务排行（用户偏好换成"改期时段分布"）
- 运行时 props schema 校验
- 事件归档/老化（先观察体积再决定）
