// SQLite 数据库初始化与迁移
//
// 设计取舍：
//   - enum 字段（status / priority / pomodoro type）统一落 TEXT，
//     人读友好；未来新增枚举值无需 INTEGER 重排。
//   - 多对多 / 一对多关系（task_dates / task_tags）放独立关联表，
//     而不是 JSON 字段，方便后续按"某日的任务 / 某标签下的任务"建索引查询。
//   - 迁移用 IF NOT EXISTS + 列存在性检测，做到幂等。每次启动安全调用。

use anyhow::{Context, Result};
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use std::path::PathBuf;

pub struct AppState {
    pub conn: Mutex<Connection>,
    pub db_path: PathBuf,
}

impl AppState {
    /// 在指定路径打开数据库并执行迁移
    pub fn open(db_path: PathBuf) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(&db_path)
            .with_context(|| format!("无法打开数据库 {:?}", db_path))?;
        Self::migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            db_path,
        })
    }

    /// 创建表与索引（幂等），并补齐后加的列
    pub(crate) fn migrate(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS tags (
                id        TEXT PRIMARY KEY,
                name      TEXT NOT NULL,
                parent_id TEXT REFERENCES tags(id) ON DELETE CASCADE,
                color     TEXT NOT NULL DEFAULT '#6366f1',
                "order"   INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_tags_parent ON tags(parent_id);

            CREATE TABLE IF NOT EXISTS tasks (
                id           TEXT PRIMARY KEY,
                title        TEXT NOT NULL,
                description  TEXT NOT NULL DEFAULT '',
                status       TEXT NOT NULL DEFAULT 'todo',
                priority     TEXT NOT NULL DEFAULT 'p2',
                "order"      INTEGER NOT NULL DEFAULT 0,
                doc_url      TEXT,
                doc_title    TEXT,
                completed_at TEXT,
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL,
                review_log   TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);

            -- 任务排期：一个任务可在多天出现
            CREATE TABLE IF NOT EXISTS task_dates (
                task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                date    TEXT NOT NULL,                 -- yyyy-MM-dd
                PRIMARY KEY (task_id, date)
            );
            CREATE INDEX IF NOT EXISTS idx_task_dates_date ON task_dates(date);

            -- 任务-标签 多对多
            CREATE TABLE IF NOT EXISTS task_tags (
                task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
                PRIMARY KEY (task_id, tag_id)
            );
            CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_id);

            -- 任务关联文档：一个任务可以挂多个 URL
            CREATE TABLE IF NOT EXISTS task_docs (
                task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                id       TEXT NOT NULL,
                title    TEXT NOT NULL DEFAULT '',
                url      TEXT NOT NULL,
                "order"  INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (task_id, id)
            );
            CREATE INDEX IF NOT EXISTS idx_task_docs_task ON task_docs(task_id);

            CREATE TABLE IF NOT EXISTS pomodoros (
                id           TEXT PRIMARY KEY,
                task_id      TEXT REFERENCES tasks(id) ON DELETE SET NULL,
                type         TEXT NOT NULL,            -- focus | short_break | long_break
                duration_sec INTEGER NOT NULL,
                completed    INTEGER NOT NULL DEFAULT 0,
                started_at   TEXT NOT NULL,
                ended_at     TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_pomodoros_started ON pomodoros(started_at);
            CREATE INDEX IF NOT EXISTS idx_pomodoros_task    ON pomodoros(task_id);

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

            -- 应用设置（KV）。MCP 开关、端口、写权限等都放这里。
            -- 用 SQLite 而不是 localStorage，是因为 Tauri 启动时要读它决定是否自启 MCP。
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "#,
        )?;

        // 对旧版本数据库做幂等的列补齐：priority 在 0.1.0 中后加入
        ensure_column(conn, "tasks", "priority", "TEXT NOT NULL DEFAULT 'p2'")?;
        // color 在 0.2 中加入，可空（未设则前端按优先级 / 状态色降级）
        ensure_column(conn, "tasks", "color", "TEXT")?;
        ensure_column(conn, "tasks", "review_log", "TEXT")?;

        // 老的 tasks.doc_url / doc_title 迁移到 task_docs（幂等：仅迁尚未挂任何文档的 task）
        backfill_task_docs(conn)?;

        Ok(())
    }
}

/// 把老数据里的 tasks.doc_url + doc_title 回填到 task_docs。
///
/// - 只处理"该任务在 task_docs 里还一条都没有"且 doc_url 非空的行
/// - id 用 "doc-legacy-{task_id}"，order = 0
/// - 不删除 tasks.doc_url / doc_title 列：保留作为 schema 兼容（导入老 .db 文件仍可识别）
fn backfill_task_docs(conn: &Connection) -> Result<()> {
    conn.execute(
        r#"
        INSERT INTO task_docs (task_id, id, title, url, "order")
        SELECT
            t.id,
            'doc-legacy-' || t.id,
            COALESCE(t.doc_title, ''),
            t.doc_url,
            0
        FROM tasks t
        WHERE t.doc_url IS NOT NULL
          AND TRIM(t.doc_url) <> ''
          AND NOT EXISTS (SELECT 1 FROM task_docs d WHERE d.task_id = t.id)
        "#,
        params![],
    )?;
    Ok(())
}

/// 检测列是否存在，不存在则 ALTER TABLE ADD COLUMN（SQLite 不支持 IF NOT EXISTS 加列）
fn ensure_column(conn: &Connection, table: &str, column: &str, decl: &str) -> Result<()> {
    let sql = format!("PRAGMA table_info({})", table);
    let mut stmt = conn.prepare(&sql)?;
    let names: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    if !names.iter().any(|n| n == column) {
        conn.execute(
            &format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, decl),
            params![],
        )?;
    }
    Ok(())
}
