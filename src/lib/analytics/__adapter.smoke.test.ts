// src/lib/analytics/__adapter.smoke.test.ts
// 用法：
//   1) npm run dev
//   2) 浏览器打开任意页面,在 console 跑:
//        import('/src/lib/analytics/__adapter.smoke.test.ts').then(m => m.run())
import { initAdapter, getAdapter } from "@/lib/dataAdapter";
import type { AnalyticsEvent } from "@/lib/analytics/types";

export async function run(): Promise<void> {
  await initAdapter();
  const adapter = getAdapter();

  const now = new Date().toISOString();
  const e1: AnalyticsEvent = {
    id: "smoke-1",
    type: "task.created",
    occurredAt: now,
    entityType: "task",
    entityId: "t-smoke",
    sessionId: "s-smoke",
    source: "manual",
    props: { priority: "p1", smoke: true },
  };
  const e2: AnalyticsEvent = {
    ...e1,
    id: "smoke-2",
    type: "task.completed",
    occurredAt: now,
  };

  await adapter.insertEvents([e1, e2]);

  const queried = await adapter.queryEvents({
    types: ["task.created", "task.completed"],
    entityId: "t-smoke",
  });
  console.log("[smoke] queried:", queried);
  if (queried.length !== 2) throw new Error("expect 2 events");

  const counts = await adapter.countEvents(
    { entityId: "t-smoke" },
    "type"
  );
  console.log("[smoke] counts:", counts);
  if (counts.length !== 2) throw new Error("expect 2 type buckets");

  console.log("✓ analytics adapter smoke test passed");
}
