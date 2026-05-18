// 用法：node src-tauri/__window-capabilities.test.mjs
import fs from "node:fs";

const capability = JSON.parse(
  fs.readFileSync(new URL("./capabilities/default.json", import.meta.url), "utf8")
);

const required = [
  "core:window:allow-hide",
  "core:window:allow-show",
  "core:window:allow-unminimize",
  "core:window:allow-set-focus",
  "core:window:allow-start-dragging",
];

const requiredWindows = ["main", "tray-popup", "task-editor"];

let fail = 0;
for (const permission of required) {
  const ok = capability.permissions.includes(permission);
  console.log(`${ok ? "✓" : "✗"} ${permission}`);
  if (!ok) fail++;
}

for (const windowLabel of requiredWindows) {
  const ok = capability.windows.includes(windowLabel);
  console.log(`${ok ? "✓" : "✗"} window:${windowLabel}`);
  if (!ok) fail++;
}

if (fail > 0) {
  console.log(`\n${fail} 项窗口权限缺失`);
  process.exit(1);
}

console.log("\n全部通过");
