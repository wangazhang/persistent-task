// 用法：npx tsx src/routes/tasks/__tagFilterLayout.test.ts
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

const filters = read("src/routes/tasks/TaskFilters.tsx");
const picker = read("src/components/ui/TagHierarchyPicker.tsx");
const urlState = read("src/routes/tasks/useTaskUrlState.ts");

ok("task filters still wire multi tag picker", filters.includes('mode="multi"'));
ok("task filters still expose clear tags action", filters.includes("清除标签筛选"));
ok("picker shows selected tags summary in multi mode", picker.includes("已选："));
ok("picker renders selected tags as TagChip", picker.includes("TagChip"));
ok("picker can remove selected tags from summary", picker.includes("onRemove={() => toggleSelect(id)}"));
ok("task url state still persists tags query", urlState.includes('params.set("tags", next.tags.join(","))'));

if (fail > 0) {
  console.log(`\n${fail} 项失败`);
  process.exit(1);
}

console.log("\n全部通过");
