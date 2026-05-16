/**
 * Web 端 SQLite 适配器，实现与 src-tauri/src/commands.rs 完全对齐的语义：
 *   - upsertTask: 事务中 INSERT OR REPLACE tasks → 重写 task_dates / task_tags
 *   - deleteTask: DELETE FROM tasks，靠 FK CASCADE 清理关联表
 *   - clearAll:   事务中显式清五张表
 *
 * 字段命名约定：DB 用 snake_case，TS 模型用 camelCase，本适配器边界处转换。
 */

import type { DataAdapter } from "../dataAdapter";
import type {
  PomodoroSession,
  PomodoroType,
  Tag,
  Task,
  TaskPriority,
  TaskStatus,
} from "../types";
import type {
  AnalyticsEvent,
  EventCountRow,
  EventFilter,
  EventGroupBy,
} from "../analytics/types";
import {
  exportSqliteBytes,
  query,
  replaceSqliteBytes,
  resetDb,
  run,
  tx,
} from "./sqliteDb";

type Row = Record<string, unknown>;

function s(v: unknown): string {
  return v == null ? "" : String(v);
}
function sOrNull(v: unknown): string | null {
  return v == null ? null : String(v);
}
function n(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

function rowToTag(r: Row): Tag {
  return {
    id: s(r.id),
    name: s(r.name),
    parentId: (r.parent_id as string | null) ?? null,
    color: s(r.color),
    order: n(r.order),
  };
}

function rowToPomodoro(r: Row): PomodoroSession {
  return {
    id: s(r.id),
    taskId: (r.task_id as string | null) ?? undefined,
    type: s(r.type) as PomodoroType,
    durationSec: n(r.duration_sec),
    completed: n(r.completed) !== 0,
    startedAt: s(r.started_at),
    endedAt: s(r.ended_at),
  };
}

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

export class SqliteAdapter implements DataAdapter {
  /* ──────────────── Tasks ──────────────── */

  async listTasks(): Promise<Task[]> {
    const taskRows = query<Row>(
      `SELECT id, title, description, status, priority, "order",
              doc_url, doc_title, color, completed_at, created_at, updated_at
       FROM tasks`
    );
    const tasks: Task[] = taskRows.map((r) => ({
      id: s(r.id),
      title: s(r.title),
      description: s(r.description),
      status: s(r.status) as TaskStatus,
      priority: s(r.priority) as TaskPriority,
      scheduledDates: [],
      tagIds: [],
      order: n(r.order),
      color: (r.color as string | null) ?? undefined,
      docUrl: (r.doc_url as string | null) ?? undefined,
      docTitle: (r.doc_title as string | null) ?? undefined,
      completedAt: (r.completed_at as string | null) ?? undefined,
      createdAt: s(r.created_at),
      updatedAt: s(r.updated_at),
    }));

    const dateRows = query<Row>(
      `SELECT task_id, date FROM task_dates ORDER BY date`
    );
    const datesByTask = new Map<string, string[]>();
    for (const r of dateRows) {
      const k = s(r.task_id);
      const arr = datesByTask.get(k) ?? [];
      arr.push(s(r.date));
      datesByTask.set(k, arr);
    }

    const tagRows = query<Row>(`SELECT task_id, tag_id FROM task_tags`);
    const tagsByTask = new Map<string, string[]>();
    for (const r of tagRows) {
      const k = s(r.task_id);
      const arr = tagsByTask.get(k) ?? [];
      arr.push(s(r.tag_id));
      tagsByTask.set(k, arr);
    }

    for (const t of tasks) {
      t.scheduledDates = datesByTask.get(t.id) ?? [];
      t.tagIds = tagsByTask.get(t.id) ?? [];
    }
    return tasks;
  }

  async upsertTask(task: Task): Promise<void> {
    tx(() => {
      run(
        `INSERT INTO tasks (
            id, title, description, status, priority, "order",
            doc_url, doc_title, color, completed_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            description = excluded.description,
            status = excluded.status,
            priority = excluded.priority,
            "order" = excluded."order",
            doc_url = excluded.doc_url,
            doc_title = excluded.doc_title,
            color = excluded.color,
            completed_at = excluded.completed_at,
            updated_at = excluded.updated_at`,
        [
          task.id,
          task.title,
          task.description,
          task.status,
          task.priority ?? "p2",
          task.order,
          task.docUrl ?? null,
          task.docTitle ?? null,
          task.color ?? null,
          task.completedAt ?? null,
          task.createdAt,
          task.updatedAt,
        ]
      );

      run(`DELETE FROM task_dates WHERE task_id = ?`, [task.id]);
      for (const d of task.scheduledDates) {
        run(
          `INSERT OR IGNORE INTO task_dates (task_id, date) VALUES (?, ?)`,
          [task.id, d]
        );
      }

      run(`DELETE FROM task_tags WHERE task_id = ?`, [task.id]);
      for (const tg of task.tagIds) {
        run(
          `INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)`,
          [task.id, tg]
        );
      }
    });
  }

  async deleteTask(id: string): Promise<void> {
    // FK ON DELETE CASCADE 自动清理 task_dates / task_tags
    run(`DELETE FROM tasks WHERE id = ?`, [id]);
  }

  /* ──────────────── Tags ──────────────── */

  async listTags(): Promise<Tag[]> {
    return query<Row>(
      `SELECT id, name, parent_id, color, "order" FROM tags`
    ).map(rowToTag);
  }

  async upsertTag(tag: Tag): Promise<void> {
    run(
      `INSERT INTO tags (id, name, parent_id, color, "order")
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           parent_id = excluded.parent_id,
           color = excluded.color,
           "order" = excluded."order"`,
      [tag.id, tag.name, sOrNull(tag.parentId), tag.color, tag.order]
    );
  }

  async deleteTag(id: string): Promise<void> {
    run(`DELETE FROM tags WHERE id = ?`, [id]);
  }

  /* ──────────────── Pomodoros ──────────────── */

  async listPomodoros(): Promise<PomodoroSession[]> {
    return query<Row>(
      `SELECT id, task_id, type, duration_sec, completed, started_at, ended_at
       FROM pomodoros ORDER BY started_at`
    ).map(rowToPomodoro);
  }

  async insertPomodoro(p: PomodoroSession): Promise<void> {
    run(
      `INSERT OR REPLACE INTO pomodoros
         (id, task_id, type, duration_sec, completed, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        p.id,
        p.taskId ?? null,
        p.type,
        p.durationSec,
        p.completed ? 1 : 0,
        p.startedAt,
        p.endedAt,
      ]
    );
  }

  async deletePomodoro(id: string): Promise<void> {
    run(`DELETE FROM pomodoros WHERE id = ?`, [id]);
  }

  /* ──────────────── Maintenance ──────────────── */

  async clearAll(): Promise<void> {
    // 删 .db 字节并重建空库 + schema —— 比逐表 DELETE 更彻底，
    // 同时避免 auto-increment 残留（虽然此项目用 TEXT id 不依赖它）
    await resetDb();
  }

  /* ──────────────── Backup / Restore ──────────────── */

  async exportDb(): Promise<Uint8Array> {
    return exportSqliteBytes();
  }

  async replaceDb(bytes: Uint8Array): Promise<void> {
    await replaceSqliteBytes(bytes);
  }

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
}

/**
 * 把 EventFilter 拼成 WHERE 子句 + 参数数组，给 query/count 共用。
 * 空 filter 返回空 sql。
 */
function buildEventWhere(filter: EventFilter): { sql: string; args: (string | number | null)[] } {
  const conds: string[] = [];
  const args: (string | number | null)[] = [];
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
