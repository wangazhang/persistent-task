import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { initAdapter } from "./lib/dataAdapter";
import "./styles/index.css";

// 启动前先把数据层初始化好：Web 端要等 sql.js + IndexedDB 就绪，
// 桌面端构造 TauriAdapter；store hydrate 才能立刻拿到一致的 adapter。
initAdapter().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
});
