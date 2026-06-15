// 持续任务 · Tauri 后端入口
//
// 启动流程：
//   1. setup 钩子里通过 PathResolver 取到 app_data_dir，
//      在其下打开 persistent-task.db（首次启动会自动创建文件并执行 migrate）
//   2. 把 AppState 注入到 Tauri 全局状态，命令通过 State<AppState> 拿连接
//   3. 注册前端 invoke 用的所有命令

pub mod commands;
pub mod db;
pub mod mcp;
pub mod models;
pub mod settings;
pub mod tray;

use std::sync::Arc;
use tauri::{Manager, Runtime, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 桌面端持久化路径：
            //   macOS  ~/Library/Application Support/com.persistenttask.app/
            //   Linux  ~/.local/share/com.persistenttask.app/
            //   Win    %APPDATA%\com.persistenttask.app\
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("无法解析 app_data_dir: {}", e))?;
            let db_path = app_data_dir.join("persistent-task.db");

            let state = db::AppState::open(db_path.clone())
                .map_err(|e| format!("初始化 SQLite 失败: {}", e))?;
            // 启用 WAL，让 MCP 端的独立 Connection 与 GUI 并发读写
            mcp::enable_wal(&state)
                .map_err(|e| format!("启用 WAL 失败: {}", e))?;
            app.manage(state);

            // 给 MCP HTTP server 用的独立 multi-thread tokio runtime
            // —— 不能在 Tauri 主线程内 block_on，所以单独起。
            let rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .thread_name("mcp-rt")
                .build()
                .map_err(|e| format!("创建 MCP runtime 失败: {}", e))?;
            let rt_handle = rt.handle().clone();
            // 让 runtime 永驻：进程退出时整个销毁，无需单独 shutdown。
            Box::leak(Box::new(rt));

            // MCP 用独立的 AppState（独立 Connection 指向同一个 DB 文件，
            // WAL 模式下两边读写不冲突）。这样避免把整个 GUI 的 AppState 抽进 Arc。
            let mcp_state = Arc::new(
                db::AppState::open(db_path)
                    .map_err(|e| format!("初始化 MCP 端 SQLite 失败: {}", e))?,
            );
            mcp::enable_wal(&mcp_state)
                .map_err(|e| format!("MCP 端启用 WAL 失败: {}", e))?;
            let controller = mcp::control::McpController::new(mcp_state, rt_handle);

            // 按 settings.mcp.http.enabled 自动启动
            if let Err(e) = controller.maybe_autostart() {
                eprintln!("[mcp] autostart 失败：{:#}", e);
            }
            app.manage(controller);

            // 系统托盘：菜单内容由前端推送，Rust 端只负责挂载与事件转发
            tray::build(app.handle())?;
            install_main_close_to_hide(app.handle());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_tasks,
            commands::upsert_task,
            commands::delete_task,
            commands::list_tags,
            commands::upsert_tag,
            commands::delete_tag,
            commands::list_pomodoros,
            commands::insert_pomodoro,
            commands::delete_pomodoro,
            commands::clear_all,
            commands::export_db,
            commands::export_db_to_path,
            commands::replace_db,
            commands::insert_events,
            commands::query_events,
            commands::count_events,
            // MCP 控制
            commands::mcp_ctl::get_mcp_settings,
            commands::mcp_ctl::set_mcp_http_port,
            commands::mcp_ctl::set_mcp_allow_write,
            commands::mcp_ctl::set_mcp_allow_destructive,
            commands::mcp_ctl::get_mcp_status,
            commands::mcp_ctl::start_mcp_server,
            commands::mcp_ctl::stop_mcp_server,
            // AI 快速录入
            commands::ai::parse_quick_input,
            commands::ai::get_ai_settings,
            commands::ai::set_ai_settings,
            commands::ai::set_ai_provider,
            commands::ai::list_ai_models,
            tray::open_task_editor,
            tray::open_quick_record,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}

fn should_hide_instead_of_close(label: &str) -> bool {
    label == "main"
}

/// MCP 子命令入口（`persistent-task --mcp`）。
/// 阻塞式：跳过 Tauri GUI，直接跑 stdio MCP server，与 GUI 共享同一份 SQLite。
pub fn run_mcp() {
    if let Err(e) = mcp::run() {
        eprintln!("[mcp] fatal: {:#}", e);
        std::process::exit(1);
    }
}

fn install_main_close_to_hide<R: Runtime>(app: &tauri::AppHandle<R>) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let app_handle = app.clone();
    let label = main.label().to_string();

    main.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if !should_hide_instead_of_close(&label) {
                return;
            }
            api.prevent_close();
            if let Some(window) = app_handle.get_webview_window(&label) {
                let _ = window.hide();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::should_hide_instead_of_close;

    #[test]
    fn close_request_hides_only_main_window() {
        assert!(should_hide_instead_of_close("main"));
        assert!(!should_hide_instead_of_close("tray-popup"));
        assert!(!should_hide_instead_of_close("task-editor"));
    }
}
