/**
 * 斜杠命令扩展（用于 RichDescription）。
 *
 * 触发：在空段落或行首输入「/」即弹出菜单；选中后把斜杠及查询字符替换为对应块结构。
 *
 * 不依赖 tippy.js：用 React Portal + 绝对定位在 clientRect 下方。
 *
 * 用法：
 *   import { SlashCommand, useSlashCommandRenderer } from "./SlashCommand";
 *   const { renderer, render } = useSlashCommandRenderer();
 *   editor extensions: [SlashCommand.configure({ render })]
 *   返回的 renderer 渲染到 React 树里
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, {
  type SuggestionOptions,
  type SuggestionProps,
} from "@tiptap/suggestion";
import {
  CheckSquare,
  Heading2,
  Heading3,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  TextQuote,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface SlashItem {
  key: string;
  title: string;
  description: string;
  icon: ReactNode;
  /** keywords 用于查询匹配（除了 title） */
  keywords?: string[];
  /** 选中时执行的命令 */
  command: (props: { editor: Editor; range: Range }) => void;
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    key: "h2",
    title: "二级标题",
    description: "中等大小的标题",
    icon: <Heading2 className="h-4 w-4" />,
    keywords: ["heading", "h2", "title", "标题"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run();
    },
  },
  {
    key: "h3",
    title: "三级标题",
    description: "小标题",
    icon: <Heading3 className="h-4 w-4" />,
    keywords: ["heading", "h3", "subtitle", "小标题"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run();
    },
  },
  {
    key: "bullet",
    title: "无序列表",
    description: "圆点列表",
    icon: <List className="h-4 w-4" />,
    keywords: ["bullet", "ul", "list", "无序", "列表"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    key: "ordered",
    title: "有序列表",
    description: "1. 2. 3. 数字列表",
    icon: <ListOrdered className="h-4 w-4" />,
    keywords: ["ordered", "ol", "number", "有序"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    key: "task",
    title: "任务列表",
    description: "可勾选的子任务",
    icon: <CheckSquare className="h-4 w-4" />,
    keywords: ["task", "todo", "checkbox", "任务", "子任务"],
    command: ({ editor, range }) => {
      // tiptap-task-list 注册的命令
      editor.chain().focus().deleteRange(range).toggleList("taskList", "taskItem").run();
    },
  },
  {
    key: "quote",
    title: "引用",
    description: "引用块",
    icon: <Quote className="h-4 w-4" />,
    keywords: ["quote", "blockquote", "引用"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    key: "code",
    title: "代码块",
    description: "等宽代码片段",
    icon: <TextQuote className="h-4 w-4" />,
    keywords: ["code", "codeblock", "代码"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setCodeBlock().run();
    },
  },
  {
    key: "divider",
    title: "分隔线",
    description: "水平分割线",
    icon: <Minus className="h-4 w-4" />,
    keywords: ["divider", "hr", "rule", "分割"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
  {
    key: "link",
    title: "插入链接",
    description: "粘贴 URL，作为占位链接",
    icon: <LinkIcon className="h-4 w-4" />,
    keywords: ["link", "url", "链接"],
    command: ({ editor, range }) => {
      const url = window.prompt("请输入链接 URL");
      const trimmed = url?.trim();
      if (!trimmed) {
        editor.chain().focus().deleteRange(range).run();
        return;
      }
      // 用 URL 作为可见文本，再套 link mark
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "text",
          text: trimmed,
          marks: [{ type: "link", attrs: { href: trimmed } }],
        })
        .run();
    },
  },
];

function filterItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((it) => {
    if (it.title.toLowerCase().includes(q)) return true;
    if (it.key.toLowerCase().includes(q)) return true;
    return (it.keywords ?? []).some((k) => k.toLowerCase().includes(q));
  });
}

/**
 * 创建一个 React 渲染契约：
 *   - extension 拿到 setRenderState，把当前 suggestion 状态推给 React。
 *   - React 用 SlashMenuPortal 渲染浮层。
 */
type RenderState = {
  visible: boolean;
  items: SlashItem[];
  selectedIndex: number;
  rect: DOMRect | null;
  command: ((item: SlashItem) => void) | null;
};

export function useSlashCommandRenderer() {
  const [state, setState] = useState<RenderState>({
    visible: false,
    items: [],
    selectedIndex: 0,
    rect: null,
    command: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  const render = useMemo<SuggestionOptions["render"]>(() => {
    return () => {
      let local: RenderState = {
        visible: false,
        items: [],
        selectedIndex: 0,
        rect: null,
        command: null,
      };

      const update = (patch: Partial<RenderState>) => {
        local = { ...local, ...patch };
        setState({ ...local });
      };

      return {
        onStart: (props: SuggestionProps<SlashItem>) => {
          update({
            visible: true,
            items: props.items,
            selectedIndex: 0,
            rect: props.clientRect?.() ?? null,
            command: (item) => props.command(item),
          });
        },
        onUpdate: (props: SuggestionProps<SlashItem>) => {
          update({
            items: props.items,
            // query 变化时把 selectedIndex 收敛到 0，避免越界
            selectedIndex: 0,
            rect: props.clientRect?.() ?? null,
            command: (item) => props.command(item),
          });
        },
        onKeyDown: ({ event }) => {
          const cur = stateRef.current;
          if (!cur.visible) return false;
          if (event.key === "Escape") {
            update({ visible: false });
            return true;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            const next =
              cur.items.length === 0
                ? 0
                : (cur.selectedIndex + 1) % cur.items.length;
            update({ selectedIndex: next });
            return true;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            const len = cur.items.length || 1;
            const next = (cur.selectedIndex + len - 1) % len;
            update({ selectedIndex: next });
            return true;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const it = cur.items[cur.selectedIndex];
            if (it && cur.command) cur.command(it);
            return true;
          }
          return false;
        },
        onExit: () => {
          update({ visible: false });
        },
      };
    };
  }, []);

  const onSelect = useCallback((idx: number) => {
    const cur = stateRef.current;
    const it = cur.items[idx];
    if (it && cur.command) cur.command(it);
  }, []);

  const renderer = state.visible && state.rect ? (
    <SlashMenuPortal
      rect={state.rect}
      items={state.items}
      selectedIndex={state.selectedIndex}
      onSelect={onSelect}
      onHover={(idx) => setState((s) => ({ ...s, selectedIndex: idx }))}
    />
  ) : null;

  return { renderer, render };
}

function SlashMenuPortal({
  rect,
  items,
  selectedIndex,
  onSelect,
  onHover,
}: {
  rect: DOMRect;
  items: SlashItem[];
  selectedIndex: number;
  onSelect: (idx: number) => void;
  onHover: (idx: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 滚动选中项进入视口
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(
      `[data-slash-index="${selectedIndex}"]`
    );
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // 浮层位置：默认贴在 caret 下方 6px；屏幕底部不够时翻到上方
  const VIEWPORT_GUTTER = 8;
  const MENU_W = 240;
  const ESTIMATED_H = Math.min(items.length * 44 + 16, 320);
  let left = rect.left;
  let top = rect.bottom + 6;
  if (typeof window !== "undefined") {
    if (top + ESTIMATED_H > window.innerHeight - VIEWPORT_GUTTER) {
      top = Math.max(VIEWPORT_GUTTER, rect.top - ESTIMATED_H - 6);
    }
    if (left + MENU_W > window.innerWidth - VIEWPORT_GUTTER) {
      left = Math.max(VIEWPORT_GUTTER, window.innerWidth - MENU_W - VIEWPORT_GUTTER);
    }
  }

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[1000] max-h-80 w-60 overflow-y-auto rounded-lg border border-ink-200 bg-white p-1 shadow-xl"
      style={{ left, top }}
      // 阻止 mousedown 让编辑器失焦（这样选中后还能 focus 编辑器）
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.length === 0 ? (
        <div className="px-2 py-3 text-center text-xs text-ink-400">无匹配项</div>
      ) : (
        items.map((it, idx) => (
          <button
            key={it.key}
            type="button"
            data-slash-index={idx}
            onMouseEnter={() => onHover(idx)}
            onClick={() => onSelect(idx)}
            className={cn(
              "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left",
              idx === selectedIndex
                ? "bg-brand-50 text-brand-700"
                : "text-ink-700 hover:bg-ink-50"
            )}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-ink-200 bg-white text-ink-500">
              {it.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{it.title}</span>
              <span className="block truncate text-[11px] text-ink-400">
                {it.description}
              </span>
            </span>
          </button>
        ))
      )}
    </div>,
    document.body
  );
}

export const SlashCommand = Extension.create<{
  render?: SuggestionOptions["render"];
}>({
  name: "slashCommand",

  addOptions() {
    return {};
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        // 输入 `/` 后立刻就要弹（含查询为空时全列表），所以 allowSpaces=false
        allowSpaces: false,
        items: ({ query }) => filterItems(query),
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
        },
        render: this.options.render,
      }),
    ];
  },
});
