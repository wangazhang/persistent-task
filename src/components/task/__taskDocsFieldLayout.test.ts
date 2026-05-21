// 用法：npx tsx src/components/task/__taskDocsFieldLayout.test.ts
import fs from "node:fs";
import path from "node:path";

const file = path.resolve("src/components/task/TaskDocsField.tsx");
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

const editRow = indexOf("document edit row", "function DocEditRow");
const urlInput = indexOf("url input", 'value={doc.url}');
const titleInput = indexOf("title input", 'value={doc.title}');
const urlFocusRef = indexOf("url focus ref", "urlRef.current?.focus()");

ok("url input belongs to edit row", editRow < urlInput);
ok("title input belongs to edit row", editRow < titleInput);
ok("url input appears before title input for paste-first flow", urlInput < titleInput);
ok("new/edit row focuses url first", editRow < urlFocusRef && urlFocusRef < urlInput);

if (fail > 0) {
  console.log(`\n${fail} 项失败`);
  process.exit(1);
}

console.log("\n全部通过");
