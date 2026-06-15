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

// ── AI 快速录入（多 provider）──
//   ai.provider             "anthropic" | "openai"   激活的 provider（默认 anthropic）
//   ai.anthropic_api_key    Anthropic API Key（明文本地 SQLite；空时回退 ANTHROPIC_API_KEY）
//   ai.anthropic_model      模型 id（默认 claude-sonnet-4-6）
//   ai.anthropic_base_url   自建网关 / 代理（默认 https://api.anthropic.com）
//   ai.openai_api_key       OpenAI API Key（空时回退 OPENAI_API_KEY）
//   ai.openai_model         模型 id（无预设，用户从 /v1/models 拉列表选）
//   ai.openai_base_url      默认 https://api.openai.com/v1
// 兼容：旧版的 ai.model / ai.base_url 作为 anthropic 的回退来源（读取时降级链）。
pub const KEY_AI_PROVIDER: &str = "ai.provider";
pub const KEY_AI_ANTHROPIC_API_KEY: &str = "ai.anthropic_api_key";
pub const KEY_AI_ANTHROPIC_MODEL: &str = "ai.anthropic_model";
pub const KEY_AI_ANTHROPIC_BASE_URL: &str = "ai.anthropic_base_url";
pub const KEY_AI_OPENAI_API_KEY: &str = "ai.openai_api_key";
pub const KEY_AI_OPENAI_MODEL: &str = "ai.openai_model";
pub const KEY_AI_OPENAI_BASE_URL: &str = "ai.openai_base_url";

// 旧键（仅作 anthropic 的读取回退，不再写入）
const LEGACY_AI_MODEL: &str = "ai.model";
const LEGACY_AI_BASE_URL: &str = "ai.base_url";

pub const DEFAULT_ANTHROPIC_MODEL: &str = "claude-sonnet-4-6";
pub const DEFAULT_ANTHROPIC_BASE_URL: &str = "https://api.anthropic.com";
pub const DEFAULT_OPENAI_MODEL: &str = ""; // 无预设：用户拉列表选
pub const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";

pub const ENV_ANTHROPIC_API_KEY: &str = "ANTHROPIC_API_KEY";
pub const ENV_OPENAI_API_KEY: &str = "OPENAI_API_KEY";

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

/// AI provider。默认 Anthropic。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    Anthropic,
    Openai,
}

impl AiProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            AiProvider::Anthropic => "anthropic",
            AiProvider::Openai => "openai",
        }
    }
    /// 解析 provider 字符串；未知 / 空 → Anthropic（安全默认）
    pub fn from_str_lenient(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "openai" => AiProvider::Openai,
            _ => AiProvider::Anthropic,
        }
    }
}

/// 激活 provider 的已解析 AI 配置（供 parse_quick_input 用）。
/// `api_key` 已掺入环境变量兜底；可能为空串=未配置。
#[derive(Debug, Clone)]
pub struct AiSettings {
    pub provider: AiProvider,
    pub api_key: String,
    pub model: String,
    pub base_url: String,
}

impl AiSettings {
    pub fn has_key(&self) -> bool {
        !self.api_key.trim().is_empty()
    }
}

/// 单个 provider 的前端视图（不回传明文 Key）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderView {
    pub has_key: bool,
    pub model: String,
    pub base_url: String,
}

/// 完整 AI 配置视图（get_ai_settings 返回，两 provider 都带）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsView {
    pub provider: String,
    pub anthropic: AiProviderView,
    pub openai: AiProviderView,
}

/// 解析生效 API Key：settings 表值优先，为空时回退环境变量；空白串视作未设置。
/// 纯函数便于单测（不触碰全局 env）。
pub fn resolve_api_key(table: Option<String>, env: Option<String>) -> String {
    first_non_empty(&[table, env]).unwrap_or_default()
}

/// 从一串 Option 里取第一个非空白值（trim 后非空）。
pub fn first_non_empty(values: &[Option<String>]) -> Option<String> {
    values
        .iter()
        .filter_map(|v| v.clone())
        .find(|s| !s.trim().is_empty())
}

/// 取指定 key，空白视作 None。
fn get_some(state: &AppState, key: &str) -> Result<Option<String>> {
    Ok(get_raw(state, key)?.filter(|s| !s.trim().is_empty()))
}

/// 读取激活 provider 的已解析配置。
///
/// 解析链：
/// - provider: ai.provider → anthropic
/// - anthropic.model:    ai.anthropic_model → (旧)ai.model → DEFAULT_ANTHROPIC_MODEL
/// - anthropic.base_url: ai.anthropic_base_url → (旧)ai.base_url → DEFAULT_ANTHROPIC_BASE_URL
/// - openai.model/base_url: ai.openai_* → DEFAULT_OPENAI_*
/// - key: 各自 settings → 各自环境变量兜底
pub fn read_ai_settings(state: &AppState) -> Result<AiSettings> {
    let provider = AiProvider::from_str_lenient(
        &get_raw(state, KEY_AI_PROVIDER)?.unwrap_or_default(),
    );
    Ok(match provider {
        AiProvider::Anthropic => AiSettings {
            provider,
            api_key: resolve_api_key(
                get_some(state, KEY_AI_ANTHROPIC_API_KEY)?,
                std::env::var(ENV_ANTHROPIC_API_KEY).ok(),
            ),
            model: first_non_empty(&[
                get_some(state, KEY_AI_ANTHROPIC_MODEL)?,
                get_some(state, LEGACY_AI_MODEL)?,
            ])
            .unwrap_or_else(|| DEFAULT_ANTHROPIC_MODEL.to_string()),
            base_url: first_non_empty(&[
                get_some(state, KEY_AI_ANTHROPIC_BASE_URL)?,
                get_some(state, LEGACY_AI_BASE_URL)?,
            ])
            .unwrap_or_else(|| DEFAULT_ANTHROPIC_BASE_URL.to_string()),
        },
        AiProvider::Openai => AiSettings {
            provider,
            api_key: resolve_api_key(
                get_some(state, KEY_AI_OPENAI_API_KEY)?,
                std::env::var(ENV_OPENAI_API_KEY).ok(),
            ),
            model: get_some(state, KEY_AI_OPENAI_MODEL)?
                .unwrap_or_else(|| DEFAULT_OPENAI_MODEL.to_string()),
            base_url: get_some(state, KEY_AI_OPENAI_BASE_URL)?
                .unwrap_or_else(|| DEFAULT_OPENAI_BASE_URL.to_string()),
        },
    })
}

/// 读取完整视图（两 provider 都带，不回传明文 Key），供前端配置页。
pub fn read_ai_settings_view(state: &AppState) -> Result<AiSettingsView> {
    let provider = AiProvider::from_str_lenient(
        &get_raw(state, KEY_AI_PROVIDER)?.unwrap_or_default(),
    );
    let anthropic_key = resolve_api_key(
        get_some(state, KEY_AI_ANTHROPIC_API_KEY)?,
        std::env::var(ENV_ANTHROPIC_API_KEY).ok(),
    );
    let openai_key = resolve_api_key(
        get_some(state, KEY_AI_OPENAI_API_KEY)?,
        std::env::var(ENV_OPENAI_API_KEY).ok(),
    );
    Ok(AiSettingsView {
        provider: provider.as_str().to_string(),
        anthropic: AiProviderView {
            has_key: !anthropic_key.trim().is_empty(),
            model: first_non_empty(&[
                get_some(state, KEY_AI_ANTHROPIC_MODEL)?,
                get_some(state, LEGACY_AI_MODEL)?,
            ])
            .unwrap_or_else(|| DEFAULT_ANTHROPIC_MODEL.to_string()),
            base_url: first_non_empty(&[
                get_some(state, KEY_AI_ANTHROPIC_BASE_URL)?,
                get_some(state, LEGACY_AI_BASE_URL)?,
            ])
            .unwrap_or_else(|| DEFAULT_ANTHROPIC_BASE_URL.to_string()),
        },
        openai: AiProviderView {
            has_key: !openai_key.trim().is_empty(),
            model: get_some(state, KEY_AI_OPENAI_MODEL)?
                .unwrap_or_else(|| DEFAULT_OPENAI_MODEL.to_string()),
            base_url: get_some(state, KEY_AI_OPENAI_BASE_URL)?
                .unwrap_or_else(|| DEFAULT_OPENAI_BASE_URL.to_string()),
        },
    })
}

/// 切换激活 provider。
pub fn set_ai_provider(state: &AppState, provider: AiProvider) -> Result<()> {
    set_raw(state, KEY_AI_PROVIDER, provider.as_str())
}

/// 写入某个 provider 的配置。
/// - `api_key` 为 `None` 表示保持现有 Key 不动；`Some("")`/空白 表示清空（回退环境变量）。
/// - `model` / `base_url` 空串表示清空该项（回退默认）。
pub fn write_provider_settings(
    state: &AppState,
    provider: AiProvider,
    api_key: Option<&str>,
    model: &str,
    base_url: &str,
) -> Result<()> {
    let (k_key, k_model, k_base) = match provider {
        AiProvider::Anthropic => (
            KEY_AI_ANTHROPIC_API_KEY,
            KEY_AI_ANTHROPIC_MODEL,
            KEY_AI_ANTHROPIC_BASE_URL,
        ),
        AiProvider::Openai => (
            KEY_AI_OPENAI_API_KEY,
            KEY_AI_OPENAI_MODEL,
            KEY_AI_OPENAI_BASE_URL,
        ),
    };
    let upsert_or_clear = |key: &str, value: &str| -> Result<()> {
        if value.trim().is_empty() {
            delete(state, key)
        } else {
            set_raw(state, key, value)
        }
    };
    if let Some(k) = api_key {
        upsert_or_clear(k_key, k)?;
    }
    upsert_or_clear(k_model, model)?;
    upsert_or_clear(k_base, base_url)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_key_prefers_table_then_env() {
        assert_eq!(
            resolve_api_key(Some("sk-table".into()), Some("sk-env".into())),
            "sk-table"
        );
        assert_eq!(resolve_api_key(None, Some("sk-env".into())), "sk-env");
        assert_eq!(
            resolve_api_key(Some("   ".into()), Some("sk-env".into())),
            "sk-env"
        );
        assert_eq!(resolve_api_key(None, None), "");
    }

    #[test]
    fn first_non_empty_picks_first_meaningful() {
        // 第一个非空白
        assert_eq!(
            first_non_empty(&[Some("  ".into()), Some("a".into()), Some("b".into())]),
            Some("a".to_string())
        );
        // 全空 / None → None
        assert_eq!(
            first_non_empty(&[None, Some("".into()), Some("\t".into())]),
            None
        );
        // 模型解析链场景：specific 空、legacy 有值 → 用 legacy
        assert_eq!(
            first_non_empty(&[None, Some("claude-legacy".into())]),
            Some("claude-legacy".to_string())
        );
    }

    #[test]
    fn provider_parse_defaults_to_anthropic() {
        assert_eq!(AiProvider::from_str_lenient("openai"), AiProvider::Openai);
        assert_eq!(AiProvider::from_str_lenient("OpenAI"), AiProvider::Openai);
        assert_eq!(
            AiProvider::from_str_lenient("anthropic"),
            AiProvider::Anthropic
        );
        // 未知 / 空白 → Anthropic
        assert_eq!(AiProvider::from_str_lenient("gpt"), AiProvider::Anthropic);
        assert_eq!(AiProvider::from_str_lenient(""), AiProvider::Anthropic);
        // round-trip
        assert_eq!(AiProvider::Openai.as_str(), "openai");
        assert_eq!(AiProvider::Anthropic.as_str(), "anthropic");
    }
}
