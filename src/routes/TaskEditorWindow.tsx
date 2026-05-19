import {
  useEffect,
  useMemo,
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

function readInitialTarget(): TaskEditorTarget {
  if (typeof window === "undefined") return {};
  return parseTaskEditorTarget(window.location.search);
}

export default function TaskEditorWindow() {
  const [target, setTarget] = useState<TaskEditorTarget>(() => readInitialTarget());
  const [state, setState] = useState<TaskEditorState | null>(null);

  useTransparentBody();

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
  async function close() {
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
    if (target.taskId) {
      await sendTaskEditorAction({
        kind: "update_task",
        taskId: target.taskId,
        draft,
      });
    } else {
      await sendTaskEditorAction({ kind: "create_task", draft });
    }
    await close();
  }

  // 快捷键：
  //   Esc       —— 焦点在可编辑控件上时先失焦（让用户先确认丢弃输入态），
  //                否则直接关窗。富文本编辑器自身也用 Esc 收弹层
  //                （斜杠菜单 / BubbleMenu），所以同样走 blur 让它接管。
  //   Cmd/Ctrl+S —— 触发 TaskEditorForm 的保存按钮（form 自己负责校验 + onSave，
  //                保存后会调用 close()）。
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
        // 找 form 的「保存」按钮：actions section 内唯一一颗 btn-primary。
        // 用 selector 而不是 ref：避免把命令式接口暴露穿过 TaskEditorForm。
        const btn = document.querySelector<HTMLButtonElement>(
          '[data-task-editor-section="actions"] button.btn-primary'
        );
        btn?.click();
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
            actionsClassName="shrink-0 border-t border-ink-200/70 bg-white px-4 py-3"
            header={{
              modeLabel,
              subtitle: "独立任务窗口",
              onClose: () => void close(),
              onMouseDown: handleHeaderMouseDown,
            }}
            task={task}
            tags={state.tags}
            defaultDate={target.defaultDate}
            onCancel={() => void close()}
            onSave={save}
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
