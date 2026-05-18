/**
 * 任务描述富文本编辑器（基于 TipTap v3）。
 *
 * 数据形态保持 markdown 字符串（向后兼容 description 字段的存量数据）；
 * 通过 `tiptap-markdown` 在 markdown ↔ ProseMirror doc 之间互转。
 *
 * 功能：
 *   - 子任务（GFM task list）：`[ ]` / `[]` / `[/]` / `[x]` + 空格触发
 *   - Link 扩展：粘贴 URL 自动变链接（autolink + linkOnPaste），Cmd/Ctrl+K 包裹选区
 *   - BubbleMenu：选中文字时浮出小工具栏（粗 / 斜 / 删 / 行内代码 / 链接 / 清除）
 *   - SlashCommand：在行首/空段落输入 `/` 弹块插入菜单（H2/H3 / 列表 / 任务 / 引用 / 代码块 / 分隔线 / 链接占位）
 */

import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef } from "react";
import {
  Bold,
  Code,
  Italic,
  Link as LinkIcon,
  RemoveFormatting,
  Strikethrough,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TriTaskItem } from "./TriTaskItem";
import markdownItTaskListsTri from "@/lib/markdownItTaskListsTri";
import { SlashCommand, useSlashCommandRenderer } from "./SlashCommand";

interface RichDescriptionProps {
  /** 初始 / 受控 markdown 内容 */
  value: string;
  /** 内容变化时回调（已序列化为 markdown）*/
  onChange: (md: string) => void;
  placeholder?: string;
  className?: string;
  /** 高度提示，默认 min-h-24 max-h-64 可滚动 */
  heightClass?: string;
}

export function RichDescription({
  value,
  onChange,
  placeholder = "可写说明，输入 / 选择块格式，或用「- [ ] xxx」添加子任务…",
  className,
  heightClass = "min-h-24 max-h-64",
}: RichDescriptionProps) {
  // 用 ref 持有 onChange，避免 effect 依赖变动导致编辑器重建
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const slash = useSlashCommandRenderer();

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // 关掉 StarterKit 自带 Link，下面用独立 Link 扩展接管（autolink / linkOnPaste）
        link: false,
      }),
      TaskList,
      TriTaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      Link.configure({
        autolink: true,
        linkOnPaste: true,
        openOnClick: false,
        defaultProtocol: "https",
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
          class: "text-brand-600 underline underline-offset-2 hover:text-brand-700",
        },
      }),
      SlashCommand.configure({ render: slash.render }),
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: "-",
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: value,
    onUpdate({ editor }) {
      // tiptap-markdown 把整篇序列化为 GFM markdown
      const md = (editor.storage as { markdown?: { getMarkdown: () => string } })
        .markdown?.getMarkdown();
      onChangeRef.current(md ?? "");
    },
    editorProps: {
      attributes: {
        class: cn(
          "tiptap prose prose-sm max-w-none focus:outline-none",
          "px-3 py-2 text-sm text-ink-700",
          heightClass,
          "overflow-y-auto"
        ),
      },
      handleKeyDown(_view, event) {
        // Cmd/Ctrl+K：在选区上提示输入 URL，包成链接
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          promptAndSetLink();
          return true;
        }
        return false;
      },
    },
  });

  function promptAndSetLink() {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const input = window.prompt("链接 URL（留空可取消，输入 - 移除链接）", prev ?? "");
    if (input === null) return;
    const trimmed = input.trim();
    if (trimmed === "" || trimmed === "-") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: trimmed })
      .run();
  }

  // 父级换了 task（value 变成另一个任务的内容）时，把编辑器内容同步过去。
  // 关键：不能让 setContent 触发 onUpdate，否则会反向写脏 onChange。
  //
  // 这里顺带做两件事：
  //   1) 第一次 editor 就绪时，把三态插件挂到 markdown-it 的 parser 上
  //   2) 然后再用 parser 重新 parse 一次初始内容，避免 markdown 扩展在
  //      onBeforeCreate 阶段就已经按"无三态"语义把 [/] 当普通文字解析掉
  const pluginInstalledRef = useRef(false);
  useEffect(() => {
    if (!editor) return;
    if (!pluginInstalledRef.current) {
      const storage = (editor.storage as unknown as Record<string, unknown>)
        .markdown as
        | { parser?: { md?: { use: (p: unknown) => void } } }
        | undefined;
      if (storage?.parser?.md) {
        storage.parser.md.use(markdownItTaskListsTri);
        pluginInstalledRef.current = true;
        // 用新插件重新 parse 初始内容
        editor.commands.setContent(value || "", { emitUpdate: false });
        return;
      }
    }
    const current = (editor.storage as { markdown?: { getMarkdown: () => string } })
      .markdown?.getMarkdown();
    if (current === value) return;
    editor.commands.setContent(value || "", { emitUpdate: false });
  }, [editor, value]);

  return (
    <div
      className={cn(
        "rounded-lg border border-ink-200 bg-white",
        "focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-300/40",
        "transition-colors",
        className
      )}
      data-placeholder={placeholder}
    >
      <EditorContent editor={editor} />
      {editor && (
        <BubbleMenu
          editor={editor}
          options={{ placement: "top" }}
          shouldShow={({ editor, from, to }) => {
            // 仅在有选区且不在代码块/链接占位时显示
            if (from === to) return false;
            if (editor.isActive("codeBlock")) return false;
            return true;
          }}
          className="flex items-center gap-0.5 rounded-md border border-ink-200 bg-white p-0.5 shadow-lg"
        >
          <ToolbarButton
            label="粗体（Cmd/Ctrl+B）"
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            label="斜体（Cmd/Ctrl+I）"
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            label="删除线"
            active={editor.isActive("strike")}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            label="行内代码"
            active={editor.isActive("code")}
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <Code className="h-3.5 w-3.5" />
          </ToolbarButton>
          <span className="mx-0.5 h-4 w-px bg-ink-200" />
          <ToolbarButton
            label="插入链接（Cmd/Ctrl+K）"
            active={editor.isActive("link")}
            onClick={promptAndSetLink}
          >
            <LinkIcon className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            label="清除格式"
            onClick={() =>
              editor.chain().focus().unsetAllMarks().clearNodes().run()
            }
          >
            <RemoveFormatting className="h-3.5 w-3.5" />
          </ToolbarButton>
        </BubbleMenu>
      )}
      {slash.renderer}
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      // 用 mousedown preventDefault 让 BubbleMenu 不会因为按钮夺焦点而消失
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        "rounded p-1 text-ink-500 hover:bg-ink-100 hover:text-ink-800",
        active && "bg-brand-100 text-brand-700 hover:bg-brand-100"
      )}
    >
      {children}
    </button>
  );
}
