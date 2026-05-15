// src/routes/tasks/views/__monthDragRange.test.ts
// 用法：npx tsx src/routes/tasks/views/__monthDragRange.test.ts
import {
  clampResizeEnd,
  clampResizeStart,
  rangeFromDrag,
  resizeContiguous,
} from "./_monthDragRange";

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

// 同周框选
eq(
  "同周 col2→col5",
  rangeFromDrag("2026-05-13", "2026-05-15", "2026-05-17"),
  { start: "2026-05-13", end: "2026-05-15", truncated: false }
);

// 跨周框选 → 截断到当周末
eq(
  "跨周回退",
  rangeFromDrag("2026-05-13", "2026-05-20", "2026-05-17"),
  { start: "2026-05-13", end: "2026-05-17", truncated: true }
);

// 起 > 止 → 交换
eq(
  "起>止 交换",
  rangeFromDrag("2026-05-15", "2026-05-13", "2026-05-17"),
  { start: "2026-05-13", end: "2026-05-15", truncated: false }
);

// resize end clamp
eq(
  "resizeEnd 拖到 start 之前 → clamp 成 start",
  clampResizeEnd("2026-05-12", "2026-05-10"),
  "2026-05-12"
);
eq(
  "resizeEnd 正常",
  clampResizeEnd("2026-05-12", "2026-05-15"),
  "2026-05-15"
);

// resize start clamp
eq(
  "resizeStart 拖到 end 之后 → clamp 成 end",
  clampResizeStart("2026-05-20", "2026-05-15"),
  "2026-05-15"
);

// resize 后展开
eq(
  "resizeContiguous 4 天",
  resizeContiguous("2026-05-11", "2026-05-14"),
  ["2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14"]
);

if (fail > 0) {
  console.log(`\n${fail} 项失败`);
  process.exit(1);
} else {
  console.log("\n全部通过");
}
