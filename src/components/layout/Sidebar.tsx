import { NavLink, useLocation } from "react-router-dom";
import {
  BarChart3,
  ListTodo,
  RotateCcw,
  Tags,
  Timer,
} from "lucide-react";
import { getAdapter, isTauri } from "@/lib/dataAdapter";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  // 任务管理统一入口；默认带 view=today 让侧边栏点击行为可预期
  { to: "/tasks?view=today", path: "/tasks", label: "任务", icon: ListTodo },
  { to: "/tags", path: "/tags", label: "标签管理", icon: Tags },
  { to: "/pomodoro", path: "/pomodoro", label: "番茄时钟", icon: Timer },
  { to: "/stats", path: "/stats", label: "统计面板", icon: BarChart3 },
];

async function resetDemoData() {
  const tip = isTauri()
    ? "将清空本地 SQLite 中的全部数据并按今天日期重新生成 demo。继续？"
    : "将清除浏览器中保存的全部演示数据并按今天日期重新生成。继续？";
  if (!confirm(tip)) return;
  try {
    await getAdapter().clearAll();
  } catch (e) {
    console.error("[reset demo] clearAll failed:", e);
  }
  location.reload();
}

export function Sidebar() {
  // 重置按钮对 web / 桌面端都开放：底层 clearAll 已自适应
  const showReset = true;
  // 高亮逻辑要基于 pathname 而非完整 to（NavLink 默认会把 ?query 一起比较，
  // 导致带 view=calendar 的 URL 不再高亮"任务"项）
  const location = useLocation();
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-ink-200/70 bg-white">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-soft">
          <span className="text-base font-bold">持</span>
        </div>
        <div>
          <div className="text-sm font-semibold text-ink-800">持续任务</div>
          <div className="text-[11px] text-ink-400">Persistent Task</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {NAV_ITEMS.map(({ to, path, label, icon: Icon }) => {
          const isActive =
            path === "/tasks"
              ? location.pathname === "/" || location.pathname.startsWith("/tasks")
              : location.pathname.startsWith(path);
          return (
            <NavLink
              key={path}
              to={to}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-brand-50 text-brand-700 font-medium"
                  : "text-ink-600 hover:bg-ink-100"
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="border-t border-ink-200/70 px-3 py-3 text-[11px] leading-relaxed text-ink-400">
        {showReset && (
          <button
            type="button"
            onClick={resetDemoData}
            className="mb-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-700"
            title="清除浏览器中保存的演示数据，重新生成"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            重置 demo 数据
          </button>
        )}
        <div className="px-2">
          本地数据 · 番茄专注
          <br />
          v0.1 · demo 数据
        </div>
      </div>
    </aside>
  );
}
