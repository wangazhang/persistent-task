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
import type { EditorView } from "@tiptap/pm/view";
import {
  createSameLevelTaskMoveTransaction,
  findTaskItemPosFromDocPos,
  getSameLevelTaskDropSide,
  type TaskDropSide,
} from "./subtaskReorder";

export type TriState = "todo" | "in_progress" | "done";

const NEXT_STATE: Record<TriState, TriState> = {
  todo: "in_progress",
  in_progress: "done",
  done: "todo",
};

// 行内输入触发：行首 `[ ] ` / `[] ` / `[x] ` / `[/] ` + 空格
// 括号内字符可省略：`[]` 与 `[ ]` 都视为未开始；`[x]/[X]` = 完成；`[/]` = 进行中。
const inputRegex = /^\s*\[([ xX/]?)\]\s$/;

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
          const ch = match[match.length - 1] ?? "";
          if (ch === "x" || ch === "X") return { state: "done" };
          if (ch === "/") return { state: "in_progress" };
          // 空字符串（`[]`）或单空格（`[ ]`）→ todo
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

      // 桌面 Tauri 的 WebView 对 contenteditable 内 HTML5 drag/drop 支持不稳定,
      // 这里用 pointer 事件自己计算目标兄弟节点,只提交同层级重排事务。
      const handle = document.createElement("span");
      handle.className = "tri-task-drag-handle";
      handle.setAttribute("data-drag-handle", "");
      handle.setAttribute("contenteditable", "false");
      handle.setAttribute("draggable", "false");
      handle.setAttribute("aria-label", "拖拽以调整顺序");
      handle.setAttribute("title", "拖拽以调整顺序");
      // lucide GripVertical:与项目其它图标统一
      handle.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>';

      const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || typeof getPos !== "function") return;
        event.preventDefault();
        event.stopPropagation();
        const sourcePos = getPos();
        if (sourcePos == null) return;
        const { view } = editor;
        // 拖动中的反馈放到 body 浮层里,不直接给 taskItem 的 li 加 class。
        // ProseMirror 会在指针事件中替换 NodeView DOM;外部浮层能避开这类刷新。
        const feedback = createTaskDragFeedback(
          view.dom.ownerDocument,
          li.textContent?.trim() || "子任务"
        );
        const updateDropPreview = (clientX: number, clientY: number) => {
          feedback.move(clientX, clientY);
          const target = findDropTargetTask(view, clientX, clientY);
          const side = target
            ? getSameLevelTaskDropSide(
                view.state.doc,
                sourcePos,
                target.pos,
                target.side
              )
            : null;
          if (!target || !side) {
            feedback.hideLine();
            return;
          }
          feedback.showLine(target.element, side);
        };

        const onPointerMove = (moveEvent: PointerEvent) => {
          moveEvent.preventDefault();
          updateDropPreview(moveEvent.clientX, moveEvent.clientY);
        };
        const finish = (upEvent: PointerEvent) => {
          upEvent.preventDefault();
          const target = findDropTargetTask(view, upEvent.clientX, upEvent.clientY);
          const side = target
            ? getSameLevelTaskDropSide(
                view.state.doc,
                sourcePos,
                target.pos,
                target.side
              )
            : null;
          cleanup();
          if (!target || !side) return;
          const tr = createSameLevelTaskMoveTransaction(
            view.state,
            sourcePos,
            target.pos,
            side
          );
          if (tr) view.dispatch(tr.scrollIntoView());
        };
        const cancel = () => cleanup();
        const cleanup = () => {
          feedback.destroy();
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", cancel);
        };

        // 先立即同步一次,让用户按下把手时立刻看到"已抓住"的反馈。
        updateDropPreview(event.clientX, event.clientY);
        window.addEventListener("pointermove", onPointerMove, { passive: false });
        window.addEventListener("pointerup", finish, { once: true });
        window.addEventListener("pointercancel", cancel, { once: true });
      };
      handle.addEventListener("pointerdown", onPointerDown);

      const onHandleDragStart = (event: DragEvent) => {
        // 只用 pointer 事件实现桌面端拖拽;禁用原生 HTML5 drag 避免 WebView 差异。
        event.preventDefault();
      };
      handle.addEventListener("dragstart", onHandleDragStart);

      const label = document.createElement("label");
      label.contentEditable = "false";
      label.className = "tri-task-checkbox";

      const btn = document.createElement("span");
      btn.className = "tri-task-checkbox__btn";
      btn.setAttribute("role", "checkbox");
      btn.setAttribute("tabindex", "-1");

      label.appendChild(btn);

      const content = document.createElement("div");
      li.appendChild(handle);
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
          handle.removeEventListener("pointerdown", onPointerDown);
          handle.removeEventListener("dragstart", onHandleDragStart);
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

function findDropTargetTask(
  view: EditorView,
  clientX: number,
  clientY: number
): { pos: number; side: TaskDropSide; element: HTMLElement } | null {
  const element = view.dom.ownerDocument.elementFromPoint(clientX, clientY);
  const target = element instanceof Element
    ? element.closest('li[data-type="taskItem"]')
    : null;
  if (!(target instanceof HTMLElement) || !view.dom.contains(target)) return null;

  let taskPos: number | null = null;
  try {
    const domPos = view.posAtDOM(target, 0);
    taskPos = findTaskItemPosFromDocPos(view.state.doc, domPos);
  } catch {
    const coords = view.posAtCoords({ left: clientX, top: clientY });
    taskPos = coords
      ? findTaskItemPosFromDocPos(view.state.doc, coords.pos)
      : null;
  }
  if (taskPos == null) {
    const coords = view.posAtCoords({ left: clientX, top: clientY });
    taskPos = coords ? findTaskItemPosFromDocPos(view.state.doc, coords.pos) : null;
  }
  if (taskPos == null) return null;

  return { pos: taskPos, side: getDropSide(target, clientY), element: target };
}

function getDropSide(target: Element, clientY: number): TaskDropSide {
  const rect = target.getBoundingClientRect();
  return clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function createTaskDragFeedback(doc: Document, label: string) {
  const ghost = doc.createElement("div");
  ghost.className = "tri-task-drag-ghost";
  ghost.textContent = label;

  const line = doc.createElement("div");
  line.className = "tri-task-drop-line";
  line.hidden = true;

  doc.body.appendChild(ghost);
  doc.body.appendChild(line);

  return {
    move(clientX: number, clientY: number) {
      ghost.style.transform = `translate3d(${clientX + 12}px, ${clientY + 10}px, 0)`;
    },
    showLine(target: HTMLElement, side: TaskDropSide) {
      const rect = target.getBoundingClientRect();
      line.hidden = false;
      line.style.left = `${rect.left + 22}px`;
      line.style.top = `${(side === "before" ? rect.top : rect.bottom) - 1}px`;
      line.style.width = `${Math.max(24, rect.width - 24)}px`;
    },
    hideLine() {
      line.hidden = true;
    },
    destroy() {
      ghost.remove();
      line.remove();
    },
  };
}

export default TriTaskItem;
