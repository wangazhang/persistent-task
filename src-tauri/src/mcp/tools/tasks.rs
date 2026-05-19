// Task 域 MCP 工具（14 个）—— Phase 2
//
// 设计取舍：
//   - 用第二个 #[tool_router] impl 块（rmcp 1.7 支持多 impl 合并）。
//     在 PersistentTaskMcpServer::new 里我们会调用 attach_task_tools 把这部分
//     合并进 tool_router。这里直接在同一个 type 上加 impl 即可。
//   - 入参用 camelCase（与前端 TS 类型一致），通过 #[serde(rename_all)] 保证。
//   - 写工具开头先调 require_write，按 settings 里的 allow_write 决定是否拒绝。
//   - 错误统一通过 to_mcp_err 转 ErrorData。

use crate::commands::core;
use crate::mcp::audit::record_tool_invoked;
use crate::mcp::server::{require_write, to_mcp_err, PersistentTaskMcpServer};
use crate::models::{Task, TaskPriority, TaskStatus};
use rmcp::{
    ErrorData as McpError,
    handler::server::wrapper::{Json, Parameters},
    tool, tool_router,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

// ── 入参类型 ──

#[derive(Debug, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListTasksArgs {
    /// 过滤 status：todo / in_progress / suspended / done / archived
    pub status: Option<String>,
    /// 过滤指定日期（yyyy-MM-dd）：只返回 scheduledDates 包含该日期的任务
    pub date: Option<String>,
    /// 过滤标签 id；如果同时给 includeDescendantTags=true，还会包含子标签下的任务
    pub tag_id: Option<String>,
    pub include_descendant_tags: Option<bool>,
    /// 过滤 priority：p0 / p1 / p2
    pub priority: Option<String>,
    /// 标题/描述模糊匹配
    pub keyword: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetTaskArgs {
    pub id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SearchTasksArgs {
    pub keyword: String,
}

#[derive(Debug, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DateRangeArgs {
    /// 含起始日期，yyyy-MM-dd
    pub from: String,
    /// 含结束日期，yyyy-MM-dd
    pub to: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskArgs {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub scheduled_dates: Option<Vec<String>>,
    #[serde(default)]
    pub tag_ids: Option<Vec<String>>,
    #[serde(default)]
    pub doc_url: Option<String>,
    #[serde(default)]
    pub doc_title: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskArgs {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub scheduled_dates: Option<Vec<String>>,
    #[serde(default)]
    pub tag_ids: Option<Vec<String>>,
    #[serde(default)]
    pub doc_url: Option<String>,
    #[serde(default)]
    pub doc_title: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTaskArgs {
    pub id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetStatusArgs {
    pub id: String,
    pub status: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleArgs {
    pub id: String,
    pub date: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MoveScheduleArgs {
    pub id: String,
    pub from_date: Option<String>,
    pub to_date: String,
    /// move (默认) / add / replace
    pub mode: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReorderArgs {
    pub date: String,
    pub ordered_task_ids: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewPastArgs {
    pub id: String,
    pub date: String,
    /// done / continue / suspend
    pub action: String,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct OkResult {
    pub ok: bool,
}

/// 列表型返回包一层 object，满足 MCP outputSchema 要求（root 必须是 object）
#[derive(Debug, Serialize, JsonSchema)]
pub struct TaskList {
    pub items: Vec<Task>,
    pub count: usize,
}

impl TaskList {
    fn from_vec(items: Vec<Task>) -> Self {
        let count = items.len();
        Self { items, count }
    }
}

/// 单任务返回包装；用于 get_task（可能找不到）
#[derive(Debug, Serialize, JsonSchema)]
pub struct TaskMaybe {
    pub found: bool,
    pub task: Option<Task>,
}

// ── 工具实现 ──

#[tool_router(router = task_tool_router, vis = "pub")]
impl PersistentTaskMcpServer {
    #[tool(
        name = "list_tasks",
        description = "列出任务。可选过滤：status / date / tagId（可含子标签）/ priority / keyword。\
         默认返回全部。"
    )]
    async fn list_tasks_tool(
        &self,
        Parameters(args): Parameters<ListTasksArgs>,
    ) -> Result<Json<TaskList>, McpError> {
        let all = core::list_tasks(&self.state).map_err(to_mcp_err)?;

        let allowed_tag_set: Option<std::collections::HashSet<String>> =
            if let Some(tid) = args.tag_id.as_deref() {
                if args.include_descendant_tags.unwrap_or(false) {
                    let tags = core::list_tags(&self.state).map_err(to_mcp_err)?;
                    Some(collect_tag_descendants(&tags, tid))
                } else {
                    Some(std::iter::once(tid.to_string()).collect())
                }
            } else {
                None
            };

        let kw = args.keyword.as_deref().map(|s| s.to_lowercase());
        let filtered: Vec<Task> = all
            .into_iter()
            .filter(|t| {
                if let Some(s) = args.status.as_deref() {
                    if t.status != TaskStatus::from_str(s) {
                        return false;
                    }
                }
                if let Some(d) = args.date.as_deref() {
                    if !t.scheduled_dates.iter().any(|x| x == d) {
                        return false;
                    }
                }
                if let Some(p) = args.priority.as_deref() {
                    if t.priority != TaskPriority::from_str(p) {
                        return false;
                    }
                }
                if let Some(set) = &allowed_tag_set {
                    if !t.tag_ids.iter().any(|tg| set.contains(tg)) {
                        return false;
                    }
                }
                if let Some(k) = &kw {
                    let hay = format!("{} {}", t.title, t.description).to_lowercase();
                    if !hay.contains(k) {
                        return false;
                    }
                }
                true
            })
            .collect();
        Ok(Json(TaskList::from_vec(filtered)))
    }

    #[tool(
        name = "get_task",
        description = "按 id 获取单个任务的全量信息（含 scheduledDates / tagIds / reviewLog）。"
    )]
    async fn get_task_tool(
        &self,
        Parameters(args): Parameters<GetTaskArgs>,
    ) -> Result<Json<TaskMaybe>, McpError> {
        let task = core::get_task(&self.state, &args.id).map_err(to_mcp_err)?;
        Ok(Json(TaskMaybe {
            found: task.is_some(),
            task,
        }))
    }

    #[tool(
        name = "search_tasks",
        description = "按关键词模糊搜索任务标题与描述（不区分大小写）。"
    )]
    async fn search_tasks_tool(
        &self,
        Parameters(args): Parameters<SearchTasksArgs>,
    ) -> Result<Json<TaskList>, McpError> {
        let kw = args.keyword.to_lowercase();
        let all = core::list_tasks(&self.state).map_err(to_mcp_err)?;
        let filtered: Vec<Task> = all
            .into_iter()
            .filter(|t| {
                let hay = format!("{} {}", t.title, t.description).to_lowercase();
                hay.contains(&kw)
            })
            .collect();
        Ok(Json(TaskList::from_vec(filtered)))
    }

    #[tool(
        name = "get_today_tasks",
        description = "获取今日任务（含跨天延续到今天的任务）。\
         返回 scheduledDates 包含今天日期的全部任务。"
    )]
    async fn get_today_tasks_tool(&self) -> Result<Json<TaskList>, McpError> {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let all = core::list_tasks(&self.state).map_err(to_mcp_err)?;
        let items: Vec<Task> = all
            .into_iter()
            .filter(|t| t.scheduled_dates.iter().any(|d| d == &today))
            .collect();
        Ok(Json(TaskList::from_vec(items)))
    }

    #[tool(
        name = "get_tasks_by_date_range",
        description = "返回日期区间 [from, to] 内任意一天被排期的任务。日期格式 yyyy-MM-dd。"
    )]
    async fn get_tasks_by_date_range_tool(
        &self,
        Parameters(args): Parameters<DateRangeArgs>,
    ) -> Result<Json<TaskList>, McpError> {
        let all = core::list_tasks(&self.state).map_err(to_mcp_err)?;
        let items: Vec<Task> = all
            .into_iter()
            .filter(|t| {
                t.scheduled_dates
                    .iter()
                    .any(|d| d.as_str() >= args.from.as_str() && d.as_str() <= args.to.as_str())
            })
            .collect();
        Ok(Json(TaskList::from_vec(items)))
    }

    // ── 写工具 ──

    #[tool(
        name = "create_task",
        description = "创建任务。仅 title 必填；id / createdAt / updatedAt 自动生成。\
         需要 MCP 写权限（高级菜单中开启）。"
    )]
    async fn create_task_tool(
        &self,
        Parameters(args): Parameters<CreateTaskArgs>,
    ) -> Result<Json<Task>, McpError> {
        require_write(&self.state)?;
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let task = Task {
            id: format!("t_{}", super::uuid_like()),
            title: args.title,
            description: args.description.unwrap_or_default(),
            status: args
                .status
                .as_deref()
                .map(TaskStatus::from_str)
                .unwrap_or(TaskStatus::Todo),
            priority: args
                .priority
                .as_deref()
                .map(TaskPriority::from_str)
                .unwrap_or(TaskPriority::P2),
            scheduled_dates: args.scheduled_dates.unwrap_or_default(),
            tag_ids: args.tag_ids.unwrap_or_default(),
            order: 0,
            color: args.color,
            docs: Vec::new(),
            doc_url: args.doc_url,
            doc_title: args.doc_title,
            completed_at: None,
            created_at: now.clone(),
            updated_at: now,
            review_log: None,
        };
        core::upsert_task(&self.state, &task).map_err(to_mcp_err)?;
        record_tool_invoked(
            &self.state,
            "create_task",
            Some("task"),
            Some(&task.id),
            Some(serde_json::json!({ "title": task.title })),
        );
        Ok(Json(task))
    }

    #[tool(
        name = "update_task",
        description = "PATCH 语义：仅更新提供的字段，其余保留。需要 MCP 写权限。"
    )]
    async fn update_task_tool(
        &self,
        Parameters(args): Parameters<UpdateTaskArgs>,
    ) -> Result<Json<Task>, McpError> {
        require_write(&self.state)?;
        let mut t = core::get_task(&self.state, &args.id)
            .map_err(to_mcp_err)?
            .ok_or_else(|| McpError::invalid_params(format!("task {} 不存在", args.id), None))?;
        if let Some(v) = args.title {
            t.title = v;
        }
        if let Some(v) = args.description {
            t.description = v;
        }
        if let Some(v) = args.status {
            t.status = TaskStatus::from_str(&v);
        }
        if let Some(v) = args.priority {
            t.priority = TaskPriority::from_str(&v);
        }
        if let Some(v) = args.scheduled_dates {
            t.scheduled_dates = v;
        }
        if let Some(v) = args.tag_ids {
            t.tag_ids = v;
        }
        if args.doc_url.is_some() {
            t.doc_url = args.doc_url;
        }
        if args.doc_title.is_some() {
            t.doc_title = args.doc_title;
        }
        if args.color.is_some() {
            t.color = args.color;
        }
        t.updated_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        core::upsert_task(&self.state, &t).map_err(to_mcp_err)?;
        record_tool_invoked(&self.state, "update_task", Some("task"), Some(&t.id), None);
        Ok(Json(t))
    }

    #[tool(
        name = "delete_task",
        description = "删除任务（不可恢复，会级联清理 task_dates / task_tags）。需要 MCP 写权限。"
    )]
    async fn delete_task_tool(
        &self,
        Parameters(args): Parameters<DeleteTaskArgs>,
    ) -> Result<Json<OkResult>, McpError> {
        require_write(&self.state)?;
        core::delete_task(&self.state, &args.id).map_err(to_mcp_err)?;
        record_tool_invoked(
            &self.state,
            "delete_task",
            Some("task"),
            Some(&args.id),
            None,
        );
        Ok(Json(OkResult { ok: true }))
    }

    #[tool(
        name = "set_task_status",
        description = "改任务状态（todo/in_progress/suspended/done/archived）。\
         状态变 done 时自动写 completedAt，离开 done 时清空。需要 MCP 写权限。"
    )]
    async fn set_task_status_tool(
        &self,
        Parameters(args): Parameters<SetStatusArgs>,
    ) -> Result<Json<Task>, McpError> {
        require_write(&self.state)?;
        let s = TaskStatus::from_str(&args.status);
        Ok(Json(
            core::set_task_status(&self.state, &args.id, s).map_err(to_mcp_err)?,
        ))
    }

    #[tool(
        name = "schedule_task_for_date",
        description = "把任务追加排期到指定日期（yyyy-MM-dd），已存在则不重复。需要 MCP 写权限。"
    )]
    async fn schedule_task_for_date_tool(
        &self,
        Parameters(args): Parameters<ScheduleArgs>,
    ) -> Result<Json<Task>, McpError> {
        require_write(&self.state)?;
        Ok(Json(
            core::schedule_task_for_date(&self.state, &args.id, &args.date)
                .map_err(to_mcp_err)?,
        ))
    }

    #[tool(
        name = "unschedule_task_from_date",
        description = "从任务的 scheduledDates 中移除一个日期。需要 MCP 写权限。"
    )]
    async fn unschedule_task_from_date_tool(
        &self,
        Parameters(args): Parameters<ScheduleArgs>,
    ) -> Result<Json<Task>, McpError> {
        require_write(&self.state)?;
        Ok(Json(
            core::unschedule_task_from_date(&self.state, &args.id, &args.date)
                .map_err(to_mcp_err)?,
        ))
    }

    #[tool(
        name = "move_task_schedule",
        description = "在日期之间挪动排期。mode = move(默认，删 from 加 to) / add(只加 to) / \
         replace(只保留 to)。需要 MCP 写权限。"
    )]
    async fn move_task_schedule_tool(
        &self,
        Parameters(args): Parameters<MoveScheduleArgs>,
    ) -> Result<Json<Task>, McpError> {
        require_write(&self.state)?;
        let mode = match args.mode.as_deref() {
            Some("add") => core::MoveScheduleMode::Add,
            Some("replace") => core::MoveScheduleMode::Replace,
            _ => core::MoveScheduleMode::Move,
        };
        Ok(Json(
            core::move_task_schedule(
                &self.state,
                &args.id,
                args.from_date.as_deref(),
                &args.to_date,
                mode,
            )
            .map_err(to_mcp_err)?,
        ))
    }

    #[tool(
        name = "reorder_tasks_for_date",
        description = "按 orderedTaskIds 给定的顺序重排（写入每个任务的 order 字段）。\
         注意：order 在当前数据模型里是任务级（不是 per-date）。需要 MCP 写权限。"
    )]
    async fn reorder_tasks_for_date_tool(
        &self,
        Parameters(args): Parameters<ReorderArgs>,
    ) -> Result<Json<OkResult>, McpError> {
        require_write(&self.state)?;
        core::reorder_tasks_for_date(&self.state, &args.date, &args.ordered_task_ids)
            .map_err(to_mcp_err)?;
        Ok(Json(OkResult { ok: true }))
    }

    #[tool(
        name = "review_past_task",
        description = "处置过期任务，追加一条 reviewLog 并按 action 调整状态：\
         done = 完成；continue = 顺延到今天；suspend = 挂起。需要 MCP 写权限。"
    )]
    async fn review_past_task_tool(
        &self,
        Parameters(args): Parameters<ReviewPastArgs>,
    ) -> Result<Json<Task>, McpError> {
        require_write(&self.state)?;
        let action = match args.action.as_str() {
            "done" => core::PastReviewAction::Done,
            "continue" => core::PastReviewAction::Continue,
            "suspend" => core::PastReviewAction::Suspend,
            other => {
                return Err(McpError::invalid_params(
                    format!("未知 action: {other}（应为 done/continue/suspend）"),
                    None,
                ));
            }
        };
        Ok(Json(
            core::review_past_task(
                &self.state,
                &args.id,
                &args.date,
                action,
                args.reason.as_deref(),
            )
            .map_err(to_mcp_err)?,
        ))
    }
}

// ── 辅助 ──

fn collect_tag_descendants(
    tags: &[crate::models::Tag],
    root: &str,
) -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    out.insert(root.to_string());
    let mut frontier: Vec<String> = vec![root.to_string()];
    while let Some(cur) = frontier.pop() {
        for t in tags {
            if t.parent_id.as_deref() == Some(cur.as_str()) && !out.contains(&t.id) {
                out.insert(t.id.clone());
                frontier.push(t.id.clone());
            }
        }
    }
    out
}
