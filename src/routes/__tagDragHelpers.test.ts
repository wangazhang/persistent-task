// 用法：npx tsx src/routes/__tagDragHelpers.test.ts
import type { Tag } from "../lib/types";
import {
  adjustGapIndex,
  createActiveTagDrag,
  isInvalidGapTarget,
  isInvalidIntoTarget,
} from "./tagDragHelpers";

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

function makeTag(
  id: string,
  parentId: string | null,
  order: number,
  name = id
): Tag {
  return {
    id,
    name,
    parentId,
    order,
    color: "#6366f1",
  };
}

const tags: Tag[] = [
  makeTag("root-a", null, 0),
  makeTag("root-b", null, 1),
  makeTag("root-c", null, 2),
  makeTag("child-a", "root-a", 0),
  makeTag("child-b", "root-a", 1),
  makeTag("grandchild-a", "child-a", 0),
];

const active = createActiveTagDrag(tags[0], [
  "child-a",
  "child-b",
  "grandchild-a",
]);

eq(
  "createActiveTagDrag caches blocked ids",
  [...active.descendantIds].sort(),
  ["child-a", "child-b", "grandchild-a"]
);

eq("null active allows into target", isInvalidIntoTarget(null, "root-b"), false);
eq("self is invalid into target", isInvalidIntoTarget(active, "root-a"), true);
eq("descendant is invalid into target", isInvalidIntoTarget(active, "child-a"), true);
eq("unrelated tag is valid into target", isInvalidIntoTarget(active, "root-b"), false);

eq("root gap is valid", isInvalidGapTarget(active, null), false);
eq("descendant parent gap is invalid", isInvalidGapTarget(active, "child-a"), true);
eq("unrelated parent gap is valid", isInvalidGapTarget(active, "root-b"), false);

eq(
  "same parent downward index adjusts after removing active item",
  adjustGapIndex(tags, "root-a", null, 3),
  { movedId: "root-a", parentId: null, newIndex: 2 }
);

eq(
  "same parent upward index stays unchanged",
  adjustGapIndex(tags, "root-c", null, 1),
  { movedId: "root-c", parentId: null, newIndex: 1 }
);

eq(
  "cross parent index stays unchanged",
  adjustGapIndex(tags, "child-a", null, 1),
  { movedId: "child-a", parentId: null, newIndex: 1 }
);

eq("missing moved tag returns null", adjustGapIndex(tags, "missing", null, 1), null);

if (fail > 0) {
  console.log(`\n${fail} 项失败`);
  process.exit(1);
}

console.log("\n全部通过");
