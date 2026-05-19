// 防止 Windows 在 release 构建中弹出额外的命令行窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `persistent-task --mcp` 跳过 GUI，作为 stdio MCP server 启动；
    // 不带参数则正常运行 Tauri 桌面端。
    if std::env::args().any(|a| a == "--mcp") {
        persistent_task_lib::run_mcp();
    } else {
        persistent_task_lib::run();
    }
}
