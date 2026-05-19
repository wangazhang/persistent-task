// Admin / Maintenance 域 MCP 工具（3 个）：DB 备份导出、整库替换、清空所有数据
//
// 这三个工具全部需要：
//   1. 写权限 + 危险权限（require_destructive）
//   2. 5 次/分钟限流
//   3. 操作前自动备份到 backups/
//   4. 操作后写一条审计事件

use crate::commands::core;
use crate::mcp::audit::record_tool_invoked;
use crate::mcp::security::auto_backup_db;
use crate::mcp::server::{require_destructive, to_mcp_err, PersistentTaskMcpServer};
use base64::Engine;
use rmcp::{
    ErrorData as McpError,
    handler::server::wrapper::{Json, Parameters},
    tool, tool_router,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, JsonSchema)]
pub struct ExportDbResp {
    /// base64 编码的 SQLite 文件二进制。还原时丢给 replace_db.bytesB64 即可。
    pub bytes_b64: String,
    pub size_bytes: usize,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceDbArgs {
    /// base64 编码的 SQLite 文件
    pub bytes_b64: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct AdminResp {
    pub ok: bool,
    /// 自动备份的文件绝对路径（如果有）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup_path: Option<String>,
}

#[tool_router(router = admin_tool_router, vis = "pub")]
impl PersistentTaskMcpServer {
    #[tool(
        name = "export_db",
        description = "导出当前 SQLite 数据库为 base64 字符串（用于备份）。\
         属于读操作但仍计入审计；不需要写权限。"
    )]
    async fn export_db_tool(&self) -> Result<Json<ExportDbResp>, McpError> {
        let bytes = core::export_db(&self.state).map_err(to_mcp_err)?;
        let size = bytes.len();
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        record_tool_invoked(
            &self.state,
            "export_db",
            Some("db"),
            None,
            Some(serde_json::json!({ "size": size })),
        );
        Ok(Json(ExportDbResp {
            bytes_b64: b64,
            size_bytes: size,
        }))
    }

    #[tool(
        name = "replace_db",
        description = "用 base64 编码的 SQLite 字节替换整个数据库（恢复备份用）。\
         执行前自动备份当前 DB 到 backups/。需要「允许写工具」+「允许危险工具」。"
    )]
    async fn replace_db_tool(
        &self,
        Parameters(args): Parameters<ReplaceDbArgs>,
    ) -> Result<Json<AdminResp>, McpError> {
        require_destructive(&self.state)?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(args.bytes_b64.as_bytes())
            .map_err(|e| {
                McpError::invalid_params(format!("bytesB64 解码失败：{}", e), None)
            })?;

        let backup = auto_backup_db(&self.state).map_err(to_mcp_err)?;
        core::replace_db(&self.state, &bytes).map_err(to_mcp_err)?;
        record_tool_invoked(
            &self.state,
            "replace_db",
            Some("db"),
            None,
            Some(serde_json::json!({
                "size": bytes.len(),
                "backup_path": backup.display().to_string(),
            })),
        );
        Ok(Json(AdminResp {
            ok: true,
            backup_path: Some(backup.display().to_string()),
        }))
    }

    #[tool(
        name = "clear_all",
        description = "清空所有任务/标签/番茄/事件（保留表结构）。\
         执行前自动备份当前 DB 到 backups/。需要「允许写工具」+「允许危险工具」。"
    )]
    async fn clear_all_tool(&self) -> Result<Json<AdminResp>, McpError> {
        require_destructive(&self.state)?;
        let backup = auto_backup_db(&self.state).map_err(to_mcp_err)?;
        core::clear_all(&self.state).map_err(to_mcp_err)?;
        // 注意：clear_all 会清空 events 表，所以审计事件要在 clear_all 之后写
        record_tool_invoked(
            &self.state,
            "clear_all",
            Some("db"),
            None,
            Some(serde_json::json!({
                "backup_path": backup.display().to_string(),
            })),
        );
        Ok(Json(AdminResp {
            ok: true,
            backup_path: Some(backup.display().to_string()),
        }))
    }
}
