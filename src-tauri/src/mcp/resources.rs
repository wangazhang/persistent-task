// MCP Resources（5 个只读 URI）
//
// agent 通过 resources/list + resources/read 拿到这些上下文，
// 便于"任务管理员"类 agent 在每次对话开头先 read 一份"今日待办"。
//
// 列表：
//   task://today      — markdown 格式的今日任务
//   task://overdue    — 待处置的过期任务 markdown
//   tag://tree        — 标签树 markdown
//   stats://summary   — 最近 30 天 JSON 汇总
//   schema://types    — 数据模型 JSON Schema（agent 自描述）

use crate::commands::core;
use crate::db::AppState;
use chrono::Local;
use rmcp::{
    ErrorData as McpError,
    model::{Annotated, ListResourcesResult, RawResource, ReadResourceResult, ResourceContents},
};

const RES_TODAY: &str = "task://today";
const RES_OVERDUE: &str = "task://overdue";
const RES_TAG_TREE: &str = "tag://tree";
const RES_STATS: &str = "stats://summary";
const RES_SCHEMA: &str = "schema://types";

pub fn list() -> ListResourcesResult {
    let mk = |uri: &str, name: &str, desc: &str, mime: &str| {
        let mut r = RawResource::new(uri, name);
        r.description = Some(desc.into());
        r.mime_type = Some(mime.into());
        Annotated::new(r, Default::default())
    };
    ListResourcesResult {
        resources: vec![
            mk(
                RES_TODAY,
                "今日任务",
                "当天 scheduledDates 命中的任务列表（含跨天延续）。Markdown。",
                "text/markdown",
            ),
            mk(
                RES_OVERDUE,
                "待处置过期任务",
                "scheduledDates 中含今日之前的未完成任务，可以用 review_past_task 工具逐个处置。",
                "text/markdown",
            ),
            mk(
                RES_TAG_TREE,
                "标签树",
                "全部标签的层级结构。",
                "text/markdown",
            ),
            mk(
                RES_STATS,
                "最近 30 天汇总",
                "完成数 / 总数 / 专注秒数；每日维度。JSON。",
                "application/json",
            ),
            mk(
                RES_SCHEMA,
                "数据模型 Schema",
                "Task / Tag / PomodoroSession 等模型的 JSON Schema，便于 agent 校验入参。",
                "application/json",
            ),
        ],
        next_cursor: None,
        meta: None,
    }
}

pub fn read(state: &AppState, uri: &str) -> Result<ReadResourceResult, McpError> {
    let to_err = |e: anyhow::Error| McpError::internal_error(e.to_string(), None);
    match uri {
        RES_TODAY => Ok(ReadResourceResult::new(vec![ResourceContents::text(
            render_today_md(state).map_err(to_err)?,
            uri,
        )
        .with_mime_type("text/markdown")])),
        RES_OVERDUE => Ok(ReadResourceResult::new(vec![ResourceContents::text(
            render_overdue_md(state).map_err(to_err)?,
            uri,
        )
        .with_mime_type("text/markdown")])),
        RES_TAG_TREE => Ok(ReadResourceResult::new(vec![ResourceContents::text(
            render_tag_tree_md(state).map_err(to_err)?,
            uri,
        )
        .with_mime_type("text/markdown")])),
        RES_STATS => Ok(ReadResourceResult::new(vec![ResourceContents::text(
            render_stats_json(state).map_err(to_err)?,
            uri,
        )
        .with_mime_type("application/json")])),
        RES_SCHEMA => Ok(ReadResourceResult::new(vec![ResourceContents::text(
            render_schema_json(),
            uri,
        )
        .with_mime_type("application/json")])),
        other => Err(McpError::invalid_params(
            format!("未知 resource URI: {other}"),
            None,
        )),
    }
}

fn render_today_md(state: &AppState) -> anyhow::Result<String> {
    let today = Local::now().format("%Y-%m-%d").to_string();
    let all = core::list_tasks(state)?;
    let mut tasks: Vec<_> = all
        .into_iter()
        .filter(|t| t.scheduled_dates.iter().any(|d| d == &today))
        .collect();
    tasks.sort_by_key(|t| (t.status.as_str().to_string(), t.order));

    let mut out = format!("# 今日任务（{}）\n\n", today);
    if tasks.is_empty() {
        out.push_str("_今天没有排期任务_\n");
        return Ok(out);
    }
    for t in &tasks {
        let check = if t.status.as_str() == "done" { "x" } else { " " };
        out.push_str(&format!("- [{}] **{}** _(优先级 {} · 状态 {})_\n",
            check, t.title, t.priority.as_str(), t.status.as_str()));
        if !t.description.is_empty() {
            // 描述按行缩进
            for line in t.description.lines() {
                out.push_str("  ");
                out.push_str(line);
                out.push('\n');
            }
        }
    }
    Ok(out)
}

fn render_overdue_md(state: &AppState) -> anyhow::Result<String> {
    let today = Local::now().format("%Y-%m-%d").to_string();
    let all = core::list_tasks(state)?;
    let overdue: Vec<_> = all
        .into_iter()
        .filter(|t| {
            // 未完成 + 存在过期日期
            !matches!(t.status.as_str(), "done" | "archived")
                && t.scheduled_dates.iter().any(|d| d.as_str() < today.as_str())
        })
        .collect();

    let mut out = format!("# 待处置过期任务（截至 {}）\n\n", today);
    if overdue.is_empty() {
        out.push_str("_没有过期未处理的任务_\n");
        return Ok(out);
    }
    out.push_str("提示：用 `review_past_task` 工具按 done/continue/suspend 处置。\n\n");
    for t in &overdue {
        let earliest = t
            .scheduled_dates
            .iter()
            .filter(|d| d.as_str() < today.as_str())
            .min()
            .cloned()
            .unwrap_or_default();
        out.push_str(&format!(
            "- **{}**  _id={}_  最早排期 {} · 当前状态 {}\n",
            t.title, t.id, earliest, t.status.as_str()
        ));
    }
    Ok(out)
}

fn render_tag_tree_md(state: &AppState) -> anyhow::Result<String> {
    let tags = core::list_tags(state)?;
    let mut by_parent: std::collections::HashMap<Option<String>, Vec<_>> =
        std::collections::HashMap::new();
    for t in &tags {
        by_parent.entry(t.parent_id.clone()).or_default().push(t);
    }
    for v in by_parent.values_mut() {
        v.sort_by_key(|t| t.order);
    }

    fn walk(
        out: &mut String,
        by_parent: &std::collections::HashMap<Option<String>, Vec<&crate::models::Tag>>,
        parent: Option<String>,
        depth: usize,
    ) {
        if let Some(children) = by_parent.get(&parent) {
            for c in children {
                out.push_str(&"  ".repeat(depth));
                out.push_str(&format!("- {} `({})`\n", c.name, c.id));
                walk(out, by_parent, Some(c.id.clone()), depth + 1);
            }
        }
    }

    let mut out = String::from("# 标签树\n\n");
    if tags.is_empty() {
        out.push_str("_暂无标签_\n");
        return Ok(out);
    }
    walk(&mut out, &by_parent, None, 0);
    Ok(out)
}

fn render_stats_json(state: &AppState) -> anyhow::Result<String> {
    let today = Local::now();
    let from = (today - chrono::Duration::days(29))
        .format("%Y-%m-%d")
        .to_string();
    let to = today.format("%Y-%m-%d").to_string();
    let daily = core::get_daily_stats(state, &from, &to)?;
    let by_tag = core::get_tag_stats(state)?;
    Ok(serde_json::to_string_pretty(&serde_json::json!({
        "from": from,
        "to": to,
        "daily": daily,
        "byTag": by_tag,
    }))?)
}

fn render_schema_json() -> String {
    use schemars::schema_for;
    let bundle = serde_json::json!({
        "Task": serde_json::to_value(schema_for!(crate::models::Task)).unwrap_or_default(),
        "Tag": serde_json::to_value(schema_for!(crate::models::Tag)).unwrap_or_default(),
        "PomodoroSession": serde_json::to_value(schema_for!(crate::models::PomodoroSession))
            .unwrap_or_default(),
        "AnalyticsEvent": serde_json::to_value(schema_for!(crate::models::AnalyticsEvent))
            .unwrap_or_default(),
    });
    serde_json::to_string_pretty(&bundle).unwrap_or_else(|_| "{}".into())
}
