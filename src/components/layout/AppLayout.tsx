import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { track } from "@/lib/analytics";

export function AppLayout() {
  const location = useLocation();
  useEffect(() => {
    // 取首段路径作 route id（"/tasks?view=today" -> "tasks"）
    const seg = location.pathname.split("/").filter(Boolean)[0] ?? "root";
    track("ui.route.enter", { route: seg });
  }, [location.pathname]);

  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
