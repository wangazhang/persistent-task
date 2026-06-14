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

// ── AI 快速录入 ──
//   ai.anthropic_api_key  string — Anthropic API Key（明文存本地 SQLite；为空时回退环境变量）
//   ai.model              string — 模型 id（默认 claude-sonnet-4-6，抽取类任务足够且更快更省）
//   ai.base_url           string — 可选，自建网关 / 代理地址（默认官方）
pub const KEY_AI_API_KEY: &str = "ai.anthropic_api_key";
pub const KEY_AI_MODEL: &str = "ai.model";
pub const KEY_AI_BASE_URL: &str = "ai.base_url";

pub const DEFAULT_AI_MODEL: &str = "claude-sonnet-4-6";
pub const DEFAULT_AI_BASE_URL: &str = "https://api.anthropic.com";
/// API Key 为空时的环境变量兜底（仅 key 走兜底；model/base_url 用默认）
pub const ENV_AI_API_KEY: &str = "ANTHROPIC_API_KEY";

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

/// AI 快速录入配置快照。`api_key` 已掺入环境变量兜底（前端展示前应做掩码）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    /// 生效的 API Key（settings 表为空时回退环境变量）。可能为空串=未配置。
    pub api_key: String,
    pub model: String,
    pub base_url: String,
}

impl AiSettings {
    /// 是否已配置可用的 Key
    pub fn has_key(&self) -> bool {
        !self.api_key.trim().is_empty()
    }
}

/// 解析生效 API Key：settings 表值优先，为空时回退环境变量；空白串视作未设置。
///
/// 抽成纯函数便于单测（不触碰全局 env），调用方传入两个来源。
pub fn resolve_api_key(table: Option<String>, env: Option<String>) -> String {
    let pick = |v: Option<String>| v.filter(|s| !s.trim().is_empty());
    pick(table).or_else(|| pick(env)).unwrap_or_default()
}

/// 读取 AI 配置。Key 走 settings 表 → 环境变量兜底；model/base_url 缺省用默认值。
pub fn read_ai_settings(state: &AppState) -> Result<AiSettings> {
    let table_key = get_raw(state, KEY_AI_API_KEY)?;
    let env_key = std::env::var(ENV_AI_API_KEY).ok();
    let model = get_raw(state, KEY_AI_MODEL)?
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_AI_MODEL.to_string());
    let base_url = get_raw(state, KEY_AI_BASE_URL)?
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_AI_BASE_URL.to_string());
    Ok(AiSettings {
        api_key: resolve_api_key(table_key, env_key),
        model,
        base_url,
    })
}

/// 写入 AI 配置。
/// - `api_key` 为 `None` 表示保持现有 Key 不动；`Some("")`/空白 表示清空（回退默认/环境变量）。
/// - `model` / `base_url` 空串表示清空该项（让其回退默认值）。
pub fn write_ai_settings(
    state: &AppState,
    api_key: Option<&str>,
    model: &str,
    base_url: &str,
) -> Result<()> {
    let upsert_or_clear = |key: &str, value: &str| -> Result<()> {
        if value.trim().is_empty() {
            delete(state, key)
        } else {
            set_raw(state, key, value)
        }
    };
    if let Some(k) = api_key {
        upsert_or_clear(KEY_AI_API_KEY, k)?;
    }
    upsert_or_clear(KEY_AI_MODEL, model)?;
    upsert_or_clear(KEY_AI_BASE_URL, base_url)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_key_prefers_table_then_env() {
        // 表里有值：直接用表
        assert_eq!(
            resolve_api_key(Some("sk-table".into()), Some("sk-env".into())),
            "sk-table"
        );
        // 表为空：回退环境变量
        assert_eq!(
            resolve_api_key(None, Some("sk-env".into())),
            "sk-env"
        );
        // 表是空白串：视作未设置，回退环境变量
        assert_eq!(
            resolve_api_key(Some("   ".into()), Some("sk-env".into())),
            "sk-env"
        );
        // 都没有：空串
        assert_eq!(resolve_api_key(None, None), "");
    }
}
