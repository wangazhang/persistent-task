/**
 * TaskItem（三态版）
 *
 * 在 @tiptap/extension-task-item 之外重新实现一个 taskItem 节点：
 *   - addAttributes 用 `state: 'todo' | 'in_progress' | 'done'` 取代原来的 `checked` boolean
 *   - NodeView 渲染自定义复选框（灰圆 / 橙半圆 / 绿勾），点击循环切换
 *   - 与 tiptap-markdown 协作：parse.updateDOM 时读 input.data-state；serialize 时输出
 *     `[ ]` / `[/]` / `[x]` 前缀
 *   - 输入规则保留：用户输入 `[ ] ` `[x] ` 或 `[/] ` 加空格会自动转 task item
 */

import { mergeAttributes, Node, wrappingInputRule } from "@tiptap/core";

export type TriState = "todo" | "in_progress" | "done";

const NEXT_STATE: Record<TriState, TriState> = {
  todo: "in_progress",
  in_progress: "done",
  done: "todo",
};

// 行内输入触发：行首 `[ ] ` / `[x] ` / `[/] ` + 空格
const inputRegex = /^\s*\[([ xX/])\]\s$/;

function parseStateAttr(s: unknown): TriState {
  if (s === "in_progress") return "in_progress";
  if (s === "done") return "done";
  return "todo";
}

export const TriTaskItem = Node.create({
  name: "taskItem",
  group: "listItem",

  addOptions() {
    return {
      nested: true,
      HTMLAttributes: {},
    };
  },

  content() {
    return this.options.nested ? "paragraph block*" : "paragraph+";
  },

  defining: true,

  addAttributes() {
    return {
      state: {
        default: "todo" as TriState,
        keepOnSplit: false,
        parseHTML: (el) => {
          const v = (el as HTMLElement).getAttribute("data-state");
          if (v) return parseStateAttr(v);
          // 兼容旧的 data-checked
          const dc = (el as HTMLElement).getAttribute("data-checked");
          if (dc === "true" || dc === "") return "done";
          return "todo";
        },
        renderHTML: (attrs) => ({
          "data-state": attrs.state,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'li[data-type="taskItem"]',
        priority: 51,
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "li",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "taskItem",
        "data-state": node.attrs.state,
      }),
      ["label", ["input", { type: "checkbox", "data-state": node.attrs.state }], ["span"]],
      ["div", 0],
    ];
  },

  addInputRules() {
    return [
      wrappingInputRule({
        find: inputRegex,
        type: this.type,
        getAttributes: (match) => {
          const ch = match[match.length - 1];
          if (ch === "x" || ch === "X") return { state: "done" };
          if (ch === "/") return { state: "in_progress" };
          return { state: "todo" };
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      "Shift-Tab": () => this.editor.commands.liftListItem(this.name),
      Tab: () => this.editor.commands.sinkListItem(this.name),
    };
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const li = document.createElement("li");
      li.setAttribute("data-type", "taskItem");

      const label = document.createElement("label");
      label.contentEditable = "false";
      label.className = "tri-task-checkbox";

      const btn = document.createElement("span");
      btn.className = "tri-task-checkbox__btn";
      btn.setAttribute("role", "checkbox");
      btn.setAttribute("tabindex", "-1");

      label.appendChild(btn);

      const content = document.createElement("div");
      li.appendChild(label);
      li.appendChild(content);

      const sync = (n: typeof node) => {
        const s = (n.attrs.state as TriState) || "todo";
        li.dataset.state = s;
        btn.dataset.state = s;
        btn.setAttribute(
          "aria-checked",
          s === "done" ? "true" : s === "in_progress" ? "mixed" : "false"
        );
        btn.setAttribute(
          "aria-label",
          s === "done"
            ? "已完成（点击改为未开始）"
            : s === "in_progress"
            ? "进行中（点击改为已完成）"
            : "未开始（点击改为进行中）"
        );
      };
      sync(node);

      const onClick = (ev: Event) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof getPos !== "function") return;
        const pos = getPos();
        if (pos == null) return;
        const cur = (editor.state.doc.nodeAt(pos)?.attrs.state ??
          "todo") as TriState;
        const next = NEXT_STATE[cur];
        editor
          .chain()
          .focus(undefined, { scrollIntoView: false })
          .command(({ tr }) => {
            tr.setNodeMarkup(pos, undefined, {
              ...editor.state.doc.nodeAt(pos)?.attrs,
              state: next,
            });
            return true;
          })
          .run();
      };
      label.addEventListener("mousedown", (e) => e.preventDefault());
      label.addEventListener("click", onClick);

      return {
        dom: li,
        contentDOM: content,
        update(updated) {
          if (updated.type.name !== "taskItem") return false;
          sync(updated);
          return true;
        },
        destroy() {
          label.removeEventListener("click", onClick);
        },
      };
    };
  },

  addStorage() {
    return {
      markdown: {
        // tiptap-markdown 序列化：在前缀写 [ ] / [/] / [x]
        serialize(state: any, node: any) {
          const s = (node.attrs.state as TriState) || "todo";
          const ch = s === "done" ? "x" : s === "in_progress" ? "/" : " ";
          state.write(`[${ch}] `);
          state.renderContent(node);
        },
        parse: {
          // tiptap-markdown 把 md 渲染成 HTML 后，会调到这里"修正"成 TipTap 期望的属性
          updateDOM(element: HTMLElement) {
            const items = element.querySelectorAll<HTMLElement>(
              ".task-list-item, li[data-state]"
            );
            items.forEach((item) => {
              const input = item.querySelector<HTMLInputElement>("input");
              let s: TriState = "todo";
              const dataState =
                item.getAttribute("data-state") ||
                input?.getAttribute("data-state");
              if (dataState === "done" || dataState === "in_progress") {
                s = dataState as TriState;
              } else if (input?.checked) {
                s = "done";
              }
              item.setAttribute("data-type", "taskItem");
              item.setAttribute("data-state", s);
              if (input) input.remove();
            });
          },
        },
      },
    };
  },
});

export default TriTaskItem;
