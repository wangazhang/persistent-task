// Tauri 命令薄壳层
//
// 这一层只负责把 `State<AppState>` 解开后转交给 `core::*` 的纯函数，
// 同时把 anyhow::Error 统一映射成 String（Tauri 命令对错误类型的要求）。
// 业务逻辑全部在 `core` 模块，MCP server 也复用同一份实现。

pub mod core;
pub mod mcp_ctl;

use crate::db::AppState;
use crate::models::{
    AnalyticsEvent, EventCountRow, EventFilter, EventGroupBy, PomodoroSession, Tag, Task,
};
use tauri::State;

fn to_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Tasks ──

#[tauri::command]
pub fn list_tasks(state: State<AppState>) -> Result<Vec<Task>, String> {
    core::list_tasks(&state).map_err(to_err)
}

#[tauri::command]
pub fn upsert_task(state: State<AppState>, task: Task) -> Result<(), String> {
    core::upsert_task(&state, &task).map_err(to_err)
}

#[tauri::command]
pub fn delete_task(state: State<AppState>, id: String) -> Result<(), String> {
    core::delete_task(&state, &id).map_err(to_err)
}

// ── Tags ──

#[tauri::command]
pub fn list_tags(state: State<AppState>) -> Result<Vec<Tag>, String> {
    core::list_tags(&state).map_err(to_err)
}

#[tauri::command]
pub fn upsert_tag(state: State<AppState>, tag: Tag) -> Result<(), String> {
    core::upsert_tag(&state, &tag).map_err(to_err)
}

#[tauri::command]
pub fn delete_tag(state: State<AppState>, id: String) -> Result<(), String> {
    core::delete_tag(&state, &id).map_err(to_err)
}

// ── Pomodoros ──

#[tauri::command]
pub fn list_pomodoros(state: State<AppState>) -> Result<Vec<PomodoroSession>, String> {
    core::list_pomodoros(&state).map_err(to_err)
}

#[tauri::command]
pub fn insert_pomodoro(
    state: State<AppState>,
    pomodoro: PomodoroSession,
) -> Result<(), String> {
    core::insert_pomodoro(&state, &pomodoro).map_err(to_err)
}

#[tauri::command]
pub fn delete_pomodoro(state: State<AppState>, id: String) -> Result<(), String> {
    core::delete_pomodoro(&state, &id).map_err(to_err)
}

// ── Maintenance / Backup ──

#[tauri::command]
pub fn clear_all(state: State<AppState>) -> Result<(), String> {
    core::clear_all(&state).map_err(to_err)
}

#[tauri::command]
pub fn export_db(state: State<AppState>) -> Result<Vec<u8>, String> {
    core::export_db(&state).map_err(to_err)
}

#[tauri::command]
pub fn export_db_to_path(state: State<AppState>, path: String) -> Result<(), String> {
    core::export_db_to_path(&state, &path).map_err(to_err)
}

#[tauri::command]
pub fn replace_db(state: State<AppState>, bytes: Vec<u8>) -> Result<(), String> {
    core::replace_db(&state, &bytes).map_err(to_err)
}

// ── Events ──

#[tauri::command]
pub fn insert_events(
    state: State<AppState>,
    events: Vec<AnalyticsEvent>,
) -> Result<(), String> {
    core::insert_events(&state, &events).map_err(to_err)
}

#[tauri::command]
pub fn query_events(
    state: State<AppState>,
    filter: EventFilter,
) -> Result<Vec<AnalyticsEvent>, String> {
    core::query_events(&state, &filter).map_err(to_err)
}

#[tauri::command]
pub fn count_events(
    state: State<AppState>,
    filter: EventFilter,
    group_by: EventGroupBy,
) -> Result<Vec<EventCountRow>, String> {
    core::count_events(&state, &filter, group_by).map_err(to_err)
}
