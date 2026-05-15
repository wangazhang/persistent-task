// src/lib/__pastReview.test.ts
// 用法：npx tsx src/lib/__pastReview.test.ts
import {
  isPastUnfinished,
  fillContinueDates,
  readLastPromptDate,
  writeLastPromptDate,
} from "./pastReview";
import type { Task } from "./types";

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

function makeTask(partial: Partial<Task>): Task {
  return {
    id: partial.id ?? "t1",
    title: partial.title ?? "x",
    description: "",
    status: partial.status ?? "todo",
    scheduledDates: partial.scheduledDates ?? [],
    tagIds: [],
    order: 0,
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    ...partial,
  };
}

const TODAY = "2026-05-16";

// isPastUnfinished —— 命中
eq(
  "命中：todo 单日过去",
  isPastUnfinished(
    makeTask({ status: "todo", scheduledDates: ["2026-05-15"] }),
    TODAY
  ),
  true
);
eq(
  "命中：in_progress 单日过去",
  isPastUnfinished(
    makeTask({ status: "in_progress", scheduledDates: ["2026-05-13"] }),
    TODAY
  ),
  true
);

// isPastUnfinished —— 不命中
eq(
  "不命中：scheduledDates 长度 != 1",
  isPastUnfinished(
    makeTask({ status: "todo", scheduledDates: ["2026-05-15", "2026-05-16"] }),
    TODAY
  ),
  false
);
eq(
  "不命中：日期是今天",
  isPastUnfinished(
    makeTask({ status: "todo", scheduledDates: [TODAY] }),
    TODAY
  ),
  false
);
eq(
  "不命中：日期是未来",
  isPastUnfinished(
    makeTask({ status: "todo", scheduledDates: ["2026-05-20"] }),
    TODAY
  ),
  false
);
eq(
  "不命中：done 状态",
  isPastUnfinished(
    makeTask({ status: "done", scheduledDates: ["2026-05-15"] }),
    TODAY
  ),
  false
);
eq(
  "不命中：suspended 状态",
  isPastUnfinished(
    makeTask({ status: "suspended", scheduledDates: ["2026-05-15"] }),
    TODAY
  ),
  false
);
eq(
  "不命中：archived 状态",
  isPastUnfinished(
    makeTask({ status: "archived", scheduledDates: ["2026-05-15"] }),
    TODAY
  ),
  false
);
eq(
  "不命中：scheduledDates 为空",
  isPastUnfinished(
    makeTask({ status: "todo", scheduledDates: [] }),
    TODAY
  ),
  false
);

// fillContinueDates —— 跨天填充
eq(
  "fill 跨 3 天",
  fillContinueDates(["2026-05-13"], "2026-05-16"),
  ["2026-05-13", "2026-05-14", "2026-05-15", "2026-05-16"]
);
eq(
  "fill 跨 1 天",
  fillContinueDates(["2026-05-15"], "2026-05-16"),
  ["2026-05-15", "2026-05-16"]
);
eq(
  "fill 跨月",
  fillContinueDates(["2026-04-29"], "2026-05-02"),
  ["2026-04-29", "2026-04-30", "2026-05-01", "2026-05-02"]
);
eq(
  "fill 起点 = today（实际不会触发，但保证幂等）",
  fillContinueDates(["2026-05-16"], "2026-05-16"),
  ["2026-05-16"]
);

// localStorage 读写
{
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => mem.set(k, v),
    removeItem: (k: string) => mem.delete(k),
    clear: () => mem.clear(),
  };
  eq("初始读为 null", readLastPromptDate(), null);
  writeLastPromptDate("2026-05-16");
  eq("写入后读到", readLastPromptDate(), "2026-05-16");
}

if (fail > 0) {
  console.log(`\n${fail} 个用例失败`);
  process.exit(1);
} else {
  console.log("\n全部通过");
}
