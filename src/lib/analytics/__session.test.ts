// src/lib/analytics/__session.test.ts
// 用法：npx tsx src/lib/analytics/__session.test.ts
import { createSessionManager } from "./session";

let fail = 0;
function eq<T>(label: string, got: T, expect: T) {
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) { console.log("  got:", got, "\n  expect:", expect); fail++; }
}
function ok(label: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) fail++;
}

// 可控时钟 + 可控 idle 阈值
let now = 1_000_000;
const mgr = createSessionManager({ idleMs: 30 * 60 * 1000, now: () => now });

const id1 = mgr.touch();
ok("first touch returns id", typeof id1 === "string" && id1.length > 0);

now += 1000;
const id2 = mgr.touch();
eq("within idle: same id", id2, id1);

now += 30 * 60 * 1000 + 1; // 超过 30 分钟
const id3 = mgr.touch();
ok("after idle: new id", id3 !== id1);

if (fail > 0) { console.log(`\n✗ ${fail} failed`); process.exit(1); }
console.log("\n✓ all passed");
