import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { X } from "lucide-react";
import { PopupFrame } from "@/components/ui/PopupFrame";
import { TaskEditorForm } from "@/components/task/TaskEditorForm";
import {
  listenTaskEditorState,
  listenTaskEditorTarget,
  parseTaskEditorTarget,
  requestTaskEditorState,
  sendTaskEditorAction,
  type TaskEditorState,
  type TaskEditorTarget,
  type TaskEditorDraft,
} from "@/lib/taskEditorBridge";
import { hideCurrentPopup } from "@/lib/trayBridge";
import { useTransparentBody } from "@/lib/trayHooks";
import { uid } from "@/lib/utils";

function readInitialTarget(): TaskEditorTarget {
  if (typeof window === "undefined") return {};
  return parseTaskEditorTarget(window.location.search);
}

export default function TaskEditorWindow() {
  const [target, setTarget] = useState<TaskEditorTarget>(() => readInitialTarget());
  const [state, setState] = useState<TaskEditorState | null>(null);
  // 新建模式下,首次自动保存把 createdId 用上,之后切到 update_task。
  // target 来自 query string,是只读的;用单独 ref 跟踪"本会话已创建的新任务 id"。
  const createdIdRef = useRef<string | null>(null);

  useTransparentBody();

  useEffect(() => {
    // target 切换(用户在同一个 task-editor 窗口里打开了另一条任务)→ 清掉旧的 createdId
    createdIdRef.current = null;
  }, [target.taskId, target.defaultDate, target.defaultTitle]);

  useEffect(() => {
    let un: (() => void) | undefined;
    let disposed = false;
    listenTaskEditorTarget((next) => {
      if (disposed) return;
      setTarget(next);
      setState(null);
    }).then((u) => {
      if (disposed) u();
      else un = u;
    });
    return () => {
      disposed = true;
      un?.();
    };
  }, []);

  useEffect(() => {
    let un: (() => void) | undefined;
    let disposed = false;
    listenTaskEditorState((next) => {
      if (!disposed) setState(next);
    }).then((u) => {
      if (disposed) u();
      else un = u;
    });
    return () => {
      disposed = true;
      un?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const timings = [0, 200, 500, 1000];
    (async () => {
      for (const delay of timings) {
        if (disposed || targetMatches(state?.target, target)) return;
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        if (disposed || targetMatches(state?.target, target)) return;
        await requestTaskEditorState(target);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [target, state?.target.taskId, state?.target.defaultDate]);

  const task = useMemo(() => state?.task ?? null, [state]);
  const modeLabel = target.taskId ? "编辑任务" : "新建任务";
  // 让 TaskEditorForm 挂"立刻冲刷"接口在这里;关窗前同步调一下,避免 300ms debounce 内丢输入。
  const flushRef = useRef<(() => void) | null>(null);
  async function close() {
    flushRef.current?.();
    await hideCurrentPopup();
  }

  async function startWindowDrag() {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().startDragging();
    } catch (err) {
      console.error("[task-editor] start dragging failed", err);
    }
  }

  function handleHeaderMouseDown(e: ReactMouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const interactive = (e.target as Element | null)?.closest("button,input,textarea,[contenteditable='true']");
    if (interactive) return;
    void startWindowDrag();
  }

  async function save(draft: TaskEditorDraft) {
    const existingId = target.taskId ?? createdIdRef.current;
    if (existingId) {
      await sendTaskEditorAction({
        kind: "update_task",
        taskId: existingId,
        draft,
      });
      return;
    }
    // 新建模式首次自动保存:本地先确定 id,送出 create_task,后续切到 update。
    const newId = uid("task-");
    createdIdRef.current = newId;
    await sendTaskEditorAction({
      kind: "create_task",
      draft,
      newTaskId: newId,
    });
  }

  // 快捷键:
  //   Esc       — 焦点在可编辑控件上时先失焦(给富文本编辑器自身的弹层让路),
  //               否则关窗(改动已经被自动保存了,关窗不会丢)。
  //   Cmd/Ctrl+S — 自动保存已经在跑,这里仅作为"立刻关闭"的便捷快捷键;
  //               关闭前不需要做任何强制冲刷,因为 onChange 已经触发了 debounce 的最后一轮。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        const ae = document.activeElement as HTMLElement | null;
        const editable =
          ae instanceof HTMLInputElement ||
          ae instanceof HTMLTextAreaElement ||
          (ae && ae.isContentEditable);
        if (editable) {
          ae.blur();
          return;
        }
        e.preventDefault();
        void close();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void close();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <PopupFrame>
      <div className="flex min-h-0 flex-1 flex-col">
        {!state ? (
          <>
            <FallbackHeader
              modeLabel={modeLabel}
              onClose={() => void close()}
              onMouseDown={handleHeaderMouseDown}
            />
            <div className="flex h-full items-center justify-center text-xs text-ink-400">
              正在加载…
            </div>
          </>
        ) : target.taskId && !task ? (
          <>
            <FallbackHeader
              modeLabel={modeLabel}
              onClose={() => void close()}
              onMouseDown={handleHeaderMouseDown}
            />
            <div className="flex h-full items-center justify-center text-xs text-ink-400">
              任务不存在或已删除
            </div>
          </>
        ) : (
          <TaskEditorForm
            className="min-h-0 flex-1"
            bodyClassName="min-h-0 flex-1 overflow-y-auto px-4 py-3"
            header={{
              modeLabel,
              subtitle: "独立任务窗口",
              onClose: () => void close(),
              onMouseDown: handleHeaderMouseDown,
            }}
            task={task}
            tags={state.tags}
            defaultDate={target.defaultDate}
            defaultTitle={target.defaultTitle}
            onSave={save}
            flushRef={flushRef}
          />
        )}
      </div>
    </PopupFrame>
  );
}

function targetMatches(a: TaskEditorTarget | undefined, b: TaskEditorTarget): boolean {
  return !!a && a.taskId === b.taskId && a.defaultDate === b.defaultDate;
}

function FallbackHeader({
  modeLabel,
  onClose,
  onMouseDown,
}: {
  modeLabel: string;
  onClose: () => void;
  onMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5 select-none"
      data-tauri-drag-region
      onMouseDown={onMouseDown}
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-ink-800">{modeLabel}</div>
        <div className="text-[11px] text-ink-400">独立任务窗口</div>
      </div>
      <button
        type="button"
        onClick={onClose}
        data-tauri-drag-region="false"
        className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
        aria-label="关闭"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
