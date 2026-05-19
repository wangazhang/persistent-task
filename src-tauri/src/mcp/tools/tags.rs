// Tag 域 MCP 工具（6 个）

use crate::commands::core;
use crate::mcp::server::{require_write, to_mcp_err, PersistentTaskMcpServer};
use crate::models::Tag;
use rmcp::{
    ErrorData as McpError,
    handler::server::wrapper::{Json, Parameters},
    tool, tool_router,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, JsonSchema)]
pub struct TagList {
    pub items: Vec<Tag>,
    pub count: usize,
}

/// 标签树节点（递归）
#[derive(Debug, Serialize, JsonSchema)]
pub struct TagNode {
    pub id: String,
    pub name: String,
    pub color: String,
    pub order: i32,
    pub children: Vec<TagNode>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct TagTree {
    pub roots: Vec<TagNode>,
}

fn build_tree(tags: &[Tag]) -> Vec<TagNode> {
    use std::collections::HashMap;
    let mut children_of: HashMap<Option<String>, Vec<&Tag>> = HashMap::new();
    for t in tags {
        children_of.entry(t.parent_id.clone()).or_default().push(t);
    }
    for v in children_of.values_mut() {
        v.sort_by_key(|t| t.order);
    }
    fn build(
        parent: Option<String>,
        children_of: &std::collections::HashMap<Option<String>, Vec<&Tag>>,
    ) -> Vec<TagNode> {
        children_of
            .get(&parent)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|t| TagNode {
                id: t.id.clone(),
                name: t.name.clone(),
                color: t.color.clone(),
                order: t.order,
                children: build(Some(t.id.clone()), children_of),
            })
            .collect()
    }
    build(None, &children_of)
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateTagArgs {
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTagArgs {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTagArgs {
    pub id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MoveTagArgs {
    pub id: String,
    #[serde(default)]
    pub new_parent_id: Option<String>,
    pub new_index: u32,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct TagResp {
    pub tag: Tag,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct OkResp {
    pub ok: bool,
}

#[tool_router(router = tag_tool_router, vis = "pub")]
impl PersistentTaskMcpServer {
    #[tool(
        name = "list_tags",
        description = "列出全部标签（平铺，未建树）。"
    )]
    async fn list_tags_tool(&self) -> Result<Json<TagList>, McpError> {
        let tags = core::list_tags(&self.state).map_err(to_mcp_err)?;
        let count = tags.len();
        Ok(Json(TagList { items: tags, count }))
    }

    #[tool(
        name = "get_tag_tree",
        description = "返回标签树（带 children 的层级结构）。"
    )]
    async fn get_tag_tree_tool(&self) -> Result<Json<TagTree>, McpError> {
        let tags = core::list_tags(&self.state).map_err(to_mcp_err)?;
        Ok(Json(TagTree {
            roots: build_tree(&tags),
        }))
    }

    #[tool(
        name = "create_tag",
        description = "创建标签。color 缺省 #6366f1（与桌面 app 默认色一致）。需要写权限。"
    )]
    async fn create_tag_tool(
        &self,
        Parameters(args): Parameters<CreateTagArgs>,
    ) -> Result<Json<TagResp>, McpError> {
        require_write(&self.state)?;
        // 计算 order：同父节点下最大 order + 1
        let tags = core::list_tags(&self.state).map_err(to_mcp_err)?;
        let order = tags
            .iter()
            .filter(|t| t.parent_id == args.parent_id)
            .map(|t| t.order)
            .max()
            .map(|m| m + 1)
            .unwrap_or(0);
        let tag = Tag {
            id: format!("tg_{}", super::uuid_like()),
            name: args.name,
            parent_id: args.parent_id,
            color: args.color.unwrap_or_else(|| "#6366f1".into()),
            order,
        };
        core::upsert_tag(&self.state, &tag).map_err(to_mcp_err)?;
        Ok(Json(TagResp { tag }))
    }

    #[tool(
        name = "update_tag",
        description = "PATCH 语义更新标签的 name / color。需要写权限。"
    )]
    async fn update_tag_tool(
        &self,
        Parameters(args): Parameters<UpdateTagArgs>,
    ) -> Result<Json<TagResp>, McpError> {
        require_write(&self.state)?;
        let tags = core::list_tags(&self.state).map_err(to_mcp_err)?;
        let mut tag = tags
            .into_iter()
            .find(|t| t.id == args.id)
            .ok_or_else(|| McpError::invalid_params(format!("tag {} 不存在", args.id), None))?;
        if let Some(v) = args.name {
            tag.name = v;
        }
        if let Some(v) = args.color {
            tag.color = v;
        }
        core::upsert_tag(&self.state, &tag).map_err(to_mcp_err)?;
        Ok(Json(TagResp { tag }))
    }

    #[tool(
        name = "delete_tag",
        description = "删除标签（级联删除子标签 + 自动解绑 task_tags）。需要写权限。"
    )]
    async fn delete_tag_tool(
        &self,
        Parameters(args): Parameters<DeleteTagArgs>,
    ) -> Result<Json<OkResp>, McpError> {
        require_write(&self.state)?;
        core::delete_tag(&self.state, &args.id).map_err(to_mcp_err)?;
        Ok(Json(OkResp { ok: true }))
    }

    #[tool(
        name = "move_tag",
        description = "把标签挪到新父节点 + 新顺序位置；同时重排兄弟节点的 order。\
         newParentId 不传 = 移到根；newIndex 是 0-based 在新父下的位置。需要写权限。"
    )]
    async fn move_tag_tool(
        &self,
        Parameters(args): Parameters<MoveTagArgs>,
    ) -> Result<Json<TagResp>, McpError> {
        require_write(&self.state)?;
        let tag = core::move_tag(
            &self.state,
            &args.id,
            args.new_parent_id.as_deref(),
            args.new_index as usize,
        )
        .map_err(to_mcp_err)?;
        Ok(Json(TagResp { tag }))
    }
}
