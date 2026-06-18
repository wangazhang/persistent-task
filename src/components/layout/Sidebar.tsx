import { NavLink, useLocation } from "react-router-dom";
import {
  BarChart3,
  Database,
  ListTodo,
  Settings2,
  Tags,
  Timer,
  Trash2,
} from "lucide-react";
import { getAdapter } from "@/lib/dataAdapter";
import { confirm as dialogConfirm } from "@/store/dialogStore";
import { cn } from "@/lib/utils";
import { flushPersistQueue } from "@/persistenceQueue";
import logoUrl from "@/assets/logo.png";

const NAV_ITEMS = [
  // 任务管理统一入口；默认带 view=today 让侧边栏点击行为可预期
  { to: "/tasks?view=today", path: "/tasks", label: "任务", icon: ListTodo },
  { to: "/tags", path: "/tags", label: "标签管理", icon: Tags },
  { to: "/pomodoro", path: "/pomodoro", label: "番茄时钟", icon: Timer },
  { to: "/stats", path: "/stats", label: "统计面板", icon: BarChart3 },
  { to: "/data", path: "/data", label: "数据", icon: Database },
  { to: "/advanced", path: "/advanced", label: "高级", icon: Settings2 },
];

async function clearAllData() {
  const ok = await dialogConfirm({
    title: "清空所有数据",
    message:
      "将清空本地数据库中的全部任务、标签、番茄记录。\n此操作不可撤销，确认继续？",
    confirmText: "清空",
    danger: true,
  });
  if (!ok) return;
  try {
    await flushPersistQueue();
    await getAdapter().clearAll();
  } catch (e) {
    console.error("[clearAll] failed:", e);
  }
  location.reload();
}

export function Sidebar() {
  // 高亮逻辑要基于 pathname 而非完整 to（NavLink 默认会把 ?query 一起比较，
  // 导致带 view=calendar 的 URL 不再高亮"任务"项）
  const location = useLocation();
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-ink-200/70 bg-white">
      <div className="flex items-center gap-2 px-5 py-5">
        <img
          src={logoUrl}
          alt="持续任务"
          className="h-12 w-12 rounded-lg shadow-soft"
        />
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
        <button
          type="button"
          onClick={clearAllData}
          className="mb-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-ink-500 hover:bg-red-50 hover:text-red-600"
          title="清空本地数据库中的全部任务、标签、番茄记录"
        >
          <Trash2 className="h-3.5 w-3.5" />
          清空数据
        </button>
        <div className="px-2">
          本地数据 · 番茄专注
          <br />
          v0.1
        </div>
      </div>
    </aside>
  );
}
