import { useEffect, useMemo, useState } from "react";
import { Check, PauseCircle, RotateCcw } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Modal } from "@/components/ui/Modal";
import { ReasonPromptDialog } from "./ReasonPromptDialog";
import { useTaskStore } from "@/store/taskStore";
import { usePastReviewStore } from "@/store/pastReviewStore";
import { isPastUnfinished } from "@/lib/pastReview";
import { isoDate } from "@/lib/utils";
import type { Task } from "@/lib/types";

/**
 * 过期未完成任务次日处理 —— 主对话框。
 *
 * 数据驱动：从 taskStore 实时算 pastUnfinished 列表，
 * 每次处理一条 → 列表自动收缩（行用 store 状态变化触发的 re-render 移除）。
 * 列表清空时自动关闭主对话框。
 */
export function PastTaskReviewDialog() {
  const open = usePastReviewStore((s) => s.open);
  const closeDialog = usePastReviewStore((s) => s.closeDialog);

  const tasks = useTaskStore((s) => s.tasks);
  const reviewPastTask = useTaskStore((s) => s.reviewPastTask);

  const today = isoDate();
  const list = useMemo<Task[]>(
    () =>
      tasks
        .filter((t) => isPastUnfinished(t, today))
        .sort((a, b) =>
          a.scheduledDates[0].localeCompare(b.scheduledDates[0])
        ),
    [tasks, today]
  );

  // 二级对话框状态
  const [pending, setPending] = useState<{
    taskId: string;
    action: "continue" | "suspend";
  } | null>(null);

  // 主对话框打开但列表已经空了 → 自动关闭
  useEffect(() => {
    if (open && list.length === 0) closeDialog();
  }, [open, list.length, closeDialog]);

  function handleDone(taskId: string) {
    reviewPastTask(taskId, "done");
  }

  function openReason(taskId: string, action: "continue" | "suspend") {
    setPending({ taskId, action });
  }

  function confirmReason(reason: string) {
    if (!pending) return;
    const finalReason = reason || undefined;
    reviewPastTask(pending.taskId, pending.action, finalReason);
    setPending(null);
  }

  const pendingTask = pending
    ? list.find((t) => t.id === pending.taskId)
    : null;
  const reasonTitle =
    pending && pendingTask
      ? `${pending.action === "continue" ? "今天继续" : "挂起"}：${pendingTask.title}`
      : "";
  const reasonConfirm = pending?.action === "continue" ? "确认继续" : "确认挂起";

  return (
    <>
      <Modal
        open={open}
        onClose={closeDialog}
        title={`待处理的过期任务（${list.length}）`}
        widthClass="max-w-xl"
        footer={
          <button type="button" className="btn-secondary" onClick={closeDialog}>
            稍后再说
          </button>
        }
      >
        <ul className="divide-y divide-ink-200/70">
          {list.map((t) => {
            const date = format(parseISO(t.scheduledDates[0]), "M/d");
            return (
              <li
                key={t.id}
                className="flex items-center gap-3 py-2.5"
                data-testid="past-review-row"
              >
                <span className="flex-1 truncate text-sm text-ink-700">
                  {t.title}
                </span>
                <span className="shrink-0 text-xs text-ink-400">{date}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <IconBtn
                    label="已完成"
                    color="text-emerald-600 hover:bg-emerald-50"
                    onClick={() => handleDone(t.id)}
                  >
                    <Check className="h-4 w-4" />
                  </IconBtn>
                  <IconBtn
                    label="今天继续"
                    color="text-brand-600 hover:bg-brand-50"
                    onClick={() => openReason(t.id, "continue")}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </IconBtn>
                  <IconBtn
                    label="挂起"
                    color="text-ink-500 hover:bg-ink-100"
                    onClick={() => openReason(t.id, "suspend")}
                  >
                    <PauseCircle className="h-4 w-4" />
                  </IconBtn>
                </div>
              </li>
            );
          })}
        </ul>
      </Modal>

      <ReasonPromptDialog
        open={pending !== null}
        title={reasonTitle}
        confirmText={reasonConfirm}
        onCancel={() => setPending(null)}
        onConfirm={confirmReason}
      />
    </>
  );
}

interface IconBtnProps {
  label: string;
  color: string;
  onClick: () => void;
  children: React.ReactNode;
}

function IconBtn({ label, color, onClick, children }: IconBtnProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`rounded-md p-1.5 transition-colors ${color}`}
    >
      {children}
    </button>
  );
}
