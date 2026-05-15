/**
 * 任务描述富文本编辑器（基于 TipTap v3）。
 *
 * 设计：
 *   - 数据形态保持 markdown 字符串（向后兼容 description 字段的存量数据）
 *   - 通过 `tiptap-markdown` 在 markdown ↔ ProseMirror doc 之间互转
 *   - 子任务 = GFM 任务列表（- [ ] / - [x]），点击 checkbox 直接勾选
 *   - 输入 "[ ] " 自动转 checkbox（StarterKit + TaskList 默认行为）
 *
 * 容器样式向已有 textarea 看齐：圆角 + 浅边 + 聚焦时高亮。
 */

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

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
  placeholder = "可写说明，或用「- [ ] xxx」格式添加子任务…",
  className,
  heightClass = "min-h-24 max-h-64",
}: RichDescriptionProps) {
  // 用 ref 持有 onChange，避免 effect 依赖变动导致编辑器重建
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // 强制段落用普通 <p>，列表保持默认。其他富格式由 starter-kit 提供
        // 但我们暂不做工具栏，所以用户主要通过 markdown 输入触发
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
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
    },
  });

  // 父级换了 task（value 变成另一个任务的内容）时，把编辑器内容同步过去。
  // 关键：不能让 setContent 触发 onUpdate，否则会反向写脏 onChange。
  useEffect(() => {
    if (!editor) return;
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
    </div>
  );
}
