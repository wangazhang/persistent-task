// 临时测试脚本：通过 npx tsx 运行验证。
// 不引入 vitest 是因为项目目前没有测试基建。
// 用法：npx tsx src/routes/tasks/views/__monthBars.test.ts

import { addDays, eachDayOfInterval, startOfWeek } from "date-fns";
import type { Task } from "../../../lib/types";
import { buildWeekBars } from "./_monthBars";

function makeDays(start: Date): Date[] {
  return eachDayOfInterval({ start, end: addDays(start, 41) });
}

function makeTask(partial: Partial<Task> & { id: string; scheduledDates: string[] }): Task {
  return {
    id: partial.id,
    title: partial.title ?? `任务 ${partial.id}`,
    description: "",
    status: partial.status ?? "todo",
    priority: partial.priority ?? "p2",
    scheduledDates: partial.scheduledDates,
    tagIds: partial.tagIds ?? [],
    order: partial.order ?? 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  } else {
    console.log("PASS:", msg);
  }
}

// 起点 2026-05-04（周一）
const monthStart = startOfWeek(new Date("2026-05-04"), { weekStartsOn: 1 });
const days = makeDays(monthStart);

console.log("== 测试 1：单日任务不画色带 ==");
{
  const t = makeTask({ id: "a", scheduledDates: ["2026-05-05"] });
  const result = buildWeekBars(days, [t], null);
  const total = result.reduce((s, w) => s + w.segments.length, 0);
  assert(total === 0, "单日任务应不产生 segment");
}

console.log("== 测试 2：连续 4 天单周内任务产生 1 段 ==");
{
  const t = makeTask({
    id: "b",
    title: "OKR 草稿",
    status: "in_progress",
    scheduledDates: ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07"],
  });
  const result = buildWeekBars(days, [t], null);
  assert(result[0].segments.length === 1, "周一-周四应为单段");
  assert(result[0].segments[0].startCol === 0, "起始列应为 0（周一）");
  assert(result[0].segments[0].endCol === 3, "结束列应为 3（周四）");
  assert(result[0].segments[0].isRunStart === true, "首段 isRunStart=true");
  assert(result[0].segments[0].isRunEnd === true, "末段 isRunEnd=true");
}

console.log("== 测试 3：跨周任务切两段，续接段不算 RunStart ==");
{
  const t = makeTask({
    id: "c",
    scheduledDates: [
      "2026-05-09", "2026-05-10", "2026-05-11", "2026-05-12",
    ],
  });
  const result = buildWeekBars(days, [t], null);
  const allSegs = result.flatMap((w) => w.segments);
  assert(allSegs.length === 2, "应切成 2 段");
  assert(allSegs[0].weekRow === 0 && allSegs[0].startCol === 5 && allSegs[0].endCol === 6, "第一段 5/9-5/10 在 row 0 col 5-6");
  assert(allSegs[0].isRunStart === true && allSegs[0].isRunEnd === false, "第一段 RunStart=true RunEnd=false");
  assert(allSegs[1].weekRow === 1 && allSegs[1].startCol === 0 && allSegs[1].endCol === 1, "第二段 5/11-5/12 在 row 1 col 0-1");
  assert(allSegs[1].isRunStart === false && allSegs[1].isRunEnd === true, "续接段 RunStart=false RunEnd=true");
}

console.log("== 测试 4：不连续日期产生多个 run ==");
{
  const t = makeTask({
    id: "d",
    scheduledDates: ["2026-05-04", "2026-05-05", "2026-05-08"],
  });
  const result = buildWeekBars(days, [t], null);
  assert(result[0].segments.length === 1, "5/4-5/5 是一段（5/8 单日不画）");
  assert(result[0].segments[0].startCol === 0 && result[0].segments[0].endCol === 1, "5/4-5/5 col 0-1");
}

console.log("== 测试 5：标签过滤 ==");
{
  const t = makeTask({
    id: "e",
    tagIds: ["tag-x"],
    scheduledDates: ["2026-05-04", "2026-05-05"],
  });
  const r1 = buildWeekBars(days, [t], new Set(["tag-y"]));
  assert(r1[0].segments.length === 0, "tag 不匹配应被过滤");
  const r2 = buildWeekBars(days, [t], new Set(["tag-x"]));
  assert(r2[0].segments.length === 1, "tag 匹配应保留");
}

console.log("== 测试 6：超过 2 个跨天任务时溢出 ==");
{
  const tasks = [1, 2, 3].map((i) =>
    makeTask({
      id: `t${i}`,
      priority: "p2",
      order: i,
      scheduledDates: ["2026-05-04", "2026-05-05"],
    })
  );
  const result = buildWeekBars(days, tasks, null);
  assert(result[0].segments.length === 2, "前 2 条保留");
  assert(result[0].overflowCount === 1, "第 3 条计入 overflow");
  assert(result[0].coveredTaskIds.size === 2, "covered 包含前 2 条");
}

console.log("== 测试 7：跨周 task 的所有 segment 都被保留 ==");
{
  const t1 = makeTask({
    id: "high",
    priority: "p0",
    scheduledDates: ["2026-05-10", "2026-05-11"],
  });
  const t2 = makeTask({ id: "mid", priority: "p1", scheduledDates: ["2026-05-04", "2026-05-05"] });
  const result = buildWeekBars(days, [t1, t2], null);
  const t1Segs = result.flatMap((w) => w.segments).filter((s) => s.taskId === "high");
  assert(t1Segs.length === 2, "跨周高优先级 task 的两段都应保留");
}

console.log("\n所有断言通过 ✅");
