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
import { query, resetDb, run, tx } from "./sqliteDb";

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

  /* ──────────────── Maintenance ──────────────── */

  async clearAll(): Promise<void> {
    // 删 .db 字节并重建空库 + schema —— 比逐表 DELETE 更彻底，
    // 同时避免 auto-increment 残留（虽然此项目用 TEXT id 不依赖它）
    await resetDb();
  }
}
