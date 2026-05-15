// src/lib/__dateRange.test.ts
// 用法：npx tsx src/lib/__dateRange.test.ts
import {
  expandRange,
  isContiguous,
  getRange,
  presetToday,
  presetTomorrow,
  presetThisWeek,
  presetNextWeek,
} from "./dateRange";

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

// expandRange 基础
eq(
  "expandRange 4 天",
  expandRange("2026-05-11", "2026-05-14"),
  ["2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14"]
);

// expandRange 自动交换
eq(
  "expandRange 起 > 止 自动交换",
  expandRange("2026-05-14", "2026-05-11"),
  ["2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14"]
);

// expandRange 同一天
eq(
  "expandRange 同一天",
  expandRange("2026-05-11", "2026-05-11"),
  ["2026-05-11"]
);

// isContiguous
eq(
  "isContiguous 连续 true",
  isContiguous(["2026-05-11", "2026-05-12", "2026-05-13"]),
  true
);
eq(
  "isContiguous 不连续 false",
  isContiguous(["2026-05-11", "2026-05-13"]),
  false
);
eq("isContiguous 空 true", isContiguous([]), true);
eq("isContiguous 单元素 true", isContiguous(["2026-05-11"]), true);
eq(
  "isContiguous 乱序但连续",
  isContiguous(["2026-05-13", "2026-05-11", "2026-05-12"]),
  true
);

// getRange
eq("getRange 空 null", getRange([]), null);
eq(
  "getRange min/max",
  getRange(["2026-05-13", "2026-05-11", "2026-05-15"]),
  { start: "2026-05-11", end: "2026-05-15" }
);

// preset 长度
eq("presetToday 1 天", presetToday().length, 1);
eq("presetTomorrow 1 天", presetTomorrow().length, 1);
eq("presetThisWeek 7 天", presetThisWeek().length, 7);
eq("presetNextWeek 7 天", presetNextWeek().length, 7);

// preset 连续性
eq(
  "presetThisWeek 连续",
  isContiguous(presetThisWeek()),
  true
);
eq(
  "presetNextWeek 紧接 thisWeek",
  presetNextWeek()[0] >
    presetThisWeek()[presetThisWeek().length - 1],
  true
);

if (fail > 0) {
  console.log(`\n${fail} 项失败`);
  process.exit(1);
} else {
  console.log("\n全部通过");
}
