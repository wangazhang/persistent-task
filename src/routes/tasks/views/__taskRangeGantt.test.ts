// 用法：npx tsx src/routes/tasks/views/__taskRangeGantt.test.ts
import type { Task } from "@/lib/types";
import {
  buildGanttRows,
  makeScrollableGanttRange,
  makeTaskTimeRange,
  resizeContinuousSchedule,
  shiftContinuousSchedule,
  tasksIntersectingRange,
} from "./_taskRangeGantt";

let fail = 0;
function ok(label: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) fail++;
}

function eq<T>(label: string, actual: T, expected: T) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  ok(`${label}: ${JSON.stringify(actual)} === ${JSON.stringify(expected)}`, pass);
}

function makeTask(partial: Partial<Task> & { id: string; scheduledDates: string[] }): Task {
  return {
    id: partial.id,
    title: partial.title ?? partial.id,
    description: "",
    status: partial.status ?? "todo",
    priority: partial.priority ?? "p2",
    scheduledDates: partial.scheduledDates,
    tagIds: partial.tagIds ?? [],
    order: 0,
    docs: [],
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

const month = makeTaskTimeRange("month", "2026-05-21");
eq("month range starts at first day", month.startISO, "2026-05-01");
eq("month range ends at last day", month.endISO, "2026-05-31");
eq("month range uses day unit", month.unit, "day");
eq("month range has 31 ticks", month.ticks.length, 31);

const year = makeTaskTimeRange("year", "2026-05-21");
eq("year range starts at Jan", year.startISO, "2026-01-01");
eq("year range ends at Dec", year.endISO, "2026-12-31");
eq("year range uses month unit", year.unit, "month");
eq("year range has 12 ticks", year.ticks.length, 12);

const scrollableWeek = makeScrollableGanttRange(
  makeTaskTimeRange("week", "2026-05-21")
);
eq("week gantt preloads four earlier weeks", scrollableWeek.startISO, "2026-04-20");
eq("week gantt preloads four later weeks", scrollableWeek.endISO, "2026-06-21");
eq("week gantt timeline stays continuous by day", scrollableWeek.ticks.length, 63);

const scrollableMonth = makeScrollableGanttRange(month);
eq("month gantt preloads earlier months", scrollableMonth.startISO, "2026-03-01");
eq("month gantt preloads later months", scrollableMonth.endISO, "2026-07-31");

const scrollableYear = makeScrollableGanttRange(year);
eq("year gantt preloads earlier year", scrollableYear.startISO, "2025-01-01");
eq("year gantt preloads later year", scrollableYear.endISO, "2027-12-31");
eq("year gantt timeline keeps month ticks", scrollableYear.ticks.length, 36);

const tasks = [
  makeTask({ id: "before", scheduledDates: ["2026-04-20"] }),
  makeTask({ id: "cross-in", scheduledDates: ["2026-04-30", "2026-05-01", "2026-05-02"] }),
  makeTask({ id: "inside", scheduledDates: ["2026-05-12"] }),
  makeTask({ id: "cross-out", scheduledDates: ["2026-05-30", "2026-05-31", "2026-06-01"] }),
  makeTask({ id: "after", scheduledDates: ["2026-06-02"] }),
];
eq(
  "tasksIntersectingRange includes any task touching current month",
  tasksIntersectingRange(tasks, month).map((t) => t.id),
  ["cross-in", "inside", "cross-out"]
);

const rows = buildGanttRows(
  [
    makeTask({ id: "clip-left", scheduledDates: ["2026-04-29", "2026-04-30", "2026-05-01", "2026-05-02"] }),
    makeTask({ id: "single", scheduledDates: ["2026-05-12"] }),
    makeTask({ id: "split", scheduledDates: ["2026-05-03", "2026-05-04", "2026-05-09"] }),
  ],
  month
);
eq(
  "month gantt clips cross-range continuous segment to visible day columns",
  rows[0].segments.map((s) => ({ startIndex: s.startIndex, endIndex: s.endIndex, editable: s.editable })),
  [{ startIndex: 0, endIndex: 1, editable: true }]
);
eq(
  "single-day tasks render as one editable day segment",
  rows[1].segments.map((s) => ({ startIndex: s.startIndex, endIndex: s.endIndex, editable: s.editable })),
  [{ startIndex: 11, endIndex: 11, editable: true }]
);
eq(
  "non-contiguous schedules render multiple read-only visible runs",
  rows[2].segments.map((s) => ({ startIndex: s.startIndex, endIndex: s.endIndex, editable: s.editable })),
  [
    { startIndex: 2, endIndex: 3, editable: false },
    { startIndex: 8, endIndex: 8, editable: false },
  ]
);

const yearRows = buildGanttRows(
  [
    makeTask({ id: "year-span", scheduledDates: ["2026-02-20", "2026-03-01", "2026-03-02", "2026-04-10"] }),
  ],
  year
);
eq(
  "year gantt maps visible dates to month columns and stays read-only",
  yearRows[0].segments.map((s) => ({ startIndex: s.startIndex, endIndex: s.endIndex, editable: s.editable })),
  [{ startIndex: 1, endIndex: 3, editable: false }]
);

const scrollableYearRows = buildGanttRows(
  [
    makeTask({
      id: "scrollable-year-span",
      scheduledDates: ["2025-12-20", "2027-01-10"],
    }),
  ],
  scrollableYear
);
eq(
  "scrollable year gantt maps months relative to the wider timeline",
  scrollableYearRows[0].segments.map((s) => ({ startIndex: s.startIndex, endIndex: s.endIndex })),
  [{ startIndex: 11, endIndex: 24 }]
);

eq(
  "dragging a continuous schedule shifts every day by delta",
  shiftContinuousSchedule(["2026-05-10", "2026-05-11", "2026-05-12"], 2),
  ["2026-05-12", "2026-05-13", "2026-05-14"]
);
eq(
  "resizing start clamps before the end",
  resizeContinuousSchedule(["2026-05-10", "2026-05-11", "2026-05-12"], "start", 3),
  ["2026-05-12"]
);
eq(
  "resizing end extends a continuous range",
  resizeContinuousSchedule(["2026-05-10", "2026-05-11", "2026-05-12"], "end", 2),
  ["2026-05-10", "2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14"]
);

if (fail > 0) {
  console.log(`\n${fail} 项失败`);
  process.exit(1);
}

console.log("\n全部通过");
