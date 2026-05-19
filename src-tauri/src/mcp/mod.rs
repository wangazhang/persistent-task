// MCP server — HTTP 常驻（默认）+ stdio 兼容
//
// GUI 模式（默认）：
//   - Tauri 启动时按 settings 自动起 HTTP MCP server（127.0.0.1:7321/mcp）
//   - 前端高级菜单提供开关 / 端口 / 写权限 / 危险权限设置
//
// CLI 模式（备用）：
//   - `persistent-task --mcp` 直接跑 stdio MCP server，给只支持 stdio 的 agent

pub mod audit;
pub mod control;
pub mod resources;
pub mod security;
pub mod server;
pub mod tools;

use crate::db::AppState;
use anyhow::{Context, Result};
use std::path::PathBuf;
use std::sync::Arc;

/// 与 Tauri `tauri.conf.json -> identifier` 同步。
pub const APP_BUNDLE_ID: &str = "com.persistenttask.app";

/// 解析与 Tauri PathResolver::app_data_dir 等价的路径。
pub fn resolve_app_data_dir() -> Result<PathBuf> {
    let base = dirs::data_dir().context("无法解析系统数据目录 (dirs::data_dir)")?;
    Ok(base.join(APP_BUNDLE_ID))
}

/// 启用 WAL 模式 + busy_timeout，让 GUI 和外部 MCP 子进程能并发读写。
pub fn enable_wal(state: &AppState) -> Result<()> {
    let conn = state.conn.lock();
    conn.pragma_update(None, "journal_mode", "WAL")
        .context("启用 WAL 模式失败")?;
    conn.pragma_update(None, "busy_timeout", 5000_i32)
        .context("设置 busy_timeout 失败")?;
    Ok(())
}

/// `persistent-task --mcp` 入口：阻塞式 stdio server。
pub fn run() -> Result<()> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("初始化 tokio runtime 失败")?;
    runtime.block_on(run_stdio_async())
}

async fn run_stdio_async() -> Result<()> {
    use rmcp::ServiceExt;
    use rmcp::transport::io::stdio;

    let db_path = resolve_app_data_dir()?.join("persistent-task.db");
    eprintln!("[mcp] opening database: {}", db_path.display());
    let state = AppState::open(db_path).context("初始化 SQLite 失败")?;
    enable_wal(&state)?;

    let state = Arc::new(state);
    let server = server::PersistentTaskMcpServer::new(state.clone());
    eprintln!(
        "[mcp] persistent-task MCP server starting (bundle={}, version={})",
        APP_BUNDLE_ID,
        env!("CARGO_PKG_VERSION")
    );

    let (rx, tx) = stdio();
    let running = server
        .serve((rx, tx))
        .await
        .context("MCP 初始化握手失败")?;

    tokio::select! {
        result = running.waiting() => {
            result.context("MCP 服务异常退出")?;
        }
        _ = tokio::signal::ctrl_c() => {
            eprintln!("[mcp] received ctrl+c, shutting down");
        }
    }

    Ok(())
}
