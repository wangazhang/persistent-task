/**
 * 托盘 popup 通用容器：透明窗口 + 圆角白卡 + 阴影，配 transparent webview window
 * 使用得到"悬浮卡片"视觉效果。tray-popup / task-detail / task-editor 共用。
 */

import type { ReactNode } from "react";

export function PopupFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen items-stretch justify-stretch bg-transparent p-2">
      <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-ink-200/50 bg-white shadow-2xl">
        {children}
      </div>
    </div>
  );
}
