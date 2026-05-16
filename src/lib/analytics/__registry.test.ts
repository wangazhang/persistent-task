// src/lib/analytics/__registry.test.ts
// 用法：npx tsx src/lib/analytics/__registry.test.ts
import { entityFromProps, isKnownType, KNOWN_TYPES } from "./registry";

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

eq("isKnownType true",  isKnownType("task.created"), true);
eq("isKnownType false", isKnownType("nope.event"),   false);
eq("KNOWN_TYPES non-empty", KNOWN_TYPES.length > 20, true);

eq(
  "entityFromProps taskId",
  entityFromProps({ taskId: "t-1", foo: 2 }),
  { entityType: "task", entityId: "t-1" }
);
eq(
  "entityFromProps tagId",
  entityFromProps({ tagId: "g-1" }),
  { entityType: "tag", entityId: "g-1" }
);
eq(
  "entityFromProps route",
  entityFromProps({ route: "year" }),
  { entityType: "route", entityId: "year" }
);
eq(
  "entityFromProps fallback",
  entityFromProps({ misc: 1 }),
  { entityType: null, entityId: null }
);

if (fail > 0) {
  console.log(`\n✗ ${fail} test(s) failed`);
  process.exit(1);
}
console.log("\n✓ all passed");
