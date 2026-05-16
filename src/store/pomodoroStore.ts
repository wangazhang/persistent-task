import { create } from "zustand";
import type { PomodoroType } from "@/lib/types";
import { useTaskStore } from "./taskStore";
import { track } from "@/lib/analytics";

/**
 * 番茄钟运行时状态。
 *
 * 状态机：
 *   idle → running（点击「开始」）
 *   running → paused（点击「暂停」）
 *   paused → running（点击「继续」）
 *   running/paused → idle（自然结束 / 取消）
 *
 * 自然结束时记录一条 PomodoroSession，并切换到对应的休息阶段（提示用户）。
 */

export type PomodoroState = "idle" | "running" | "paused";

const FOCUS_SEC = 25 * 60;
const SHORT_BREAK_SEC = 5 * 60;
const LONG_BREAK_SEC = 15 * 60;

export function targetSecOf(type: PomodoroType): number {
  if (type === "focus") return FOCUS_SEC;
  if (type === "short_break") return SHORT_BREAK_SEC;
  return LONG_BREAK_SEC;
}

interface PomodoroStoreState {
  state: PomodoroState;
  type: PomodoroType;
  /** 当前关联任务 */
  taskId?: string;
  /** 已经计时的秒数（在 running 状态下会被 tick 不断更新）*/
  elapsedSec: number;
  /** 当前会话的开始时间（ISO）*/
  startedAt?: string;
  /** 完成多少个 focus 后给一次长休息 */
  finishedFocusCount: number;

  /** 选择/切换任务 */
  selectTask: (taskId?: string) => void;
  /** 切换计时类型（仅 idle 时允许）*/
  setType: (type: PomodoroType) => void;
  /** 启动计时 */
  start: () => void;
  pause: () => void;
  resume: () => void;
  /** 终止计时（不算完成）*/
  stop: () => void;
  /** 内部 tick：每秒推进 1 */
  tick: () => void;
}

export const usePomodoroStore = create<PomodoroStoreState>((set, get) => ({
  state: "idle",
  type: "focus",
  taskId: undefined,
  elapsedSec: 0,
  startedAt: undefined,
  finishedFocusCount: 0,

  selectTask(taskId) {
    if (get().state !== "idle") return;
    set({ taskId });
  },

  setType(type) {
    if (get().state !== "idle") return;
    set({ type, elapsedSec: 0 });
  },

  start() {
    set({
      state: "running",
      elapsedSec: 0,
      startedAt: new Date().toISOString(),
    });
    track("pomodoro.started", {
      taskId: get().taskId,
      type: get().type,
    });
  },

  pause() {
    if (get().state === "running") set({ state: "paused" });
  },

  resume() {
    if (get().state === "paused") set({ state: "running" });
  },

  stop() {
    const { state, type, taskId, elapsedSec, startedAt } = get();
    if (state === "idle") return;
    // 把已有进度记一笔（不计 completed）
    if (elapsedSec > 5) {
      useTaskStore.getState().addPomodoro({
        taskId,
        type,
        durationSec: elapsedSec,
        completed: false,
        startedAt: startedAt ?? new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
    }
    set({ state: "idle", elapsedSec: 0, startedAt: undefined });
  },

  tick() {
    const { state, type, taskId, elapsedSec, startedAt, finishedFocusCount } =
      get();
    if (state !== "running") return;
    const target = targetSecOf(type);
    const next = elapsedSec + 1;
    if (next >= target) {
      // 自然完成
      useTaskStore.getState().addPomodoro({
        taskId,
        type,
        durationSec: target,
        completed: true,
        startedAt: startedAt ?? new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
      // 自动切到休息（focus 完成 4 次后给长休息）
      if (type === "focus") {
        const newCount = finishedFocusCount + 1;
        const nextType: PomodoroType =
          newCount % 4 === 0 ? "long_break" : "short_break";
        set({
          state: "idle",
          type: nextType,
          elapsedSec: 0,
          startedAt: undefined,
          finishedFocusCount: newCount,
        });
      } else {
        set({
          state: "idle",
          type: "focus",
          elapsedSec: 0,
          startedAt: undefined,
        });
      }
      return;
    }
    set({ elapsedSec: next });
  },
}));
