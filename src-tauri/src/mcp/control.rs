// MCP HTTP 服务的运行时控制器
//
// - GUI 启动时按 settings 自动起服务（如果 mcp.http.enabled = true）
// - Tauri command `start_mcp_server` / `stop_mcp_server` / `get_mcp_status` 提供前端控制
// - 端口冲突时从期望端口起 +1 试 10 次，实际端口写回 settings
// - 全局只允许一个 HTTP 实例：用一个 Mutex<Option<Handle>> 守护
//
// 关键约束：rusqlite Connection 不是 Send。axum handler 在异步 worker 上执行，
// 但工具函数都在短锁短放（parking_lot Mutex），且持锁期间不跨 await，所以安全；
// WAL + busy_timeout=5000 还能容忍 GUI 主进程的并发写。

use crate::db::AppState;
use crate::mcp::server::PersistentTaskMcpServer;
use crate::settings;
use anyhow::{Context, Result};
use parking_lot::Mutex;
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use std::sync::Arc;
use tokio::runtime::Handle as RuntimeHandle;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

const PORT_TRY_LIMIT: u16 = 10;

struct RunningHttp {
    port: u16,
    cancel: CancellationToken,
    join: JoinHandle<()>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub running: bool,
    pub port: Option<u16>,
}

pub struct McpController {
    pub state: Arc<AppState>,
    /// tokio runtime 的句柄。Tauri setup 阶段创建一个独立的 multi-thread runtime
    /// 给 MCP HTTP server 用，避免阻塞 Tauri 主线程。
    pub rt: RuntimeHandle,
    running: Mutex<Option<RunningHttp>>,
}

impl McpController {
    pub fn new(state: Arc<AppState>, rt: RuntimeHandle) -> Self {
        Self {
            state,
            rt,
            running: Mutex::new(None),
        }
    }

    pub fn status(&self) -> McpStatus {
        match &*self.running.lock() {
            Some(r) => McpStatus {
                running: true,
                port: Some(r.port),
            },
            None => McpStatus {
                running: false,
                port: None,
            },
        }
    }

    /// 按 settings 决定是否启动；返回当前状态。供 GUI 启动时调用。
    pub fn maybe_autostart(&self) -> Result<McpStatus> {
        let s = settings::read_mcp_settings(&self.state)?;
        if s.http_enabled {
            self.start(s.http_port)
        } else {
            Ok(self.status())
        }
    }

    /// 启动 HTTP 服务。如果已在跑，直接返回当前状态（幂等）。
    pub fn start(&self, desired_port: u16) -> Result<McpStatus> {
        if self.running.lock().is_some() {
            return Ok(self.status());
        }

        // 试端口：从 desired_port 起 +1 最多 10 次
        let listener = self.rt.block_on(async {
            let mut last_err: Option<std::io::Error> = None;
            for offset in 0..PORT_TRY_LIMIT {
                let p = desired_port.saturating_add(offset);
                match tokio::net::TcpListener::bind(("127.0.0.1", p)).await {
                    Ok(l) => return Ok(l),
                    Err(e) => last_err = Some(e),
                }
            }
            Err(last_err.unwrap_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::AddrInUse, "no free port")
            }))
        })?;
        let addr = listener.local_addr().context("无法读取监听地址")?;
        let port = addr.port();

        // cancel：clone 一份给 closure 等待，原 token 留给 stop() 触发取消
        let cancel = CancellationToken::new();
        let shutdown_signal = cancel.clone();
        let server_state = self.state.clone();

        let svc: StreamableHttpService<PersistentTaskMcpServer, LocalSessionManager> =
            StreamableHttpService::new(
                move || Ok(PersistentTaskMcpServer::new(server_state.clone())),
                Default::default(),
                StreamableHttpServerConfig::default()
                    .with_sse_keep_alive(None)
                    .with_cancellation_token(cancel.child_token()),
            );
        let router = axum::Router::new().nest_service("/mcp", svc);

        let join = self.rt.spawn(async move {
            let serve = axum::serve(listener, router)
                .with_graceful_shutdown(async move { shutdown_signal.cancelled_owned().await });
            if let Err(e) = serve.await {
                eprintln!("[mcp] http server exited with error: {}", e);
            }
        });

        *self.running.lock() = Some(RunningHttp {
            port,
            cancel,
            join,
        });

        // 写回实际端口供前端展示
        let _ = settings::set_u16(&self.state, settings::KEY_HTTP_ACTUAL_PORT, port);
        eprintln!("[mcp] http server started on 127.0.0.1:{}/mcp", port);
        Ok(McpStatus {
            running: true,
            port: Some(port),
        })
    }

    /// 停止当前 HTTP 服务。如果没在跑，noop。
    pub fn stop(&self) -> Result<McpStatus> {
        let prev = self.running.lock().take();
        if let Some(r) = prev {
            r.cancel.cancel();
            let _ = self.rt.block_on(async {
                tokio::time::timeout(std::time::Duration::from_secs(2), r.join).await
            });
            let _ = settings::delete(&self.state, settings::KEY_HTTP_ACTUAL_PORT);
            eprintln!("[mcp] http server stopped");
        }
        Ok(self.status())
    }
}
