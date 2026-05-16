// src/lib/analytics/__middleware.test.ts
// 用法：npx tsx src/lib/analytics/__middleware.test.ts
import { create } from "zustand";
import { withTracking, type ActionMapping } from "./middleware";

let fail = 0;
function eq<T>(label: string, got: T, expect: T) {
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) { console.log("  got:", got, "\n  expect:", expect); fail++; }
}

interface S {
  count: number;
  inc: (by: number) => void;
  reset: () => void;
}

const tracked: Array<[string, object]> = [];

const mapping: ActionMapping<S> = {
  inc: (ret, args, { prev, next }) => [
    ["task.updated", { fields: ["count"], delta: next.count - prev.count, args }],
  ],
  // reset 不映射 → 不应产事件
};

const useStore = create<S>()(
  withTracking(mapping, {
    sink: (type, props) => tracked.push([type, props]),
  })((set) => ({
    count: 0,
    inc(by) { set((s) => ({ count: s.count + by })); },
    reset() { set({ count: 0 }); },
  }))
);

// 触发
useStore.getState().inc(3);
useStore.getState().inc(2);
useStore.getState().reset();

eq("tracked count", tracked.length, 2);
eq("tracked[0] type", tracked[0]![0], "task.updated");
eq("tracked[0] delta", (tracked[0]![1] as any).delta, 3);
eq("tracked[1] delta", (tracked[1]![1] as any).delta, 2);

if (fail > 0) { console.log(`\n✗ ${fail} failed`); process.exit(1); }
console.log("\n✓ all passed");
