/**
 * Web 端 SQLite 库的 schema 定义。
 *
 * !!! 与 src-tauri/src/db.rs 中的 schema 手动保持同步 !!!
 *   字段顺序、默认值、外键约束、索引都需要一一对应，
 *   否则两端导入/导出同一个 .db 文件时会出现兼容性问题。
 *
 * 任何 schema 变更都需要：
 *   1. 同步更新 db.rs 的 migrate()
 *   2. 同步更新本文件
 *   3. 如果是加列：在两端都加 ensure_column 逻辑（Rust 端已有；JS 端见下方 ensureColumn）
 */

export const SCHEMA_SQL = `
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
    color        TEXT,
    completed_at TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    review_log   TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);

CREATE TABLE IF NOT EXISTS task_dates (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    date    TEXT NOT NULL,
    PRIMARY KEY (task_id, date)
);
CREATE INDEX IF NOT EXISTS idx_task_dates_date ON task_dates(date);

CREATE TABLE IF NOT EXISTS task_tags (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    PRIMARY KEY (task_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_id);

CREATE TABLE IF NOT EXISTS pomodoros (
    id           TEXT PRIMARY KEY,
    task_id      TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    type         TEXT NOT NULL,
    duration_sec INTEGER NOT NULL,
    completed    INTEGER NOT NULL DEFAULT 0,
    started_at   TEXT NOT NULL,
    ended_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pomodoros_started ON pomodoros(started_at);
CREATE INDEX IF NOT EXISTS idx_pomodoros_task    ON pomodoros(task_id);
`;
