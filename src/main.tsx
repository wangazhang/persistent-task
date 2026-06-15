import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import TrayPopup from "./routes/TrayPopup";
import TaskEditorWindow from "./routes/TaskEditorWindow";
import QuickRecordWindow from "./routes/QuickRecordWindow";
import { initAdapter, isTauri } from "./lib/dataAdapter";
import { flushNow, track } from "./lib/analytics";
import "./styles/index.css";

const startedAt = performance.now();

// 独立 webview 窗口：根据 ?win= 决定挂载哪个根组件。
//   win=tray-popup    → 托盘列表/番茄 popup
//   win=task-editor   → 完整任务编辑器 popup（独立窗口）
//   win=quick-record  → AI 快速录入小窗（独立窗口）
const winParam =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("win")
    : null;

function mount(el: React.ReactNode) {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>{el}</React.StrictMode>
  );
}

if (winParam === "tray-popup") {
  mount(<TrayPopup />);
} else if (winParam === "task-editor") {
  mount(<TaskEditorWindow />);
} else if (winParam === "quick-record") {
  // 这个 webview 是透明窗口 + 面板四周留透明 padding（给光圈/圆角）。
  // 全局 body 有 bg-ink-50（浅灰），会把 padding 区填成直角浅色块——
  // 覆盖掉，让 padding 真正透明，只剩圆角面板 + 光圈。
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  mount(<QuickRecordWindow />);
} else {
  initAdapter().then(async () => {
    const platform: "tauri" | "web" = isTauri() ? "tauri" : "web";
    track("app.launched", { platform });
    track("app.hydrated", {
      platform,
      durationMs: Math.round(performance.now() - startedAt),
    });

    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => {
        void flushNow();
      });
    }

    mount(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );
  });
}
