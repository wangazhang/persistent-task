// 数据模型（与前端 src/lib/types.ts 保持同构）
//
// serde 字段使用 camelCase，对外保持与前端 TS 类型一致，
// 这样前端 invoke 时无需手动转换字段名。
// JsonSchema 用于 rmcp 在 MCP `tools/list` 时自动产出 outputSchema。

use serde::{Deserialize, Serialize};

/// 任务状态。前端取值：todo / in_progress / suspended / done / archived
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Todo,
    InProgress,
    /// 挂起：暂时搁置（前端在 v2 加入）
    Suspended,
    Done,
    Archived,
}

/// 任务优先级。前端取值：p0 / p1 / p2，缺省 = p2
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum TaskPriority {
    P0,
    P1,
    P2,
}

impl Default for TaskPriority {
    fn default() -> Self {
        TaskPriority::P2
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
    /// 优先级。前端可能不传（旧数据 / 老 mock），用 default 兜底到 P2
    #[serde(default)]
    pub priority: TaskPriority,
    /// 任务出现在哪些天的「今日任务」中（yyyy-MM-dd）
    pub scheduled_dates: Vec<String>,
    pub tag_ids: Vec<String>,
    pub order: i32,
    /// 自定义颜色（hex）。未设则前端按优先级 / 状态色显示。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// 次日处理日志 JSON 字符串。前端会 JSON.parse / JSON.stringify。
    /// 兼容旧数据：缺失或 null 视作 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_log: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    /// 父标签 id；为空表示根
    pub parent_id: Option<String>,
    pub color: String,
    pub order: i32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PomodoroType {
    Focus,
    ShortBreak,
    LongBreak,
}

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroSession {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(rename = "type")]
    pub type_: PomodoroType,
    pub duration_sec: i32,
    pub completed: bool,
    pub started_at: String,
    pub ended_at: String,
}

// ────────────────────────────────────────────────────────────────
// 与 SQLite 行的互转辅助
//
// 我们把 enum 落库为 TEXT，便于人读 & 调试，也避免未来加新 variant 时
// 需要做 INTEGER → enum 的回填迁移。
// ────────────────────────────────────────────────────────────────

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskStatus::Todo => "todo",
            TaskStatus::InProgress => "in_progress",
            TaskStatus::Suspended => "suspended",
            TaskStatus::Done => "done",
            TaskStatus::Archived => "archived",
        }
    }
    pub fn from_str(s: &str) -> Self {
        match s {
            "in_progress" => TaskStatus::InProgress,
            "suspended" => TaskStatus::Suspended,
            "done" => TaskStatus::Done,
            "archived" => TaskStatus::Archived,
            // 未知值兜底为 todo，保证老数据不崩
            _ => TaskStatus::Todo,
        }
    }
}

impl TaskPriority {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskPriority::P0 => "p0",
            TaskPriority::P1 => "p1",
            TaskPriority::P2 => "p2",
        }
    }
    pub fn from_str(s: &str) -> Self {
        match s {
            "p0" => TaskPriority::P0,
            "p1" => TaskPriority::P1,
            _ => TaskPriority::P2,
        }
    }
}

impl PomodoroType {
    pub fn as_str(&self) -> &'static str {
        match self {
            PomodoroType::Focus => "focus",
            PomodoroType::ShortBreak => "short_break",
            PomodoroType::LongBreak => "long_break",
        }
    }
    pub fn from_str(s: &str) -> Self {
        match s {
            "short_break" => PomodoroType::ShortBreak,
            "long_break" => PomodoroType::LongBreak,
            _ => PomodoroType::Focus,
        }
    }
}

// ────────────────────────────────────────────────────────────────
// Analytics Events
// ────────────────────────────────────────────────────────────────

/// 事件来源：auto = store 中间件自动产出；manual = 显式 track() 调用
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum EventSource {
    Auto,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsEvent {
    pub id: String,
    pub r#type: String,
    pub occurred_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<String>,
    pub session_id: String,
    pub source: EventSource,
    /// 任意 JSON 对象;前端约定 stringify 后传入
    pub props: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EventFilter {
    #[serde(default)]
    pub types: Option<Vec<String>>,
    #[serde(default)]
    pub entity_type: Option<String>,
    #[serde(default)]
    pub entity_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum EventGroupBy {
    Day,
    Hour,
    Type,
}

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct EventCountRow {
    pub key: String,
    pub count: i64,
}
