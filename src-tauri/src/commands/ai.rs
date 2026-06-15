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
        "你是任务录入助手。把用户的一段自由文本拆解成结构化任务列表（输出 tasks 数组）。\n\
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

/// OpenAI Responses API 的结构化输出 JSON Schema（strict 模式要求：
/// 每个对象 additionalProperties=false 且所有字段都在 required 里）。
/// parse_emit_tasks_input 本身容错，所以"全部 required 但允许空值"没问题。
fn build_emit_tasks_schema_strict() -> Value {
    serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "tasks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "title": { "type": "string", "description": "简洁的任务标题" },
                        "description": { "type": "string", "description": "补充细节，没有则空串" },
                        "priority": { "type": "string", "enum": ["p0", "p1", "p2"] },
                        "scheduledDates": { "type": "array", "items": { "type": "string" } },
                        "matchedTagIds": { "type": "array", "items": { "type": "string" } },
                        "newTagNames": { "type": "array", "items": { "type": "string" } }
                    },
                    "required": [
                        "title", "description", "priority",
                        "scheduledDates", "matchedTagIds", "newTagNames"
                    ]
                }
            }
        },
        "required": ["tasks"]
    })
}

/// 从 OpenAI Responses API 响应里取出结构化输出（解析成 {tasks:[...]} Value）。
///
/// 响应形如 `{ output: [ { type:"message", content:[ {type:"output_text", text:"<json>"} ] } ] }`。
/// 遍历 output 找 message → 取第一个 output_text 文本，按 JSON 解析；
/// 命中 refusal（安全拒答）→ 返回明确错误。
fn extract_openai_responses_output(response: &Value) -> Result<Value, String> {
    let output = response
        .get("output")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "OpenAI 响应缺少 output 字段".to_string())?;
    for item in output {
        if item.get("type").and_then(|t| t.as_str()) != Some("message") {
            continue; // 跳过 reasoning 等非 message 项
        }
        let Some(content) = item.get("content").and_then(|c| c.as_array()) else {
            continue;
        };
        for block in content {
            match block.get("type").and_then(|t| t.as_str()) {
                Some("output_text") | Some("text") => {
                    let text = block.get("text").and_then(|t| t.as_str()).unwrap_or("");
                    return serde_json::from_str(text)
                        .map_err(|e| format!("结构化输出 JSON 解析失败：{e}"));
                }
                Some("refusal") => {
                    let r = block
                        .get("refusal")
                        .and_then(|t| t.as_str())
                        .unwrap_or("模型拒绝了该请求");
                    return Err(format!("模型拒绝：{r}"));
                }
                _ => {}
            }
        }
    }
    Err("OpenAI 响应中没有结构化输出文本".to_string())
}

/// 从 /v1/models 响应里取出模型 id 列表。OpenAI 与 Anthropic 都是 {data:[{id}]}。
fn parse_models_response(response: &Value) -> Vec<String> {
    response
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|i| i.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// 解析用户自由文本为任务草稿。只读、无副作用：不写 store / DB。
///
/// 按激活 provider 路由：Anthropic 走 Messages API（强制 tool_use），
/// OpenAI 走 Responses API（text.format json_schema 结构化输出）；
/// 两者都产出 {tasks:[...]}，复用 parse_emit_tasks_input。
///
/// 未配置 Key 返回 [`ERR_AI_NOT_CONFIGURED`] 供前端识别。
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
    let client = reqwest::Client::new();
    let base = ai.base_url.trim_end_matches('/');

    let tasks_value: Value = match ai.provider {
        settings::AiProvider::Anthropic => {
            let body = serde_json::json!({
                "model": ai.model,
                "max_tokens": MAX_TOKENS,
                "system": system,
                "tools": [build_emit_tasks_tool()],
                "tool_choice": { "type": "tool", "name": EMIT_TASKS },
                "messages": [{ "role": "user", "content": text }],
            });
            let resp = client
                .post(format!("{base}/v1/messages"))
                .header("x-api-key", &ai.api_key)
                .header("anthropic-version", ANTHROPIC_VERSION)
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("请求 Anthropic 失败：{e}"))?;
            let value = read_json_or_err(resp, "Anthropic").await?;
            extract_tool_use_input(&value)
                .ok_or_else(|| "响应中没有 emit_tasks 工具调用".to_string())?
        }
        settings::AiProvider::Openai => {
            let body = serde_json::json!({
                "model": ai.model,
                "input": [
                    { "role": "system", "content": system },
                    { "role": "user", "content": text },
                ],
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": EMIT_TASKS,
                        "strict": true,
                        "schema": build_emit_tasks_schema_strict(),
                    }
                },
            });
            let resp = client
                .post(openai_endpoint(&ai.base_url, "responses"))
                .header("authorization", format!("Bearer {}", ai.api_key))
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("请求 OpenAI 失败：{e}"))?;
            let value = read_json_or_err(resp, "OpenAI").await?;
            extract_openai_responses_output(&value)?
        }
    };

    Ok(parse_emit_tasks_input(&tasks_value, &allowed))
}

/// OpenAI 端点 URL 归一化：无论 base 带不带 `/v1`，最终都拼成 `{host}/v1/{path}`。
///   https://api.openai.com/v1   + responses → https://api.openai.com/v1/responses
///   https://gw.example.com      + models    → https://gw.example.com/v1/models
///   https://gw.example.com/v1   + models    → https://gw.example.com/v1/models
pub fn openai_endpoint(base: &str, path: &str) -> String {
    let trimmed = base.trim().trim_end_matches('/');
    let root = trimmed.strip_suffix("/v1").unwrap_or(trimmed);
    format!("{root}/v1/{path}")
}

/// 读响应：把 HTTP 状态 + URL + 响应片段带进错误，便于诊断网关问题。
/// 非 2xx 或非 JSON（如网关返回 HTML/404 页）都给出可读信息，而不是裸 serde 错误。
async fn read_json_or_err(resp: reqwest::Response, who: &str) -> Result<Value, String> {
    let status = resp.status();
    let url = resp.url().to_string();
    let payload = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let snippet: String = payload.chars().take(400).collect();
        return Err(format!("{who} 返回 {status}（{url}）：{snippet}"));
    }
    serde_json::from_str(&payload).map_err(|_| {
        let snippet: String = payload.chars().take(200).collect();
        format!("{who} 返回非 JSON 响应（{url}，HTTP {status}）：{snippet}")
    })
}

/// 读取 AI 配置完整视图（两 provider 都带，不回传明文 Key）。
#[tauri::command]
pub fn get_ai_settings(
    state: tauri::State<'_, AppState>,
) -> Result<settings::AiSettingsView, String> {
    settings::read_ai_settings_view(&state).map_err(|e| e.to_string())
}

/// 切换激活的 provider（"anthropic" | "openai"）。
#[tauri::command]
pub fn set_ai_provider(
    state: tauri::State<'_, AppState>,
    provider: String,
) -> Result<(), String> {
    let p = settings::AiProvider::from_str_lenient(&provider);
    settings::set_ai_provider(&state, p).map_err(|e| e.to_string())
}

/// 写入指定 provider 的配置。`api_key` 为 None 表示保持现有 Key 不变；Some("") 表示清空。
#[tauri::command]
pub fn set_ai_settings(
    state: tauri::State<'_, AppState>,
    provider: String,
    api_key: Option<String>,
    model: String,
    base_url: String,
) -> Result<(), String> {
    let p = settings::AiProvider::from_str_lenient(&provider);
    settings::write_provider_settings(&state, p, api_key.as_deref(), &model, &base_url)
        .map_err(|e| e.to_string())
}

/// 拉取当前 provider 可用的模型 id 列表（GET /v1/models）。
/// 需先配置好该 provider 的 Key。
#[tauri::command]
pub async fn list_ai_models(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let ai = settings::read_ai_settings(&state).map_err(|e| e.to_string())?;
    if !ai.has_key() {
        return Err(ERR_AI_NOT_CONFIGURED.to_string());
    }
    let client = reqwest::Client::new();
    let req = match ai.provider {
        settings::AiProvider::Anthropic => client
            .get(format!("{}/v1/models", ai.base_url.trim_end_matches('/')))
            .header("x-api-key", &ai.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION),
        settings::AiProvider::Openai => client
            .get(openai_endpoint(&ai.base_url, "models"))
            .header("authorization", format!("Bearer {}", ai.api_key)),
    };
    let resp = req
        .send()
        .await
        .map_err(|e| format!("请求模型列表失败：{e}"))?;
    let value = read_json_or_err(resp, "模型列表").await?;
    let mut models = parse_models_response(&value);
    models.sort();
    Ok(models)
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
        assert!(p.contains("tasks")); // 提示里要求输出 tasks 数组
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

    #[test]
    fn extracts_openai_responses_output_text() {
        // Responses API：output[] 里先有 reasoning 项，再有 message + output_text
        let resp = json!({
            "output": [
                { "type": "reasoning", "summary": [] },
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [
                        { "type": "output_text", "text": "{\"tasks\":[{\"title\":\"甲\"}]}" }
                    ]
                }
            ]
        });
        let value = extract_openai_responses_output(&resp).expect("应取到结构化输出");
        let out = parse_emit_tasks_input(&value, &tags(&[]));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].title, "甲");
    }

    #[test]
    fn openai_refusal_surfaces_error() {
        let resp = json!({
            "output": [
                {
                    "type": "message",
                    "content": [
                        { "type": "refusal", "refusal": "无法满足该请求" }
                    ]
                }
            ]
        });
        let err = extract_openai_responses_output(&resp).unwrap_err();
        assert!(err.contains("拒绝"));
        assert!(err.contains("无法满足该请求"));
    }

    #[test]
    fn openai_missing_output_errors() {
        assert!(extract_openai_responses_output(&json!({})).is_err());
        assert!(extract_openai_responses_output(&json!({ "output": [] })).is_err());
    }

    #[test]
    fn parses_models_list() {
        // OpenAI / Anthropic /v1/models 都是 {data:[{id}]}
        let resp = json!({
            "object": "list",
            "data": [
                { "id": "gpt-5-codex", "object": "model" },
                { "id": "codex-mini-latest", "object": "model" },
                { "id": "gpt-4o" }
            ]
        });
        let models = parse_models_response(&resp);
        assert_eq!(models, vec!["gpt-5-codex", "codex-mini-latest", "gpt-4o"]);
    }

    #[test]
    fn parses_models_empty_when_no_data() {
        assert!(parse_models_response(&json!({})).is_empty());
        assert!(parse_models_response(&json!({ "data": [] })).is_empty());
    }

    #[test]
    fn openai_endpoint_normalizes_v1() {
        // 官方 base 自带 /v1
        assert_eq!(
            openai_endpoint("https://api.openai.com/v1", "responses"),
            "https://api.openai.com/v1/responses"
        );
        // 网关 base 不带 /v1 → 自动补
        assert_eq!(
            openai_endpoint("https://qi-token.qiekj.com", "models"),
            "https://qi-token.qiekj.com/v1/models"
        );
        // 带尾斜杠
        assert_eq!(
            openai_endpoint("https://gw.example.com/", "responses"),
            "https://gw.example.com/v1/responses"
        );
        // 已带 /v1 + 尾斜杠
        assert_eq!(
            openai_endpoint("https://gw.example.com/v1/", "models"),
            "https://gw.example.com/v1/models"
        );
    }
}
