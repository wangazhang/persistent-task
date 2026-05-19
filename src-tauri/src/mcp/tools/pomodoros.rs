// Pomodoro 域 MCP 工具（3 个）

use crate::commands::core;
use crate::mcp::server::{require_write, to_mcp_err, PersistentTaskMcpServer};
use crate::models::{PomodoroSession, PomodoroType};
use rmcp::{
    ErrorData as McpError,
    handler::server::wrapper::{Json, Parameters},
    tool, tool_router,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListPomodorosArgs {
    /// 只看某个任务的番茄记录
    pub task_id: Option<String>,
    /// 起始日期 yyyy-MM-dd（含）
    pub from: Option<String>,
    /// 结束日期 yyyy-MM-dd（含）
    pub to: Option<String>,
    /// 类型过滤：focus / short_break / long_break
    pub pomo_type: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LogPomodoroArgs {
    /// focus / short_break / long_break
    pub pomo_type: String,
    pub duration_sec: i32,
    pub started_at: String,
    pub ended_at: String,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub completed: Option<bool>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeletePomodoroArgs {
    pub id: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct PomodoroList {
    pub items: Vec<PomodoroSession>,
    pub count: usize,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct PomodoroResp {
    pub pomodoro: PomodoroSession,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct OkResp {
    pub ok: bool,
}

#[tool_router(router = pomodoro_tool_router, vis = "pub")]
impl PersistentTaskMcpServer {
    #[tool(
        name = "list_pomodoros",
        description = "列出番茄记录。可选过滤：taskId / 日期区间 [from,to] / pomoType。"
    )]
    async fn list_pomodoros_tool(
        &self,
        Parameters(args): Parameters<ListPomodorosArgs>,
    ) -> Result<Json<PomodoroList>, McpError> {
        let all = core::list_pomodoros(&self.state).map_err(to_mcp_err)?;
        let want_type = args
            .pomo_type
            .as_deref()
            .map(PomodoroType::from_str);
        let items: Vec<PomodoroSession> = all
            .into_iter()
            .filter(|p| {
                if let Some(tid) = args.task_id.as_deref() {
                    if p.task_id.as_deref() != Some(tid) {
                        return false;
                    }
                }
                if let Some(t) = want_type {
                    if p.type_ != t {
                        return false;
                    }
                }
                if let Some(f) = args.from.as_deref() {
                    // started_at 是 ISO 字符串，取前 10 位当 yyyy-MM-dd 比较
                    if p.started_at.get(..10).unwrap_or("") < f {
                        return false;
                    }
                }
                if let Some(t) = args.to.as_deref() {
                    if p.started_at.get(..10).unwrap_or("") > t {
                        return false;
                    }
                }
                true
            })
            .collect();
        let count = items.len();
        Ok(Json(PomodoroList { items, count }))
    }

    #[tool(
        name = "log_pomodoro",
        description = "记录一次番茄钟会话（focus / short_break / long_break）。需要写权限。"
    )]
    async fn log_pomodoro_tool(
        &self,
        Parameters(args): Parameters<LogPomodoroArgs>,
    ) -> Result<Json<PomodoroResp>, McpError> {
        require_write(&self.state)?;
        let p = PomodoroSession {
            id: format!("pomo_{}", super::uuid_like()),
            task_id: args.task_id,
            type_: PomodoroType::from_str(&args.pomo_type),
            duration_sec: args.duration_sec,
            completed: args.completed.unwrap_or(true),
            started_at: args.started_at,
            ended_at: args.ended_at,
        };
        core::insert_pomodoro(&self.state, &p).map_err(to_mcp_err)?;
        Ok(Json(PomodoroResp { pomodoro: p }))
    }

    #[tool(
        name = "delete_pomodoro",
        description = "删除一条番茄记录。需要写权限。"
    )]
    async fn delete_pomodoro_tool(
        &self,
        Parameters(args): Parameters<DeletePomodoroArgs>,
    ) -> Result<Json<OkResp>, McpError> {
        require_write(&self.state)?;
        core::delete_pomodoro(&self.state, &args.id).map_err(to_mcp_err)?;
        Ok(Json(OkResp { ok: true }))
    }
}
