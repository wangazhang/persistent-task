import { useMemo } from "react";
import { BellRing } from "lucide-react";
import { useTaskStore } from "@/store/taskStore";
import { usePastReviewStore } from "@/store/pastReviewStore";
import { isPastUnfinished } from "@/lib/pastReview";
import { isoDate } from "@/lib/utils";

/**
 * 应用顶栏。当前唯一职责是放「待处理过期任务」入口。
 *
 * 红点徽标条数 = 当前过期未完成任务数。条数为 0 时整个按钮不渲染。
 */
export function TopBar() {
  const tasks = useTaskStore((s) => s.tasks);
  const openDialog = usePastReviewStore((s) => s.openDialog);

  const today = isoDate();
  const count = useMemo(
    () => tasks.filter((t) => isPastUnfinished(t, today)).length,
    [tasks, today]
  );

  return (
    <header className="flex h-12 shrink-0 items-center justify-end border-b border-ink-200/70 bg-white px-4">
      {count > 0 && (
        <button
          type="button"
          onClick={openDialog}
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-500 hover:bg-ink-100 hover:text-ink-700"
          title={`${count} 个过期未完成任务待处理`}
          aria-label={`${count} 个过期未完成任务待处理`}
        >
          <BellRing className="h-4 w-4" />
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-medium leading-none text-white">
            {count > 99 ? "99+" : count}
          </span>
        </button>
      )}
    </header>
  );
}
