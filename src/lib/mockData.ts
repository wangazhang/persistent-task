import { addDays, subDays } from "date-fns";
import type { PomodoroSession, Tag, Task } from "./types";
import { isoDate, uid } from "./utils";

/**
 * 演示用 mock 数据。
 *
 * 任务可见性规则：
 *   - 任务在每个 scheduledDates 中的日期都会出现在「今日任务」中
 *   - 已完成任务不在 scheduledDates 显示，仅在统计/历史中可见
 */

const today = new Date();
const todayStr = isoDate(today);
const yesterdayStr = isoDate(subDays(today, 1));
const tomorrowStr = isoDate(addDays(today, 1));

// 标签：树形结构
//   工作
//     - 项目 A
//     - 项目 B
//   学习
//     - 阅读
//     - 在线课
//   生活
const TAG_WORK = "tag-work";
const TAG_PROJECT_A = "tag-proj-a";
const TAG_PROJECT_B = "tag-proj-b";
const TAG_STUDY = "tag-study";
const TAG_READING = "tag-reading";
const TAG_COURSE = "tag-course";
const TAG_LIFE = "tag-life";

export const initialTags: Tag[] = [
  { id: TAG_WORK, name: "工作", parentId: null, color: "#6366f1", order: 0 },
  {
    id: TAG_PROJECT_A,
    name: "项目 A",
    parentId: TAG_WORK,
    color: "#4f46e5",
    order: 0,
  },
  {
    id: TAG_PROJECT_B,
    name: "项目 B",
    parentId: TAG_WORK,
    color: "#8b5cf6",
    order: 1,
  },
  { id: TAG_STUDY, name: "学习", parentId: null, color: "#10b981", order: 1 },
  {
    id: TAG_READING,
    name: "阅读",
    parentId: TAG_STUDY,
    color: "#059669",
    order: 0,
  },
  {
    id: TAG_COURSE,
    name: "在线课",
    parentId: TAG_STUDY,
    color: "#34d399",
    order: 1,
  },
  { id: TAG_LIFE, name: "生活", parentId: null, color: "#f59e0b", order: 2 },
];

const now = new Date().toISOString();

export const initialTasks: Task[] = [
  {
    id: uid("task-"),
    title: "完成季度 OKR 草稿",
    description: "包含 3 个 Objective、9 个 KR，对齐上下游相关方意见。",
    status: "in_progress",
    priority: "p0",
    scheduledDates: [yesterdayStr, todayStr, tomorrowStr],
    tagIds: [TAG_WORK, TAG_PROJECT_A],
    order: 0,
    docUrl: "https://alidocs.dingtalk.com/i/p/example-okr",
    docTitle: "Q3 OKR 草稿（钉钉文档）",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: uid("task-"),
    title: "Review 同事的设计稿",
    description: "聚焦交互一致性与可访问性。",
    status: "todo",
    priority: "p1",
    scheduledDates: [todayStr],
    tagIds: [TAG_WORK, TAG_PROJECT_B],
    order: 1,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: uid("task-"),
    title: "阅读《深度工作》第 3 章",
    description: "重点：仪式感与时间块法。",
    status: "todo",
    priority: "p2",
    scheduledDates: [todayStr, tomorrowStr],
    tagIds: [TAG_STUDY, TAG_READING],
    order: 2,
    docUrl: "https://example.com/notes/deep-work-ch3",
    docTitle: "我的读书笔记",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: uid("task-"),
    title: "完成 Rust 异步编程章节",
    description: "tokio 任务调度 + select!",
    status: "todo",
    priority: "p1",
    scheduledDates: [tomorrowStr],
    tagIds: [TAG_STUDY, TAG_COURSE],
    order: 0,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: uid("task-"),
    title: "整理本周采购清单",
    description: "",
    status: "todo",
    priority: "p2",
    scheduledDates: [todayStr],
    tagIds: [TAG_LIFE],
    order: 3,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: uid("task-"),
    title: "重构旧版报表模块",
    description: "需求待对齐，先挂起；待 PRD 定稿后恢复。",
    status: "suspended",
    priority: "p1",
    scheduledDates: [todayStr, tomorrowStr],
    tagIds: [TAG_WORK, TAG_PROJECT_B],
    order: 4,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: uid("task-"),
    title: "周会同步项目 A 进展",
    description: "已完成、风险、下周计划。",
    status: "done",
    priority: "p1",
    // done 任务保留排期：在原日期的「已完成」折叠区可见，
    // 取消勾选时跨天信息也会自然恢复
    scheduledDates: [yesterdayStr, todayStr],
    tagIds: [TAG_WORK, TAG_PROJECT_A],
    order: 99,
    completedAt: subDays(today, 1).toISOString(),
    createdAt: subDays(today, 2).toISOString(),
    updatedAt: subDays(today, 1).toISOString(),
  },
];

// 为统计页准备一些历史番茄钟数据
function makeHistoricalPomodoros(): PomodoroSession[] {
  const sessions: PomodoroSession[] = [];
  for (let i = 0; i < 14; i++) {
    const day = subDays(today, i);
    const count = Math.floor(Math.random() * 5) + (i % 3 === 0 ? 1 : 2);
    for (let j = 0; j < count; j++) {
      const startedAt = new Date(day);
      startedAt.setHours(9 + j, Math.floor(Math.random() * 30));
      const duration = 25 * 60;
      const endedAt = new Date(startedAt.getTime() + duration * 1000);
      sessions.push({
        id: uid("pomo-"),
        taskId: initialTasks[j % initialTasks.length].id,
        type: "focus",
        durationSec: duration,
        completed: true,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
      });
    }
  }
  return sessions;
}

export const initialPomodoros: PomodoroSession[] = makeHistoricalPomodoros();
