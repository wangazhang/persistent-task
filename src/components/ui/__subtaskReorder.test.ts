// 用法：npx tsx src/components/ui/__subtaskReorder.test.ts
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  createSameLevelTaskMoveTransaction,
  findTaskItemPosFromDocPos,
  getSameLevelTaskDropSide,
} from "./subtaskReorder";

let fail = 0;

function eq<T>(label: string, got: T, expect: T) {
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) {
    console.log("  got:   ", got);
    console.log("  expect:", expect);
    fail++;
  }
}

function ok(label: string, value: boolean) {
  console.log(`${value ? "✓" : "✗"} ${label}`);
  if (!value) fail++;
}

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: {
      content: "inline*",
      group: "block",
      toDOM: () => ["p", 0],
    },
    taskList: {
      content: "taskItem+",
      group: "block list",
      toDOM: () => ["ul", { "data-type": "taskList" }, 0],
    },
    taskItem: {
      content: "paragraph block*",
      group: "listItem",
      defining: true,
      toDOM: () => ["li", { "data-type": "taskItem" }, 0],
    },
  },
  marks: {},
});

function paragraph(text: string): PMNode {
  return schema.nodes.paragraph.create(null, schema.text(text));
}

function item(text: string, children: PMNode[] = []): PMNode {
  return schema.nodes.taskItem.create(null, [paragraph(text), ...children]);
}

function list(children: PMNode[]): PMNode {
  return schema.nodes.taskList.create(null, children);
}

function taskPositions(doc: PMNode): Record<string, number> {
  const positions: Record<string, number> = {};
  doc.descendants((node, pos) => {
    if (node.type.name !== "taskItem") return;
    positions[node.child(0).textContent] = pos;
  });
  return positions;
}

function topLevelOrder(doc: PMNode): string[] {
  const taskList = doc.child(0);
  const out: string[] = [];
  taskList.forEach((node) => out.push(node.child(0).textContent));
  return out;
}

const flatDoc = schema.nodes.doc.create(null, [
  list([item("A"), item("B"), item("C")]),
]);
const flatState = EditorState.create({ doc: flatDoc });
const flatPos = taskPositions(flatDoc);

eq(
  "resolves a paragraph text position to its task item",
  findTaskItemPosFromDocPos(flatDoc, flatPos.B + 2),
  flatPos.B
);

const moveDown = createSameLevelTaskMoveTransaction(
  flatState,
  flatPos.A,
  flatPos.C,
  "after"
);
ok("creates transaction for same-level move", !!moveDown);
if (moveDown) {
  eq(
    "moves first task item after third sibling",
    topLevelOrder(moveDown.doc),
    ["B", "C", "A"]
  );
}

eq(
  "keeps valid drop side for same-level visual indicator",
  getSameLevelTaskDropSide(flatState.doc, flatPos.A, flatPos.C, "after"),
  "after"
);

eq(
  "hides visual indicator for no-op adjacent drop",
  getSameLevelTaskDropSide(flatState.doc, flatPos.A, flatPos.B, "before"),
  null
);

const moveUp = createSameLevelTaskMoveTransaction(
  flatState,
  flatPos.C,
  flatPos.A,
  "before"
);
ok("creates transaction for upward same-level move", !!moveUp);
if (moveUp) {
  eq(
    "moves third task item before first sibling",
    topLevelOrder(moveUp.doc),
    ["C", "A", "B"]
  );
}

const nestedDoc = schema.nodes.doc.create(null, [
  list([item("A", [list([item("A.1"), item("A.2")])]), item("B")]),
]);
const nestedState = EditorState.create({ doc: nestedDoc });
const nestedPos = taskPositions(nestedDoc);
const crossLevel = createSameLevelTaskMoveTransaction(
  nestedState,
  nestedPos.B,
  nestedPos["A.1"],
  "before"
);
eq("rejects cross-level drop target", crossLevel, null);

eq(
  "hides visual indicator for cross-level drop target",
  getSameLevelTaskDropSide(nestedDoc, nestedPos.B, nestedPos["A.1"], "before"),
  null
);

if (fail > 0) {
  console.log(`\n${fail} 项失败`);
  process.exit(1);
}

console.log("\n全部通过");
