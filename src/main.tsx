import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { initAdapter, isTauri } from "./lib/dataAdapter";
import { flushNow, track } from "./lib/analytics";
import "./styles/index.css";

const startedAt = performance.now();

initAdapter().then(async () => {
  const platform: "tauri" | "web" = isTauri() ? "tauri" : "web";
  track("app.launched", { platform });
  track("app.hydrated", {
    platform,
    durationMs: Math.round(performance.now() - startedAt),
  });

  // 退出前同步 flush(尽量；浏览器 beforeunload 限制下用 sendBeacon-like 思路:已是本地写入,fire-and-forget 即可)
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
      void flushNow();
    });
  }
  // Tauri 端的 onCloseRequested 处理留给后续可选优化(本地写入即时性已经够用)

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
});
