// Analytics 域 MCP 工具（4 个）：daily/tag 聚合 + 事件查询

use crate::commands::core::{self, DailyStat, TagStat};
use crate::mcp::server::{to_mcp_err, PersistentTaskMcpServer};
use crate::models::{AnalyticsEvent, EventCountRow, EventFilter, EventGroupBy};
use rmcp::{
    ErrorData as McpError,
    handler::server::wrapper::{Json, Parameters},
    tool, tool_router,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DailyStatsArgs {
    /// 起始日期 yyyy-MM-dd（含）
    pub from: String,
    /// 结束日期 yyyy-MM-dd（含）
    pub to: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct DailyStatList {
    pub items: Vec<DailyStat>,
    pub count: usize,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct TagStatList {
    pub items: Vec<TagStat>,
    pub count: usize,
}

#[derive(Debug, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueryEventsArgs {
    /// 仅这些 type 的事件
    pub types: Option<Vec<String>>,
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
    pub session_id: Option<String>,
    /// 起始时间（ISO）
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CountEventsArgs {
    #[serde(flatten)]
    pub filter: QueryEventsArgs,
    /// 分组维度：day / hour / type
    pub group_by: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct EventList {
    pub items: Vec<AnalyticsEvent>,
    pub count: usize,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct EventCounts {
    pub items: Vec<EventCountRow>,
    pub group_by: String,
}

fn to_event_filter(a: QueryEventsArgs) -> EventFilter {
    EventFilter {
        types: a.types,
        entity_type: a.entity_type,
        entity_id: a.entity_id,
        session_id: a.session_id,
        from: a.from,
        to: a.to,
        limit: a.limit,
        offset: a.offset,
    }
}

#[tool_router(router = analytics_tool_router, vis = "pub")]
impl PersistentTaskMcpServer {
    #[tool(
        name = "get_daily_stats",
        description = "按日聚合：每天的任务总数 / 完成数 / 专注秒数。日期区间 [from,to]，yyyy-MM-dd。"
    )]
    async fn get_daily_stats_tool(
        &self,
        Parameters(args): Parameters<DailyStatsArgs>,
    ) -> Result<Json<DailyStatList>, McpError> {
        let items = core::get_daily_stats(&self.state, &args.from, &args.to)
            .map_err(to_mcp_err)?;
        let count = items.len();
        Ok(Json(DailyStatList { items, count }))
    }

    #[tool(
        name = "get_tag_stats",
        description = "按标签聚合：每个标签下的任务数、完成数、专注秒数。"
    )]
    async fn get_tag_stats_tool(&self) -> Result<Json<TagStatList>, McpError> {
        let items = core::get_tag_stats(&self.state).map_err(to_mcp_err)?;
        let count = items.len();
        Ok(Json(TagStatList { items, count }))
    }

    #[tool(
        name = "query_events",
        description = "查询埋点事件（task.created / pomodoro.started 等）。\
         支持按 type / entity / session / 时间范围过滤，按 occurredAt DESC 返回。"
    )]
    async fn query_events_tool(
        &self,
        Parameters(args): Parameters<QueryEventsArgs>,
    ) -> Result<Json<EventList>, McpError> {
        let filter = to_event_filter(args);
        let items = core::query_events(&self.state, &filter).map_err(to_mcp_err)?;
        let count = items.len();
        Ok(Json(EventList { items, count }))
    }

    #[tool(
        name = "count_events",
        description = "按分组维度（day / hour / type）统计事件次数。"
    )]
    async fn count_events_tool(
        &self,
        Parameters(args): Parameters<CountEventsArgs>,
    ) -> Result<Json<EventCounts>, McpError> {
        let group = match args.group_by.as_str() {
            "day" => EventGroupBy::Day,
            "hour" => EventGroupBy::Hour,
            "type" => EventGroupBy::Type,
            other => {
                return Err(McpError::invalid_params(
                    format!("未知 groupBy: {other}（应为 day/hour/type）"),
                    None,
                ));
            }
        };
        let filter = to_event_filter(args.filter);
        let items = core::count_events(&self.state, &filter, group).map_err(to_mcp_err)?;
        Ok(Json(EventCounts {
            items,
            group_by: args.group_by,
        }))
    }
}
