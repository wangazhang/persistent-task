// 持续任务 · Tauri 后端入口
//
// 启动流程：
//   1. setup 钩子里通过 PathResolver 取到 app_data_dir，
//      在其下打开 persistent-task.db（首次启动会自动创建文件并执行 migrate）
//   2. 把 AppState 注入到 Tauri 全局状态，命令通过 State<AppState> 拿连接
//   3. 注册前端 invoke 用的所有命令

pub mod commands;
pub mod db;
pub mod models;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
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

            let state = db::AppState::open(db_path)
                .map_err(|e| format!("初始化 SQLite 失败: {}", e))?;
            app.manage(state);

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
            commands::replace_db,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
