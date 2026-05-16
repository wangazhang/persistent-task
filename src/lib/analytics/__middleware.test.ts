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
// 通过闭包捕获 prev/next/args 用来验证 diff context 工作
const observed: Array<{ delta: number; argsLen: number }> = [];

const mapping: ActionMapping<S> = {
  inc: (_ret, args, { prev, next }) => {
    observed.push({ delta: next.count - prev.count, argsLen: args.length });
    return [
      ["task.updated", { taskId: "test", fields: ["count"] }],
    ];
  },
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
eq("tracked[0] props", tracked[0]![1], { taskId: "test", fields: ["count"] });
eq("observed delta seq", observed.map((o) => o.delta), [3, 2]);
eq("observed argsLen seq", observed.map((o) => o.argsLen), [1, 1]);

if (fail > 0) { console.log(`\n✗ ${fail} failed`); process.exit(1); }
console.log("\n✓ all passed");
