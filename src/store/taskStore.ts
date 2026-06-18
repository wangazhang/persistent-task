import { create } from "zustand";
import { getAdapter } from "@/lib/dataAdapter";
import type {
  PomodoroSession,
  Task,
  TaskReviewAction,
  TaskReviewEntry,
  TaskStatus,
} from "@/lib/types";
import { isoDate, uid } from "@/lib/utils";
import { withTracking, type ActionMapping } from "@/lib/analytics/middleware";
import type { TaskPriority } from "@/lib/types";
import { fillContinueDates } from "@/lib/pastReview";
import { enqueuePersist } from "@/persistenceQueue";

interface TaskStoreState {
  tasks: Task[];
  pomodoros: PomodoroSession[];
  hydrated: boolean;

  hydrate: () => Promise<void>;

  // tasks
  addTask: (
    partial: Partial<Task> & Pick<Task, "title">
  ) => Task;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  toggleStatus: (id: string, status?: TaskStatus) => void;
  /**
   * 在指定日期内重新排序任务列表
   * @param date yyyy-MM-dd
   * @param orderedIds 排序后的任务 id 列表
   */
  reorderForDate: (date: string, orderedIds: string[]) => void;
  /** 把任务从某天移除（不改变其他天）*/
  removeFromDate: (taskId: string, date: string) => void;
  /** 把任务追加到某天（如果尚未在）*/
  scheduleForDate: (taskId: string, date: string) => void;
  /**
   * 拖拽改期的原子操作。
   * - "move"（默认）：从 fromDate 移除 + 加入 toDate —— 拖拽的直觉语义
   * - "add"：保留 fromDate，仅把 toDate 加入 —— 复制到多日（Alt 修饰键）
   * - "replace"：scheduledDates 重置为 [toDate] —— 整体改期（Shift 修饰键）
   * fromDate === toDate 或源 / 目标完全一致时是 no-op，不触发 update。
   */
  moveSchedule: (
    taskId: string,
    fromDate: string,
    toDate: string,
    mode?: "move" | "add" | "replace"
  ) => void;
  /** 处理某条过期未完成任务（已完成 / 今天继续 / 挂起），同时追加 reviewLog */
  reviewPastTask: (
    id: string,
    action: TaskReviewAction,
    reason?: string
  ) => void;

  // pomodoros
  addPomodoro: (s: Omit<PomodoroSession, "id">) => PomodoroSession;
  removePomodoro: (id: string) => void;
}

/**
 * 在不破坏不变量的前提下，把任务持久化到 adapter。
 * 仅做 fire-and-forget，UI 仍以 zustand 内存状态为准（乐观更新）。
 */
function persistTask(t: Task) {
  void enqueuePersist(() => getAdapter().upsertTask(t));
}
function persistDeleteTask(id: string) {
  void enqueuePersist(() => getAdapter().deleteTask(id));
}
function persistPomo(p: PomodoroSession) {
  void enqueuePersist(() => getAdapter().insertPomodoro(p));
}
function persistDeletePomo(id: string) {
  void enqueuePersist(() => getAdapter().deletePomodoro(id));
}

const taskTrackingMapping: ActionMapping<TaskStoreState> = {
  addTask: (ret) => {
    const t = ret as { id: string; priority: TaskPriority; tagIds: string[]; docs?: { url: string }[]; description?: string };
    return [
      ["task.created", {
        taskId: t.id,
        priority: t.priority,
        tagIds: t.tagIds ?? [],
        hasDoc: (t.docs?.length ?? 0) > 0,
      }],
    ];
  },

  toggleStatus: (_ret, args) => {
    const [id, status] = args as [string, "todo" | "in_progress" | "suspended" | "done" | "archived" | undefined];
    if (status === "done") return [["task.completed", { taskId: id }]];
    if (status === "todo" || status === "in_progress") return [["task.uncompleted", { taskId: id }]];
    // 没传 status 时,store 内部会切换;靠 prev/next 推断
    return [];
  },

  deleteTask: (_ret, args) => {
    const [id] = args as [string];
    return [["task.deleted", { taskId: id }]];
  },

  moveSchedule: (_ret, args) => {
    const [id, from, to, mode] = args as [string, string, string, "move" | "add" | "replace" | undefined];
    return [["task.rescheduled", { taskId: id, fromDate: from, toDate: to, mode: mode ?? "move" }]];
  },

  scheduleForDate: (_ret, args) => {
    const [id, date] = args as [string, string];
    return [["task.scheduled", { taskId: id, date }]];
  },

  removeFromDate: (_ret, args) => {
    const [id, date] = args as [string, string];
    return [["task.unscheduled", { taskId: id, date }]];
  },

  reorderForDate: (_ret, args) => {
    const [date, ids] = args as [string, string[]];
    return [["task.reordered", { date, count: ids.length }]];
  },

  updateTask: (_ret, args, { prev, next }) => {
    const [id, patch] = args as [string, Partial<{ priority: TaskPriority; tagIds: string[] }>];
    const prevTask = prev.tasks.find((t) => t.id === id);
    const nextTask = next.tasks.find((t) => t.id === id);
    const out: Array<[any, any]> = [];
    if (prevTask && nextTask) {
      if (patch.priority && prevTask.priority !== nextTask.priority) {
        out.push(["task.priority_changed", {
          taskId: id, from: prevTask.priority, to: nextTask.priority,
        }]);
      }
      if (patch.tagIds) {
        const prevTags = prevTask.tagIds ?? [];
        const nextTags = nextTask.tagIds ?? [];
        for (const t of nextTags) if (!prevTags.includes(t)) out.push(["task.tagged", { taskId: id, tagId: t }]);
        for (const t of prevTags) if (!nextTags.includes(t)) out.push(["task.untagged", { taskId: id, tagId: t }]);
      }
    }
    out.push(["task.updated", { taskId: id, fields: Object.keys(patch ?? {}) }]);
    return out;
  },

  addPomodoro: (ret) => {
    const p = ret as { taskId?: string; type: "focus" | "short_break" | "long_break"; durationSec: number; completed: boolean };
    return [
      [
        p.completed ? "pomodoro.completed" : "pomodoro.cancelled",
        p.completed
          ? { taskId: p.taskId, type: p.type, durationSec: p.durationSec }
          : { taskId: p.taskId, type: p.type, elapsedSec: p.durationSec },
      ],
    ];
  },
};

export const useTaskStore = create<TaskStoreState>()(
  withTracking(taskTrackingMapping)((set, get) => ({
  tasks: [],
  pomodoros: [],
  hydrated: false,

  async hydrate() {
    if (get().hydrated) return;
    const adapter = getAdapter();
    const [tasks, pomos] = await Promise.all([
      adapter.listTasks(),
      adapter.listPomodoros(),
    ]);
    set({ tasks, pomodoros: pomos, hydrated: true });
  },

  addTask(partial) {
    const now = new Date().toISOString();
    const today = isoDate();
    const task: Task = {
      // 允许调用方预生成 id(任务编辑窗口自动保存新任务时用),
      // 这样上层在拿到 id 后还能继续 update 同一条记录而不会重复 create。
      id: partial.id ?? uid("task-"),
      title: partial.title,
      description: partial.description ?? "",
      status: partial.status ?? "todo",
      priority: partial.priority ?? "p2",
      scheduledDates: partial.scheduledDates ?? [today],
      tagIds: partial.tagIds ?? [],
      order:
        partial.order ??
        (get().tasks.filter((t) =>
          (partial.scheduledDates ?? [today]).some((d) =>
            t.scheduledDates.includes(d)
          )
        ).length || 0),
      docs: partial.docs ?? [],
      docUrl: partial.docUrl,
      docTitle: partial.docTitle,
      completedAt: partial.completedAt,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ tasks: [...s.tasks, task] }));
    persistTask(task);
    return task;
  },

  updateTask(id, patch) {
    set((s) => {
      const next = s.tasks.map((t) =>
        t.id === id
          ? { ...t, ...patch, updatedAt: new Date().toISOString() }
          : t
      );
      const updated = next.find((t) => t.id === id);
      if (updated) persistTask(updated);
      return { tasks: next };
    });
  },

  deleteTask(id) {
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
    persistDeleteTask(id);
  },

  toggleStatus(id, status) {
    const target = get().tasks.find((t) => t.id === id);
    if (!target) return;
    // 不带 status 参数：todo/in_progress/suspended → done，反之亦然
    const nextStatus: TaskStatus =
      status ?? (target.status === "done" ? "todo" : "done");
    const patch: Partial<Task> = {
      status: nextStatus,
      completedAt:
        nextStatus === "done" ? new Date().toISOString() : undefined,
    };
    // 关键设计：状态切换不再修改 scheduledDates。
    // - 标记 done 时保留排期 → 任务仍出现在原日期的日历单元格 / DaySection 已完成区
    // - 从 done 取消勾选时，原跨天信息自然恢复（不会丢失）
    // - 主列表（Today / Tasks "all"）通过 status filter 隐藏 done/suspended，
    //   再用独立的"已完成 / 已挂起"折叠区展示
    //
    // 老数据兼容：若 done 任务已被前一版本清空 scheduledDates，
    // 取消勾选时回填到今天（避免任务"消失"）。
    if (target.status === "done" && nextStatus !== "done") {
      if (target.scheduledDates.length === 0) {
        patch.scheduledDates = [isoDate()];
      }
    }
    get().updateTask(id, patch);
  },

  reorderForDate(_date, orderedIds) {
    set((s) => {
      const idToIndex = new Map(orderedIds.map((id, i) => [id, i]));
      const next = s.tasks.map((t) => {
        const idx = idToIndex.get(t.id);
        if (idx === undefined) return t;
        const updated = {
          ...t,
          order: idx,
          updatedAt: new Date().toISOString(),
        };
        persistTask(updated);
        return updated;
      });
      return { tasks: next };
    });
  },

  removeFromDate(taskId, date) {
    const t = get().tasks.find((t) => t.id === taskId);
    if (!t) return;
    get().updateTask(taskId, {
      scheduledDates: t.scheduledDates.filter((d) => d !== date),
    });
  },

  scheduleForDate(taskId, date) {
    const t = get().tasks.find((t) => t.id === taskId);
    if (!t) return;
    if (t.scheduledDates.includes(date)) return;
    get().updateTask(taskId, {
      scheduledDates: [...t.scheduledDates, date],
    });
  },

  moveSchedule(taskId, fromDate, toDate, mode = "move") {
    if (fromDate === toDate && mode !== "replace") return;
    const t = get().tasks.find((x) => x.id === taskId);
    if (!t) return;
    let next: string[];
    if (mode === "replace") {
      next = [toDate];
    } else if (mode === "add") {
      next = t.scheduledDates.includes(toDate)
        ? t.scheduledDates.slice()
        : [...t.scheduledDates, toDate];
    } else {
      // move：去掉源、加上目标（保持已存在的其它日期不变）
      next = t.scheduledDates.filter((d) => d !== fromDate);
      if (!next.includes(toDate)) next.push(toDate);
    }
    next.sort();
    // 如果 next 与原数组等价（含相同元素），跳过 update 避免空操作 re-render
    if (
      next.length === t.scheduledDates.length &&
      next.every((d, i) => d === t.scheduledDates[i])
    ) {
      return;
    }
    get().updateTask(taskId, { scheduledDates: next });
  },

  reviewPastTask(id, action, reason) {
    const target = get().tasks.find((t) => t.id === id);
    if (!target) return;
    const today = isoDate();
    const existing = target.reviewLog ?? [];
    const entry: TaskReviewEntry = reason
      ? { date: today, action, reason }
      : { date: today, action };
    const reviewLog: TaskReviewEntry[] = [...existing, entry];

    if (action === "done") {
      get().updateTask(id, {
        status: "done",
        completedAt: new Date().toISOString(),
        reviewLog,
      });
      return;
    }
    if (action === "suspend") {
      get().updateTask(id, { status: "suspended", reviewLog });
      return;
    }
    // continue：填充 scheduledDates，状态保持 todo / in_progress
    const next = fillContinueDates(target.scheduledDates, today);
    get().updateTask(id, { scheduledDates: next, reviewLog });
  },

  addPomodoro(input) {
    const session: PomodoroSession = { id: uid("pomo-"), ...input };
    set((s) => ({ pomodoros: [...s.pomodoros, session] }));
    persistPomo(session);
    return session;
  },

  removePomodoro(id) {
    set((s) => ({ pomodoros: s.pomodoros.filter((p) => p.id !== id) }));
    persistDeletePomo(id);
  },
})));
