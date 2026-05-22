// 用法：npx tsx src/routes/tasks/__taskViewModeLayout.test.ts
import fs from "node:fs";
import path from "node:path";

let fail = 0;
function ok(label: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) fail++;
}

function read(file: string): string {
  return fs.readFileSync(path.resolve(file), "utf8");
}

const urlState = read("src/routes/tasks/useTaskUrlState.ts");
const hub = read("src/routes/tasks/TasksHub.tsx");
const week = read("src/routes/tasks/views/WeekView.tsx");
const month = read("src/routes/tasks/views/MonthView.tsx");
const year = read("src/routes/tasks/views/YearView.tsx");
const taskView = fs.existsSync(path.resolve("src/routes/tasks/views/TaskRangeView.tsx"))
  ? read("src/routes/tasks/views/TaskRangeView.tsx")
  : "";

ok("URL state exposes time/tasks surface mode", urlState.includes("TaskSurfaceMode"));
ok("URL state reads mode query", urlState.includes('.get("mode")'));
ok("URL patch writes mode query", urlState.includes('params.set("mode", next.mode)'));
ok("top-level task tabs do not include gantt", !hub.includes('key: "gantt"'));
ok("TasksHub passes mode into week view", hub.includes('view === "week"') && hub.includes("mode={mode}"));
ok("week/month/year views import task range view", [week, month, year].every((text) => text.includes("TaskRangeView")));
ok("task range view offers list and gantt layouts", taskView.includes('"gantt"') && taskView.includes("TaskViewLayout"));
ok("task range view keeps year gantt read-only", taskView.includes("range.kind !== \"year\""));

if (fail > 0) {
  console.log(`\n${fail} 项失败`);
  process.exit(1);
}

console.log("\n全部通过");
