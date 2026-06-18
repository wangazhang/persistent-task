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
  "预填标题 URL（含空格/中文需编码）",
  toTaskEditorUrl({ defaultDate: "2026-05-17", defaultTitle: "写 周报" }),
  "index.html?win=task-editor&defaultDate=2026-05-17&defaultTitle=%E5%86%99+%E5%91%A8%E6%8A%A5"
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

eq(
  "解析预填标题（Rust 端 %20 编码还原）",
  parseTaskEditorTarget("?win=task-editor&defaultTitle=%E5%86%99%20%E5%91%A8%E6%8A%A5"),
  { defaultTitle: "写 周报" }
);

if (fail > 0) {
  console.log(`\n${fail} 项失败`);
  process.exit(1);
} else {
  console.log("\n全部通过");
}
