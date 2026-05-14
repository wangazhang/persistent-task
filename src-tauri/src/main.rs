// 防止 Windows 在 release 构建中弹出额外的命令行窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    persistent_task_lib::run();
}
