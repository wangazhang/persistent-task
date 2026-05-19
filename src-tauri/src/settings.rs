// 应用设置（KV）— 当前承载 MCP 相关开关
//
// 字段（key）约定：
//   mcp.http.enabled        bool  — 是否启动本地 HTTP MCP 服务（默认 false）
//   mcp.http.port           int   — 期望端口；冲突时实际端口会自动 +1（默认 7321）
//   mcp.http.actual_port    int   — 当前服务实际监听端口（运行时写入；停止时清空）
//   mcp.allow_write         bool  — 是否允许写工具（默认 false，安全优先）
//   mcp.allow_destructive   bool  — 是否允许 admin/危险工具（默认 false）
//
// 设计取舍：值统一以 TEXT 存（JSON 编码），调用方在使用点解析。
// 这样未来加复杂结构（数组、对象）不用改表。

use crate::db::AppState;
use anyhow::{Context, Result};
use rusqlite::{params, OptionalExtension};

pub const KEY_HTTP_ENABLED: &str = "mcp.http.enabled";
pub const KEY_HTTP_PORT: &str = "mcp.http.port";
pub const KEY_HTTP_ACTUAL_PORT: &str = "mcp.http.actual_port";
pub const KEY_ALLOW_WRITE: &str = "mcp.allow_write";
pub const KEY_ALLOW_DESTRUCTIVE: &str = "mcp.allow_destructive";

pub const DEFAULT_PORT: u16 = 7321;

pub fn get_raw(state: &AppState, key: &str) -> Result<Option<String>> {
    let conn = state.conn.lock();
    let val: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()?;
    Ok(val)
}

pub fn set_raw(state: &AppState, key: &str, value: &str) -> Result<()> {
    let conn = state.conn.lock();
    conn.execute(
        r#"
        INSERT INTO settings (key, value) VALUES (?1, ?2)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        "#,
        params![key, value],
    )?;
    Ok(())
}

pub fn delete(state: &AppState, key: &str) -> Result<()> {
    let conn = state.conn.lock();
    conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
    Ok(())
}

pub fn get_bool(state: &AppState, key: &str, default: bool) -> Result<bool> {
    match get_raw(state, key)? {
        Some(s) => Ok(matches!(s.as_str(), "true" | "1")),
        None => Ok(default),
    }
}

pub fn set_bool(state: &AppState, key: &str, value: bool) -> Result<()> {
    set_raw(state, key, if value { "true" } else { "false" })
}

pub fn get_u16(state: &AppState, key: &str, default: u16) -> Result<u16> {
    match get_raw(state, key)? {
        Some(s) => s.parse::<u16>().with_context(|| format!("setting {key} 不是合法 u16")),
        None => Ok(default),
    }
}

pub fn set_u16(state: &AppState, key: &str, value: u16) -> Result<()> {
    set_raw(state, key, &value.to_string())
}

/// 当前 MCP 配置快照（前端展示 / Rust 启停判断都用这个）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSettings {
    pub http_enabled: bool,
    pub http_port: u16,
    pub actual_port: Option<u16>,
    pub allow_write: bool,
    pub allow_destructive: bool,
}

pub fn read_mcp_settings(state: &AppState) -> Result<McpSettings> {
    Ok(McpSettings {
        http_enabled: get_bool(state, KEY_HTTP_ENABLED, false)?,
        http_port: get_u16(state, KEY_HTTP_PORT, DEFAULT_PORT)?,
        actual_port: match get_raw(state, KEY_HTTP_ACTUAL_PORT)? {
            Some(s) => s.parse::<u16>().ok(),
            None => None,
        },
        allow_write: get_bool(state, KEY_ALLOW_WRITE, false)?,
        allow_destructive: get_bool(state, KEY_ALLOW_DESTRUCTIVE, false)?,
    })
}
