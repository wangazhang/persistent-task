// 用法：npx tsx src/components/task/__taskEditorFormLayout.test.ts
import fs from "node:fs";
import path from "node:path";

const file = path.resolve("src/components/task/TaskEditorForm.tsx");
const text = fs.readFileSync(file, "utf8");

let fail = 0;
function ok(label: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) fail++;
}

function indexOf(label: string, needle: string): number {
  const index = text.indexOf(needle);
  ok(`${label} exists`, index >= 0);
  return index;
}

const statusPriority = indexOf(
  "status and priority shared row",
  'data-task-editor-section="status-priority"'
);
const statusControl = indexOf("status control", "<StatusButtonGroup");
const priorityControl = indexOf(
  "flat priority options",
  'data-task-editor-section="priority-options"'
);
ok(
  "status and priority controls are grouped together",
  statusPriority < statusControl && statusControl < priorityControl
);
ok("priority dropdown removed from editor form", !text.includes("<PriorityPicker"));
ok(
  "priority column has enough horizontal room",
  text.includes("grid-cols-[minmax(0,1fr)_minmax(16rem,max-content)]")
);
ok(
  "priority options stay on one row",
  text.includes('className="flex flex-nowrap gap-1.5"')
);

const header = indexOf("editable editor header", 'data-task-editor-header');
const headerTitle = indexOf("header title edit trigger", "setTitleEditing(true)");
const headerProgress = indexOf(
  "header progress ring",
  "ProgressRing percent={progress.percent}"
);
ok("header owns title editing", header < headerTitle);
ok("header owns progress ring", header < headerProgress);
ok("header removes numeric progress summary", !text.includes("{progress.percent}%"));
ok("header removes empty progress copy", !text.includes("暂无子任务"));

const description = indexOf(
  "description section",
  'data-task-editor-section="description"'
);
const descriptionSummary = indexOf(
  "description-local subtask summary",
  'data-task-editor-section="description-progress"'
);
const descriptionEditor = indexOf("description editor", "<RichDescription");
ok("subtask summary lives in description section", description < descriptionSummary);
ok("subtask summary appears above description editor", descriptionSummary < descriptionEditor);
ok("subtask summary includes done and total", text.includes("{progress.done}/{progress.total} 子任务"));
ok("subtask summary includes in-progress count", text.includes("{progress.inProgress} 进行中"));

// 表单已改为字段级自动保存,底部不再有 actions / 保存 / 取消按钮
ok("actions section removed (auto-save replaces explicit save)", !text.includes('data-task-editor-section="actions"'));
ok("save button removed", !text.includes(">保存<"));
ok("cancel button removed", !text.includes(">取消<"));
ok("auto-save effect present", text.includes("justLoadedRef"));

// docs section 已抽到独立组件 TaskDocsField；此处只验证组件挂载点
const compactSections = ["title", "status-priority", "color", "tags", "schedule"];
const compactSectionIndexes = compactSections.map((section) =>
  indexOf(`${section} section`, `data-task-editor-section="${section}"`)
);
const docsField = indexOf("docs field", "<TaskDocsField");
compactSectionIndexes.push(docsField);
ok(
  "description is the last editable section",
  Math.max(...compactSectionIndexes) < description
);

if (fail > 0) {
  console.log(`\n${fail} 项失败`);
  process.exit(1);
}

console.log("\n全部通过");
