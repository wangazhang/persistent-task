// MCP 工具按域拆分到这些子模块。
// 每个子模块通过 #[tool_router(router = X_tool_router, vis = "pub")] 暴露
// 一个静态 router 构造函数，由 mcp/server.rs 的 new() 合并进总 router。

pub mod admin;
pub mod analytics;
pub mod pomodoros;
pub mod tags;
pub mod tasks;

/// crate 内共享：生成 ms 时间戳 + 32 位时间扰动的"足够独特"的字符串 id。
/// 不引入 uuid crate；对单机/单进程场景碰撞概率足够低。
pub(crate) fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = chrono::Utc::now().timestamp_millis();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let r = nanos.wrapping_mul(2654435761);
    format!("{ts:x}{r:08x}")
}
