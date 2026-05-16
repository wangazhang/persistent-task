# 事件埋点系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为持续任务双端（Tauri + Web）增加统一的本地事件埋点系统，支持行为/UI 分析与历史查询。

**Architecture:** 单表 `events`（双端 SQLite, schema 同步）+ TS analytics 层（`registry / track / buffer / session / withTracking`）+ Stats 三个新面板 + DataPage 第 4 个 tab `events`。

**Tech Stack:** TypeScript + React + Zustand + react-router + Tauri (Rust/rusqlite) + sql.js（已有）；测试用项目自有的 `npx tsx __<name>.test.ts` 模式（手写 `eq()` 断言，参考 `src/lib/__dateRange.test.ts`）。

**Spec:** `docs/superpowers/specs/2026-05-16-analytics-events-design.md`

---

## P1 数据层

### Task 1: 定义 analytics 类型

**Files:**
- Create: `src/lib/analytics/types.ts`

- [ ] **Step 1: 创建类型文件**

```ts
// src/lib/analytics/types.ts
/**
 * 一条已定型的事件记录（落库前/读出后的统一形态）。
 */
export interface AnalyticsEvent {
  id: string;
  type: string;
  /** ISO8601 本地时间，例如 2026-05-16T10:23:11+08:00 */
  occurredAt: string;
  entityType: string | null;
  entityId: string | null;
  sessionId: string;
  source: "auto" | "manual";
  /** 自由 JSON;读出时已 parse,写入时由适配层 stringify */
  props: Record<string, unknown>;
}

export interface EventFilter {
  types?: string[];
  entityType?: string;
  entityId?: string;
  sessionId?: string;
  /** ISO8601, 包含 */
  from?: string;
  /** ISO8601, 包含 */
  to?: string;
  /** 默认 200, 最大 2000 */
  limit?: number;
  offset?: number;
}

export type EventGroupBy = "day" | "hour" | "type";

export interface EventCountRow {
  /** day: 'YYYY-MM-DD' / hour: '00'..'23' / type: 事件 type */
  key: string;
  count: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/analytics/types.ts
git commit -m "feat(analytics): add AnalyticsEvent / EventFilter types"
```

---

### Task 2: Web 端 schema 加 events 表

**Files:**
- Modify: `src/lib/webDb/schema.ts`

- [ ] **Step 1: 在 SCHEMA_SQL 末尾追加 events 表 DDL**

打开 `src/lib/webDb/schema.ts`，在反引号字符串结尾的 `\`;\`` 之前追加：

```sql

CREATE TABLE IF NOT EXISTS events (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL,
    occurred_at  TEXT NOT NULL,
    entity_type  TEXT,
    entity_id    TEXT,
    session_id   TEXT NOT NULL,
    source       TEXT NOT NULL,
    props        TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_events_type      ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_occurred  ON events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_entity    ON events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_events_session   ON events(session_id);
```

- [ ] **Step 2: 启动 dev,验证表已建**

```bash
npm run dev
```

打开浏览器 devtools，进入 IndexedDB → 找到项目库；或在 console 跑：

```js
// 应能看到 events 在 sqlite_master 里
window.__webDb?.exec?.("SELECT name FROM sqlite_master WHERE type='table'")
```

如未暴露 `__webDb`，跳过该校验，靠后续 Task 的端到端测试兜底。

- [ ] **Step 3: Commit**

```bash
git add src/lib/webDb/schema.ts
git commit -m "feat(db): add events table to web schema"
```

---

### Task 3: Tauri 端 schema 加 events 表

**Files:**
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: 在 migrate 的 execute_batch 末尾加 events DDL**

打开 `src-tauri/src/db.rs`，找到 `migrate` 函数里的 `execute_batch(r#" ... "#)` 块；在 raw string 结束 `"#` 之前、所有现有 DDL 之后追加：

```sql

            -- 事件埋点（与 src/lib/webDb/schema.ts 保持同步）
            CREATE TABLE IF NOT EXISTS events (
                id           TEXT PRIMARY KEY,
                type         TEXT NOT NULL,
                occurred_at  TEXT NOT NULL,
                entity_type  TEXT,
                entity_id    TEXT,
                session_id   TEXT NOT NULL,
                source       TEXT NOT NULL,
                props        TEXT NOT NULL DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS idx_events_type      ON events(type);
            CREATE INDEX IF NOT EXISTS idx_events_occurred  ON events(occurred_at);
            CREATE INDEX IF NOT EXISTS idx_events_entity    ON events(entity_type, entity_id);
            CREATE INDEX IF NOT EXISTS idx_events_session   ON events(session_id);
```

- [ ] **Step 2: 编译通过**

```bash
cd src-tauri && cargo check
```

预期：`Finished` 无报错。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat(db): add events table to tauri schema"
```

---

### Task 4: 扩展 DataAdapter 接口

**Files:**
- Modify: `src/lib/dataAdapter.ts`

- [ ] **Step 1: 在 import 区域加 analytics 类型**

在 `import type { ... } from "./types";` 下面新增：

```ts
import type {
  AnalyticsEvent,
  EventCountRow,
  EventFilter,
  EventGroupBy,
} from "./analytics/types";
```

- [ ] **Step 2: 在 DataAdapter 接口末尾(replaceDb 之后)加三个方法**

```ts
  // events
  insertEvents(events: AnalyticsEvent[]): Promise<void>;
  queryEvents(filter: EventFilter): Promise<AnalyticsEvent[]>;
  countEvents(
    filter: EventFilter,
    groupBy: EventGroupBy
  ): Promise<EventCountRow[]>;
```

- [ ] **Step 3: TauriAdapter 类里加三个方法实现**

在 `replaceDb(...)` 之后追加：

```ts
  insertEvents(events: AnalyticsEvent[]) {
    return this.invoke<void>("insert_events", { events });
  }
  queryEvents(filter: EventFilter) {
    return this.invoke<AnalyticsEvent[]>("query_events", { filter });
  }
  countEvents(filter: EventFilter, groupBy: EventGroupBy) {
    return this.invoke<EventCountRow[]>("count_events", { filter, groupBy });
  }
```

- [ ] **Step 4: TypeScript 编译通过**

```bash
npx tsc --noEmit
```

预期：报"SqliteAdapter 没实现新方法"等错误（下一个 Task 修复），TauriAdapter 自身不报错。

- [ ] **Step 5: Commit**

```bash
git add src/lib/dataAdapter.ts
git commit -m "feat(adapter): extend DataAdapter with events APIs"
```

---

### Task 5: Web SqliteAdapter 实现 events 三方法

**Files:**
- Modify: `src/lib/webDb/sqliteAdapter.ts`

- [ ] **Step 1: 在 import 区域追加 analytics 类型**

文件顶部 `import type { ... } from "../types";` 下面：

```ts
import type {
  AnalyticsEvent,
  EventCountRow,
  EventFilter,
  EventGroupBy,
} from "../analytics/types";
```

- [ ] **Step 2: 在文件靠下方 row 转换辅助函数区域加 rowToEvent**

紧跟 `rowToPomodoro` 之后：

```ts
function rowToEvent(r: Row): AnalyticsEvent {
  let props: Record<string, unknown> = {};
  try {
    props = JSON.parse(s(r.props) || "{}");
  } catch {
    props = {};
  }
  return {
    id: s(r.id),
    type: s(r.type),
    occurredAt: s(r.occurred_at),
    entityType: (r.entity_type as string | null) ?? null,
    entityId: (r.entity_id as string | null) ?? null,
    sessionId: s(r.session_id),
    source: (s(r.source) === "auto" ? "auto" : "manual"),
    props,
  };
}
```

- [ ] **Step 3: 在 SqliteAdapter 类实现末尾(replaceDb 之后)加三个方法**

```ts
  async insertEvents(events: AnalyticsEvent[]): Promise<void> {
    if (events.length === 0) return;
    await tx(() => {
      for (const e of events) {
        run(
          `INSERT OR REPLACE INTO events
             (id,type,occurred_at,entity_type,entity_id,session_id,source,props)
           VALUES (?,?,?,?,?,?,?,?)`,
          [
            e.id,
            e.type,
            e.occurredAt,
            e.entityType,
            e.entityId,
            e.sessionId,
            e.source,
            JSON.stringify(e.props ?? {}),
          ]
        );
      }
    });
  }

  async queryEvents(filter: EventFilter): Promise<AnalyticsEvent[]> {
    const { sql, args } = buildEventWhere(filter);
    const limit = Math.min(Math.max(filter.limit ?? 200, 1), 2000);
    const offset = Math.max(filter.offset ?? 0, 0);
    const rows = query<Row>(
      `SELECT id,type,occurred_at,entity_type,entity_id,session_id,source,props
         FROM events
         ${sql}
         ORDER BY occurred_at DESC, id DESC
         LIMIT ${limit} OFFSET ${offset}`,
      args
    );
    return rows.map(rowToEvent);
  }

  async countEvents(
    filter: EventFilter,
    groupBy: EventGroupBy
  ): Promise<EventCountRow[]> {
    const { sql, args } = buildEventWhere(filter);
    const keyExpr =
      groupBy === "day"
        ? `strftime('%Y-%m-%d', occurred_at, 'localtime')`
        : groupBy === "hour"
        ? `strftime('%H', occurred_at, 'localtime')`
        : `type`;
    const rows = query<Row>(
      `SELECT ${keyExpr} AS k, COUNT(*) AS c
         FROM events
         ${sql}
         GROUP BY ${keyExpr}
         ORDER BY ${keyExpr} ASC`,
      args
    );
    return rows.map((r) => ({ key: s(r.k), count: n(r.c) }));
  }
```

- [ ] **Step 4: 在文件底部加 buildEventWhere 工具函数**

```ts
/**
 * 把 EventFilter 拼成 WHERE 子句 + 参数数组，给 query/count 共用。
 * 空 filter 返回空 sql。
 */
function buildEventWhere(filter: EventFilter): { sql: string; args: unknown[] } {
  const conds: string[] = [];
  const args: unknown[] = [];
  if (filter.types && filter.types.length > 0) {
    conds.push(
      `type IN (${filter.types.map(() => "?").join(",")})`
    );
    args.push(...filter.types);
  }
  if (filter.entityType) {
    conds.push("entity_type = ?");
    args.push(filter.entityType);
  }
  if (filter.entityId) {
    conds.push("entity_id = ?");
    args.push(filter.entityId);
  }
  if (filter.sessionId) {
    conds.push("session_id = ?");
    args.push(filter.sessionId);
  }
  if (filter.from) {
    conds.push("occurred_at >= ?");
    args.push(filter.from);
  }
  if (filter.to) {
    conds.push("occurred_at <= ?");
    args.push(filter.to);
  }
  return {
    sql: conds.length === 0 ? "" : `WHERE ${conds.join(" AND ")}`,
    args,
  };
}
```

- [ ] **Step 5: TypeScript 编译通过**

```bash
npx tsc --noEmit
```

预期：通过。

- [ ] **Step 6: Commit**

```bash
git add src/lib/webDb/sqliteAdapter.ts
git commit -m "feat(adapter): implement events APIs on web SqliteAdapter"
```

---

### Task 6: Tauri models.rs 加 Event 结构

**Files:**
- Modify: `src-tauri/src/models.rs`

- [ ] **Step 1: 在文件末尾追加 Event/EventFilter 类型**

```rust
// ────────────────────────────────────────────────────────────────
// Analytics Events
// ────────────────────────────────────────────────────────────────

/// 事件来源：auto = store 中间件自动产出；manual = 显式 track() 调用
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EventSource {
    Auto,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsEvent {
    pub id: String,
    pub r#type: String,
    pub occurred_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<String>,
    pub session_id: String,
    pub source: EventSource,
    /// 任意 JSON 对象;前端约定 stringify 后传入
    pub props: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EventFilter {
    #[serde(default)]
    pub types: Option<Vec<String>>,
    #[serde(default)]
    pub entity_type: Option<String>,
    #[serde(default)]
    pub entity_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventGroupBy {
    Day,
    Hour,
    Type,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventCountRow {
    pub key: String,
    pub count: i64,
}
```

- [ ] **Step 2: 编译通过**

```bash
cd src-tauri && cargo check
```

预期：可能报缺 `serde_json` —— 在 `src-tauri/Cargo.toml` 的 `[dependencies]` 加：

```toml
serde_json = "1"
```

再 `cargo check` 直到通过。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(models): add AnalyticsEvent / EventFilter structs"
```

---

### Task 7: Tauri commands.rs 加 events 三个命令

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: 在文件 use 区追加导入**

```rust
use crate::models::{
    AnalyticsEvent, EventCountRow, EventFilter, EventGroupBy, EventSource,
};
```

（保留原有 `use crate::models::{...}` 改为合并行；如已存在 models 导入，把新类型追加进去即可。）

- [ ] **Step 2: 在文件末尾追加三个命令**

```rust
// ────────────────────────────────────────────────────────────────
// Events
// ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn insert_events(
    state: State<AppState>,
    events: Vec<AnalyticsEvent>,
) -> Result<(), String> {
    if events.is_empty() {
        return Ok(());
    }
    let mut conn = state.conn.lock();
    let tx = conn.transaction().map_err(to_err)?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT OR REPLACE INTO events \
                 (id,type,occurred_at,entity_type,entity_id,session_id,source,props) \
                 VALUES (?,?,?,?,?,?,?,?)",
            )
            .map_err(to_err)?;
        for e in &events {
            let source_str = match e.source {
                EventSource::Auto => "auto",
                EventSource::Manual => "manual",
            };
            let props_json = serde_json::to_string(&e.props).map_err(to_err)?;
            stmt.execute(params![
                e.id,
                e.r#type,
                e.occurred_at,
                e.entity_type,
                e.entity_id,
                e.session_id,
                source_str,
                props_json,
            ])
            .map_err(to_err)?;
        }
    }
    tx.commit().map_err(to_err)?;
    Ok(())
}

#[tauri::command]
pub fn query_events(
    state: State<AppState>,
    filter: EventFilter,
) -> Result<Vec<AnalyticsEvent>, String> {
    let conn = state.conn.lock();
    let (where_sql, params_vec) = build_event_where(&filter);
    let limit = filter.limit.unwrap_or(200).clamp(1, 2000);
    let offset = filter.offset.unwrap_or(0).max(0);
    let sql = format!(
        "SELECT id,type,occurred_at,entity_type,entity_id,session_id,source,props \
         FROM events {} ORDER BY occurred_at DESC, id DESC LIMIT {} OFFSET {}",
        where_sql, limit, offset
    );
    let mut stmt = conn.prepare(&sql).map_err(to_err)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params_vec.iter()), |row| {
            let source: String = row.get(6)?;
            let props_str: String = row.get(7)?;
            let props: serde_json::Value =
                serde_json::from_str(&props_str).unwrap_or(serde_json::json!({}));
            Ok(AnalyticsEvent {
                id: row.get(0)?,
                r#type: row.get(1)?,
                occurred_at: row.get(2)?,
                entity_type: row.get(3)?,
                entity_id: row.get(4)?,
                session_id: row.get(5)?,
                source: if source == "auto" {
                    EventSource::Auto
                } else {
                    EventSource::Manual
                },
                props,
            })
        })
        .map_err(to_err)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(to_err)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn count_events(
    state: State<AppState>,
    filter: EventFilter,
    group_by: EventGroupBy,
) -> Result<Vec<EventCountRow>, String> {
    let conn = state.conn.lock();
    let (where_sql, params_vec) = build_event_where(&filter);
    let key_expr = match group_by {
        EventGroupBy::Day => "strftime('%Y-%m-%d', occurred_at, 'localtime')",
        EventGroupBy::Hour => "strftime('%H', occurred_at, 'localtime')",
        EventGroupBy::Type => "type",
    };
    let sql = format!(
        "SELECT {k} AS k, COUNT(*) AS c FROM events {w} GROUP BY {k} ORDER BY {k} ASC",
        k = key_expr,
        w = where_sql
    );
    let mut stmt = conn.prepare(&sql).map_err(to_err)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params_vec.iter()), |row| {
            Ok(EventCountRow {
                key: row.get::<_, String>(0)?,
                count: row.get::<_, i64>(1)?,
            })
        })
        .map_err(to_err)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(to_err)?);
    }
    Ok(out)
}

/// 把 EventFilter 拼成 WHERE 与参数列表（与 web 端 buildEventWhere 语义一致）
fn build_event_where(filter: &EventFilter) -> (String, Vec<String>) {
    let mut conds: Vec<String> = Vec::new();
    let mut args: Vec<String> = Vec::new();
    if let Some(ts) = &filter.types {
        if !ts.is_empty() {
            let placeholders = ts.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            conds.push(format!("type IN ({})", placeholders));
            for t in ts {
                args.push(t.clone());
            }
        }
    }
    if let Some(v) = &filter.entity_type {
        conds.push("entity_type = ?".into());
        args.push(v.clone());
    }
    if let Some(v) = &filter.entity_id {
        conds.push("entity_id = ?".into());
        args.push(v.clone());
    }
    if let Some(v) = &filter.session_id {
        conds.push("session_id = ?".into());
        args.push(v.clone());
    }
    if let Some(v) = &filter.from {
        conds.push("occurred_at >= ?".into());
        args.push(v.clone());
    }
    if let Some(v) = &filter.to {
        conds.push("occurred_at <= ?".into());
        args.push(v.clone());
    }
    if conds.is_empty() {
        ("".into(), args)
    } else {
        (format!("WHERE {}", conds.join(" AND ")), args)
    }
}
```

- [ ] **Step 3: 编译通过**

```bash
cd src-tauri && cargo check
```

预期：通过。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(commands): add insert_events / query_events / count_events"
```

---

### Task 8: 在 lib.rs 注册新命令

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 在 invoke_handler! 列表里追加三项**

打开 `src-tauri/src/lib.rs`，找到 `tauri::generate_handler![ ... ]`，在 `commands::replace_db,` 后面增加：

```rust
            commands::insert_events,
            commands::query_events,
            commands::count_events,
```

- [ ] **Step 2: 编译通过**

```bash
cd src-tauri && cargo build
```

预期：`Finished` 无报错。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(tauri): register events commands"
```

---

### Task 9: 数据层端到端冒烟测试

**Files:**
- Create: `src/lib/analytics/__adapter.smoke.test.ts`

- [ ] **Step 1: 写冒烟测试（Web 适配器,在 jsdom 之外不易跑;改用启动后控制台脚本）**

由于 Web sql.js 需要浏览器环境，新建一个**手动冒烟脚本**而不是 tsx 单测：

```ts
// src/lib/analytics/__adapter.smoke.test.ts
// 用法：
//   1) npm run dev
//   2) 浏览器打开任意页面,在 console 跑:
//        import('/src/lib/analytics/__adapter.smoke.test.ts').then(m => m.run())
import { initAdapter, getAdapter } from "@/lib/dataAdapter";
import type { AnalyticsEvent } from "@/lib/analytics/types";

export async function run(): Promise<void> {
  await initAdapter();
  const adapter = getAdapter();

  const now = new Date().toISOString();
  const e1: AnalyticsEvent = {
    id: "smoke-1",
    type: "task.created",
    occurredAt: now,
    entityType: "task",
    entityId: "t-smoke",
    sessionId: "s-smoke",
    source: "manual",
    props: { priority: "p1", smoke: true },
  };
  const e2: AnalyticsEvent = {
    ...e1,
    id: "smoke-2",
    type: "task.completed",
    occurredAt: now,
  };

  await adapter.insertEvents([e1, e2]);

  const queried = await adapter.queryEvents({
    types: ["task.created", "task.completed"],
    entityId: "t-smoke",
  });
  console.log("[smoke] queried:", queried);
  if (queried.length !== 2) throw new Error("expect 2 events");

  const counts = await adapter.countEvents(
    { entityId: "t-smoke" },
    "type"
  );
  console.log("[smoke] counts:", counts);
  if (counts.length !== 2) throw new Error("expect 2 type buckets");

  console.log("✓ analytics adapter smoke test passed");
}
```

- [ ] **Step 2: 跑一次 Web 端冒烟（浏览器 console）**

```bash
npm run dev
```

按文件顶部说明在浏览器 console 调用 `run()`，确认输出 `✓ analytics adapter smoke test passed`。

- [ ] **Step 3: 跑一次 Tauri 端冒烟**

```bash
npm run tauri:dev
```

同样在 webview console 调用 `run()`。预期同样通过；如果 Tauri 报命令未注册，回到 Task 8 检查。

- [ ] **Step 4: Commit**

```bash
git add src/lib/analytics/__adapter.smoke.test.ts
git commit -m "test(analytics): add data layer smoke script"
```

---

## P2 埋点层

### Task 10: registry.ts — 事件类型与 props 类型

**Files:**
- Create: `src/lib/analytics/registry.ts`

- [ ] **Step 1: 写 EventMap + 工具函数**

```ts
// src/lib/analytics/registry.ts
/**
 * 事件 registry。
 *
 * 隐私约定（接入新事件时必读）：
 *   - 不写明文 task title,只写 entity_id
 *   - 搜索查询只记 queryLength,不记内容
 *   - props 中如出现 url,只记 host,不记 path/query
 */

import type { TaskPriority } from "../types";

export type EventMap = {
  // task domain
  "task.created":           { taskId: string; priority: TaskPriority; tagIds: string[]; hasDoc: boolean };
  "task.updated":           { taskId: string; fields: string[] };
  "task.completed":         { taskId: string };
  "task.uncompleted":       { taskId: string };
  "task.deleted":           { taskId: string };
  "task.scheduled":         { taskId: string; date: string };
  "task.unscheduled":       { taskId: string; date: string };
  "task.rescheduled":       { taskId: string; fromDate: string; toDate: string; mode: "move" | "add" | "replace" };
  "task.tagged":            { taskId: string; tagId: string };
  "task.untagged":          { taskId: string; tagId: string };
  "task.priority_changed":  { taskId: string; from: TaskPriority; to: TaskPriority };
  "task.reordered":         { date: string; count: number };

  // pomodoro domain
  "pomodoro.started":       { taskId?: string; type: "focus" | "short_break" | "long_break" };
  "pomodoro.completed":     { taskId?: string; type: "focus" | "short_break" | "long_break"; durationSec: number };
  "pomodoro.cancelled":     { taskId?: string; type: "focus" | "short_break" | "long_break"; elapsedSec: number };

  // tag domain
  "tag.created":            { tagId: string; parentId: string | null; color: string };
  "tag.renamed":            { tagId: string };
  "tag.deleted":            { tagId: string; cascadeCount: number };
  "tag.moved":              { tagId: string; newParentId: string | null };

  // ui domain
  "ui.route.enter":         { route: string };
  "ui.dialog.open":         { dialog: string };
  "ui.popover.open":        { popover: string; date?: string };
  "ui.search.used":         { queryLength: number };
  "ui.export":              { kind: "db" };
  "ui.import":              { kind: "db" };

  // app domain
  "app.launched":           { platform: "tauri" | "web" };
  "app.hydrated":           { platform: "tauri" | "web"; durationMs: number };
};

export type EventType = keyof EventMap;

export const KNOWN_TYPES: EventType[] = [
  "task.created", "task.updated", "task.completed", "task.uncompleted",
  "task.deleted", "task.scheduled", "task.unscheduled", "task.rescheduled",
  "task.tagged", "task.untagged", "task.priority_changed", "task.reordered",
  "pomodoro.started", "pomodoro.completed", "pomodoro.cancelled",
  "tag.created", "tag.renamed", "tag.deleted", "tag.moved",
  "ui.route.enter", "ui.dialog.open", "ui.popover.open", "ui.search.used",
  "ui.export", "ui.import",
  "app.launched", "app.hydrated",
];

const KNOWN_SET = new Set<string>(KNOWN_TYPES);

export function isKnownType(t: string): t is EventType {
  return KNOWN_SET.has(t);
}

/**
 * 从 props 抽出 (entity_type, entity_id),约定字段名：
 *   taskId   -> ('task', value)
 *   tagId    -> ('tag', value)
 *   route    -> ('route', value)
 *   popover  -> ('popover', value)
 *   dialog   -> ('dialog', value)
 * 都没命中则返回 (null, null)。
 */
export function entityFromProps(
  props: Record<string, unknown>
): { entityType: string | null; entityId: string | null } {
  const pairs: Array<[string, string]> = [
    ["taskId", "task"],
    ["tagId", "tag"],
    ["route", "route"],
    ["popover", "popover"],
    ["dialog", "dialog"],
  ];
  for (const [key, type] of pairs) {
    const v = props[key];
    if (typeof v === "string" && v.length > 0) {
      return { entityType: type, entityId: v };
    }
  }
  return { entityType: null, entityId: null };
}
```

- [ ] **Step 2: 写单测**

Create: `src/lib/analytics/__registry.test.ts`

```ts
// src/lib/analytics/__registry.test.ts
// 用法：npx tsx src/lib/analytics/__registry.test.ts
import { entityFromProps, isKnownType, KNOWN_TYPES } from "./registry";

let fail = 0;
function eq<T>(label: string, got: T, expect: T) {
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) {
    console.log("  got:   ", got);
    console.log("  expect:", expect);
    fail++;
  }
}

eq("isKnownType true",  isKnownType("task.created"), true);
eq("isKnownType false", isKnownType("nope.event"),   false);
eq("KNOWN_TYPES non-empty", KNOWN_TYPES.length > 20, true);

eq(
  "entityFromProps taskId",
  entityFromProps({ taskId: "t-1", foo: 2 }),
  { entityType: "task", entityId: "t-1" }
);
eq(
  "entityFromProps tagId",
  entityFromProps({ tagId: "g-1" }),
  { entityType: "tag", entityId: "g-1" }
);
eq(
  "entityFromProps route",
  entityFromProps({ route: "year" }),
  { entityType: "route", entityId: "year" }
);
eq(
  "entityFromProps fallback",
  entityFromProps({ misc: 1 }),
  { entityType: null, entityId: null }
);

if (fail > 0) {
  console.log(`\n✗ ${fail} test(s) failed`);
  process.exit(1);
}
console.log("\n✓ all passed");
```

- [ ] **Step 3: 跑测试,确认失败（registry.ts 不存在）**

```bash
npx tsx src/lib/analytics/__registry.test.ts
```

预期：会因为 `import "./registry"` 找不到而失败 —— 这一步实际是等 Step 1 文件已写好后跑通过。**注意：把 Step 1 的文件先建好再跑这个 Step 3。**

预期最终输出：`✓ all passed`。

- [ ] **Step 4: Commit**

```bash
git add src/lib/analytics/registry.ts src/lib/analytics/__registry.test.ts
git commit -m "feat(analytics): add event registry + entity extraction"
```

---

### Task 11: session.ts — sessionId 生成与续期

**Files:**
- Create: `src/lib/analytics/session.ts`
- Create: `src/lib/analytics/__session.test.ts`

- [ ] **Step 1: 写测试（先写,失败,后实现）**

```ts
// src/lib/analytics/__session.test.ts
// 用法：npx tsx src/lib/analytics/__session.test.ts
import { createSessionManager } from "./session";

let fail = 0;
function eq<T>(label: string, got: T, expect: T) {
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) { console.log("  got:", got, "\n  expect:", expect); fail++; }
}
function ok(label: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) fail++;
}

// 可控时钟 + 可控 idle 阈值
let now = 1_000_000;
const mgr = createSessionManager({ idleMs: 30 * 60 * 1000, now: () => now });

const id1 = mgr.touch();
ok("first touch returns id", typeof id1 === "string" && id1.length > 0);

now += 1000;
const id2 = mgr.touch();
eq("within idle: same id", id2, id1);

now += 30 * 60 * 1000 + 1; // 超过 30 分钟
const id3 = mgr.touch();
ok("after idle: new id", id3 !== id1);

if (fail > 0) { console.log(`\n✗ ${fail} failed`); process.exit(1); }
console.log("\n✓ all passed");
```

- [ ] **Step 2: 跑测试,确认失败**

```bash
npx tsx src/lib/analytics/__session.test.ts
```

预期：`Cannot find module './session'`。

- [ ] **Step 3: 实现 session.ts**

```ts
// src/lib/analytics/session.ts
import { uid } from "../utils";

export interface SessionManager {
  /** 标记一次活动；如距上次活动超过 idleMs 则起新 session */
  touch(): string;
  /** 当前 session id（不更新 lastTouch） */
  current(): string;
}

export interface SessionOptions {
  /** 闲置阈值,默认 30 分钟 */
  idleMs?: number;
  /** 注入时钟,便于测试 */
  now?: () => number;
}

export function createSessionManager(opts: SessionOptions = {}): SessionManager {
  const idleMs = opts.idleMs ?? 30 * 60 * 1000;
  const now = opts.now ?? (() => Date.now());

  let id: string = `s-${uid()}`;
  let last: number = now();

  return {
    touch() {
      const t = now();
      if (t - last > idleMs) {
        id = `s-${uid()}`;
      }
      last = t;
      return id;
    },
    current() {
      return id;
    },
  };
}

/** 全局单例（生产用） */
export const sessionManager: SessionManager = createSessionManager();
```

- [ ] **Step 4: 跑测试,确认通过**

```bash
npx tsx src/lib/analytics/__session.test.ts
```

预期：`✓ all passed`。

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/session.ts src/lib/analytics/__session.test.ts
git commit -m "feat(analytics): add session manager with idle-renew"
```

---

### Task 12: buffer.ts — 内存队列 + flush 策略

**Files:**
- Create: `src/lib/analytics/buffer.ts`
- Create: `src/lib/analytics/__buffer.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/lib/analytics/__buffer.test.ts
// 用法：npx tsx src/lib/analytics/__buffer.test.ts
import { createBuffer } from "./buffer";
import type { AnalyticsEvent } from "./types";

let fail = 0;
function eq<T>(label: string, got: T, expect: T) {
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) { console.log("  got:", got, "\n  expect:", expect); fail++; }
}
function ok(label: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) fail++;
}

function mkEvent(id: string, type = "ui.route.enter"): AnalyticsEvent {
  return {
    id, type,
    occurredAt: new Date().toISOString(),
    entityType: null, entityId: null,
    sessionId: "s-test", source: "manual", props: {},
  };
}

async function run() {
  // 1) 阈值触发：达 50 条立即 flush
  {
    const written: AnalyticsEvent[][] = [];
    const buf = createBuffer({
      threshold: 3,
      intervalMs: 60_000,
      writer: async (batch) => { written.push(batch); },
    });
    buf.push(mkEvent("a"));
    buf.push(mkEvent("b"));
    eq("not flushed yet", written.length, 0);
    buf.push(mkEvent("c"));
    // 微任务排空
    await new Promise(r => setTimeout(r, 10));
    eq("threshold flushed", written.length, 1);
    eq("batch size", written[0]!.length, 3);
  }

  // 2) 关键事件立即 flush
  {
    const written: AnalyticsEvent[][] = [];
    const buf = createBuffer({
      threshold: 50,
      intervalMs: 60_000,
      writer: async (b) => { written.push(b); },
      criticalTypes: new Set(["app.launched"]),
    });
    buf.push(mkEvent("k", "app.launched"));
    await new Promise(r => setTimeout(r, 10));
    eq("critical flushed", written.length, 1);
  }

  // 3) flushNow 强制
  {
    const written: AnalyticsEvent[][] = [];
    const buf = createBuffer({
      threshold: 50, intervalMs: 60_000,
      writer: async (b) => { written.push(b); },
    });
    buf.push(mkEvent("x"));
    await buf.flushNow();
    eq("flushNow worked", written.length, 1);
  }

  // 4) writer 失败 3 次后丢弃,buffer 不无限增长
  {
    const calls: number[] = [];
    let attempt = 0;
    const buf = createBuffer({
      threshold: 1, intervalMs: 60_000,
      writer: async () => { attempt++; calls.push(attempt); throw new Error("boom"); },
      maxRetries: 3,
    });
    buf.push(mkEvent("e"));
    await new Promise(r => setTimeout(r, 10));
    // 触发了重试,但最终丢弃
    ok("attempted >=1 time", calls.length >= 1);
    ok("buffer drained after maxRetries", buf.size() === 0);
  }

  if (fail > 0) { console.log(`\n✗ ${fail} failed`); process.exit(1); }
  console.log("\n✓ all passed");
}
run();
```

- [ ] **Step 2: 跑测试,确认失败**

```bash
npx tsx src/lib/analytics/__buffer.test.ts
```

预期：`Cannot find module './buffer'`。

- [ ] **Step 3: 实现 buffer.ts**

```ts
// src/lib/analytics/buffer.ts
import type { AnalyticsEvent } from "./types";

export interface BufferOptions {
  /** 满 threshold 条立即 flush */
  threshold?: number;
  /** 每 intervalMs 检查一次 */
  intervalMs?: number;
  /** 实际写库函数（一次一批，事务里跑） */
  writer: (batch: AnalyticsEvent[]) => Promise<void>;
  /** 命中即立即 flush 的事件类型 */
  criticalTypes?: Set<string>;
  /** writer 连续失败几次后丢弃这批,默认 3 */
  maxRetries?: number;
}

export interface Buffer {
  push(e: AnalyticsEvent): void;
  /** 立刻把当前 buffer 中的事件全部写入 */
  flushNow(): Promise<void>;
  /** 当前队列长度 */
  size(): number;
  /** 关闭定时器 */
  dispose(): void;
}

export function createBuffer(opts: BufferOptions): Buffer {
  const threshold = opts.threshold ?? 50;
  const intervalMs = opts.intervalMs ?? 2000;
  const maxRetries = opts.maxRetries ?? 3;
  const critical = opts.criticalTypes ?? new Set<string>();

  const queue: AnalyticsEvent[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let retryCount = 0;

  const ensureTimer = () => {
    if (timer != null) return;
    timer = setInterval(() => {
      if (queue.length > 0) void flushOnce();
    }, intervalMs);
    // Node/Deno 下可被 unref;浏览器无此函数
    // @ts-expect-error optional unref
    timer?.unref?.();
  };

  async function flushOnce(): Promise<void> {
    if (inFlight) return;
    if (queue.length === 0) return;
    inFlight = true;
    const batch = queue.splice(0, queue.length);
    try {
      await opts.writer(batch);
      retryCount = 0;
    } catch (err) {
      retryCount++;
      // 失败时把 batch 退回队首,等下次再试;超过 maxRetries 则丢弃
      if (retryCount < maxRetries) {
        queue.unshift(...batch);
        if (typeof console !== "undefined") {
          console.warn("[analytics] flush failed, will retry", err);
        }
      } else {
        if (typeof console !== "undefined") {
          console.error(
            "[analytics] flush failed after retries, dropping batch",
            { dropped: batch.length, err }
          );
        }
        retryCount = 0;
      }
    } finally {
      inFlight = false;
    }
  }

  return {
    push(e) {
      queue.push(e);
      ensureTimer();
      if (critical.has(e.type) || queue.length >= threshold) {
        // 微任务里排空,避免在 push 调用栈里同步抛错
        Promise.resolve().then(() => flushOnce());
      }
    },
    async flushNow() {
      // 最多等一轮(避免 inFlight 时直接返回)
      if (inFlight) {
        await new Promise((r) => setTimeout(r, 0));
      }
      await flushOnce();
    },
    size() {
      return queue.length;
    },
    dispose() {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
```

- [ ] **Step 4: 跑测试,确认通过**

```bash
npx tsx src/lib/analytics/__buffer.test.ts
```

预期：`✓ all passed`。

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/buffer.ts src/lib/analytics/__buffer.test.ts
git commit -m "feat(analytics): add buffered flush with retry-and-drop"
```

---

### Task 13: track + index.ts 公共 API

**Files:**
- Create: `src/lib/analytics/index.ts`

- [ ] **Step 1: 实现公共入口**

```ts
// src/lib/analytics/index.ts
/**
 * 埋点对外 API。
 *
 * 业务/UI 代码只 import { track, flushNow } from "@/lib/analytics"
 * 其他符号属内部实现,不导出。
 */
import { getAdapter } from "../dataAdapter";
import { uid } from "../utils";
import { createBuffer, type Buffer } from "./buffer";
import { entityFromProps, isKnownType, type EventMap } from "./registry";
import { sessionManager } from "./session";
import type { AnalyticsEvent } from "./types";

const CRITICAL = new Set<string>([
  "app.launched",
  "pomodoro.completed",
]);

let buffer: Buffer | null = null;

function getBuffer(): Buffer {
  if (buffer) return buffer;
  buffer = createBuffer({
    threshold: 50,
    intervalMs: 2000,
    criticalTypes: CRITICAL,
    writer: async (batch) => {
      await getAdapter().insertEvents(batch);
    },
  });
  return buffer;
}

export interface TrackOptions {
  source?: "auto" | "manual";
}

/**
 * 显式埋点入口。强类型:type 必须在 EventMap 中,props 类型严格匹配。
 *
 * 不阻塞业务,异常仅在 dev 模式 console.warn。
 */
export function track<K extends keyof EventMap>(
  type: K,
  props: EventMap[K],
  opts: TrackOptions = {}
): void {
  try {
    if (!isKnownType(type)) {
      if (import.meta.env?.DEV) {
        console.warn(`[analytics] unknown type: ${type}`);
      }
      return;
    }
    const propsObj = (props ?? {}) as Record<string, unknown>;
    const { entityType, entityId } = entityFromProps(propsObj);
    const event: AnalyticsEvent = {
      id: uid("evt-"),
      type,
      occurredAt: new Date().toISOString(),
      entityType,
      entityId,
      sessionId: sessionManager.touch(),
      source: opts.source ?? "manual",
      props: propsObj,
    };
    getBuffer().push(event);
  } catch (err) {
    if (import.meta.env?.DEV) {
      console.warn("[analytics] track() failed", err);
    }
  }
}

/** 立即把 buffer 写出（退出钩子用） */
export async function flushNow(): Promise<void> {
  if (buffer) await buffer.flushNow();
}

/** 当前 sessionId（调试用） */
export function currentSessionId(): string {
  return sessionManager.current();
}

// 重导出供 store 中间件使用
export { withTracking } from "./middleware";
export type { EventMap, EventType } from "./registry";
```

- [ ] **Step 2: TypeScript 编译通过**

```bash
npx tsc --noEmit
```

预期：报"middleware.ts 不存在"——下个 Task 创建它。先跳过此报错继续。

- [ ] **Step 3: Commit**

```bash
git add src/lib/analytics/index.ts
git commit -m "feat(analytics): add track() public API"
```

---

### Task 14: middleware.ts — withTracking 中间件

**Files:**
- Create: `src/lib/analytics/middleware.ts`
- Create: `src/lib/analytics/__middleware.test.ts`

- [ ] **Step 1: 写测试**

```ts
// src/lib/analytics/__middleware.test.ts
// 用法：npx tsx src/lib/analytics/__middleware.test.ts
import { create } from "zustand";
import { withTracking, type ActionMapping } from "./middleware";

let fail = 0;
function eq<T>(label: string, got: T, expect: T) {
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) { console.log("  got:", got, "\n  expect:", expect); fail++; }
}

interface S {
  count: number;
  inc: (by: number) => void;
  reset: () => void;
}

const tracked: Array<[string, object]> = [];

const mapping: ActionMapping<S> = {
  inc: (ret, args, { prev, next }) => [
    ["task.updated", { fields: ["count"], delta: next.count - prev.count, args }],
  ],
  // reset 不映射 → 不应产事件
};

const useStore = create<S>()(
  withTracking(mapping, {
    sink: (type, props) => tracked.push([type, props]),
  })((set) => ({
    count: 0,
    inc(by) { set((s) => ({ count: s.count + by })); },
    reset() { set({ count: 0 }); },
  }))
);

// 触发
useStore.getState().inc(3);
useStore.getState().inc(2);
useStore.getState().reset();

eq("tracked count", tracked.length, 2);
eq("tracked[0] type", tracked[0]![0], "task.updated");
eq("tracked[0] delta", (tracked[0]![1] as any).delta, 3);
eq("tracked[1] delta", (tracked[1]![1] as any).delta, 2);

if (fail > 0) { console.log(`\n✗ ${fail} failed`); process.exit(1); }
console.log("\n✓ all passed");
```

- [ ] **Step 2: 跑测试,确认失败**

```bash
npx tsx src/lib/analytics/__middleware.test.ts
```

预期：`Cannot find module './middleware'`。

- [ ] **Step 3: 实现 middleware.ts**

```ts
// src/lib/analytics/middleware.ts
import type { StateCreator } from "zustand";
import { track } from "./index";
import type { EventMap } from "./registry";

/**
 * 单个 action 的映射函数。
 *   ret  -- action 的返回值
 *   args -- action 调用参数（数组）
 *   ctx  -- { prev: 调用前 store 切片, next: 调用后 store 切片 }
 *
 * 返回 [type, props][] —— 一次 action 可发多事件,空数组表示不打点。
 */
export type ActionMapper<S, K extends keyof EventMap = keyof EventMap> = (
  ret: unknown,
  args: unknown[],
  ctx: { prev: S; next: S }
) => Array<[K, EventMap[K]]>;

export type ActionMapping<S> = {
  // 用 string 而不是 keyof S,允许写宽松
  [actionName: string]: ActionMapper<S>;
};

export interface WithTrackingOptions {
  /** 测试时注入；默认调 track() */
  sink?: <K extends keyof EventMap>(type: K, props: EventMap[K]) => void;
}

/**
 * Zustand 中间件：拦截 mapping 中列出的 action,执行后 emit 事件。
 *
 * 用法：
 *   create<S>()(withTracking(mapping)((set, get) => ({...})))
 */
export function withTracking<S extends object>(
  mapping: ActionMapping<S>,
  opts: WithTrackingOptions = {}
) {
  const sink = opts.sink ?? ((type, props) => track(type as never, props as never, { source: "auto" }));

  return (initializer: StateCreator<S, [], []>): StateCreator<S, [], []> =>
    (set, get, store) => {
      const baseState = initializer(set, get, store);
      // 遍历 baseState 的方法,凡命中 mapping 的 action 都包一层
      const wrapped: Record<string, unknown> = { ...(baseState as Record<string, unknown>) };
      for (const [name, mapper] of Object.entries(mapping)) {
        const original = (baseState as Record<string, unknown>)[name];
        if (typeof original !== "function") {
          if (import.meta.env?.DEV) {
            console.warn(`[analytics] action not found in store: ${name}`);
          }
          continue;
        }
        const fn = original as (...a: unknown[]) => unknown;
        wrapped[name] = (...args: unknown[]) => {
          const prev = get();
          const ret = fn(...args);
          const next = get();
          try {
            const events = mapper(ret, args, { prev, next });
            for (const [type, props] of events) {
              sink(type, props);
            }
          } catch (err) {
            if (import.meta.env?.DEV) {
              console.warn(`[analytics] mapper '${name}' threw`, err);
            }
          }
          return ret;
        };
      }
      return wrapped as S;
    };
}
```

- [ ] **Step 4: 跑测试,确认通过**

```bash
npx tsx src/lib/analytics/__middleware.test.ts
```

预期：`✓ all passed`。  
若报 `import.meta.env` 解析问题,在 mapper 中加 `// @ts-expect-error tsx 不识别 vite env` 注释或换成 `try{...}catch{}`。

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/middleware.ts src/lib/analytics/__middleware.test.ts
git commit -m "feat(analytics): add withTracking zustand middleware"
```

---

### Task 15: 退出钩子 — 注册 flushNow

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 1: 在 initAdapter().then(...) 之前 / 之后挂钩**

打开 `src/main.tsx`，改造为：

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { initAdapter, isTauri } from "./lib/dataAdapter";
import { flushNow, track } from "./lib/analytics";
import "./styles/index.css";

const startedAt = performance.now();

initAdapter().then(async () => {
  const platform: "tauri" | "web" = isTauri() ? "tauri" : "web";
  track("app.launched", { platform });
  track("app.hydrated", {
    platform,
    durationMs: Math.round(performance.now() - startedAt),
  });

  // 退出前同步 flush(尽量；浏览器 beforeunload 限制下用 sendBeacon-like 思路:已是本地写入,fire-and-forget 即可)
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
      void flushNow();
    });
  }
  // Tauri 端的 onCloseRequested 处理留给后续可选优化(本地写入即时性已经够用)

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
});
```

- [ ] **Step 2: 启动 dev,console 应能看到无报错**

```bash
npm run dev
```

打开浏览器,无报错;在 console 跑 `import('/src/lib/analytics').then(m => m.currentSessionId())` 应输出当前 session id。

- [ ] **Step 3: Commit**

```bash
git add src/main.tsx
git commit -m "feat(analytics): emit app.launched and flush on unload"
```

---

## P3 接入（自动 + 显式）

### Task 16: taskStore 接 withTracking

**Files:**
- Modify: `src/store/taskStore.ts`

- [ ] **Step 1: 在文件顶部加 import**

```ts
import { withTracking, type ActionMapping } from "@/lib/analytics/middleware";
import type { TaskPriority } from "@/lib/types";
```

- [ ] **Step 2: 在 `export const useTaskStore = create<TaskStoreState>(...)` 之前定义 mapping**

```ts
const taskTrackingMapping: ActionMapping<TaskStoreState> = {
  addTask: (ret) => {
    const t = ret as { id: string; priority: TaskPriority; tagIds: string[]; description?: string };
    return [
      ["task.created", {
        taskId: t.id,
        priority: t.priority,
        tagIds: t.tagIds ?? [],
        hasDoc: !!(t as any).docUrl,
      }],
    ];
  },

  toggleStatus: (_ret, args) => {
    const [id, status] = args as [string, "todo" | "in_progress" | "suspended" | "done" | "archived" | undefined];
    if (status === "done") return [["task.completed", { taskId: id }]];
    if (status === "todo" || status === "in_progress") return [["task.uncompleted", { taskId: id }]];
    // 没传 status 时,store 内部会切换;靠 prev/next 推断
    return [];
  },

  deleteTask: (_ret, args) => {
    const [id] = args as [string];
    return [["task.deleted", { taskId: id }]];
  },

  moveSchedule: (_ret, args) => {
    const [id, from, to, mode] = args as [string, string, string, "move" | "add" | "replace" | undefined];
    return [["task.rescheduled", { taskId: id, fromDate: from, toDate: to, mode: mode ?? "move" }]];
  },

  scheduleForDate: (_ret, args) => {
    const [id, date] = args as [string, string];
    return [["task.scheduled", { taskId: id, date }]];
  },

  removeFromDate: (_ret, args) => {
    const [id, date] = args as [string, string];
    return [["task.unscheduled", { taskId: id, date }]];
  },

  reorderForDate: (_ret, args) => {
    const [date, ids] = args as [string, string[]];
    return [["task.reordered", { date, count: ids.length }]];
  },

  updateTask: (_ret, args, { prev, next }) => {
    const [id, patch] = args as [string, Partial<{ priority: TaskPriority; tagIds: string[] }>];
    const prevTask = prev.tasks.find((t) => t.id === id);
    const nextTask = next.tasks.find((t) => t.id === id);
    const out: Array<[string, object]> = [];
    if (prevTask && nextTask) {
      if (patch.priority && prevTask.priority !== nextTask.priority) {
        out.push(["task.priority_changed", {
          taskId: id, from: prevTask.priority, to: nextTask.priority,
        }]);
      }
      if (patch.tagIds) {
        const prevTags = prevTask.tagIds ?? [];
        const nextTags = nextTask.tagIds ?? [];
        for (const t of nextTags) if (!prevTags.includes(t)) out.push(["task.tagged", { taskId: id, tagId: t }]);
        for (const t of prevTags) if (!nextTags.includes(t)) out.push(["task.untagged", { taskId: id, tagId: t }]);
      }
    }
    out.push(["task.updated", { taskId: id, fields: Object.keys(patch ?? {}) }]);
    return out as Array<[any, any]>;
  },

  addPomodoro: (ret) => {
    const p = ret as { taskId?: string; type: "focus" | "short_break" | "long_break"; durationSec: number; completed: boolean };
    return [
      [
        p.completed ? "pomodoro.completed" : "pomodoro.cancelled",
        p.completed
          ? { taskId: p.taskId, type: p.type, durationSec: p.durationSec }
          : { taskId: p.taskId, type: p.type, elapsedSec: p.durationSec },
      ],
    ];
  },
};
```

- [ ] **Step 3: 把 create 调用包上 withTracking**

把：

```ts
export const useTaskStore = create<TaskStoreState>((set, get) => ({ /* ... */ }));
```

改为：

```ts
export const useTaskStore = create<TaskStoreState>()(
  withTracking(taskTrackingMapping)((set, get) => ({ /* 原 store 体保持不变 */ }))
);
```

注意：原 `create<TaskStoreState>(` 改为 `create<TaskStoreState>()(` —— 加一对空括号是 zustand v4 中间件 curry 写法的要求。

- [ ] **Step 4: 启动 dev,操作几个任务**

```bash
npm run dev
```

新建/完成/改期/拖动一个任务。在浏览器 console:

```js
import('/src/lib/dataAdapter').then(m => m.getAdapter().queryEvents({})).then(console.log)
```

应能看到 `task.created / task.completed / task.rescheduled` 等事件。

- [ ] **Step 5: Commit**

```bash
git add src/store/taskStore.ts
git commit -m "feat(analytics): wire taskStore to withTracking middleware"
```

---

### Task 17: tagStore 接 withTracking

**Files:**
- Modify: `src/store/tagStore.ts`

- [ ] **Step 1: 顶部加 import**

```ts
import { withTracking, type ActionMapping } from "@/lib/analytics/middleware";
```

- [ ] **Step 2: 定义 mapping**

紧靠 `export const useTagStore = create...` 之前：

```ts
import type { Tag } from "@/lib/types";

interface _TagStoreShape {
  tags: Tag[];
}

const tagTrackingMapping: ActionMapping<_TagStoreShape & Record<string, unknown>> = {
  addTag: (ret) => {
    const t = ret as { id: string; parentId: string | null; color: string };
    return [["tag.created", { tagId: t.id, parentId: t.parentId ?? null, color: t.color }]];
  },
  updateTag: (_ret, args) => {
    const [id, patch] = args as [string, Partial<{ name: string }>];
    if (patch.name !== undefined) return [["tag.renamed", { tagId: id }]];
    return [];
  },
  deleteTagCascade: (ret, args) => {
    const [id] = args as [string];
    const removed = ret as string[];
    return [["tag.deleted", { tagId: id, cascadeCount: removed.length }]];
  },
  moveTag: (_ret, args) => {
    const [tagId, newParentId] = args as [string, string | null, number];
    return [["tag.moved", { tagId, newParentId: newParentId ?? null }]];
  },
};
```

- [ ] **Step 3: 包 create**

把 `create<TagStoreState>((set, get) => ({...}))` 改为：

```ts
export const useTagStore = create<TagStoreState>()(
  withTracking(tagTrackingMapping as ActionMapping<TagStoreState>)((set, get) => ({ /* 原内容 */ }))
);
```

- [ ] **Step 4: dev 校验**

新建/重命名/删除/拖动一个标签,浏览器 console queryEvents 应看到 `tag.*` 事件。

- [ ] **Step 5: Commit**

```bash
git add src/store/tagStore.ts
git commit -m "feat(analytics): wire tagStore to withTracking middleware"
```

---

### Task 18: pomodoroStore 显式 track（避免双重打点）

**Files:**
- Modify: `src/store/pomodoroStore.ts`

> 说明：pomodoroStore 内部调 `useTaskStore.getState().addPomodoro(...)`，已被 taskStore mapping 覆盖产出 `pomodoro.completed/cancelled`。这里只补 `pomodoro.started` —— 它发生在 `start()` 时，那时还没写库。

- [ ] **Step 1: 顶部加 import**

```ts
import { track } from "@/lib/analytics";
```

- [ ] **Step 2: 在 `start()` 函数体内,设置 `state: "running"` 之前/之后加 track**

定位到 `start: () => { ... set({ state: "running", ... }) ... }`，在 set 调用之后追加：

```ts
        track("pomodoro.started", {
          taskId: get().taskId,
          type: get().type,
        });
```

（具体位置以 store 当前实现为准，确保只在真正进入 running 状态时发射一次。）

- [ ] **Step 3: dev 校验**

跑一个番茄钟,console queryEvents 应能看到 `pomodoro.started`(开始时)和 `pomodoro.completed`(自然结束时)。

- [ ] **Step 4: Commit**

```bash
git add src/store/pomodoroStore.ts
git commit -m "feat(analytics): track pomodoro.started in pomodoroStore"
```

---

### Task 19: UI 显式埋点 — 路由进入

**Files:**
- Modify: `src/components/layout/AppLayout.tsx`

- [ ] **Step 1: 用 useEffect + useLocation 在 pathname 变化时打点**

把 `AppLayout.tsx` 改为：

```tsx
import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { track } from "@/lib/analytics";

export function AppLayout() {
  const location = useLocation();
  useEffect(() => {
    // 取首段路径作 route id（"/tasks?view=today" -> "tasks"）
    const seg = location.pathname.split("/").filter(Boolean)[0] ?? "root";
    track("ui.route.enter", { route: seg });
  }, [location.pathname]);

  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: dev 校验**

切换侧栏几个 tab,queryEvents 应每切一次产一条 `ui.route.enter`。

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AppLayout.tsx
git commit -m "feat(analytics): track ui.route.enter on navigation"
```

---

### Task 20: UI 显式埋点 — popover / dialog / search / 导入导出

**Files:**
- Modify (示例): popover 调用方、dialogStore、ImportExportBar、search 组件

> 这些埋点点分散在多个文件;原则是**每个用户可见的"打开"动作处加一行 `track(...)`**。下面给出每个具体修改点。

- [ ] **Step 1: 任务页 day-tasks popover**

定位到打开 day-tasks popover 的位置（搜 `day-tasks` 或 popover-open 相关），在打开 handler 中加：

```ts
import { track } from "@/lib/analytics";
// ...
track("ui.popover.open", { popover: "day-tasks", date });
```

具体文件视实现而定，常见在 `src/routes/tasks/Year.tsx` 或类似日历视图组件中。

- [ ] **Step 2: dialogStore 打开钩子**

打开 `src/store/dialogStore.ts`，找到对外暴露的 `confirm(...)` / `prompt(...)` / `open(...)` 等入口，在每个入口最开始加：

```ts
import { track } from "@/lib/analytics";
// 在每个 confirm/prompt/open 实现的开头:
track("ui.dialog.open", { dialog: opts.kind ?? "confirm" });
```

如果 dialogStore 只有一种弹窗,统一传字符串即可。

- [ ] **Step 3: 搜索组件**

搜索框组件位于 `src/components/search/`。在执行搜索的 handler（如 `handleSearch(query)`）中加：

```ts
import { track } from "@/lib/analytics";
// ...
track("ui.search.used", { queryLength: query.length });
```

注意：**绝不传 query 内容,只传 length**。

- [ ] **Step 4: 导入导出按钮**

打开 `src/routes/data/ImportExportBar.tsx`：

```ts
import { track } from "@/lib/analytics";

// 在 handleExport 函数体首行
track("ui.export", { kind: "db" });

// 在 handleImport 函数体首行（成功路径或入口处都可,选择入口）
track("ui.import", { kind: "db" });
```

- [ ] **Step 5: dev 全链路校验**

跑一遍："切 tab → 打开搜索 → 在年视图点开 day-tasks popover → 删一个任务（弹 confirm）→ 导出"。  
然后 console:

```js
import('/src/lib/dataAdapter').then(m => m.getAdapter().queryEvents({ types: ["ui.route.enter","ui.popover.open","ui.dialog.open","ui.search.used","ui.export"] })).then(console.log)
```

应能看到上述所有事件。

- [ ] **Step 6: Commit**

```bash
git add -u
git commit -m "feat(analytics): track popover / dialog / search / import-export"
```

---

## P4 查询 UI

### Task 21: useEventStats hook

**Files:**
- Create: `src/lib/analytics/useEventStats.ts`

- [ ] **Step 1: 实现 hook**

```ts
// src/lib/analytics/useEventStats.ts
import { useEffect, useState } from "react";
import { getAdapter } from "../dataAdapter";
import type { EventCountRow, EventFilter, EventGroupBy } from "./types";

export interface EventStatsState {
  data: EventCountRow[];
  loading: boolean;
  error: string | null;
}

/**
 * 调用 adapter.countEvents(filter, groupBy);filter 改变时自动重取。
 */
export function useEventCount(
  filter: EventFilter,
  groupBy: EventGroupBy
): EventStatsState {
  const [state, setState] = useState<EventStatsState>({
    data: [], loading: true, error: null,
  });
  // 用 JSON 化的 filter 作为依赖,避免对象引用稳定性问题
  const dep = JSON.stringify({ filter, groupBy });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    getAdapter()
      .countEvents(filter, groupBy)
      .then((rows) => {
        if (!cancelled) setState({ data: rows, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ data: [], loading: false, error: String(err) });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);

  return state;
}
```

- [ ] **Step 2: TypeScript 编译通过**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/analytics/useEventStats.ts
git commit -m "feat(analytics): add useEventCount hook"
```

---

### Task 22: Stats 三个新面板

**Files:**
- Modify: `src/routes/Stats.tsx`

- [ ] **Step 1: 顶部加 import**

```ts
import { useEventCount } from "@/lib/analytics/useEventStats";
import { useTagStore } from "@/store/tagStore";  // 若已 import,跳过
```

- [ ] **Step 2: 在 `Stats()` 内、return 之前,根据 range 计算 from/to ISO**

```ts
  const fromIso = useMemo(() => new Date(start.getFullYear(), start.getMonth(), start.getDate()).toISOString(), [start]);
  const toIso   = useMemo(() => {
    const e = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59);
    return e.toISOString();
  }, [end]);

  const created = useEventCount(
    { types: ["task.created"], from: fromIso, to: toIso },
    "hour"
  );
  const rescheduled = useEventCount(
    { types: ["task.rescheduled"], from: fromIso, to: toIso },
    "hour"
  );
  const completed = useEventCount(
    { types: ["task.completed"], from: fromIso, to: toIso },
    "type"  // 我们其实不分组,只要总数;用 type 简单
  );
```

- [ ] **Step 3: 在 return 末尾、原图表之后,新增三块面板**

```tsx
      {/* —— 任务添加节奏 —— */}
      <section className="mt-8 rounded-2xl border border-ink-200/60 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-ink-700">任务添加节奏（按小时）</h2>
        {created.loading ? (
          <div className="text-xs text-ink-400">加载中…</div>
        ) : created.error ? (
          <div className="text-xs text-rose-500">加载失败</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={fillHours(created.data)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="key" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* —— 改期时段分布 —— */}
      <section className="mt-6 rounded-2xl border border-ink-200/60 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-ink-700">改期时段分布（按小时）</h2>
        {rescheduled.loading ? (
          <div className="text-xs text-ink-400">加载中…</div>
        ) : rescheduled.error ? (
          <div className="text-xs text-rose-500">加载失败</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={fillHours(rescheduled.data)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="key" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* —— 标签完成率排行 —— */}
      <section className="mt-6 rounded-2xl border border-ink-200/60 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-ink-700">标签完成率 Top 10</h2>
        <TagCompletionRanking start={start} end={end} />
      </section>
```

- [ ] **Step 4: 在文件底部加 fillHours 工具 + TagCompletionRanking 组件**

```tsx
/** 把 hour 桶补齐 0..23,空缺按 0 计 */
function fillHours(rows: { key: string; count: number }[]): { key: string; count: number }[] {
  const map = new Map(rows.map((r) => [r.key, r.count]));
  return Array.from({ length: 24 }, (_, h) => {
    const key = String(h).padStart(2, "0");
    return { key, count: map.get(key) ?? 0 };
  });
}

function TagCompletionRanking({ start, end }: { start: Date; end: Date }) {
  const tasks = useTaskStore((s) => s.tasks);
  const tags = useTagStore((s) => s.tags);

  const data = useMemo(() => {
    const startStr = isoDate(start), endStr = isoDate(end);
    const inRange = (iso?: string) =>
      !!iso && iso.slice(0, 10) >= startStr && iso.slice(0, 10) <= endStr;

    return tags
      .map((tag) => {
        const tagged = tasks.filter((t) => (t.tagIds ?? []).includes(tag.id));
        const completed = tagged.filter(
          (t) => t.status === "done" && inRange(t.completedAt)
        );
        return {
          name: tag.name,
          total: tagged.length,
          completed: completed.length,
          rate: tagged.length === 0 ? 0 : completed.length / tagged.length,
        };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 10);
  }, [tasks, tags, start, end]);

  if (data.length === 0) return <div className="text-xs text-ink-400">暂无数据</div>;

  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 26)}>
      <BarChart data={data} layout="vertical" margin={{ left: 60 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
        <YAxis type="category" dataKey="name" width={80} />
        <Tooltip formatter={(v: number) => `${Math.round(v * 100)}%`} />
        <Bar dataKey="rate" fill="#10b981" />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 5: dev 校验**

```bash
npm run dev
```

打开 `/stats`，三块新面板应渲染（首次可能为空，操作几个任务/改期后再回来看）。

- [ ] **Step 6: Commit**

```bash
git add src/routes/Stats.tsx
git commit -m "feat(stats): add 3 analytics panels (add-rhythm/reschedule/tag-rate)"
```

---

### Task 23: 扩展 useDataUrlState 加 events tab

**Files:**
- Modify: `src/routes/data/useDataUrlState.ts`

- [ ] **Step 1: 增加 events 选项**

```ts
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

export type DataTab = "tasks" | "tags" | "pomodoros" | "events";

const VALID: DataTab[] = ["tasks", "tags", "pomodoros", "events"];

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

- [ ] **Step 2: Commit**

```bash
git add src/routes/data/useDataUrlState.ts
git commit -m "feat(data): add 'events' to DataTab"
```

---

### Task 24: EventsTable 组件

**Files:**
- Create: `src/routes/data/tables/EventsTable.tsx`

- [ ] **Step 1: 实现表格组件**

```tsx
// src/routes/data/tables/EventsTable.tsx
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { getAdapter } from "@/lib/dataAdapter";
import { KNOWN_TYPES, type EventType } from "@/lib/analytics/registry";
import type { AnalyticsEvent, EventFilter } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 200;

const TYPE_GROUPS: Record<string, EventType[]> = {
  task: KNOWN_TYPES.filter((t) => t.startsWith("task.")),
  pomodoro: KNOWN_TYPES.filter((t) => t.startsWith("pomodoro.")),
  tag: KNOWN_TYPES.filter((t) => t.startsWith("tag.")),
  ui: KNOWN_TYPES.filter((t) => t.startsWith("ui.")),
  app: KNOWN_TYPES.filter((t) => t.startsWith("app.")),
};

function todayIso(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function EventsTable() {
  const [types, setTypes] = useState<EventType[]>([]);
  const [from, setFrom] = useState<string>(todayIso().from);
  const [to, setTo] = useState<string>(todayIso().to);
  const [entityId, setEntityId] = useState<string>("");
  const [rows, setRows] = useState<AnalyticsEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filter: EventFilter = useMemo(
    () => ({
      types: types.length > 0 ? types : undefined,
      from,
      to,
      entityId: entityId.trim() || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [types, from, to, entityId, offset]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAdapter()
      .queryEvents(filter)
      .then((res) => {
        if (cancelled) return;
        if (offset === 0) setRows(res);
        else setRows((prev) => [...prev, ...res]);
        setHasMore(res.length === PAGE_SIZE);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [JSON.stringify(filter)]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    setOffset(0);
  };

  const toggleType = (t: EventType) => {
    setOffset(0);
    setTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {/* 过滤栏 */}
      <div className="rounded-lg border border-ink-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <input
            type="datetime-local"
            value={from.slice(0, 16)}
            onChange={(e) => { setOffset(0); setFrom(new Date(e.target.value).toISOString()); }}
            className="rounded border border-ink-200 px-2 py-1"
          />
          <span className="text-ink-400">→</span>
          <input
            type="datetime-local"
            value={to.slice(0, 16)}
            onChange={(e) => { setOffset(0); setTo(new Date(e.target.value).toISOString()); }}
            className="rounded border border-ink-200 px-2 py-1"
          />
          <input
            type="text"
            placeholder="entity_id"
            value={entityId}
            onChange={(e) => { setOffset(0); setEntityId(e.target.value); }}
            className="rounded border border-ink-200 px-2 py-1 w-40"
          />
          <button
            type="button"
            onClick={refresh}
            className="ml-auto inline-flex items-center gap-1 rounded border border-ink-200 px-2 py-1 hover:bg-ink-50"
          >
            <RefreshCw className="h-3 w-3" />刷新
          </button>
        </div>

        {/* 类型分组多选 */}
        <div className="mt-3 space-y-1">
          {Object.entries(TYPE_GROUPS).map(([group, ts]) => (
            <div key={group} className="flex flex-wrap items-center gap-1.5">
              <span className="w-16 text-[11px] uppercase text-ink-400">{group}</span>
              {ts.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px]",
                    types.includes(t)
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-ink-200 text-ink-500 hover:bg-ink-50"
                  )}
                >
                  {t.split(".")[1]}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* 列表 */}
      <div className="rounded-lg border border-ink-200 bg-white">
        {error && <div className="p-3 text-xs text-rose-500">加载失败：{error}</div>}
        {!error && rows.length === 0 && !loading && (
          <div className="p-3 text-xs text-ink-400">无事件</div>
        )}
        <ul className="divide-y divide-ink-100">
          {rows.map((e) => {
            const open = expanded.has(e.id);
            return (
              <li key={e.id} className="px-3 py-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => toggleExpand(e.id)}
                  className="flex w-full items-center gap-2 text-left"
                >
                  {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <span className="text-ink-400">{e.occurredAt.slice(11, 19)}</span>
                  <span className="font-mono text-ink-700">{e.type}</span>
                  {e.entityType && (
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-600">
                      {e.entityType}:{e.entityId}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-ink-400">
                    {e.source}
                  </span>
                </button>
                {open && (
                  <pre className="mt-1 ml-5 overflow-x-auto rounded bg-ink-50 p-2 text-[11px] text-ink-700">
                    {JSON.stringify(e.props, null, 2)}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between border-t border-ink-100 px-3 py-2 text-[11px] text-ink-500">
          <span>{loading ? "加载中…" : `已加载 ${rows.length} 条`}</span>
          {hasMore && !loading && (
            <button
              type="button"
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              className="rounded border border-ink-200 px-2 py-1 hover:bg-ink-50"
            >
              加载更多
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 编译通过**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/data/tables/EventsTable.tsx
git commit -m "feat(data): add EventsTable component"
```

---

### Task 25: DataPage 接入 events tab

**Files:**
- Modify: `src/routes/data/DataPage.tsx`

- [ ] **Step 1: 加 import + tab 项 + 渲染分支**

打开 `src/routes/data/DataPage.tsx`,顶部 import 区追加：

```ts
import { EventsTable } from "./tables/EventsTable";
```

在 `tabs` 数组末尾加 `events`：

```ts
  const tabs: TabDef[] = [
    { key: "tasks", label: "任务", count: tasks.length },
    { key: "tags", label: "标签", count: tags.length },
    { key: "pomodoros", label: "番茄", count: pomodoros.length },
    { key: "events", label: "事件", count: 0 }, // count 0 占位,实际不显示
  ];
```

由于 events 行数可能很大，把渲染按钮的 label 处对 events 特判（同文件渲染 button 那一段）：

```tsx
              {tab === t.key
                ? "bg-brand-600 text-white"
                : "bg-white text-ink-600 hover:bg-ink-50"
            )}
          >
            {t.key === "events" ? t.label : `${t.label} (${t.count})`}
          </button>
```

在条件渲染末尾追加：

```tsx
      {tab === "events" && <EventsTable />}
```

- [ ] **Step 2: dev 校验**

```bash
npm run dev
```

打开 `/data?tab=events`：
- 默认显示今天事件，能切换日期范围
- 类型 chips 多选 → 列表过滤
- entity_id 输入 → 过滤
- 行点击展开 props
- "加载更多" 翻页

- [ ] **Step 3: Tauri 端校验**

```bash
npm run tauri:dev
```

同样路径走一遍,确保 Tauri 端事件入库 + 查询都正常。

- [ ] **Step 4: Commit**

```bash
git add src/routes/data/DataPage.tsx
git commit -m "feat(data): wire events tab in DataPage"
```

---

## 收尾

### Task 26: 全链路回归

- [ ] **Step 1: 跑全部单测**

```bash
npx tsx src/lib/analytics/__registry.test.ts
npx tsx src/lib/analytics/__session.test.ts
npx tsx src/lib/analytics/__buffer.test.ts
npx tsx src/lib/analytics/__middleware.test.ts
npx tsx src/lib/__dateRange.test.ts
```

预期：每个都 `✓ all passed`。

- [ ] **Step 2: 双端冒烟**

Web (`npm run dev`) 与 Tauri (`npm run tauri:dev`) 各跑一次：

1. 新建任务 → `events` tab 应看到 `task.created`
2. 完成任务 → `task.completed`
3. 拖动改期 → `task.rescheduled`
4. 创建/重命名/删除标签 → `tag.*`
5. 启动一个番茄(自然结束) → `pomodoro.started` + `pomodoro.completed`
6. 切换路由 → `ui.route.enter`
7. 打开年视图 day-tasks popover → `ui.popover.open`
8. 搜索 → `ui.search.used`(props 只含 queryLength)
9. 导出/导入 → `ui.export` / `ui.import`
10. /stats 页：3 块新面板有数据

- [ ] **Step 3: 检查 props 不含敏感字段**

Console:

```js
import('/src/lib/dataAdapter').then(m => m.getAdapter().queryEvents({ types: ["ui.search.used"], limit: 50 })).then(rs => rs.forEach(r => console.log(r.props)))
```

确认不含 query 内容,只有 `queryLength`。再查 `task.*`:

```js
import('/src/lib/dataAdapter').then(m => m.getAdapter().queryEvents({ types: ["task.created"], limit: 50 })).then(rs => rs.forEach(r => console.log(r.props)))
```

确认不含 task title。

- [ ] **Step 4: 提交剩余改动并打 tag**

```bash
git status
# 应 clean。如有遗漏改动,逐项 commit。
```

---

## 自检备忘

- 双端 schema 已同步（Task 2 + Task 3）
- 双端 adapter 实现一致（Task 5 + Task 7）
- IPC 命令已注册（Task 8）
- 单测覆盖：registry / session / buffer / middleware（Task 10/11/12/14）
- 数据层冒烟脚本（Task 9）
- 隐私约束在 registry 注释 + Task 20 Step 3 + Task 26 Step 3 三处确认
- Stats 三面板（Task 22）+ events tab（Task 24/25）覆盖 spec 的查询层需求
- spec 中提到的事件类型全在 registry KNOWN_TYPES
- 退出 flush 已挂（Task 15）

