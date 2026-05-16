// src/lib/analytics/__buffer.test.ts
// 用法：npx tsx src/lib/analytics/__buffer.test.ts
import { createBuffer } from "./buffer";
import type { AnalyticsEvent } from "./types";

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

function mkEvent(id: string, type = "ui.route.enter"): AnalyticsEvent {
  return {
    id, type,
    occurredAt: new Date().toISOString(),
    entityType: null, entityId: null,
    sessionId: "s-test", source: "manual", props: {},
  };
}

async function run() {
  // 1) 阈值触发：达 3 条立即 flush
  {
    const written: AnalyticsEvent[][] = [];
    const buf = createBuffer({
      threshold: 3,
      intervalMs: 60_000,
      writer: async (batch) => { written.push(batch); },
    });
    buf.push(mkEvent("a"));
    buf.push(mkEvent("b"));
    eq("not flushed yet", written.length, 0);
    buf.push(mkEvent("c"));
    // 微任务排空
    await new Promise(r => setTimeout(r, 10));
    eq("threshold flushed", written.length, 1);
    eq("batch size", written[0]!.length, 3);
  }

  // 2) 关键事件立即 flush
  {
    const written: AnalyticsEvent[][] = [];
    const buf = createBuffer({
      threshold: 50,
      intervalMs: 60_000,
      writer: async (b) => { written.push(b); },
      criticalTypes: new Set(["app.launched"]),
    });
    buf.push(mkEvent("k", "app.launched"));
    await new Promise(r => setTimeout(r, 10));
    eq("critical flushed", written.length, 1);
  }

  // 3) flushNow 强制
  {
    const written: AnalyticsEvent[][] = [];
    const buf = createBuffer({
      threshold: 50, intervalMs: 60_000,
      writer: async (b) => { written.push(b); },
    });
    buf.push(mkEvent("x"));
    await buf.flushNow();
    eq("flushNow worked", written.length, 1);
  }

  // 4) writer 失败 3 次后丢弃,buffer 不无限增长
  {
    const calls: number[] = [];
    let attempt = 0;
    const buf = createBuffer({
      threshold: 1, intervalMs: 60_000,
      writer: async () => { attempt++; calls.push(attempt); throw new Error("boom"); },
      maxRetries: 3,
    });
    buf.push(mkEvent("e"));
    await new Promise(r => setTimeout(r, 50));
    // 触发了重试,但最终丢弃
    ok("attempted exactly maxRetries times", calls.length === 3);
    ok("buffer drained after maxRetries", buf.size() === 0);
  }

  if (fail > 0) { console.log(`\n✗ ${fail} failed`); process.exit(1); }
  console.log("\n✓ all passed");
}
run();
