import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Vite 配置（Tauri 期望固定端口）
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: false,
    watch: {
      // 让 Vite 忽略 src-tauri
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  // sql.js 是混合 JS + WASM 包，vite 的依赖预构建会处理失败；
  // wasm 文件通过 sqliteDb.ts 里的 `?url` 导入加载，不需要预构建。
  optimizeDeps: {
    exclude: ["sql.js"],
  },
  build: {
    target: "esnext",
    minify: "esbuild",
    sourcemap: false,
  },
});
