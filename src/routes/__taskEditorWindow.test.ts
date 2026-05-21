// 用法：npx tsx src/routes/__taskEditorWindow.test.ts
import fs from "node:fs";
import path from "node:path";

const file = path.resolve("src/routes/TaskEditorWindow.tsx");
const text = fs.readFileSync(file, "utf8");
const formText = fs.readFileSync(
  path.resolve("src/components/task/TaskEditorForm.tsx"),
  "utf8"
);
const combinedText = `${text}\n${formText}`;

let fail = 0;
function ok(label: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) fail++;
}

ok("header draggable", combinedText.includes("data-tauri-drag-region"));
ok("header uses startDragging fallback", text.includes("startDragging"));
ok(
  "close button non-drag",
  combinedText.includes('data-tauri-drag-region="false"')
);
ok(
  "form body scrolls independently",
  text.includes('bodyClassName="min-h-0 flex-1 overflow-y-auto px-4 py-3"')
);
ok(
  "uses editable form header instead of static title",
  text.includes("header={{") && !text.includes("{title}</div>")
);
ok(
  "header drag ignores title editing controls",
  text.includes('closest("button,input,textarea')
);
// 自动保存改造后,window 不再调用 form 的"保存"按钮 selector,
// 而是自己 sendTaskEditorAction;新建模式用 newTaskId 让首次创建后能继续 update。
ok("window no longer simulates clicking save button", !text.includes("btn-primary"));
ok("window passes newTaskId on create", text.includes("newTaskId"));

if (fail > 0) {
  console.log(`\n${fail} 项失败`);
  process.exit(1);
}

console.log("\n全部通过");
