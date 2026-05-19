// PersistentTaskMcpServer：rmcp 工具路由器
//
// 工具按域拆到 `tools/` 子模块，每个子模块用独立的 `#[tool_router(router = X, vis = pub)]`
// 生成自己的 ToolRouter，然后在 new() 里 merge 进总 router。
// 这样 30 个工具可以分文件维护，编译期类型检查仍然完整。

use crate::db::AppState;
use crate::settings;
use rmcp::{
    ErrorData as McpError, ServerHandler,
    handler::server::{
        router::tool::ToolRouter,
        wrapper::{Json, Parameters},
    },
    model::{
        Implementation, ListResourcesResult, PaginatedRequestParams, ReadResourceRequestParams,
        ReadResourceResult, ServerCapabilities, ServerInfo,
    },
    service::RequestContext,
    tool, tool_handler, tool_router,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Clone)]
pub struct PersistentTaskMcpServer {
    pub state: Arc<AppState>,
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema, Default)]
pub struct PingArgs {}

#[derive(Debug, Serialize, JsonSchema)]
pub struct PingOutput {
    pub server: String,
    pub version: String,
    pub db_path: String,
    pub status: String,
}

#[tool_router]
impl PersistentTaskMcpServer {
    pub fn new(state: Arc<AppState>) -> Self {
        // 合并各域的子路由器
        let router = Self::tool_router()
            + Self::task_tool_router()
            + Self::tag_tool_router()
            + Self::pomodoro_tool_router()
            + Self::analytics_tool_router()
            + Self::admin_tool_router();
        Self {
            state,
            tool_router: router,
        }
    }

    #[tool(
        name = "ping",
        description = "健康检查：返回 MCP server 元信息和当前打开的数据库路径。\
         agent 接入后可先调一次确认连通性。"
    )]
    async fn ping(
        &self,
        _params: Parameters<PingArgs>,
    ) -> Result<Json<PingOutput>, McpError> {
        Ok(Json(PingOutput {
            server: "persistent-task".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            db_path: self.state.db_path.display().to_string(),
            status: "ok".into(),
        }))
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for PersistentTaskMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .build(),
        )
        .with_server_info(Implementation::new(
            "persistent-task",
            env!("CARGO_PKG_VERSION"),
        ))
        .with_instructions(
            "持续任务桌面 app 的 MCP 接口。可读写任务/标签/番茄钟/统计事件。\
             写工具默认禁用；进入桌面 app 高级菜单开启「允许写工具」后可用。\
             危险工具（数据库导入/清空）需要单独开启「允许危险工具」。\
             5 个只读 Resource（task://today / overdue / tag://tree / stats://summary / schema://types）\
             可用于让 agent 在对话开头加载上下文。",
        )
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<rmcp::RoleServer>,
    ) -> Result<ListResourcesResult, McpError> {
        Ok(crate::mcp::resources::list())
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<rmcp::RoleServer>,
    ) -> Result<ReadResourceResult, McpError> {
        crate::mcp::resources::read(&self.state, &request.uri)
    }
}

// ── 工具辅助 ──

/// 把 anyhow / 字符串错误统一映射为 MCP 错误结构
pub fn to_mcp_err<E: std::fmt::Display>(e: E) -> McpError {
    McpError::internal_error(e.to_string(), None)
}

/// 写工具入口前调用：未在 GUI 中启用「允许写工具」时直接拒绝；
/// 通过后再检查速率限制（60 次/分钟）。
pub fn require_write(state: &AppState) -> Result<(), McpError> {
    match settings::get_bool(state, settings::KEY_ALLOW_WRITE, false) {
        Ok(true) => {}
        Ok(false) => {
            return Err(McpError::invalid_request(
                "MCP 写权限未启用。请在桌面 app 的「高级」菜单中打开「允许写工具」。",
                None,
            ));
        }
        Err(e) => return Err(to_mcp_err(e)),
    }
    crate::mcp::security::check_write_limit()
}

/// 危险工具（admin / replace_db / clear_all）入口：
/// 需要两个开关都打开，并通过更严格的速率限制（5 次/分钟）。
#[allow(dead_code)]
pub fn require_destructive(state: &AppState) -> Result<(), McpError> {
    require_write(state)?;
    match settings::get_bool(state, settings::KEY_ALLOW_DESTRUCTIVE, false) {
        Ok(true) => {}
        Ok(false) => {
            return Err(McpError::invalid_request(
                "MCP 危险操作未启用。请在桌面 app 的「高级」菜单中打开「允许危险工具」。",
                None,
            ));
        }
        Err(e) => return Err(to_mcp_err(e)),
    }
    crate::mcp::security::check_destructive_limit()
}
