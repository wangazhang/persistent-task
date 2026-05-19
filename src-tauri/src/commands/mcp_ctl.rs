// Tauri commands for the GUI "高级" page
//
// 前端通过这些 invoke 控制 MCP HTTP 服务的启停和读取/修改设置。

use crate::db::AppState;
use crate::mcp::control::{McpController, McpStatus};
use crate::settings::{self, McpSettings};
use tauri::State;

fn to_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
pub fn get_mcp_settings(state: State<AppState>) -> Result<McpSettings, String> {
    settings::read_mcp_settings(&state).map_err(to_err)
}

#[tauri::command]
pub fn set_mcp_http_port(state: State<AppState>, port: u16) -> Result<(), String> {
    settings::set_u16(&state, settings::KEY_HTTP_PORT, port).map_err(to_err)
}

#[tauri::command]
pub fn set_mcp_allow_write(state: State<AppState>, allow: bool) -> Result<(), String> {
    settings::set_bool(&state, settings::KEY_ALLOW_WRITE, allow).map_err(to_err)
}

#[tauri::command]
pub fn set_mcp_allow_destructive(state: State<AppState>, allow: bool) -> Result<(), String> {
    settings::set_bool(&state, settings::KEY_ALLOW_DESTRUCTIVE, allow).map_err(to_err)
}

#[tauri::command]
pub fn get_mcp_status(controller: State<McpController>) -> McpStatus {
    controller.status()
}

#[tauri::command]
pub fn start_mcp_server(
    state: State<AppState>,
    controller: State<McpController>,
) -> Result<McpStatus, String> {
    // 同时把 enabled = true 写到 settings，下次启动自动起
    settings::set_bool(&state, settings::KEY_HTTP_ENABLED, true).map_err(to_err)?;
    let s = settings::read_mcp_settings(&state).map_err(to_err)?;
    controller.start(s.http_port).map_err(to_err)
}

#[tauri::command]
pub fn stop_mcp_server(
    state: State<AppState>,
    controller: State<McpController>,
) -> Result<McpStatus, String> {
    settings::set_bool(&state, settings::KEY_HTTP_ENABLED, false).map_err(to_err)?;
    controller.stop().map_err(to_err)
}
