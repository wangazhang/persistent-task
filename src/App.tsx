import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TasksHub } from "@/routes/tasks/TasksHub";
import { TagsPage } from "@/routes/Tags";
import { Pomodoro } from "@/routes/Pomodoro";
import { Stats } from "@/routes/Stats";
import { DataPage } from "@/routes/data/DataPage";
import { AdvancedPage } from "@/routes/AdvancedPage";
import { useTaskStore } from "@/store/taskStore";
import { useTagStore } from "@/store/tagStore";
import { usePomodoroStore } from "@/store/pomodoroStore";
import { usePastReviewStore } from "@/store/pastReviewStore";
import { isPastUnfinished } from "@/lib/pastReview";
import { isoDate } from "@/lib/utils";
import { TrayMainBridge } from "@/components/TrayMainBridge";

function checkAndAutoPrompt() {
  const past = usePastReviewStore.getState();
  if (!past.shouldAutoPrompt()) return;
  // 只查一次 store，不订阅
  const { tasks } = useTaskStore.getState();
  const today = isoDate();
  const hasPast = tasks.some((t) => isPastUnfinished(t, today));
  if (!hasPast) return;
  past.openDialog();
  past.markPromptedToday();
}

export default function App() {
  const hydrateTasks = useTaskStore((s) => s.hydrate);
  const hydrateTags = useTagStore((s) => s.hydrate);
  const tickPomodoro = usePomodoroStore((s) => s.tick);

  // 启动时加载数据，加载完毕后判断是否需要弹"待处理过期任务"
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all([hydrateTags(), hydrateTasks()]);
      if (cancelled) return;
      checkAndAutoPrompt();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 全局番茄钟 tick：每秒跳一次（store 内部判断状态）
  useEffect(() => {
    const id = setInterval(() => tickPomodoro(), 1000);
    return () => clearInterval(id);
  }, [tickPomodoro]);

  // 跨日（应用持续打开）也要触发一次：
  //   - visibilitychange：用户切回应用前台
  //   - 5 分钟轮询：纯前台情况下也能感知日期变化
  useEffect(() => {
    function onVis() {
      if (document.visibilityState === "visible") checkAndAutoPrompt();
    }
    document.addEventListener("visibilitychange", onVis);
    const timer = window.setInterval(checkAndAutoPrompt, 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(timer);
    };
  }, []);

  return (
    <>
      <Routes>
        <Route element={<AppLayout />}>
          {/* 首页 → 任务管理（今日 view） */}
          <Route index element={<Navigate to="/tasks?view=today" replace />} />

          {/* 旧路径兼容：/today、/calendar 全部并入 /tasks */}
          <Route
            path="today"
            element={<Navigate to="/tasks?view=today" replace />}
          />
          <Route
            path="calendar"
            element={<Navigate to="/tasks?view=month" replace />}
          />

          <Route path="tasks" element={<TasksHub />} />
          <Route path="tags" element={<TagsPage />} />
          <Route path="pomodoro" element={<Pomodoro />} />
          <Route path="stats" element={<Stats />} />
          <Route path="data" element={<DataPage />} />
          <Route path="advanced" element={<AdvancedPage />} />
          <Route
            path="*"
            element={<Navigate to="/tasks?view=today" replace />}
          />
        </Route>
      </Routes>
      <ConfirmDialog />
      <TrayMainBridge />
    </>
  );
}
