// 用法：npx tsx src/routes/__trayPomodoroPanel.test.ts
import fs from "node:fs";
import path from "node:path";

const trayPopup = fs.readFileSync(
  path.resolve("src/routes/TrayPopup.tsx"),
  "utf8"
);
const trayBridge = fs.readFileSync(path.resolve("src/lib/trayBridge.ts"), "utf8");
const mainBridge = fs.readFileSync(
  path.resolve("src/components/TrayMainBridge.tsx"),
  "utf8"
);

let fail = 0;
function ok(label: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) fail++;
}

ok("pomodoro panel has type presets", trayPopup.includes("POMO_TYPE_OPTIONS"));
ok("pomodoro panel shows linked task section", trayPopup.includes("当前任务"));
ok("pomodoro panel has empty task hint", trayPopup.includes("选择一个任务后再开始专注"));
ok("tray protocol supports set_pomodoro_type", trayBridge.includes("set_pomodoro_type"));
ok("main bridge handles set_pomodoro_type", mainBridge.includes('case "set_pomodoro_type"'));

if (fail > 0) {
  console.log(`\n${fail} 项失败`);
  process.exit(1);
}

console.log("\n全部通过");
