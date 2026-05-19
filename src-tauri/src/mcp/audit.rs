// MCP 审计日志
//
// 每次成功的 MCP 写工具调用，往 events 表插一条 `mcp.tool.invoked`，
// 之后通过 query_events 工具或前端"统计面板"可以回查"哪个 agent 改了什么"。
//
// 失败的调用（限流被拒、权限被拒）不记录，否则攻击者用刷调用淹掉日志。

use crate::commands::core;
use crate::db::AppState;
use crate::models::{AnalyticsEvent, EventSource};

const MCP_SESSION_ID: &str = "mcp";

pub fn record_tool_invoked(
    state: &AppState,
    tool_name: &str,
    entity_type: Option<&str>,
    entity_id: Option<&str>,
    extra_props: Option<serde_json::Value>,
) {
    let mut props = serde_json::Map::new();
    props.insert("tool".into(), serde_json::Value::String(tool_name.into()));
    if let Some(v) = extra_props {
        if let serde_json::Value::Object(m) = v {
            for (k, vv) in m {
                props.insert(k, vv);
            }
        }
    }

    let event = AnalyticsEvent {
        id: format!("mcp_{}", super::tools::uuid_like()),
        r#type: "mcp.tool.invoked".into(),
        occurred_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        entity_type: entity_type.map(|s| s.to_string()),
        entity_id: entity_id.map(|s| s.to_string()),
        session_id: MCP_SESSION_ID.into(),
        source: EventSource::Auto,
        props: serde_json::Value::Object(props),
    };

    // 审计写失败不应阻塞主流程，吞掉错误但 eprintln
    if let Err(e) = core::insert_events(state, &[event]) {
        eprintln!("[mcp][audit] failed to insert audit event: {:#}", e);
    }
}
