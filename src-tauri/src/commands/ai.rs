// AI 快速录入命令
//
// 把用户的一段自由文本交给 Anthropic Messages API，借助强制 tool_use 结构化输出
// 解析成一个或多个任务草稿（ParsedTaskDraft）。
//
// 设计要点：
//   - Key 不出前端：请求由这里（Rust）用 reqwest 发起，集中鉴权。
//   - 只读、无副作用：本命令不写 store / DB，只返回草稿；入库由 main 窗口经事件完成。
//   - 防 AI 编造：matchedTagIds 只保留确实存在于入参 tags 里的 id。
//
// 纯逻辑（解析 tool_use.input → ParsedTaskDraft[]）抽成 parse_emit_tasks_input，
// 不依赖网络，便于对固定 JSON fixture 做单测。

use crate::db::AppState;
use crate::models::TaskPriority;
use crate::settings;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

/// 强制调用的工具名；与 system prompt / input_schema 对应
pub const EMIT_TASKS: &str = "emit_tasks";

/// 解析后的单条任务草稿（返回给前端，camelCase）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedTaskDraft {
    pub title: String,
    pub description: String,
    pub priority: TaskPriority,
    /// 绝对 ISO 日期 yyyy-MM-dd
    pub scheduled_dates: Vec<String>,
    /// 已对入参标签做过存在性过滤的已有标签 id
    pub matched_tag_ids: Vec<String>,
    /// 建议新建的标签名
    pub new_tag_names: Vec<String>,
}

/// 把 `emit_tasks` 工具的 input（{"tasks": [...]}）转成草稿列表。
///
/// 容错策略（AI 输出可能不严格）：
///   - 没有 tasks 数组 → 空列表
///   - title 缺失 / 空白 → 跳过该条（标题是唯一硬要求）
///   - description 缺失 → 空串
///   - priority 缺失 / 非法 → p2
///   - scheduledDates / newTagNames 缺失 → 空数组；元素取非空字符串
///   - matchedTagIds 只保留存在于 allowed_tag_ids 的 id（丢弃 AI 编造的）
pub fn parse_emit_tasks_input(
    input: &Value,
    allowed_tag_ids: &HashSet<String>,
) -> Vec<ParsedTaskDraft> {
    let Some(tasks) = input.get("tasks").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    tasks
        .iter()
        .filter_map(|task| {
            let title = task.get("title").and_then(|v| v.as_str())?.trim().to_string();
            if title.is_empty() {
                return None; // 标题是唯一硬要求
            }
            let description = task
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let priority = task
                .get("priority")
                .and_then(|v| v.as_str())
                .map(TaskPriority::from_str)
                .unwrap_or_default();
            let matched_tag_ids = string_array(task.get("matchedTagIds"))
                .into_iter()
                .filter(|id| allowed_tag_ids.contains(id))
                .collect();
            Some(ParsedTaskDraft {
                title,
                description,
                priority,
                scheduled_dates: string_array(task.get("scheduledDates")),
                matched_tag_ids,
                new_tag_names: string_array(task.get("newTagNames")),
            })
        })
        .collect()
}

/// 从 Value 取字符串数组里的非空 trim 后元素
fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// 随请求传入的已有标签（仅 id + name）。AI 据此做标签匹配。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagLite {
    pub id: String,
    pub name: String,
}

/// 前端命令返回的 AI 配置视图：不回传明文 Key（仅暴露是否已配置）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsView {
    pub has_key: bool,
    pub model: String,
    pub base_url: String,
}

/// 未配置 Key 的错误标记 —— 前端识别后引导去「高级」设置页。
pub const ERR_AI_NOT_CONFIGURED: &str = "AI_NOT_CONFIGURED";

const ANTHROPIC_VERSION: &str = "2023-06-01";
const MAX_TOKENS: u32 = 2048;

/// 把 yyyy-MM-dd 转成中文星期；解析失败返回 None。
fn weekday_cn(today: &str) -> Option<&'static str> {
    use chrono::{Datelike, NaiveDate, Weekday};
    let date = NaiveDate::parse_from_str(today, "%Y-%m-%d").ok()?;
    Some(match date.weekday() {
        Weekday::Mon => "星期一",
        Weekday::Tue => "星期二",
        Weekday::Wed => "星期三",
        Weekday::Thu => "星期四",
        Weekday::Fri => "星期五",
        Weekday::Sat => "星期六",
        Weekday::Sun => "星期日",
    })
}

/// 组 system prompt：注入今天日期/星期 + 已有标签列表，约束输出规则。
fn build_system_prompt(today: &str, tags: &[TagLite]) -> String {
    let weekday = weekday_cn(today)
        .map(|w| format!("（{w}）"))
        .unwrap_or_default();
    let tag_lines = if tags.is_empty() {
        "（暂无已有标签）".to_string()
    } else {
        tags.iter()
            .map(|t| format!("- id={} 名称={}", t.id, t.name))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        "你是任务录入助手。把用户的一段自由文本拆解成结构化任务，调用 {EMIT_TASKS} 工具输出。\n\
        \n\
        今天是 {today}{weekday}。所有相对时间（“明天”“周五”“下周一”等）都要换算成绝对日期 YYYY-MM-DD。\n\
        \n\
        规则：\n\
        - 一段文本可能包含多件事，按语义拆成多个任务；同一件事的多个动作可合并进一个任务的 title/description。\n\
        - 优先级推断：出现“紧急/急/重要/尽快/今天必须”等 → p0 或 p1；否则默认 p2。\n\
        - 标签 matchedTagIds 只能从下面提供的已有标签 id 里选；覆盖不到的语义放进 newTagNames（简短名词）。\n\
        - 未提及的字段留空（空串 / 空数组），不要臆造日期。\n\
        - 输出语言跟随输入（中文输入 → 中文 title/description）。\n\
        \n\
        已有标签：\n{tag_lines}"
    )
}

/// emit_tasks 工具定义（强制结构化输出）。
fn build_emit_tasks_tool() -> Value {
    serde_json::json!({
        "name": EMIT_TASKS,
        "description": "把用户的自由文本拆解成结构化任务列表",
        "input_schema": {
            "type": "object",
            "properties": {
                "tasks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": { "type": "string", "description": "简洁的任务标题" },
                            "description": { "type": "string", "description": "补充细节，没有则空串" },
                            "priority": { "type": "string", "enum": ["p0", "p1", "p2"] },
                            "scheduledDates": {
                                "type": "array", "items": { "type": "string" },
                                "description": "YYYY-MM-DD 绝对日期，未提及则空数组"
                            },
                            "matchedTagIds": {
                                "type": "array", "items": { "type": "string" },
                                "description": "仅可从提供的已有标签 id 中选"
                            },
                            "newTagNames": {
                                "type": "array", "items": { "type": "string" },
                                "description": "已有标签覆盖不到时建议的新标签名"
                            }
                        },
                        "required": ["title"]
                    }
                }
            },
            "required": ["tasks"]
        }
    })
}

/// 从 Messages API 响应里取出 emit_tasks 工具调用的 input。
fn extract_tool_use_input(response: &Value) -> Option<Value> {
    response
        .get("content")?
        .as_array()?
        .iter()
        .find(|block| {
            block.get("type").and_then(|t| t.as_str()) == Some("tool_use")
                && block.get("name").and_then(|n| n.as_str()) == Some(EMIT_TASKS)
        })
        .and_then(|block| block.get("input").cloned())
}

/// 解析用户自由文本为任务草稿。只读、无副作用：不写 store / DB。
///
/// 失败时返回字符串错误；未配置 Key 返回 [`ERR_AI_NOT_CONFIGURED`] 供前端识别。
#[tauri::command]
pub async fn parse_quick_input(
    state: tauri::State<'_, AppState>,
    text: String,
    today: String,
    tags: Vec<TagLite>,
) -> Result<Vec<ParsedTaskDraft>, String> {
    // 在 await 前读完设置并拿到 owned 数据（不跨 await 持锁）
    let ai = settings::read_ai_settings(&state).map_err(|e| e.to_string())?;
    if !ai.has_key() {
        return Err(ERR_AI_NOT_CONFIGURED.to_string());
    }
    let allowed: HashSet<String> = tags.iter().map(|t| t.id.clone()).collect();
    let system = build_system_prompt(&today, &tags);
    let body = serde_json::json!({
        "model": ai.model,
        "max_tokens": MAX_TOKENS,
        "system": system,
        "tools": [build_emit_tasks_tool()],
        "tool_choice": { "type": "tool", "name": EMIT_TASKS },
        "messages": [{ "role": "user", "content": text }],
    });

    let url = format!("{}/v1/messages", ai.base_url.trim_end_matches('/'));
    let resp = reqwest::Client::new()
        .post(&url)
        .header("x-api-key", &ai.api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求 Anthropic 失败：{e}"))?;

    let status = resp.status();
    let payload = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let snippet: String = payload.chars().take(500).collect();
        return Err(format!("Anthropic 返回 {status}：{snippet}"));
    }

    let value: Value = serde_json::from_str(&payload)
        .map_err(|e| format!("解析响应 JSON 失败：{e}"))?;
    let input = extract_tool_use_input(&value)
        .ok_or_else(|| "响应中没有 emit_tasks 工具调用".to_string())?;
    Ok(parse_emit_tasks_input(&input, &allowed))
}

/// 读取 AI 配置（不回传明文 Key，仅暴露是否已配置）。
#[tauri::command]
pub fn get_ai_settings(state: tauri::State<'_, AppState>) -> Result<AiSettingsView, String> {
    let ai = settings::read_ai_settings(&state).map_err(|e| e.to_string())?;
    Ok(AiSettingsView {
        has_key: ai.has_key(),
        model: ai.model,
        base_url: ai.base_url,
    })
}

/// 写入 AI 配置。`api_key` 为 None 表示保持现有 Key 不变；Some("") 表示清空。
#[tauri::command]
pub fn set_ai_settings(
    state: tauri::State<'_, AppState>,
    api_key: Option<String>,
    model: String,
    base_url: String,
) -> Result<(), String> {
    settings::write_ai_settings(&state, api_key.as_deref(), &model, &base_url)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tags(ids: &[&str]) -> HashSet<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_multiple_tasks_with_all_fields() {
        let input = json!({
            "tasks": [
                {
                    "title": "做用户访谈",
                    "description": "准备问题清单",
                    "priority": "p0",
                    "scheduledDates": ["2026-06-15"],
                    "matchedTagIds": [],
                    "newTagNames": ["调研"]
                },
                {
                    "title": "交季度报告初稿",
                    "description": "",
                    "priority": "p1",
                    "scheduledDates": ["2026-06-20"],
                    "matchedTagIds": ["tag-plan"],
                    "newTagNames": []
                }
            ]
        });
        let out = parse_emit_tasks_input(&input, &tags(&["tag-plan"]));
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].title, "做用户访谈");
        assert_eq!(out[0].priority, TaskPriority::P0);
        assert_eq!(out[0].scheduled_dates, vec!["2026-06-15"]);
        assert_eq!(out[0].new_tag_names, vec!["调研"]);
        assert_eq!(out[1].matched_tag_ids, vec!["tag-plan"]);
    }

    #[test]
    fn priority_defaults_to_p2_when_missing_or_invalid() {
        let input = json!({
            "tasks": [
                { "title": "甲" },
                { "title": "乙", "priority": "urgent" }
            ]
        });
        let out = parse_emit_tasks_input(&input, &tags(&[]));
        assert_eq!(out[0].priority, TaskPriority::P2);
        assert_eq!(out[1].priority, TaskPriority::P2);
        assert_eq!(out[0].description, "");
        assert!(out[0].scheduled_dates.is_empty());
    }

    #[test]
    fn filters_out_fabricated_tag_ids() {
        let input = json!({
            "tasks": [
                { "title": "甲", "matchedTagIds": ["real", "fake", "also-fake"] }
            ]
        });
        let out = parse_emit_tasks_input(&input, &tags(&["real"]));
        assert_eq!(out[0].matched_tag_ids, vec!["real"]);
    }

    #[test]
    fn no_tasks_key_yields_empty() {
        assert!(parse_emit_tasks_input(&json!({}), &tags(&[])).is_empty());
        assert!(parse_emit_tasks_input(&json!({ "tasks": [] }), &tags(&[])).is_empty());
    }

    #[test]
    fn skips_tasks_with_blank_title() {
        let input = json!({
            "tasks": [
                { "title": "" },
                { "title": "   " },
                { "description": "无标题" },
                { "title": "有效" }
            ]
        });
        let out = parse_emit_tasks_input(&input, &tags(&[]));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].title, "有效");
    }

    #[test]
    fn system_prompt_injects_today_weekday_and_tags() {
        let tags = vec![
            TagLite { id: "tag-plan".into(), name: "产品规划".into() },
            TagLite { id: "tag-x".into(), name: "竞品".into() },
        ];
        let p = build_system_prompt("2026-06-14", &tags);
        assert!(p.contains("2026-06-14"));
        assert!(p.contains("星期日")); // 2026-06-14 是周日
        assert!(p.contains("产品规划"));
        assert!(p.contains("tag-plan"));
        assert!(p.contains(EMIT_TASKS));
    }

    #[test]
    fn system_prompt_handles_no_tags_and_bad_date() {
        let p = build_system_prompt("not-a-date", &[]);
        assert!(p.contains("暂无已有标签"));
        // 日期解析失败时不应崩，也不附带星期括号
        assert!(!p.contains("（星期"));
    }

    #[test]
    fn extracts_emit_tasks_tool_input() {
        let resp = json!({
            "content": [
                { "type": "text", "text": "好的" },
                { "type": "tool_use", "name": "emit_tasks", "input": { "tasks": [{ "title": "甲" }] } }
            ]
        });
        let input = extract_tool_use_input(&resp).expect("应找到 tool_use");
        let out = parse_emit_tasks_input(&input, &tags(&[]));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].title, "甲");
    }

    #[test]
    fn extract_returns_none_without_tool_use() {
        let resp = json!({ "content": [{ "type": "text", "text": "无工具调用" }] });
        assert!(extract_tool_use_input(&resp).is_none());
    }
}
