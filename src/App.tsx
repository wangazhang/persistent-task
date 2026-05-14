import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TasksHub } from "@/routes/tasks/TasksHub";
import { TagsPage } from "@/routes/Tags";
import { Pomodoro } from "@/routes/Pomodoro";
import { Stats } from "@/routes/Stats";
import { DataPage } from "@/routes/data/DataPage";
import { useTaskStore } from "@/store/taskStore";
import { useTagStore } from "@/store/tagStore";
import { usePomodoroStore } from "@/store/pomodoroStore";

export default function App() {
  const hydrateTasks = useTaskStore((s) => s.hydrate);
  const hydrateTags = useTagStore((s) => s.hydrate);
  const tickPomodoro = usePomodoroStore((s) => s.tick);

  // 启动时加载数据
  useEffect(() => {
    void hydrateTags();
    void hydrateTasks();
  }, [hydrateTasks, hydrateTags]);

  // 全局番茄钟 tick：每秒跳一次（store 内部判断状态）
  useEffect(() => {
    const id = setInterval(() => tickPomodoro(), 1000);
    return () => clearInterval(id);
  }, [tickPomodoro]);

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
          <Route
            path="*"
            element={<Navigate to="/tasks?view=today" replace />}
          />
        </Route>
      </Routes>
      <ConfirmDialog />
    </>
  );
}
