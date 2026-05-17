/**
 * 跨窗口托盘桥：主窗口 ↔ tray-popup 之间的事件协议
 *
 *   - 主窗口端：订阅 store 变化，emit `tray:state` 推送快照给 popup
 *   - popup 端：监听 `tray:state`；用户交互时 emit `tray:action` 回主窗口
 *   - popup 启动时主动 emit `tray:request-state`，主窗口收到后立刻 push 一次
 *
 * 用 Tauri Event 系统，跨 webview 进程的轻量级 IPC。
 */

import type { TrayStateSnapshot } from "@/store/trayStore";
import { isTauri } from "./dataAdapter";

const EV_STATE = "tray:state";
const EV_REQUEST = "tray:request-state";
const EV_ACTION = "tray:action";
/** 主窗口 → detail 窗口：切换显示的任务 id（避免 webview reload）*/
const EV_DETAIL_TARGET = "tray:detail-target";

export type TrayAction =
  | { kind: "open_main" }
  | { kind: "open_pomodoro" }
  | { kind: "open_task"; taskId: string }
  | { kind: "toggle_done"; taskId: string }
  | { kind: "delete_task"; taskId: string }
  | { kind: "start_pomodoro_for"; taskId: string }
  | { kind: "select_pomodoro_task"; taskId: string }
  | { kind: "reorder_today"; orderedIds: string[] }
  | {
      kind: "update_task";
      taskId: string;
      patch: {
        title?: string;
        description?: string;
        status?: "todo" | "in_progress" | "suspended" | "done" | "archived";
        priority?: "p0" | "p1" | "p2";
      };
    }
  | { kind: "open_task_in_main"; taskId: string }
  | { kind: "pomo_start" }
  | { kind: "pomo_pause" }
  | { kind: "pomo_resume" }
  | { kind: "pomo_stop" }
  | { kind: "set_pomodoro_type"; type: "focus" | "short_break" | "long_break" };

// ---- 主窗口侧 ----

export async function emitTrayState(snap: TrayStateSnapshot): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emitTo } = await import("@tauri-apps/api/event");
    // 同时推给两个相关窗口；失败（窗口未创建）忽略
    await Promise.allSettled([
      emitTo("tray-popup", EV_STATE, snap),
      emitTo("task-detail", EV_STATE, snap),
    ]);
  } catch (err) {
    console.error("[trayBridge] emit state failed", err);
  }
}

export async function listenTrayAction(
  handler: (action: TrayAction) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const un = await listen<TrayAction>(EV_ACTION, (e) => {
    if (e.payload && typeof e.payload === "object" && "kind" in e.payload) {
      console.log("[trayBridge] main received action", e.payload);
      handler(e.payload);
    }
  });
  console.log("[trayBridge] main listening tray:action");
  return un;
}

export async function listenTrayStateRequest(
  handler: () => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const un = await listen(EV_REQUEST, () => handler());
  return un;
}

// ---- popup 侧 ----

export async function listenTrayState(
  handler: (snap: TrayStateSnapshot) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const un = await listen<TrayStateSnapshot>(EV_STATE, (e) => {
    if (e.payload) handler(e.payload);
  });
  return un;
}

export async function sendTrayAction(action: TrayAction): Promise<void> {
  console.log("[trayBridge] sendTrayAction →", action.kind, action);
  if (!isTauri()) {
    console.warn("[trayBridge] not in tauri, skip");
    return;
  }
  try {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("main", EV_ACTION, action);
    console.log("[trayBridge] emitTo main OK:", action.kind);
  } catch (err) {
    console.error("[trayBridge] emitTo FAILED:", action.kind, err);
  }
}

export async function requestTrayStateRefresh(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("main", EV_REQUEST);
  } catch (err) {
    console.error("[trayBridge] request refresh failed", err);
  }
}

/** detail 窗口监听：主窗口/popup 通知它该显示哪个 taskId */
export async function listenDetailTarget(
  handler: (taskId: string) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const un = await listen<string>(EV_DETAIL_TARGET, (e) => {
    if (typeof e.payload === "string") handler(e.payload);
  });
  return un;
}

/** popup/main → detail：切换显示的 task */
export async function setDetailTarget(taskId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("task-detail", EV_DETAIL_TARGET, taskId);
  } catch (err) {
    console.error("[trayBridge] set detail target failed", err);
  }
}

/** 关闭当前 popup 窗口（用 hide 保留实例，下次再 open 复用）*/
export async function hideCurrentPopup(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
  } catch (err) {
    console.error("[trayBridge] hide current window failed", err);
  }
}
