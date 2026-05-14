#!/bin/bash

# AI 工作站 - 精简版
# 仅提供 Codex 与 Claude Code 的快速启动入口
# 两者均默认使用各自的"全授权模式"启动：
#   - Codex:       --dangerously-bypass-approvals-and-sandbox
#   - Claude Code: --dangerously-skip-permissions
#   agent无需关注本脚本
# --- 通用函数 ---

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

print_step() {
    echo -e "\n\033[1;34m📋 $1\033[0m"
}

print_success() {
    echo -e "\033[1;32m✅ $1\033[0m"
}

print_error() {
    echo -e "\033[1;31m❌ $1\033[0m"
}

print_warning() {
    echo -e "\033[1;33m⚠️  $1\033[0m"
}

# --- 通用：环境与代理 ---

# 切到 Node.js 22 版本（启动 Codex / Claude Code 都需要）
use_node_22() {
    if ! command_exists nvm; then
        if [ -f "$HOME/.nvm/nvm.sh" ]; then
            source "$HOME/.nvm/nvm.sh"
        else
            print_error "nvm 未安装或未加载，请先安装 nvm。"
            return 1
        fi
    fi

    echo "正在切换到 Node.js 22 版本..."
    if ! nvm use 22 >/dev/null 2>&1; then
        print_warning "未安装 Node.js 22，正在自动安装..."
        if ! nvm install 22; then
            print_error "Node.js 22 安装失败"
            return 1
        fi
        nvm use 22 >/dev/null 2>&1
    fi

    CURRENT_NODE_VERSION=$(node --version 2>/dev/null)
    print_success "当前 Node.js 版本：$CURRENT_NODE_VERSION"
}

# 询问是否启用代理（默认启用）
maybe_enable_proxy() {
    read -p "是否需要为安装/升级启用代理？(Y/n): " USE_PROXY
    if ! [[ "$USE_PROXY" == "n" || "$USE_PROXY" == "N" ]]; then
        print_warning "已启用代理 (127.0.0.1:7890)"
        export https_proxy=http://127.0.0.1:7890
        export http_proxy=http://127.0.0.1:7890
        export all_proxy=socks5://127.0.0.1:7890
    else
        echo "不使用代理"
    fi
}

unset_proxy() {
    unset https_proxy http_proxy all_proxy
}

# --- Claude Code：自动安装 / 升级 / 启动 ---

install_claude_code_internal() {
    echo "🎯 正在安装 Claude Code..."
    echo "📦 安装命令: npm install -g @anthropic-ai/claude-code"
    echo

    maybe_enable_proxy

    echo
    echo "🔄 正在全局安装 Claude Code..."
    npm install -g @anthropic-ai/claude-code
    local install_status=$?

    unset_proxy

    if [ $install_status -eq 0 ]; then
        print_success "Claude Code 安装完成！"
        if command_exists claude; then
            local new_version
            new_version=$(claude --version 2>/dev/null || echo "未知版本")
            echo "安装版本: $new_version"
        fi
        return 0
    else
        print_error "Claude Code 安装失败，请检查网络连接或代理设置"
        return 1
    fi
}

# 启动 Claude Code（全授权模式 / YOLO）
start_claude() {
    print_step "启动 Claude Code（全授权模式 / --dangerously-skip-permissions）"

    if ! use_node_22; then
        return 1
    fi

    if ! command_exists claude; then
        print_warning "未检测到 Claude Code，正在自动安装..."
        if ! install_claude_code_internal; then
            return 1
        fi
        if ! command_exists claude; then
            print_error "Claude Code 安装后仍未检测到 claude 命令"
            return 1
        fi
    else
        local current_version
        current_version=$(claude --version 2>/dev/null || echo "未知版本")
        print_success "检测到 Claude Code 已安装 (版本: $current_version)"

        read -p "是否检查并升级到最新版本？(y/N): " check_upgrade
        if [[ "$check_upgrade" == "y" || "$check_upgrade" == "Y" ]]; then
            maybe_enable_proxy
            echo "🔄 正在升级 Claude Code 到最新版本..."
            npm install -g @anthropic-ai/claude-code@latest
            local upgrade_status=$?
            unset_proxy
            if [ $upgrade_status -eq 0 ]; then
                local new_version
                new_version=$(claude --version 2>/dev/null || echo "最新版本")
                print_success "Claude Code 升级完成！新版本: $new_version"
            else
                print_error "Claude Code 升级失败，将使用当前版本启动"
            fi
        fi
    fi

    export NODE_OPTIONS="--max-old-space-size=8192"
    echo "🎯 正在以全授权模式启动 Claude Code..."
    echo "💡 内存: 8GB | 模式: --dangerously-skip-permissions | 按 Ctrl+C 停止"
    claude --dangerously-skip-permissions
}

# --- Codex：自动安装 / 升级 / 启动 ---

# 启动 Codex（全授权模式 / YOLO）
start_codex() {
    print_step "启动 Codex（全授权模式 / --dangerously-bypass-approvals-and-sandbox）"

    if ! use_node_22; then
        return 1
    fi

    if ! command_exists codex; then
        print_warning "未检测到 Codex CLI，正在自动安装..."

        maybe_enable_proxy

        echo
        echo "🔄 正在全局安装 Codex CLI..."
        npm install -g @openai/codex
        local install_status=$?

        unset_proxy

        if [ $install_status -eq 0 ]; then
            print_success "Codex CLI 安装完成！"
            if command_exists codex; then
                local codex_version
                codex_version=$(codex --version 2>/dev/null || echo "版本信息不可用")
                echo "安装版本: $codex_version"
            fi
        else
            print_error "Codex CLI 安装失败，请检查网络连接或代理设置"
            return 1
        fi
    else
        local current_version
        current_version=$(codex --version 2>/dev/null || echo "未知版本")
        print_success "检测到 Codex CLI 已安装 (版本: $current_version)"

        read -p "是否检查并升级到最新版本？(y/N): " check_upgrade
        if [[ "$check_upgrade" == "y" || "$check_upgrade" == "Y" ]]; then
            maybe_enable_proxy
            echo "🔄 正在升级 Codex CLI 到最新版本..."
            npm install -g @openai/codex@latest
            local upgrade_status=$?
            unset_proxy
            if [ $upgrade_status -eq 0 ]; then
                local new_version
                new_version=$(codex --version 2>/dev/null || echo "最新版本")
                print_success "Codex CLI 升级完成！新版本: $new_version"
            else
                print_error "Codex CLI 升级失败，将使用当前版本启动"
            fi
        fi
    fi

    export NODE_OPTIONS="--max-old-space-size=8192"
    echo "🎯 正在以全授权模式启动 Codex..."
    echo "💡 内存: 8GB | 模式: --dangerously-bypass-approvals-and-sandbox | 按 Ctrl+C 停止"
    codex --dangerously-bypass-approvals-and-sandbox
}

# --- Worktree 管理 ---

# 解析当前所在 git 仓库的根路径与工程名
# 失败时打印错误并返回 1（用于在进入 worktree 菜单时拦截）
resolve_repo_context() {
    if ! command_exists git; then
        print_error "未检测到 git 命令"
        return 1
    fi

    if ! REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
        print_error "当前目录不在任何 git 仓库内：$(pwd)"
        return 1
    fi

    PROJECT_NAME="$(basename "$REPO_ROOT")"
    REPO_PARENT="$(dirname "$REPO_ROOT")"
    return 0
}

# 校验用户输入的后缀
# 入参 $1: 后缀字符串
# 出参：合法返回 0，非法打印原因并返回 1
validate_suffix() {
    local suffix="$1"
    if [ -z "$suffix" ]; then
        print_error "后缀不能为空"
        return 1
    fi
    if [[ "$suffix" =~ [[:space:]/\\] ]]; then
        print_error "后缀不能包含空格、/ 或 \\ 字符"
        return 1
    fi
    if [[ "$suffix" =~ ^[\.-] ]]; then
        print_error "后缀不能以 . 或 - 开头"
        return 1
    fi
    return 0
}

# 1) 创建 worktree
worktree_create() {
    print_step "创建 worktree（与本工程平行）"

    echo "📦 当前工程: $PROJECT_NAME"
    echo "📁 工程路径: $REPO_ROOT"
    echo "📂 父目录:   $REPO_PARENT"
    echo

    read -p "请输入 worktree 后缀（最终目录名为 ${PROJECT_NAME}-<后缀>）: " suffix
    if ! validate_suffix "$suffix"; then
        return 1
    fi

    local worktree_name="${PROJECT_NAME}-${suffix}"
    local worktree_path="${REPO_PARENT}/${worktree_name}"

    if [ -e "$worktree_path" ]; then
        print_error "目标路径已存在，请换一个后缀：$worktree_path"
        return 1
    fi

    if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/${worktree_name}"; then
        print_error "同名分支 '${worktree_name}' 已存在，请换一个后缀"
        return 1
    fi

    echo
    echo "即将执行: git worktree add \"$worktree_path\" -b \"$worktree_name\""
    read -p "确认创建？(Y/n): " confirm
    if [[ "$confirm" == "n" || "$confirm" == "N" ]]; then
        echo "已取消"
        return 0
    fi

    if git -C "$REPO_ROOT" worktree add "$worktree_path" -b "$worktree_name"; then
        print_success "worktree 创建成功"
        echo "📁 路径:   $worktree_path"
        echo "🌿 分支:   $worktree_name"
        echo
        echo "💡 进入新 worktree:"
        echo "    cd \"$worktree_path\""
    else
        print_error "worktree 创建失败"
        return 1
    fi
}

# 2) 查看 worktree 列表
worktree_list() {
    print_step "Worktree 列表"

    echo "📦 当前工程: $PROJECT_NAME (前缀 ${PROJECT_NAME}- 的条目会被高亮)"
    echo

    # 用 porcelain 输出便于解析；同时打印一份带高亮的视图
    local entries
    entries="$(git -C "$REPO_ROOT" worktree list --porcelain 2>/dev/null)"
    if [ -z "$entries" ]; then
        print_warning "没有任何 worktree 信息"
        return 0
    fi

    local path="" branch="" head="" idx=0
    printf "%-4s  %-50s  %-30s  %s\n" "序号" "路径" "分支" "标记"
    printf "%-4s  %-50s  %-30s  %s\n" "----" "--------------------------------------------------" "------------------------------" "----"

    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            worktree\ *)
                path="${line#worktree }"
                branch=""
                head=""
                ;;
            HEAD\ *)
                head="${line#HEAD }"
                ;;
            branch\ *)
                branch="${line#branch refs/heads/}"
                ;;
            "")
                if [ -n "$path" ]; then
                    idx=$((idx + 1))
                    local display_branch="${branch:-(detached)}"
                    local mark=""
                    local base
                    base="$(basename "$path")"
                    if [[ "$base" == "${PROJECT_NAME}-"* ]]; then
                        mark="\033[1;32m★ 本脚本风格\033[0m"
                    elif [ "$path" = "$REPO_ROOT" ]; then
                        mark="\033[1;36m● 当前主工程\033[0m"
                    fi
                    printf "%-4s  %-50s  %-30s  " "$idx" "$path" "$display_branch"
                    echo -e "$mark"
                    path="" branch="" head=""
                fi
                ;;
        esac
    done <<EOF
$entries

EOF
}

# 3) 删除 worktree
worktree_delete() {
    print_step "删除 worktree"

    # 收集除主工程外的所有 worktree
    local paths=() branches=()
    local path="" branch=""
    local entries
    entries="$(git -C "$REPO_ROOT" worktree list --porcelain 2>/dev/null)"

    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            worktree\ *)
                path="${line#worktree }"
                branch=""
                ;;
            branch\ *)
                branch="${line#branch refs/heads/}"
                ;;
            "")
                if [ -n "$path" ] && [ "$path" != "$REPO_ROOT" ]; then
                    paths+=("$path")
                    branches+=("$branch")
                fi
                path=""; branch=""
                ;;
        esac
    done <<EOF
$entries

EOF

    if [ ${#paths[@]} -eq 0 ]; then
        print_warning "没有可删除的 worktree（主工程不允许删除）"
        return 0
    fi

    echo "可删除的 worktree:"
    local i
    for ((i = 0; i < ${#paths[@]}; i++)); do
        local b="${branches[$i]:-(detached)}"
        printf "  %2d. %s  [分支: %s]\n" "$((i + 1))" "${paths[$i]}" "$b"
    done
    echo "   0. 取消"
    echo

    read -p "请输入要删除的序号: " choice
    if [[ "$choice" == "0" || -z "$choice" ]]; then
        echo "已取消"
        return 0
    fi
    if ! [[ "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt "${#paths[@]}" ]; then
        print_error "无效的序号"
        return 1
    fi

    local target_path="${paths[$((choice - 1))]}"
    local target_branch="${branches[$((choice - 1))]}"

    echo
    echo "即将删除:"
    echo "  路径: $target_path"
    echo "  分支: ${target_branch:-(detached)}"
    echo

    read -p "是否同时强制删除（含未提交修改也会丢失）？(y/N): " force_choice
    local force_flag=""
    if [[ "$force_choice" == "y" || "$force_choice" == "Y" ]]; then
        force_flag="--force"
        print_warning "将以 --force 模式删除，未提交修改将丢失"
    fi

    read -p "最终确认删除？(y/N): " final_confirm
    if [[ "$final_confirm" != "y" && "$final_confirm" != "Y" ]]; then
        echo "已取消"
        return 0
    fi

    if ! git -C "$REPO_ROOT" worktree remove $force_flag "$target_path"; then
        print_error "worktree 目录删除失败"
        if [ -z "$force_flag" ]; then
            echo "💡 提示：如目标存在未提交修改，可重试并选择强制删除"
        fi
        return 1
    fi
    print_success "worktree 目录已删除：$target_path"

    if [ -n "$target_branch" ]; then
        if git -C "$REPO_ROOT" branch -D "$target_branch" >/dev/null 2>&1; then
            print_success "分支已删除：$target_branch"
        else
            print_warning "分支删除失败或已不存在：$target_branch"
        fi
    fi
}

# Worktree 二级菜单
worktree_menu() {
    if ! resolve_repo_context; then
        return 1
    fi

    while true; do
        echo -e "\n=================================="
        echo "       🌳 Worktree 管理 🌳"
        echo "=================================="
        echo "📦 当前工程: $PROJECT_NAME"
        echo
        echo "  1. 创建 worktree"
        echo "  2. 查看 worktree 列表"
        echo "  3. 删除 worktree"
        echo
        echo "  0. 返回主菜单"
        read -p "请选择操作 [0-3]: " choice

        case $choice in
            1) worktree_create ;;
            2) worktree_list ;;
            3) worktree_delete ;;
            0) break ;;
            *) print_error "无效选项，请输入 0-3 之间的数字。" ;;
        esac
    done
}

# --- 主菜单 ---

main_menu() {
    while true; do
        echo -e "\n=================================="
        echo "       🚀 AI 工作站 🚀"
        echo "=================================="
        echo "默认全授权模式启动："
        echo
        echo "  1. 启动 Codex"
        echo "  2. 启动 Claude Code"
        echo
        echo "工程协作："
        echo "  3. 管理 Worktree (创建 / 查看 / 删除)"
        echo
        echo "  0. 退出"
        read -p "请选择操作 [0-3]: " choice

        case $choice in
            1)
                start_codex
                ;;
            2)
                start_claude
                ;;
            3)
                worktree_menu
                ;;
            0)
                echo "👋 AI 工作站已退出，再见！"
                break
                ;;
            *)
                print_error "无效选项，请输入 0-3 之间的数字。"
                ;;
        esac
    done
}

# --- 脚本入口 ---
main_menu
