// Tauri 命令：前端 invoke() 的入口
//
// 设计取舍：
//   - 错误统一映射为 String（tauri 命令要求 Serialize 错误）。Result<T, String>
//     在前端 catch 到时拿到的就是错误描述，足够 demo / 桌面级使用。
//   - upsert_task / upsert_tag 等"全量替换"语义：直接 INSERT OR REPLACE，
//     同时清空并重写关联表（task_dates / task_tags）—— 一次事务里做完，
//     无需前端区分新建 / 更新。
//   - 所有 list_* 命令一次性把所有行返回，让前端在内存里做过滤 / 排序。
//     量级（一个人一辈子任务 ≤ 10⁵）放心；将来需要再做分页。

use crate::db::AppState;
use crate::models::{PomodoroSession, PomodoroType, Tag, Task, TaskPriority, TaskStatus};
use rusqlite::params;
use tauri::State;

/// 把任意 anyhow / rusqlite 错误映射到 Tauri 命令期望的 String 错误
fn to_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ────────────────────────────────────────────────────────────────
// Tasks
// ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_tasks(state: State<AppState>) -> Result<Vec<Task>, String> {
    let conn = state.conn.lock();

    // 1) 一次性把 tasks 主表读出来
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, title, description, status, priority, "order",
                   doc_url, doc_title, color, completed_at, created_at, updated_at
            FROM tasks
            "#,
        )
        .map_err(to_err)?;
    let task_rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,                  // id
                row.get::<_, String>(1)?,                  // title
                row.get::<_, String>(2)?,                  // description
                row.get::<_, String>(3)?,                  // status
                row.get::<_, String>(4)?,                  // priority
                row.get::<_, i32>(5)?,                     // order
                row.get::<_, Option<String>>(6)?,          // doc_url
                row.get::<_, Option<String>>(7)?,          // doc_title
                row.get::<_, Option<String>>(8)?,          // color
                row.get::<_, Option<String>>(9)?,          // completed_at
                row.get::<_, String>(10)?,                 // created_at
                row.get::<_, String>(11)?,                 // updated_at
            ))
        })
        .map_err(to_err)?;

    let mut tasks: Vec<Task> = Vec::new();
    for r in task_rows {
        let (id, title, description, status, priority, order, doc_url, doc_title, color, completed_at, created_at, updated_at) =
            r.map_err(to_err)?;
        tasks.push(Task {
            id,
            title,
            description,
            status: TaskStatus::from_str(&status),
            priority: TaskPriority::from_str(&priority),
            scheduled_dates: vec![],
            tag_ids: vec![],
            order,
            color,
            doc_url,
            doc_title,
            completed_at,
            created_at,
            updated_at,
        });
    }
    drop(stmt);

    // 2) 一次性读所有 task_dates / task_tags，避免 N+1 查询
    let mut dates_by_task: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    {
        let mut s = conn
            .prepare("SELECT task_id, date FROM task_dates ORDER BY date")
            .map_err(to_err)?;
        let rows = s
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(to_err)?;
        for r in rows {
            let (tid, d) = r.map_err(to_err)?;
            dates_by_task.entry(tid).or_default().push(d);
        }
    }

    let mut tags_by_task: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    {
        let mut s = conn
            .prepare("SELECT task_id, tag_id FROM task_tags")
            .map_err(to_err)?;
        let rows = s
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(to_err)?;
        for r in rows {
            let (tid, tg) = r.map_err(to_err)?;
            tags_by_task.entry(tid).or_default().push(tg);
        }
    }

    // 3) 装配
    for t in tasks.iter_mut() {
        if let Some(d) = dates_by_task.remove(&t.id) {
            t.scheduled_dates = d;
        }
        if let Some(tg) = tags_by_task.remove(&t.id) {
            t.tag_ids = tg;
        }
    }

    Ok(tasks)
}

#[tauri::command]
pub fn upsert_task(state: State<AppState>, task: Task) -> Result<(), String> {
    let mut conn = state.conn.lock();
    let tx = conn.transaction().map_err(to_err)?;

    tx.execute(
        r#"
        INSERT INTO tasks (
            id, title, description, status, priority, "order",
            doc_url, doc_title, color, completed_at, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
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
            updated_at = excluded.updated_at
        "#,
        params![
            task.id,
            task.title,
            task.description,
            task.status.as_str(),
            task.priority.as_str(),
            task.order,
            task.doc_url,
            task.doc_title,
            task.color,
            task.completed_at,
            task.created_at,
            task.updated_at,
        ],
    )
    .map_err(to_err)?;

    // 关联表全量替换：先清后写
    tx.execute("DELETE FROM task_dates WHERE task_id = ?1", params![task.id])
        .map_err(to_err)?;
    for d in &task.scheduled_dates {
        tx.execute(
            "INSERT OR IGNORE INTO task_dates (task_id, date) VALUES (?1, ?2)",
            params![task.id, d],
        )
        .map_err(to_err)?;
    }

    tx.execute("DELETE FROM task_tags WHERE task_id = ?1", params![task.id])
        .map_err(to_err)?;
    for tg in &task.tag_ids {
        tx.execute(
            "INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
            params![task.id, tg],
        )
        .map_err(to_err)?;
    }

    tx.commit().map_err(to_err)?;
    Ok(())
}

#[tauri::command]
pub fn delete_task(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.conn.lock();
    // ON DELETE CASCADE 已自动清理 task_dates / task_tags
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])
        .map_err(to_err)?;
    Ok(())
}

// ────────────────────────────────────────────────────────────────
// Tags
// ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_tags(state: State<AppState>) -> Result<Vec<Tag>, String> {
    let conn = state.conn.lock();
    let mut stmt = conn
        .prepare(r#"SELECT id, name, parent_id, color, "order" FROM tags"#)
        .map_err(to_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                color: row.get(3)?,
                order: row.get(4)?,
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
pub fn upsert_tag(state: State<AppState>, tag: Tag) -> Result<(), String> {
    let conn = state.conn.lock();
    conn.execute(
        r#"
        INSERT INTO tags (id, name, parent_id, color, "order")
        VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            parent_id = excluded.parent_id,
            color = excluded.color,
            "order" = excluded."order"
        "#,
        params![tag.id, tag.name, tag.parent_id, tag.color, tag.order],
    )
    .map_err(to_err)?;
    Ok(())
}

#[tauri::command]
pub fn delete_tag(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.conn.lock();
    // 子标签和 task_tags 通过 ON DELETE CASCADE 自动清理
    conn.execute("DELETE FROM tags WHERE id = ?1", params![id])
        .map_err(to_err)?;
    Ok(())
}

// ────────────────────────────────────────────────────────────────
// Pomodoros
// ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_pomodoros(state: State<AppState>) -> Result<Vec<PomodoroSession>, String> {
    let conn = state.conn.lock();
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, task_id, type, duration_sec, completed, started_at, ended_at
            FROM pomodoros
            ORDER BY started_at
            "#,
        )
        .map_err(to_err)?;
    let rows = stmt
        .query_map([], |row| {
            let type_str: String = row.get(2)?;
            let completed_int: i32 = row.get(4)?;
            Ok(PomodoroSession {
                id: row.get(0)?,
                task_id: row.get::<_, Option<String>>(1)?,
                type_: PomodoroType::from_str(&type_str),
                duration_sec: row.get(3)?,
                completed: completed_int != 0,
                started_at: row.get(5)?,
                ended_at: row.get(6)?,
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
pub fn insert_pomodoro(
    state: State<AppState>,
    pomodoro: PomodoroSession,
) -> Result<(), String> {
    let conn = state.conn.lock();
    conn.execute(
        r#"
        INSERT OR REPLACE INTO pomodoros
            (id, task_id, type, duration_sec, completed, started_at, ended_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        "#,
        params![
            pomodoro.id,
            pomodoro.task_id,
            pomodoro.type_.as_str(),
            pomodoro.duration_sec,
            if pomodoro.completed { 1 } else { 0 },
            pomodoro.started_at,
            pomodoro.ended_at,
        ],
    )
    .map_err(to_err)?;
    Ok(())
}

#[tauri::command]
pub fn delete_pomodoro(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.conn.lock();
    conn.execute("DELETE FROM pomodoros WHERE id = ?1", params![id])
        .map_err(to_err)?;
    Ok(())
}

// ────────────────────────────────────────────────────────────────
// Maintenance
// ────────────────────────────────────────────────────────────────

/// 清空所有用户数据（用于侧边栏「重置 demo 数据」入口）。
/// 不删除表结构本身。
#[tauri::command]
pub fn clear_all(state: State<AppState>) -> Result<(), String> {
    let mut conn = state.conn.lock();
    let tx = conn.transaction().map_err(to_err)?;
    // 关联表先于主表删除（虽然有 CASCADE，显式删一次更直观）
    tx.execute("DELETE FROM task_tags", []).map_err(to_err)?;
    tx.execute("DELETE FROM task_dates", []).map_err(to_err)?;
    tx.execute("DELETE FROM pomodoros", []).map_err(to_err)?;
    tx.execute("DELETE FROM tasks", []).map_err(to_err)?;
    tx.execute("DELETE FROM tags", []).map_err(to_err)?;
    tx.commit().map_err(to_err)?;
    Ok(())
}
