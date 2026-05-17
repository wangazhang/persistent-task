import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import TrayPopup from "./routes/TrayPopup";
import TaskDetailPopup from "./routes/TaskDetailPopup";
import TaskEditorWindow from "./routes/TaskEditorWindow";
import { initAdapter, isTauri } from "./lib/dataAdapter";
import { flushNow, track } from "./lib/analytics";
import "./styles/index.css";

const startedAt = performance.now();

// 独立 webview 窗口：根据 ?win= 决定挂载哪个根组件。
//   win=tray-popup    → 托盘列表/番茄 popup
//   win=task-detail   → 任务轻量编辑器 popup（独立窗口）
//   win=task-editor   → 完整任务编辑器 popup（独立窗口）
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
} else if (winParam === "task-detail") {
  mount(<TaskDetailPopup />);
} else if (winParam === "task-editor") {
  mount(<TaskEditorWindow />);
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
