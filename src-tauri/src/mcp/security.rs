// MCP 安全模块：限流 + 自动备份
//
// 限流策略（中度安全）：
//   - 写工具：60 次/分钟（滑动窗口）
//   - 危险工具：5 次/分钟
// 触发限流时返回 -32600（invalid request），message 含人类可读说明。
//
// 备份策略：
//   - 危险操作（replace_db / clear_all）执行前自动备份 DB 到 backups/
//   - 文件名 persistent-task-<unix_ts>.db，保留最近 20 份，老的删

use crate::db::AppState;
use anyhow::{Context, Result};
use parking_lot::Mutex;
use rmcp::ErrorData as McpError;
use std::collections::VecDeque;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// 滑动窗口限流器：记录最近 `window` 时间内的事件时间点，超过 `max` 拒绝。
pub struct SlidingWindow {
    window: Duration,
    max: usize,
    events: Mutex<VecDeque<Instant>>,
}

impl SlidingWindow {
    pub const fn new(window: Duration, max: usize) -> Self {
        Self {
            window,
            max,
            events: Mutex::new(VecDeque::new()),
        }
    }

    /// 试图占用一次配额。成功返回 Ok(())；超限返回 Err(剩余等待秒数估计)。
    pub fn try_acquire(&self) -> Result<(), u64> {
        let now = Instant::now();
        let mut q = self.events.lock();
        // 清理过期
        while let Some(front) = q.front() {
            if now.duration_since(*front) >= self.window {
                q.pop_front();
            } else {
                break;
            }
        }
        if q.len() >= self.max {
            // 估计还要等多少秒：最旧那条出窗的时刻
            let wait = q
                .front()
                .map(|t| self.window.saturating_sub(now.duration_since(*t)))
                .unwrap_or_default();
            return Err(wait.as_secs().max(1));
        }
        q.push_back(now);
        Ok(())
    }
}

fn write_limiter() -> &'static SlidingWindow {
    static L: OnceLock<SlidingWindow> = OnceLock::new();
    L.get_or_init(|| SlidingWindow::new(Duration::from_secs(60), 60))
}

fn destructive_limiter() -> &'static SlidingWindow {
    static L: OnceLock<SlidingWindow> = OnceLock::new();
    L.get_or_init(|| SlidingWindow::new(Duration::from_secs(60), 5))
}

pub fn check_write_limit() -> Result<(), McpError> {
    write_limiter().try_acquire().map_err(|wait_secs| {
        McpError::invalid_request(
            format!("MCP 写工具限流：超过 60 次/分钟，请等待约 {} 秒。", wait_secs),
            None,
        )
    })
}

pub fn check_destructive_limit() -> Result<(), McpError> {
    destructive_limiter().try_acquire().map_err(|wait_secs| {
        McpError::invalid_request(
            format!("MCP 危险工具限流：超过 5 次/分钟，请等待约 {} 秒。", wait_secs),
            None,
        )
    })
}

/// 危险操作前自动备份当前 DB。
/// 备份目录：`<app_data_dir>/backups/`，文件名 persistent-task-<unix_ms>.db。
/// 保留最近 20 份；超出按修改时间最旧的删。
pub fn auto_backup_db(state: &AppState) -> Result<std::path::PathBuf> {
    let db_path = &state.db_path;
    let parent = db_path
        .parent()
        .context("db_path 没有父目录")?
        .to_path_buf();
    let backup_dir = parent.join("backups");
    std::fs::create_dir_all(&backup_dir).context("创建 backups 目录失败")?;
    let ts = chrono::Utc::now().timestamp_millis();
    let dest = backup_dir.join(format!("persistent-task-{ts}.db"));

    // 拿一下连接锁，确保备份期间没人在写
    {
        let _g = state.conn.lock();
        std::fs::copy(db_path, &dest).context("复制 DB 到 backups 失败")?;
    }

    prune_old_backups(&backup_dir, 20);
    Ok(dest)
}

fn prune_old_backups(dir: &std::path::Path, keep: usize) {
    let Ok(mut entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(std::time::SystemTime, std::path::PathBuf)> = Vec::new();
    while let Some(Ok(e)) = entries.next() {
        if let Ok(meta) = e.metadata() {
            if meta.is_file() {
                let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
                files.push((modified, e.path()));
            }
        }
    }
    files.sort_by(|a, b| b.0.cmp(&a.0)); // 新到旧
    for (_, p) in files.into_iter().skip(keep) {
        let _ = std::fs::remove_file(p);
    }
}
