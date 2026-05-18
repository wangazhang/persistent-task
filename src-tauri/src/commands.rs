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
use crate::models::{
    AnalyticsEvent, EventCountRow, EventFilter, EventGroupBy, EventSource,
    PomodoroSession, PomodoroType, Tag, Task, TaskDoc, TaskPriority, TaskStatus,
};
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
                   doc_url, doc_title, color, completed_at, created_at, updated_at,
                   review_log
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
                row.get::<_, Option<String>>(12)?,         // review_log
            ))
        })
        .map_err(to_err)?;

    let mut tasks: Vec<Task> = Vec::new();
    for r in task_rows {
        let (
            id,
            title,
            description,
            status,
            priority,
            order,
            doc_url,
            doc_title,
            color,
            completed_at,
            created_at,
            updated_at,
            review_log,
        ) = r.map_err(to_err)?;
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
            docs: vec![],
            doc_url,
            doc_title,
            completed_at,
            created_at,
            updated_at,
            review_log,
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

    let mut docs_by_task: std::collections::HashMap<String, Vec<TaskDoc>> =
        std::collections::HashMap::new();
    {
        let mut s = conn
            .prepare(
                r#"SELECT task_id, id, title, url FROM task_docs ORDER BY task_id, "order", id"#,
            )
            .map_err(to_err)?;
        let rows = s
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    TaskDoc {
                        id: row.get::<_, String>(1)?,
                        title: row.get::<_, String>(2)?,
                        url: row.get::<_, String>(3)?,
                    },
                ))
            })
            .map_err(to_err)?;
        for r in rows {
            let (tid, doc) = r.map_err(to_err)?;
            docs_by_task.entry(tid).or_default().push(doc);
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
        if let Some(docs) = docs_by_task.remove(&t.id) {
            t.docs = docs;
        }
    }

    Ok(tasks)
}

#[tauri::command]
pub fn upsert_task(state: State<AppState>, task: Task) -> Result<(), String> {
    let mut conn = state.conn.lock();
    let tx = conn.transaction().map_err(to_err)?;

    // 把 docs[0] 同步到老的 doc_url/doc_title 列，确保两种字段一致：
    //   - 给老代码读取留向后兼容
    //   - 避免 docs 被清空后老字段还在残留、下次启动 backfill 再回填
    let (legacy_url, legacy_title) = match task.docs.first() {
        Some(d) => (Some(d.url.clone()), Some(d.title.clone())),
        None => (task.doc_url.clone(), task.doc_title.clone()),
    };

    tx.execute(
        r#"
        INSERT INTO tasks (
            id, title, description, status, priority, "order",
            doc_url, doc_title, color, completed_at, created_at, updated_at,
            review_log
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
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
            updated_at = excluded.updated_at,
            review_log = excluded.review_log
        "#,
        params![
            task.id,
            task.title,
            task.description,
            task.status.as_str(),
            task.priority.as_str(),
            task.order,
            legacy_url,
            legacy_title,
            task.color,
            task.completed_at,
            task.created_at,
            task.updated_at,
            task.review_log,
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

    tx.execute("DELETE FROM task_docs WHERE task_id = ?1", params![task.id])
        .map_err(to_err)?;
    for (idx, doc) in task.docs.iter().enumerate() {
        tx.execute(
            r#"INSERT OR REPLACE INTO task_docs (task_id, id, title, url, "order")
               VALUES (?1, ?2, ?3, ?4, ?5)"#,
            params![task.id, doc.id, doc.title, doc.url, idx as i32],
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
    tx.execute("DELETE FROM task_docs", []).map_err(to_err)?;
    tx.execute("DELETE FROM pomodoros", []).map_err(to_err)?;
    tx.execute("DELETE FROM tasks", []).map_err(to_err)?;
    tx.execute("DELETE FROM tags", []).map_err(to_err)?;
    tx.commit().map_err(to_err)?;
    Ok(())
}

// ────────────────────────────────────────────────────────────────
// Backup / Restore
// ────────────────────────────────────────────────────────────────

/// 导出当前数据库为 SQLite 文件字节。
///
/// 实现：持锁后直接读取磁盘文件。默认 rollback journal 模式下，
/// 文件本身就是完整数据库（无独立 WAL），无需 VACUUM INTO。
#[tauri::command]
pub fn export_db(state: State<AppState>) -> Result<Vec<u8>, String> {
    let _guard = state.conn.lock();
    std::fs::read(&state.db_path).map_err(to_err)
}

/// 直接把数据库文件复制到指定路径。
///
/// 桌面端 webview 不支持 `<a download>`，由前端通过 tauri-plugin-dialog 弹
/// 原生保存对话框拿到 path 后调本命令，避免把整库走 JSON IPC 序列化两次。
#[tauri::command]
pub fn export_db_to_path(state: State<AppState>, path: String) -> Result<(), String> {
    let _guard = state.conn.lock();
    std::fs::copy(&state.db_path, &path)
        .map(|_| ())
        .map_err(|e| format!("写出文件失败：{}", e))
}

/// 用传入的 SQLite 字节替换当前数据库。
///
/// 流程：
///   1. 写入临时文件 `<db_path>.import.tmp`
///   2. 用 rusqlite 打开临时文件并跑一次 migrate 校验结构
///   3. 关闭旧连接（替换为内存占位）
///   4. 原子 rename 替换主文件
///   5. 重新打开 + migrate，写回 AppState
///
/// 任意一步失败都会清理临时文件，且不动主文件。
#[tauri::command]
pub fn replace_db(state: State<AppState>, bytes: Vec<u8>) -> Result<(), String> {
    use rusqlite::Connection;

    let mut tmp_path = state.db_path.clone();
    let mut name = tmp_path
        .file_name()
        .map(|s| s.to_os_string())
        .unwrap_or_else(|| "db".into());
    name.push(".import.tmp");
    tmp_path.set_file_name(&name);

    // 1. 写临时文件
    std::fs::write(&tmp_path, &bytes).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        format!("写入临时文件失败：{}", e)
    })?;

    // 2. 校验：打开临时文件、跑 migrate（migrate 是幂等的 CREATE IF NOT EXISTS）
    let validate_result = (|| -> Result<(), String> {
        let tmp_conn = Connection::open(&tmp_path)
            .map_err(|e| format!("打开临时数据库失败：{}", e))?;
        crate::db::AppState::migrate(&tmp_conn)
            .map_err(|e| format!("校验数据库结构失败：{}", e))?;
        // tmp_conn 在此处 drop，释放文件
        Ok(())
    })();
    if let Err(e) = validate_result {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(e);
    }

    // 3. 锁主连接，关闭后替换文件
    let mut guard = state.conn.lock();
    let placeholder = Connection::open_in_memory()
        .map_err(|e| format!("创建占位连接失败：{}", e))?;
    let old = std::mem::replace(&mut *guard, placeholder);
    drop(old);

    if let Err(e) = std::fs::rename(&tmp_path, &state.db_path) {
        // 替换失败，重新打开旧文件让 AppState 仍可用
        let recovered = Connection::open(&state.db_path)
            .map_err(|e2| format!("替换失败且无法恢复旧库：{} / {}", e, e2))?;
        *guard = recovered;
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!("替换数据库文件失败：{}", e));
    }

    // 4. 重新打开 + migrate，写回 state
    let new_conn = Connection::open(&state.db_path)
        .map_err(|e| format!("重新打开数据库失败：{}", e))?;
    crate::db::AppState::migrate(&new_conn)
        .map_err(|e| format!("迁移新数据库失败：{}", e))?;
    *guard = new_conn;

    Ok(())
}

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
