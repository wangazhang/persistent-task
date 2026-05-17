// 用法：npx tsx src/lib/__taskEditorBridge.test.ts
import {
  parseTaskEditorTarget,
  toTaskEditorUrl,
} from "./taskEditorBridge";

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

eq(
  "编辑任务 URL",
  toTaskEditorUrl({ taskId: "task-1" }),
  "index.html?win=task-editor&taskId=task-1"
);

eq(
  "新建任务 URL",
  toTaskEditorUrl({ defaultDate: "2026-05-17" }),
  "index.html?win=task-editor&defaultDate=2026-05-17"
);

eq(
  "解析编辑目标",
  parseTaskEditorTarget("?win=task-editor&taskId=task-1"),
  { taskId: "task-1" }
);

eq(
  "解析新建目标",
  parseTaskEditorTarget("?win=task-editor&defaultDate=2026-05-17"),
  { defaultDate: "2026-05-17" }
);

if (fail > 0) {
  console.log(`\n${fail} 项失败`);
  process.exit(1);
} else {
  console.log("\n全部通过");
}
