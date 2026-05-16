/**
 * markdown-it 插件：识别 GFM 风格的三态任务列表项。
 *
 *   - "- [ ] xxx"  → 未开始（todo）
 *   - "- [/] xxx"  → 进行中（in_progress，本项目自定义扩展）
 *   - "- [x] xxx"  → 已完成（done）
 *
 * 行为参考自上游 markdown-it-task-lists，但扩展了 "[/]" 这一种状态。
 * 渲染后的 input 元素带：
 *   - class="task-list-item-checkbox"
 *   - data-state="todo|in_progress|done"
 *   - checked=""（仅 done 时）
 *
 * 输出的 <li> 会被 setAttr class="task-list-item"，外层 <ul> 会被打上
 * class="contains-task-list"，与上游兼容，TipTap 的 task-list extension
 * 仍能正常识别 list 类型。
 */

import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token";

type State = "todo" | "in_progress" | "done";

const PREFIX_RE = /^\[([ xX/])\] /;

function matchState(content: string): State | null {
  const m = content.match(PREFIX_RE);
  if (!m) return null;
  const ch = m[1];
  if (ch === " ") return "todo";
  if (ch === "/") return "in_progress";
  return "done";
}

function attrSet(token: Token, name: string, value: string) {
  const i = token.attrIndex(name);
  if (i < 0) token.attrPush([name, value]);
  else token.attrs![i] = [name, value];
}

function isInline(t: Token) {
  return t && t.type === "inline";
}
function isParagraph(t: Token) {
  return t && t.type === "paragraph_open";
}
function isListItem(t: Token) {
  return t && t.type === "list_item_open";
}

function parentToken(tokens: Token[], index: number): number {
  const targetLevel = tokens[index].level - 1;
  for (let i = index - 1; i >= 0; i--) {
    if (tokens[i].level === targetLevel) return i;
  }
  return -1;
}

function makeCheckbox(state: State): Token {
  const checked = state === "done" ? ' checked=""' : "";
  const html =
    `<input class="task-list-item-checkbox" data-state="${state}"` +
    ` disabled type="checkbox"${checked}>`;
  // 用 any 而不是 import Token class 的原因是只是临时构造一个 inline html token
  const t = { type: "html_inline", content: html, level: 0 } as Token;
  return t;
}

export default function markdownItTaskListsTri(md: MarkdownIt) {
  md.core.ruler.after("inline", "tri-task-lists", (state) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i];
      if (!isInline(inline) || !isParagraph(tokens[i - 1]) || !isListItem(tokens[i - 2])) {
        continue;
      }
      const s = matchState(inline.content);
      if (!s) continue;

      // 1) 注入 checkbox token；2) 剥掉前缀文字（"[x] " 共 4 字符）
      const TokenCtor = state.Token as unknown as new (
        type: string,
        tag: string,
        nesting: number
      ) => Token;
      const cb = makeCheckbox(s);
      // 用现有 token 构造器以保留 line / map 信息更稳，但这里 makeCheckbox
      // 已造出 html_inline，足够走 renderer。直接 unshift 即可。
      void TokenCtor;
      if (inline.children) {
        inline.children.unshift(cb);
        const firstText = inline.children[1];
        if (firstText && typeof firstText.content === "string") {
          firstText.content = firstText.content.slice(4);
        }
      }
      inline.content = inline.content.slice(4);

      attrSet(tokens[i - 2], "class", "task-list-item");
      attrSet(tokens[i - 2], "data-state", s);
      const parent = parentToken(tokens, i - 2);
      if (parent >= 0) {
        attrSet(tokens[parent], "class", "contains-task-list");
      }
    }
    return true;
  });
}
