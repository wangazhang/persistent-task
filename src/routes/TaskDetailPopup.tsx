/**
 * 任务轻量编辑器 popup（独立 webview，label = task-detail）。
 *
 * 切换 task 不再 reload webview：当前显示的 taskId 用 useState 跟踪，
 * 通过 `tray:detail-target` 事件接收主窗口/popup 的"显示这个任务"指令。
 *
 * 数据流：
 *   - useTraySnapshot 监听 tray:state（含 retry，避免 race）
 *   - listenDetailTarget 监听切换指令
 *   - 编辑动作 → debounce 200ms emit `update_task` 给主窗口
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Play, Trash2, X } from "lucide-react";
import { RichDescription } from "@/components/ui/RichDescription";
import { PopupFrame } from "@/components/ui/PopupFrame";
import { StatusButtonGroup } from "@/components/ui/StatusButtonGroup";
import { useTrayPopupStore, type TrayStateSnapshot } from "@/store/trayStore";
import { useTraySnapshot, useTransparentBody } from "@/lib/trayHooks";
import {
  hideCurrentPopup,
  listenDetailTarget,
  sendTrayAction,
} from "@/lib/trayBridge";
import { cn } from "@/lib/utils";

type TaskLite = TrayStateSnapshot["todayTasks"][number];

const PRIO_BTN: { v: "p0" | "p1" | "p2"; l: string; tone: string }[] = [
  { v: "p0", l: "P0", tone: "text-rose-600 bg-rose-50 border-rose-200" },
  { v: "p1", l: "P1", tone: "text-amber-700 bg-amber-50 border-amber-200" },
  { v: "p2", l: "P2", tone: "text-ink-700 bg-ink-50 border-ink-200" },
];

function readTaskIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("taskId");
}

export default function TaskDetailPopup() {
  const [taskId, setTaskId] = useState<string | null>(() => readTaskIdFromUrl());
  const snapshot = useTrayPopupStore((s) => s.snapshot);

  useTraySnapshot("task-detail");
  useTransparentBody();

  // 监听主窗口/popup 推过来的切换指令（避免 reload webview 引入 race）
  useEffect(() => {
    let un: (() => void) | undefined;
    let disposed = false;
    listenDetailTarget((id) => {
      if (!disposed) setTaskId(id);
    }).then((u) => {
      if (disposed) u();
      else un = u;
    });
    return () => {
      disposed = true;
      un?.();
    };
  }, []);

  const task = useMemo(
    () => (taskId ? snapshot?.todayTasks.find((t) => t.id === taskId) ?? null : null),
    [snapshot, taskId]
  );

  const onClose = () => {
    console.log("[detail] close popup");
    void hideCurrentPopup();
  };

  if (!taskId) {
    return (
      <PopupFrame>
        <Header onClose={onClose} />
        <Empty text="无效的任务 ID" />
      </PopupFrame>
    );
  }
  if (snapshot === null) {
    return (
      <PopupFrame>
        <Header onClose={onClose} />
        <div className="flex h-full items-center justify-center text-xs text-ink-400">
          正在加载…
        </div>
      </PopupFrame>
    );
  }
  if (!task) {
    return (
      <PopupFrame>
        <Header taskId={taskId} onClose={onClose} />
        <Empty text="任务不存在或已完成/删除" />
      </PopupFrame>
    );
  }

  return (
    <PopupFrame>
      <Header taskId={taskId} onClose={onClose} />
      <DetailBody task={task} taskId={taskId} onClose={onClose} />
    </PopupFrame>
  );
}

function Header({
  taskId,
  onClose,
}: {
  taskId?: string | null;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-ink-400">
        任务详情
      </div>
      <div className="flex items-center gap-1">
        {taskId && (
          <button
            type="button"
            onClick={() => {
              console.log("[detail] click 完整编辑");
              sendTrayAction({ kind: "open_task_in_main", taskId });
            }}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-500 hover:bg-ink-100 hover:text-ink-700"
            title="在主窗口完整编辑（颜色 / 标签 / 排期）"
          >
            完整编辑
            <ArrowUpRight className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            console.log("[detail] click 关闭");
            onClose();
          }}
          className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
          aria-label="关闭"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function DetailBody({
  task,
  taskId,
  onClose,
}: {
  task: TaskLite;
  taskId: string;
  onClose: () => void;
}) {
  // 本地草稿：标题/描述用 controlled，debounce 后写回主窗口
  // key=task.id 让组件在 task 切换时自动重置 state（避免上一条草稿污染新任务）
  return <DetailBodyInner key={task.id} task={task} taskId={taskId} onClose={onClose} />;
}

function DetailBodyInner({
  task,
  taskId,
  onClose,
}: {
  task: TaskLite;
  taskId: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  /** 上次"远端推过来 / 本地写回"的值，用来分辨真实远端变化 */
  const remoteRef = useRef({
    title: task.title,
    description: task.description ?? "",
  });

  // 远端变化（其它窗口改了这条任务）→ 同步到本地草稿
  useEffect(() => {
    const r = remoteRef.current;
    if (task.title !== r.title || (task.description ?? "") !== r.description) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      remoteRef.current = {
        title: task.title,
        description: task.description ?? "",
      };
    }
  }, [task.title, task.description]);

  // 本地变化 → debounce 写回主窗口
  useEffect(() => {
    const r = remoteRef.current;
    if (title === r.title && description === r.description) return;
    const id = window.setTimeout(() => {
      sendTrayAction({
        kind: "update_task",
        taskId,
        patch: { title, description },
      });
      remoteRef.current = { title, description };
    }, 250);
    return () => window.clearTimeout(id);
  }, [title, description, taskId]);

  const currentPrio = (task.priority as "p0" | "p1" | "p2") ?? "p2";

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <input
          className="w-full border-none bg-transparent text-base font-medium text-ink-800 outline-none placeholder:text-ink-300"
          placeholder="任务标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <div className="mt-2">
          <div className="mb-1 text-[11px] text-ink-400">
            描述（支持子任务：[ ] / [/] / [x]）
          </div>
          <RichDescription
            value={description}
            onChange={setDescription}
            heightClass="min-h-20 max-h-44"
          />
        </div>

        <div className="mt-3">
          <div className="mb-1 text-[11px] text-ink-400">状态</div>
          <StatusButtonGroup
            value={task.status}
            onChange={(s) => {
              console.log("[detail] click 状态", s);
              sendTrayAction({
                kind: "update_task",
                taskId,
                patch: { status: s },
              });
            }}
            compact
          />
        </div>

        <div className="mt-3">
          <div className="mb-1 text-[11px] text-ink-400">优先级</div>
          <div className="flex gap-1">
            {PRIO_BTN.map(({ v, l, tone }) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  console.log("[detail] click 优先级", v);
                  sendTrayAction({
                    kind: "update_task",
                    taskId,
                    patch: { priority: v },
                  });
                }}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                  currentPrio === v
                    ? tone
                    : "border-ink-200 text-ink-500 hover:bg-ink-50"
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-ink-100 px-3 py-2">
        <button
          type="button"
          onClick={() => {
            console.log("[detail] click 开始番茄钟");
            sendTrayAction({ kind: "start_pomodoro_for", taskId });
            onClose();
          }}
          className="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
        >
          <Play className="h-3.5 w-3.5" />
          开始番茄钟
        </button>
        <button
          type="button"
          onClick={() => {
            console.log("[detail] click 删除");
            if (!confirm("确定删除这个任务？")) return;
            sendTrayAction({ kind: "delete_task", taskId });
            onClose();
          }}
          className="flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除
        </button>
      </div>
    </>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-1 items-center justify-center px-4 text-center text-xs text-ink-400">
      {text}
    </div>
  );
}
