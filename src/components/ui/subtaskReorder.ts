import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

export type TaskDropSide = "before" | "after";

interface TaskItemRef {
  node: PMNode;
  pos: number;
  end: number;
  parentDepth: number;
  parentPos: number;
}

export function createSameLevelTaskMoveTransaction(
  state: EditorState,
  sourcePos: number,
  targetPos: number,
  side: TaskDropSide
): Transaction | null {
  if (!getSameLevelTaskDropSide(state.doc, sourcePos, targetPos, side)) {
    return null;
  }
  const source = readTaskItemRef(state.doc, sourcePos);
  const target = readTaskItemRef(state.doc, targetPos);
  if (!source || !target) return null;

  const targetInsertPos = side === "before" ? target.pos : target.end;
  const tr = state.tr.delete(source.pos, source.end);
  const mappedInsertPos = tr.mapping.map(targetInsertPos);
  tr.insert(mappedInsertPos, source.node);
  return tr;
}

export function getSameLevelTaskDropSide(
  doc: PMNode,
  sourcePos: number,
  targetPos: number,
  side: TaskDropSide
): TaskDropSide | null {
  // 同一个父 taskList 下才给落点反馈/提交事务;跨层级拖动保持无效。
  const source = readTaskItemRef(doc, sourcePos);
  const target = readTaskItemRef(doc, targetPos);
  if (!source || !target) return null;
  if (source.pos === target.pos) return null;
  if (
    source.parentDepth !== target.parentDepth ||
    source.parentPos !== target.parentPos
  ) {
    return null;
  }

  const targetInsertPos = side === "before" ? target.pos : target.end;
  // 拖到自己原位置的前/后等价于 no-op,不显示插入线。
  if (targetInsertPos === source.pos || targetInsertPos === source.end) {
    return null;
  }
  return side;
}

export function findTaskItemPosFromDocPos(doc: PMNode, pos: number): number | null {
  const safePos = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(safePos);

  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === "taskItem") {
      return $pos.before(depth);
    }
  }

  if ($pos.nodeAfter?.type.name === "taskItem") return safePos;
  if ($pos.nodeBefore?.type.name === "taskItem") {
    return safePos - $pos.nodeBefore.nodeSize;
  }
  return null;
}

function readTaskItemRef(doc: PMNode, pos: number): TaskItemRef | null {
  const node = doc.nodeAt(pos);
  if (!node || node.type.name !== "taskItem") return null;
  const $pos = doc.resolve(pos);
  if ($pos.parent.type.name !== "taskList") return null;
  return {
    node,
    pos,
    end: pos + node.nodeSize,
    parentDepth: $pos.depth,
    parentPos: $pos.before($pos.depth),
  };
}
