/**
 * 系统托盘 popup 窗口的 UI 状态（仅在 popup webview 进程里使用）。
 *
 * 主窗口的真实数据通过 Tauri 事件 `tray:state` 同步过来，popup 这边只用它做展示。
 */

import { create } from "zustand";
import type { Task, TaskStatus } from "@/lib/types";

/** 主窗口推过来的、与托盘 popup 相关的快照 */
export interface TrayStateSnapshot {
  /** 今日活跃任务（todo + in_progress + suspended 的可见任务）*/
  todayTasks: Pick<
    Task,
    "id" | "title" | "status" | "color" | "priority" | "description"
  >[];
  /** 今日已完成任务数（小标题展示）*/
  doneCountToday: number;
  pomodoro: {
    state: "idle" | "running" | "paused";
    type: "focus" | "short_break" | "long_break";
    /** 已经计时秒数 */
    elapsedSec: number;
    /** 目标秒数 */
    targetSec: number;
    /** 关联任务 id（若有）*/
    taskId?: string;
  };
}

export type TrayMode = "tasks" | "pomodoro";

interface TrayPopupStoreState {
  mode: TrayMode;
  setMode: (m: TrayMode) => void;

  snapshot: TrayStateSnapshot | null;
  setSnapshot: (s: TrayStateSnapshot) => void;
}

export const useTrayPopupStore = create<TrayPopupStoreState>((set) => ({
  mode: "tasks",
  setMode: (mode) => set({ mode }),

  snapshot: null,
  setSnapshot: (snapshot) => set({ snapshot }),
}));

export function isActiveTaskStatus(s: TaskStatus): boolean {
  return s === "todo" || s === "in_progress" || s === "suspended";
}

// ---- 主窗口侧：打开任务编辑器的全局回调槽位 ----
// TasksHub 挂载时注册自己的 openEdit；TrayMainBridge 收到 open_task 事件时
// 调用注册过的回调把编辑器弹出来。
//
// 单独放一个 store 而不是 Context，是为了让 TrayMainBridge / 别的非 React 上下文
// 也能 useTaskOpenStore.getState().handler 直接取到。

interface TaskOpenStoreState {
  handler: ((t: Task) => void) | null;
  setHandler: (h: ((t: Task) => void) | null) => void;
}
export const useTaskOpenStore = create<TaskOpenStoreState>((set) => ({
  handler: null,
  setHandler: (handler) => set({ handler }),
}));
