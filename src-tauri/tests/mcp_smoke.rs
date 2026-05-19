// MCP stdio 端到端 smoke 测试
//
// 用 `cargo test --test mcp_smoke` 运行。
//
// 策略：直接起 `--mcp` 子进程，按 JSON-RPC 协议手发请求 + 解析响应。
// 不引入 rmcp-client 依赖；shell-friendly 的 line-delimited 协议自己手撕足够。
//
// 用的是真实的 SQLite DB（app_data_dir 下），但所有断言都是"工具应存在 / 应返回 object"层面的，
// 不依赖具体数据条数。也不修改数据（默认不开 MCP_WRITE，写工具被拒）。

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::time::Duration;

/// 启动 `target/<debug|release>/persistent-task --mcp`，返回子进程 + 通道。
fn spawn_mcp() -> (Child, ChildStdin, BufReader<std::process::ChildStdout>) {
    // 首选 CARGO_BIN_EXE_<bin>（cargo 在大多数环境会注入）；
    // 兜底：从 test 自己的 exe 推导出 target/debug/persistent-task。
    let bin: PathBuf = std::env::var_os("CARGO_BIN_EXE_persistent-task")
        .map(PathBuf::from)
        .or_else(|| {
            // test 在 target/<profile>/deps/mcp_smoke-<hash>
            let me = std::env::current_exe().ok()?;
            // me.parent() = deps/；me.parent().parent() = <profile>/
            let profile_dir = me.parent()?.parent()?;
            let exe = profile_dir.join(if cfg!(windows) {
                "persistent-task.exe"
            } else {
                "persistent-task"
            });
            if exe.exists() { Some(exe) } else { None }
        })
        .expect("找不到 persistent-task 二进制：先运行 `cargo build --bin persistent-task`");

    let mut child = Command::new(&bin)
        .arg("--mcp")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("启动 persistent-task --mcp 失败");

    let stdin = child.stdin.take().expect("无法获取 stdin");
    let stdout = BufReader::new(child.stdout.take().expect("无法获取 stdout"));
    (child, stdin, stdout)
}

fn send(stdin: &mut ChildStdin, msg: &Value) {
    let line = serde_json::to_string(msg).expect("序列化失败") + "\n";
    stdin.write_all(line.as_bytes()).expect("写 stdin 失败");
    stdin.flush().expect("flush stdin 失败");
}

fn recv(stdout: &mut BufReader<std::process::ChildStdout>) -> Value {
    let mut line = String::new();
    stdout.read_line(&mut line).expect("读 stdout 失败");
    serde_json::from_str(line.trim()).expect("解析响应 JSON 失败")
}

fn initialize(stdin: &mut ChildStdin, stdout: &mut BufReader<std::process::ChildStdout>) -> Value {
    send(
        stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "smoke", "version": "1.0" }
            }
        }),
    );
    let resp = recv(stdout);
    send(
        stdin,
        &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
    );
    resp
}

#[test]
fn handshake_returns_server_info() {
    let (mut child, mut stdin, mut stdout) = spawn_mcp();
    let resp = initialize(&mut stdin, &mut stdout);
    let result = resp.get("result").expect("initialize 应返回 result");
    let info = result.get("serverInfo").expect("缺少 serverInfo");
    assert_eq!(info.get("name").and_then(Value::as_str), Some("persistent-task"));
    let caps = result.get("capabilities").expect("缺少 capabilities");
    assert!(caps.get("tools").is_some(), "capabilities.tools 缺失");
    assert!(
        caps.get("resources").is_some(),
        "capabilities.resources 缺失"
    );
    let _ = child.kill();
}

#[test]
fn tools_list_has_31_entries() {
    let (mut child, mut stdin, mut stdout) = spawn_mcp();
    initialize(&mut stdin, &mut stdout);
    send(
        &mut stdin,
        &json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
    );
    let resp = recv(&mut stdout);
    let tools = resp["result"]["tools"]
        .as_array()
        .expect("tools 应是数组");
    assert_eq!(
        tools.len(),
        31,
        "期望 31 个工具，实际 {}：{:?}",
        tools.len(),
        tools
            .iter()
            .filter_map(|t| t.get("name").and_then(Value::as_str))
            .collect::<Vec<_>>()
    );
    // 抽查几个关键工具一定要存在
    let names: std::collections::HashSet<&str> = tools
        .iter()
        .filter_map(|t| t.get("name").and_then(Value::as_str))
        .collect();
    for must in [
        "ping",
        "list_tasks",
        "create_task",
        "set_task_status",
        "list_tags",
        "get_tag_tree",
        "log_pomodoro",
        "get_daily_stats",
        "export_db",
        "clear_all",
    ] {
        assert!(names.contains(must), "缺少工具 {must}");
    }
    let _ = child.kill();
}

#[test]
fn resources_list_has_five() {
    let (mut child, mut stdin, mut stdout) = spawn_mcp();
    initialize(&mut stdin, &mut stdout);
    send(
        &mut stdin,
        &json!({ "jsonrpc": "2.0", "id": 3, "method": "resources/list" }),
    );
    let resp = recv(&mut stdout);
    let list = resp["result"]["resources"]
        .as_array()
        .expect("resources 应是数组");
    assert_eq!(list.len(), 5);
    let uris: std::collections::HashSet<&str> = list
        .iter()
        .filter_map(|r| r.get("uri").and_then(Value::as_str))
        .collect();
    for must in [
        "task://today",
        "task://overdue",
        "tag://tree",
        "stats://summary",
        "schema://types",
    ] {
        assert!(uris.contains(must), "缺少 resource {must}");
    }
    let _ = child.kill();
}

#[test]
fn ping_returns_db_path() {
    let (mut child, mut stdin, mut stdout) = spawn_mcp();
    initialize(&mut stdin, &mut stdout);
    send(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": { "name": "ping", "arguments": {} }
        }),
    );
    let resp = recv(&mut stdout);
    let sc = &resp["result"]["structuredContent"];
    assert_eq!(sc["status"], "ok");
    assert!(sc["db_path"].as_str().is_some_and(|s| !s.is_empty()));
    let _ = child.kill();
}

#[test]
fn list_tasks_returns_object_with_items() {
    let (mut child, mut stdin, mut stdout) = spawn_mcp();
    initialize(&mut stdin, &mut stdout);
    send(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": { "name": "list_tasks", "arguments": {} }
        }),
    );
    let resp = recv(&mut stdout);
    let sc = &resp["result"]["structuredContent"];
    assert!(sc["items"].is_array(), "items 应是数组");
    assert!(sc["count"].is_number(), "count 应是数字");
    let _ = child.kill();
}

#[test]
fn write_tool_is_denied_by_default() {
    // 默认 settings 里 allow_write 未启用，create_task 应返回错误
    let (mut child, mut stdin, mut stdout) = spawn_mcp();
    initialize(&mut stdin, &mut stdout);
    send(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 6,
            "method": "tools/call",
            "params": { "name": "create_task", "arguments": { "title": "smoke_should_not_persist" } }
        }),
    );
    let resp = recv(&mut stdout);
    assert!(
        resp.get("error").is_some(),
        "create_task 默认应被拒，实际响应：{}",
        resp
    );
    let msg = resp["error"]["message"].as_str().unwrap_or_default();
    assert!(msg.contains("写权限") || msg.contains("写工具"));
    let _ = child.kill();
}

#[test]
fn server_terminates_when_stdin_closes() {
    let (mut child, stdin, _stdout) = spawn_mcp();
    drop(stdin);
    // 给最多 3 秒退出；正常情况 server 收到 EOF 会立即退
    for _ in 0..30 {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    panic!("server 在 stdin 关闭后没有退出");
}
