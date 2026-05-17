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
    port: 1431,
    strictPort: true,
    host: false,
    watch: {
      // 让 Vite 忽略 src-tauri
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  // sql.js 发布的是 UMD 包，需要 vite 预构建（esbuild）做 CJS→ESM interop
  // 才能生成 `import initSqlJs from "sql.js"` 的 default 导出。
  // wasm 文件路径通过 sqliteDb.ts 里的 `?url` 显式导入，预构建不影响 wasm 加载。
  optimizeDeps: {
    include: ["sql.js"],
  },
  build: {
    target: "esnext",
    minify: "esbuild",
    sourcemap: false,
  },
});
