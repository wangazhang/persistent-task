/**
 * 主窗口侧的托盘桥：
 *   - 监听本窗口的 store 变化，组装快照 emit `tray:state`
 *   - 监听 popup 的 `tray:request-state` 事件 → 立即 push 一次
 *   - 监听 popup 的 `tray:action` 事件 → 触发对应业务行为
 *
 * 番茄运行时 elapsedSec 每秒变化 → snapshot 也每秒变化 → 每秒 emit。
 * Tauri event 在同进程内的开销很小，不用节流。
 */

import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTaskStore } from "@/store/taskStore";
import { useTagStore } from "@/store/tagStore";
import { usePomodoroStore, targetSecOf } from "@/store/pomodoroStore";
import {
  emitTrayState,
  listenTrayAction,
  listenTrayStateRequest,
  type TrayAction,
} from "@/lib/trayBridge";
import {
  emitTaskEditorState,
  listenTaskEditorAction,
  listenTaskEditorStateRequest,
  openTaskEditorWindow,
  taskEditorDraftToTaskPatch,
  type TaskEditorAction,
  type TaskEditorTarget,
} from "@/lib/taskEditorBridge";
import type { TrayStateSnapshot } from "@/store/trayStore";
import { isTauri } from "@/lib/dataAdapter";
import { isoDate } from "@/lib/utils";

export function TrayMainBridge() {
  const tasks = useTaskStore((s) => s.tasks);
  const pomo = usePomodoroStore();
  const navigate = useNavigate();

  const navRef = useRef(navigate);
  navRef.current = navigate;

  // 组装快照
  const snapshot: TrayStateSnapshot = useMemo(() => {
    const today = isoDate();
    const todayTasks = tasks
      .filter(
        (t) =>
          t.scheduledDates.includes(today) &&
          (t.status === "todo" || t.status === "in_progress" || t.status === "suspended")
      )
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        color: t.color,
        priority: t.priority,
        description: t.description,
      }));
    const doneCountToday = tasks.filter(
      (t) => t.status === "done" && t.scheduledDates.includes(today)
    ).length;

    return {
      todayTasks,
      doneCountToday,
      pomodoro: {
        state: pomo.state,
        type: pomo.type,
        elapsedSec: pomo.elapsedSec,
        targetSec: targetSecOf(pomo.type),
        taskId: pomo.taskId,
      },
    };
  }, [tasks, pomo.state, pomo.type, pomo.elapsedSec, pomo.taskId]);

  // 推送：每次 snapshot 变化就 emit。
  const lastSerializedRef = useRef("");
  useEffect(() => {
    if (!isTauri()) return;
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSerializedRef.current) return;
    lastSerializedRef.current = serialized;
    void emitTrayState(snapshot);
  }, [snapshot]);

  // 持有最新 snapshot 给 request listener 闭包用
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // 监听 popup 的 request → 立即 push 一次（应对 popup 启动时主窗口尚未变更的场景）
  useEffect(() => {
    if (!isTauri()) return;
    let un: (() => void) | undefined;
    let disposed = false;
    listenTrayStateRequest(() => {
      // 必须用 ref，闭包变量 snapshot 是 mount 时刻的（null），会污染 popup 的快照
      const latest = snapshotRef.current;
      console.log("[trayBridge] main got refresh request, snapshot:", latest);
      if (latest) void emitTrayState(latest);
    }).then((u) => {
      if (disposed) u();
      else un = u;
    });
    return () => {
      disposed = true;
      un?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 独立完整任务编辑器：按需请求 main 里的最新 task/tag 快照。
  useEffect(() => {
    if (!isTauri()) return;
    let unRequest: (() => void) | undefined;
    let unAction: (() => void) | undefined;
    let disposed = false;

    listenTaskEditorStateRequest((target) => {
      void emitTaskEditorStateFor(target);
    }).then((u) => {
      if (disposed) u();
      else unRequest = u;
    });

    listenTaskEditorAction((action) => {
      handleTaskEditorAction(action);
    }).then((u) => {
      if (disposed) u();
      else unAction = u;
    });

    return () => {
      disposed = true;
      unRequest?.();
      unAction?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 监听 popup 的 action
  useEffect(() => {
    if (!isTauri()) return;
    let un: (() => void) | undefined;
    let disposed = false;
    listenTrayAction((action) => handleAction(action)).then((u) => {
      if (disposed) u();
      else un = u;
    });
    return () => {
      disposed = true;
      un?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAction(action: TrayAction) {
    const pomoStore = usePomodoroStore.getState();
    const taskStore = useTaskStore.getState();
    switch (action.kind) {
      case "open_main":
        focusMain();
        break;
      case "open_pomodoro":
        focusMain();
        navRef.current("/pomodoro");
        break;
      case "open_task": {
        void openTaskEditorWindow({ taskId: action.taskId });
        break;
      }
      case "open_task_in_main": {
        void openTaskEditorWindow({ taskId: action.taskId });
        break;
      }
      case "update_task": {
        taskStore.updateTask(action.taskId, action.patch);
        break;
      }
      case "toggle_done": {
        taskStore.toggleStatus(action.taskId);
        break;
      }
      case "delete_task": {
        taskStore.deleteTask(action.taskId);
        break;
      }
      case "start_pomodoro_for": {
        focusMain();
        pomoStore.selectTask(action.taskId);
        pomoStore.setType("focus");
        pomoStore.start();
        navRef.current("/pomodoro");
        break;
      }
      case "select_pomodoro_task": {
        pomoStore.selectTask(action.taskId);
        pomoStore.setType("focus");
        break;
      }
      case "reorder_today": {
        taskStore.reorderForDate(isoDate(), action.orderedIds);
        break;
      }
      case "pomo_start":
        pomoStore.start();
        break;
      case "pomo_pause":
        pomoStore.pause();
        break;
      case "pomo_resume":
        pomoStore.resume();
        break;
      case "pomo_stop":
        pomoStore.stop();
        break;
      case "set_pomodoro_type":
        pomoStore.setType(action.type);
        break;
    }
  }

  return null;

  async function emitTaskEditorStateFor(target: TaskEditorTarget) {
    const latestTasks = useTaskStore.getState().tasks;
    const latestTags = useTagStore.getState().tags;
    await emitTaskEditorState({
      target,
      task: target.taskId
        ? latestTasks.find((t) => t.id === target.taskId) ?? null
        : null,
      tags: latestTags,
    });
  }

  function handleTaskEditorAction(action: TaskEditorAction) {
    const taskStore = useTaskStore.getState();
    const patch = taskEditorDraftToTaskPatch(action.draft);
    if (action.kind === "create_task") {
      taskStore.addTask({ title: action.draft.title, ...patch });
      return;
    }
    taskStore.updateTask(action.taskId, patch);
  }
}

async function focusMain() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  // popup 那边触发的 action 在哪个 window 接收要看谁先 listen；
  // 这里强制让 "main" 窗口前置（无论谁触发都得让用户看到主窗口）
  try {
    const { Window } = await import("@tauri-apps/api/window");
    const main = await Window.getByLabel("main");
    if (main) {
      await main.show();
      await main.unminimize();
      await main.setFocus();
    }
  } catch {
    const w = getCurrentWindow();
    await w.setFocus();
  }
}
