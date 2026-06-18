// 业务逻辑核心层
//
// 把原本写在 `#[tauri::command]` 函数体里的 SQL/事务逻辑抽到这里，
// 签名统一为 `(state: &AppState, ...) -> anyhow::Result<T>`，
// 这样 Tauri 命令层和 MCP 工具层可以共用同一份实现，零分叉。
//
// 设计取舍：
//   - 错误用 anyhow，调用方自己决定怎么映射（Tauri 转 String，MCP 转 ErrorData）。
//   - 这里的函数都是同步的（rusqlite 是 sync），调用方如果在 async 上下文里
//     需要走 spawn_blocking 自己包；MCP 工具会在异步函数里包一层。
//   - 所有"全量替换"语义（upsert_task / upsert_tag）保持原 commands.rs 的事务边界，
//     无任何行为变更。

use crate::db::AppState;
use crate::models::{
    AnalyticsEvent, EventCountRow, EventFilter, EventGroupBy, EventSource,
    PomodoroSession, PomodoroType, Tag, Task, TaskDoc, TaskPriority, TaskStatus,
};
use anyhow::{Context, Result};
use rusqlite::params;

// ────────────────────────────────────────────────────────────────
// Tasks
// ────────────────────────────────────────────────────────────────

pub fn list_tasks(state: &AppState) -> Result<Vec<Task>> {
    let conn = state.conn.lock();

    let mut stmt = conn.prepare(
        r#"
        SELECT id, title, description, status, priority, "order",
               doc_url, doc_title, color, completed_at, created_at, updated_at,
               review_log
        FROM tasks
        "#,
    )?;
    let task_rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, i32>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<String>>(8)?,
            row.get::<_, Option<String>>(9)?,
            row.get::<_, String>(10)?,
            row.get::<_, String>(11)?,
            row.get::<_, Option<String>>(12)?,
        ))
    })?;

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
        ) = r?;
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

    let mut dates_by_task: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    {
        let mut s = conn.prepare("SELECT task_id, date FROM task_dates ORDER BY date")?;
        let rows = s.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for r in rows {
            let (tid, d) = r?;
            dates_by_task.entry(tid).or_default().push(d);
        }
    }

    let mut tags_by_task: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    {
        let mut s = conn.prepare("SELECT task_id, tag_id FROM task_tags")?;
        let rows = s.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for r in rows {
            let (tid, tg) = r?;
            tags_by_task.entry(tid).or_default().push(tg);
        }
    }

    let mut docs_by_task: std::collections::HashMap<String, Vec<TaskDoc>> =
        std::collections::HashMap::new();
    {
        let mut s = conn.prepare(
            r#"SELECT task_id, id, title, url FROM task_docs ORDER BY task_id, "order", id"#,
        )?;
        let rows = s.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                TaskDoc {
                    id: row.get::<_, String>(1)?,
                    title: row.get::<_, String>(2)?,
                    url: row.get::<_, String>(3)?,
                },
            ))
        })?;
        for r in rows {
            let (tid, doc) = r?;
            docs_by_task.entry(tid).or_default().push(doc);
        }
    }

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

pub fn get_task(state: &AppState, id: &str) -> Result<Option<Task>> {
    Ok(list_tasks(state)?.into_iter().find(|t| t.id == id))
}

pub fn upsert_task(state: &AppState, task: &Task) -> Result<()> {
    let mut conn = state.conn.lock();
    let tx = conn.transaction()?;

    // 把 docs[0] 同步到老的 doc_url/doc_title 列，保证两种字段一致：
    //   - 给老代码读取留向后兼容
    //   - 避免 docs 被清空后老字段还残留、下次启动 backfill 再回填
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
    )?;

    tx.execute("DELETE FROM task_dates WHERE task_id = ?1", params![task.id])?;
    for d in &task.scheduled_dates {
        tx.execute(
            "INSERT OR IGNORE INTO task_dates (task_id, date) VALUES (?1, ?2)",
            params![task.id, d],
        )?;
    }

    tx.execute("DELETE FROM task_tags WHERE task_id = ?1", params![task.id])?;
    for tg in &task.tag_ids {
        tx.execute(
            "INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
            params![task.id, tg],
        )?;
    }

    tx.execute("DELETE FROM task_docs WHERE task_id = ?1", params![task.id])?;
    for (idx, doc) in task.docs.iter().enumerate() {
        tx.execute(
            r#"INSERT OR REPLACE INTO task_docs (task_id, id, title, url, "order")
               VALUES (?1, ?2, ?3, ?4, ?5)"#,
            params![task.id, doc.id, doc.title, doc.url, idx as i32],
        )?;
    }

    tx.commit()?;
    Ok(())
}

pub fn delete_task(state: &AppState, id: &str) -> Result<()> {
    let conn = state.conn.lock();
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    Ok(())
}

// ── Task 高级语义（前端 store 中已有，core 这里集中实现） ──

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn touch(task: &mut Task) {
    task.updated_at = now_iso();
}

/// 仅修改 status；status=done 时自动写 completedAt（已有则保留），离开 done 时清空
pub fn set_task_status(state: &AppState, id: &str, status: TaskStatus) -> Result<Task> {
    let mut t = get_task(state, id)?
        .with_context(|| format!("task {id} 不存在"))?;
    t.status = status;
    match status {
        TaskStatus::Done => {
            if t.completed_at.is_none() {
                t.completed_at = Some(now_iso());
            }
        }
        _ => {
            t.completed_at = None;
        }
    }
    touch(&mut t);
    upsert_task(state, &t)?;
    Ok(t)
}

/// 给任务追加一个日期到 scheduledDates（去重）
pub fn schedule_task_for_date(state: &AppState, id: &str, date: &str) -> Result<Task> {
    let mut t = get_task(state, id)?
        .with_context(|| format!("task {id} 不存在"))?;
    if !t.scheduled_dates.iter().any(|d| d == date) {
        t.scheduled_dates.push(date.to_string());
        t.scheduled_dates.sort();
    }
    touch(&mut t);
    upsert_task(state, &t)?;
    Ok(t)
}

/// 从 scheduledDates 中移除一个日期
pub fn unschedule_task_from_date(state: &AppState, id: &str, date: &str) -> Result<Task> {
    let mut t = get_task(state, id)?
        .with_context(|| format!("task {id} 不存在"))?;
    t.scheduled_dates.retain(|d| d != date);
    touch(&mut t);
    upsert_task(state, &t)?;
    Ok(t)
}

#[derive(Debug, Clone, Copy, serde::Deserialize, serde::Serialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum MoveScheduleMode {
    /// 把 from 删掉，加上 to（默认行为）
    Move,
    /// 不删 from，只追加 to
    Add,
    /// 用 to 替换整个 scheduledDates 列表
    Replace,
}

pub fn move_task_schedule(
    state: &AppState,
    id: &str,
    from_date: Option<&str>,
    to_date: &str,
    mode: MoveScheduleMode,
) -> Result<Task> {
    let mut t = get_task(state, id)?
        .with_context(|| format!("task {id} 不存在"))?;
    match mode {
        MoveScheduleMode::Move => {
            if let Some(f) = from_date {
                t.scheduled_dates.retain(|d| d != f);
            }
            if !t.scheduled_dates.iter().any(|d| d == to_date) {
                t.scheduled_dates.push(to_date.to_string());
            }
        }
        MoveScheduleMode::Add => {
            if !t.scheduled_dates.iter().any(|d| d == to_date) {
                t.scheduled_dates.push(to_date.to_string());
            }
        }
        MoveScheduleMode::Replace => {
            t.scheduled_dates = vec![to_date.to_string()];
        }
    }
    t.scheduled_dates.sort();
    touch(&mut t);
    upsert_task(state, &t)?;
    Ok(t)
}

/// 重排某一天里的任务顺序：传入按期望顺序的 task id 列表，
/// 依次写入 1/2/3... 到对应任务的 order 字段。
pub fn reorder_tasks_for_date(state: &AppState, _date: &str, ordered_ids: &[String]) -> Result<()> {
    // _date 仅做语义说明；当前数据模型 order 是任务级（不是 per-date）
    for (i, tid) in ordered_ids.iter().enumerate() {
        if let Some(mut t) = get_task(state, tid)? {
            t.order = i as i32;
            touch(&mut t);
            upsert_task(state, &t)?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, serde::Deserialize, serde::Serialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PastReviewAction {
    /// 标记为完成（追加 reviewLog 后 status -> done）
    Done,
    /// 顺延到今天（追加 reviewLog 并把今天加入 scheduledDates）
    Continue,
    /// 挂起（追加 reviewLog 并 status -> suspended）
    Suspend,
}

/// 处置过期任务，追加一条 reviewLog 并按 action 更新任务状态。
/// reviewLog 在 DB 里是 JSON 字符串，这里解码后追加再编码。
pub fn review_past_task(
    state: &AppState,
    id: &str,
    date: &str,
    action: PastReviewAction,
    reason: Option<&str>,
) -> Result<Task> {
    let mut t = get_task(state, id)?
        .with_context(|| format!("task {id} 不存在"))?;

    let mut log: Vec<serde_json::Value> = match &t.review_log {
        Some(s) if !s.is_empty() => serde_json::from_str(s).unwrap_or_default(),
        _ => Vec::new(),
    };
    let action_str = match action {
        PastReviewAction::Done => "done",
        PastReviewAction::Continue => "continue",
        PastReviewAction::Suspend => "suspend",
    };
    let mut entry = serde_json::Map::new();
    entry.insert("date".into(), serde_json::Value::String(date.into()));
    entry.insert("action".into(), serde_json::Value::String(action_str.into()));
    if let Some(r) = reason {
        entry.insert("reason".into(), serde_json::Value::String(r.into()));
    }
    log.push(serde_json::Value::Object(entry));
    t.review_log = Some(serde_json::to_string(&log)?);

    match action {
        PastReviewAction::Done => {
            t.status = TaskStatus::Done;
            if t.completed_at.is_none() {
                t.completed_at = Some(now_iso());
            }
        }
        PastReviewAction::Continue => {
            let today = chrono::Local::now().format("%Y-%m-%d").to_string();
            if !t.scheduled_dates.iter().any(|d| d == &today) {
                t.scheduled_dates.push(today);
                t.scheduled_dates.sort();
            }
        }
        PastReviewAction::Suspend => {
            t.status = TaskStatus::Suspended;
        }
    }
    touch(&mut t);
    upsert_task(state, &t)?;
    Ok(t)
}

// ────────────────────────────────────────────────────────────────
// Tags
// ────────────────────────────────────────────────────────────────

pub fn list_tags(state: &AppState) -> Result<Vec<Tag>> {
    let conn = state.conn.lock();
    let mut stmt = conn.prepare(r#"SELECT id, name, parent_id, color, "order" FROM tags"#)?;
    let rows = stmt.query_map([], |row| {
        Ok(Tag {
            id: row.get(0)?,
            name: row.get(1)?,
            parent_id: row.get(2)?,
            color: row.get(3)?,
            order: row.get(4)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn upsert_tag(state: &AppState, tag: &Tag) -> Result<()> {
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
    )?;
    Ok(())
}

pub fn delete_tag(state: &AppState, id: &str) -> Result<()> {
    let conn = state.conn.lock();
    conn.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
    Ok(())
}

// ── Tag 高级语义 ──

/// 把 tag 挪到新父节点 + 新顺序位置。其他兄弟节点的 order 重新整理。
pub fn move_tag(
    state: &AppState,
    tag_id: &str,
    new_parent_id: Option<&str>,
    new_index: usize,
) -> Result<Tag> {
    // 防自循环：检查 new_parent 不是 tag_id 的后代
    if let Some(npid) = new_parent_id {
        if npid == tag_id {
            anyhow::bail!("不能把标签移到自己");
        }
        let tags = list_tags(state)?;
        let mut cursor = Some(npid.to_string());
        while let Some(cur) = cursor {
            if cur == tag_id {
                anyhow::bail!("不能把标签移到其后代下");
            }
            cursor = tags
                .iter()
                .find(|t| t.id == cur)
                .and_then(|t| t.parent_id.clone());
        }
    }

    let mut tags = list_tags(state)?;
    let target = tags
        .iter_mut()
        .find(|t| t.id == tag_id)
        .with_context(|| format!("tag {tag_id} 不存在"))?
        .clone();

    // 找到目标父节点下的兄弟（不含自己）
    let mut siblings: Vec<Tag> = tags
        .iter()
        .filter(|t| {
            t.parent_id.as_deref() == new_parent_id && t.id != tag_id
        })
        .cloned()
        .collect();
    siblings.sort_by_key(|t| t.order);

    let mut moved = target;
    moved.parent_id = new_parent_id.map(|s| s.to_string());

    let idx = new_index.min(siblings.len());
    siblings.insert(idx, moved.clone());

    for (i, t) in siblings.iter_mut().enumerate() {
        t.order = i as i32;
        upsert_tag(state, t)?;
    }

    // 返回 moved 的最新形态
    Ok(siblings.into_iter().find(|t| t.id == tag_id).unwrap())
}

// ── Stats 聚合 ──

#[derive(Debug, Clone, serde::Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DailyStat {
    pub date: String,
    pub completed_count: i64,
    pub total_count: i64,
    pub focus_sec: i64,
}

/// 按日聚合：每天的总任务数 / 完成数 / 专注秒数。
/// total_count = 当天 task_dates 命中的任务数。
/// completed_count = 当天 task_dates 命中且 status='done' 的任务数（用 completed_at 当天的更精准；这里取 status）。
pub fn get_daily_stats(state: &AppState, from: &str, to: &str) -> Result<Vec<DailyStat>> {
    let conn = state.conn.lock();

    // 各日的任务总数 / 完成数
    let mut stmt = conn.prepare(
        "SELECT td.date, \
                COUNT(*) AS total, \
                SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done \
         FROM task_dates td JOIN tasks t ON t.id = td.task_id \
         WHERE td.date >= ?1 AND td.date <= ?2 \
         GROUP BY td.date",
    )?;
    let mut by_date: std::collections::BTreeMap<String, (i64, i64)> = Default::default();
    let rows = stmt.query_map(params![from, to], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, Option<i64>>(2)?.unwrap_or(0),
        ))
    })?;
    for r in rows {
        let (d, total, done) = r?;
        by_date.insert(d, (total, done));
    }
    drop(stmt);

    // 各日的专注秒数（pomodoros.type='focus' 且 completed=1 按 started_at 当日分组）
    let mut stmt2 = conn.prepare(
        "SELECT strftime('%Y-%m-%d', started_at, 'localtime') AS d, \
                SUM(duration_sec) AS s \
         FROM pomodoros \
         WHERE type = 'focus' AND completed = 1 \
           AND strftime('%Y-%m-%d', started_at, 'localtime') BETWEEN ?1 AND ?2 \
         GROUP BY d",
    )?;
    let mut focus_by: std::collections::HashMap<String, i64> = Default::default();
    let rows2 = stmt2.query_map(params![from, to], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<i64>>(1)?.unwrap_or(0)))
    })?;
    for r in rows2 {
        let (d, s) = r?;
        focus_by.insert(d, s);
    }
    drop(stmt2);

    // 合并：以 task_dates 出现的日期为准，专注秒数从 focus_by 取
    let mut out = Vec::new();
    let all_dates: std::collections::BTreeSet<String> = by_date
        .keys()
        .chain(focus_by.keys())
        .cloned()
        .collect();
    for d in all_dates {
        let (total, done) = by_date.get(&d).copied().unwrap_or((0, 0));
        let focus = focus_by.get(&d).copied().unwrap_or(0);
        out.push(DailyStat {
            date: d,
            completed_count: done,
            total_count: total,
            focus_sec: focus,
        });
    }
    Ok(out)
}

#[derive(Debug, Clone, serde::Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TagStat {
    pub tag_id: String,
    pub tag_name: String,
    pub tag_color: String,
    pub task_count: i64,
    pub completed_count: i64,
    pub focus_sec: i64,
}

/// 按标签聚合：每个标签下的任务数 / 完成数 / 专注秒数。
/// 专注秒数 = 该标签下任务关联的所有 focus pomodoros 之和。
pub fn get_tag_stats(state: &AppState) -> Result<Vec<TagStat>> {
    let conn = state.conn.lock();
    let mut stmt = conn.prepare(
        "SELECT tg.id, tg.name, tg.color, \
                COUNT(DISTINCT t.id) AS task_count, \
                SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done_count, \
                COALESCE((SELECT SUM(p.duration_sec) \
                          FROM pomodoros p \
                          WHERE p.task_id IN (SELECT tt2.task_id FROM task_tags tt2 WHERE tt2.tag_id = tg.id) \
                            AND p.type='focus' AND p.completed=1), 0) AS focus_sec \
         FROM tags tg \
         LEFT JOIN task_tags tt ON tt.tag_id = tg.id \
         LEFT JOIN tasks t ON t.id = tt.task_id \
         GROUP BY tg.id, tg.name, tg.color",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(TagStat {
            tag_id: row.get(0)?,
            tag_name: row.get(1)?,
            tag_color: row.get(2)?,
            task_count: row.get::<_, Option<i64>>(3)?.unwrap_or(0),
            completed_count: row.get::<_, Option<i64>>(4)?.unwrap_or(0),
            focus_sec: row.get::<_, Option<i64>>(5)?.unwrap_or(0),
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

// ────────────────────────────────────────────────────────────────
// Pomodoros
// ────────────────────────────────────────────────────────────────

pub fn list_pomodoros(state: &AppState) -> Result<Vec<PomodoroSession>> {
    let conn = state.conn.lock();
    let mut stmt = conn.prepare(
        r#"
        SELECT id, task_id, type, duration_sec, completed, started_at, ended_at
        FROM pomodoros
        ORDER BY started_at
        "#,
    )?;
    let rows = stmt.query_map([], |row| {
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
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn insert_pomodoro(state: &AppState, pomodoro: &PomodoroSession) -> Result<()> {
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
    )?;
    Ok(())
}

pub fn delete_pomodoro(state: &AppState, id: &str) -> Result<()> {
    let conn = state.conn.lock();
    conn.execute("DELETE FROM pomodoros WHERE id = ?1", params![id])?;
    Ok(())
}

// ────────────────────────────────────────────────────────────────
// Maintenance / Backup
// ────────────────────────────────────────────────────────────────

pub fn clear_all(state: &AppState) -> Result<()> {
    let mut conn = state.conn.lock();
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM task_tags", [])?;
    tx.execute("DELETE FROM task_dates", [])?;
    tx.execute("DELETE FROM task_docs", [])?;
    tx.execute("DELETE FROM pomodoros", [])?;
    tx.execute("DELETE FROM tasks", [])?;
    tx.execute("DELETE FROM tags", [])?;
    tx.commit()?;
    Ok(())
}

/// 把当前库完整导出到指定路径（独立、已整合的 .sqlite 文件）。
///
/// 为什么不是「checkpoint + fs::copy 主库文件」：
///   本应用同一个 DB 文件上有两个常驻 WAL 连接（GUI 的 AppState 与 MCP 的
///   mcp_state，见 lib.rs）。WAL 模式下只要另一个连接持有读锁，
///   `wal_checkpoint(TRUNCATE)` 就会返回 SQLITE_BUSY 且**不**把 -wal 合并进主库；
///   再 fs::copy 主库文件就会丢掉仍滞留在 -wal 里的最新写入 —— 表现为
///   「导出后再导入，最近的记录全没了」。
///
///   `VACUUM INTO` 透过连接自身的视图读取（天然包含已提交的 WAL 帧，也包含
///   另一连接提交的数据），写出一个干净、整合完毕的独立库文件，与 checkpoint
///   成败、是否有并发连接都无关。
fn vacuum_into(state: &AppState, dest: &std::path::Path) -> Result<()> {
    // VACUUM INTO 要求目标文件不存在，否则报错。覆盖导出时先删旧文件。
    if dest.exists() {
        std::fs::remove_file(dest)
            .with_context(|| format!("无法覆盖已存在的目标文件 {:?}", dest))?;
    }
    let guard = state.conn.lock();
    // 路径里可能含单引号，转义后再拼进 SQL 字面量。
    let dest_str = dest.to_string_lossy().replace('\'', "''");
    guard
        .execute_batch(&format!("VACUUM INTO '{}';", dest_str))
        .context("导出数据库失败")?;
    Ok(())
}

pub fn export_db(state: &AppState) -> Result<Vec<u8>> {
    // VACUUM INTO 到临时文件，读出字节后删除。不直接读主库文件，原因见 vacuum_into。
    let mut tmp = state.db_path.clone();
    let mut name = tmp
        .file_name()
        .map(|s| s.to_os_string())
        .unwrap_or_else(|| "db".into());
    name.push(".export.tmp");
    tmp.set_file_name(&name);

    vacuum_into(state, &tmp)?;
    let result = std::fs::read(&tmp).context("读取导出文件失败");
    let _ = std::fs::remove_file(&tmp);
    Ok(result?)
}

pub fn export_db_to_path(state: &AppState, path: &str) -> Result<()> {
    vacuum_into(state, std::path::Path::new(path))
}

pub fn replace_db(state: &AppState, bytes: &[u8]) -> Result<()> {
    use rusqlite::Connection;

    let mut tmp_path = state.db_path.clone();
    let mut name = tmp_path
        .file_name()
        .map(|s| s.to_os_string())
        .unwrap_or_else(|| "db".into());
    name.push(".import.tmp");
    tmp_path.set_file_name(&name);

    if let Err(e) = std::fs::write(&tmp_path, bytes) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(anyhow::anyhow!("写入临时文件失败：{}", e));
    }

    let validate_result = (|| -> Result<()> {
        let tmp_conn =
            Connection::open(&tmp_path).context("打开临时数据库失败")?;
        crate::db::AppState::migrate(&tmp_conn).context("校验数据库结构失败")?;
        Ok(())
    })();
    if let Err(e) = validate_result {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(e);
    }

    let mut guard = state.conn.lock();
    let placeholder = Connection::open_in_memory().context("创建占位连接失败")?;
    let old = std::mem::replace(&mut *guard, placeholder);
    drop(old);

    if let Err(e) = std::fs::rename(&tmp_path, &state.db_path) {
        let recovered = Connection::open(&state.db_path)
            .with_context(|| format!("替换失败且无法恢复旧库：{}", e))?;
        *guard = recovered;
        let _ = std::fs::remove_file(&tmp_path);
        return Err(anyhow::anyhow!("替换数据库文件失败：{}", e));
    }

    // 旧库残留的 -wal / -shm 属于被替换掉的数据库，若不清理，SQLite 重新打开时
    // 会把旧 WAL 应用到新导入的库上，导致数据错乱 / 条数对不上。
    if let Some(name) = state.db_path.file_name().map(|s| s.to_os_string()) {
        for suffix in ["-wal", "-shm"] {
            let mut sidecar = state.db_path.clone();
            let mut n = name.clone();
            n.push(suffix);
            sidecar.set_file_name(n);
            let _ = std::fs::remove_file(&sidecar);
        }
    }

    let new_conn = Connection::open(&state.db_path).context("重新打开数据库失败")?;
    crate::db::AppState::migrate(&new_conn).context("迁移新数据库失败")?;
    *guard = new_conn;

    Ok(())
}

// ────────────────────────────────────────────────────────────────
// Events
// ────────────────────────────────────────────────────────────────

pub fn insert_events(state: &AppState, events: &[AnalyticsEvent]) -> Result<()> {
    if events.is_empty() {
        return Ok(());
    }
    let mut conn = state.conn.lock();
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO events \
             (id,type,occurred_at,entity_type,entity_id,session_id,source,props) \
             VALUES (?,?,?,?,?,?,?,?)",
        )?;
        for e in events {
            let source_str = match e.source {
                EventSource::Auto => "auto",
                EventSource::Manual => "manual",
            };
            let props_json = serde_json::to_string(&e.props)?;
            stmt.execute(params![
                e.id,
                e.r#type,
                e.occurred_at,
                e.entity_type,
                e.entity_id,
                e.session_id,
                source_str,
                props_json,
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn query_events(state: &AppState, filter: &EventFilter) -> Result<Vec<AnalyticsEvent>> {
    let conn = state.conn.lock();
    let (where_sql, params_vec) = build_event_where(filter);
    let limit = filter.limit.unwrap_or(200).clamp(1, 2000);
    let offset = filter.offset.unwrap_or(0).max(0);
    let sql = format!(
        "SELECT id,type,occurred_at,entity_type,entity_id,session_id,source,props \
         FROM events {} ORDER BY occurred_at DESC, id DESC LIMIT {} OFFSET {}",
        where_sql, limit, offset
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(params_vec.iter()), |row| {
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
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn count_events(
    state: &AppState,
    filter: &EventFilter,
    group_by: EventGroupBy,
) -> Result<Vec<EventCountRow>> {
    let conn = state.conn.lock();
    let (where_sql, params_vec) = build_event_where(filter);
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
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(params_vec.iter()), |row| {
        Ok(EventCountRow {
            key: row.get::<_, String>(0)?,
            count: row.get::<_, i64>(1)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

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
