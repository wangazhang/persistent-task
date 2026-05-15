/**
 * 整库导入导出。
 *
 * 导出 / 导入都通过 DataAdapter 转发：
 *   - Web 端  → 走 sql.js + IndexedDB
 *   - Tauri  → 走 Rust 端 export_db / replace_db 命令（操作磁盘 SQLite 文件）
 *
 * 校验在前端统一用 sql.js 完成（sql.js 在两端 webview 都可用），
 * 校验通过后才把字节交给 adapter 落地。
 *
 * 校验三段：
 *   1) 文件头 16 字节 = "SQLite format 3\0"
 *   2) sql.js 能成功打开
 *   3) 含 tasks / tags / pomodoros 三张表
 */

import initSqlJs from "sql.js/dist/sql-wasm.js";
import type { SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { getAdapter } from "./dataAdapter";
import { alert, confirm } from "@/store/dialogStore";

const SQLITE_MAGIC = "SQLite format 3\0";
const REQUIRED_TABLES = ["tasks", "tags", "pomodoros"] as const;
const MAX_BYTES = 200 * 1024 * 1024; // 200MB

let SQL: Promise<SqlJsStatic> | null = null;
function getSql(): Promise<SqlJsStatic> {
  if (!SQL) SQL = initSqlJs({ locateFile: () => wasmUrl });
  return SQL;
}

function formatTs(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}`
  );
}

/** 触发浏览器下载，文件名带时间戳，避免覆盖 */
export async function exportDbToFile(): Promise<void> {
  let bytes: Uint8Array;
  try {
    bytes = await getAdapter().exportDb();
  } catch (e) {
    await alert({
      title: "导出失败",
      message: `读取数据库失败：${String(e)}`,
    });
    return;
  }
  const blob = new Blob([bytes.slice().buffer], {
    type: "application/x-sqlite3",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `persistent-task-${formatTs(new Date())}.sqlite`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 字节流是否为合法的 SQLite 文件（仅校验文件头）*/
function hasSqliteMagic(bytes: Uint8Array): boolean {
  if (bytes.length < SQLITE_MAGIC.length) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) {
    if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

interface ValidateResult {
  ok: boolean;
  reason?: string;
  /** 校验通过时附带文件里各表的条数，供二次确认提示展示 */
  counts?: ImportCounts;
}

function countTable(
  db: import("sql.js").Database,
  table: string
): number {
  const stmt = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`);
  try {
    stmt.step();
    const row = stmt.getAsObject() as { n?: number };
    return Number(row.n ?? 0);
  } finally {
    stmt.free();
  }
}

/** 真打开一次确认结构正确（用完即关，不污染主 db 实例）*/
async function validateBytes(bytes: Uint8Array): Promise<ValidateResult> {
  if (!hasSqliteMagic(bytes)) {
    return { ok: false, reason: "文件不是 SQLite 格式" };
  }
  let tmp: import("sql.js").Database;
  try {
    const SqlMod = await getSql();
    tmp = new SqlMod.Database(bytes);
  } catch {
    return { ok: false, reason: "无法打开为 SQLite 数据库" };
  }
  try {
    const stmt = tmp.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    );
    const found = new Set<string>();
    while (stmt.step()) {
      const row = stmt.getAsObject() as { name?: string };
      if (row.name) found.add(row.name);
    }
    stmt.free();
    for (const t of REQUIRED_TABLES) {
      if (!found.has(t)) {
        return { ok: false, reason: `缺少必需的表：${t}` };
      }
    }
    return {
      ok: true,
      counts: {
        tasks: countTable(tmp, "tasks"),
        tags: countTable(tmp, "tags"),
        pomodoros: countTable(tmp, "pomodoros"),
      },
    };
  } finally {
    tmp.close();
  }
}

export interface ImportCounts {
  tasks: number;
  tags: number;
  pomodoros: number;
}

/**
 * 走完整导入流程：
 *   1. 大小 / 头 / 结构校验
 *   2. 双重确认（带当前数据计数）
 *   3. 写回 IndexedDB
 *   4. location.reload()
 *
 * 用户取消 / 校验失败 / 写入失败 都会以「不刷新」结束并提示用户；
 * 注意：写入失败时内存中的 db 实例已被关闭，必须由用户手动刷新页面才能恢复。
 *
 * @param currentCounts 当前内存中的三类计数，用于二次确认提示
 */
export async function importDbFromFile(
  file: File,
  currentCounts: ImportCounts
): Promise<void> {
  if (file.size > MAX_BYTES) {
    await alert({
      title: "导入失败",
      message: `备份文件过大（${(file.size / 1024 / 1024).toFixed(
        1
      )}MB），上限 200MB。`,
    });
    return;
  }

  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  const validation = await validateBytes(bytes);
  if (!validation.ok) {
    await alert({
      title: "导入失败",
      message: `文件不是合法的持续任务备份：${validation.reason}`,
    });
    return;
  }

  const fileCounts = validation.counts ?? { tasks: 0, tags: 0, pomodoros: 0 };
  const ok = await confirm({
    title: "覆盖导入",
    message:
      `将用文件中的 ${fileCounts.tasks} 个任务 / ${fileCounts.tags} 个标签 / ${fileCounts.pomodoros} 条番茄，\n` +
      `覆盖当前的 ${currentCounts.tasks} 个任务 / ${currentCounts.tags} 个标签 / ${currentCounts.pomodoros} 条番茄。\n\n` +
      `此操作不可撤销，确认继续？`,
    confirmText: "覆盖导入",
    cancelText: "取消",
    danger: true,
  });
  if (!ok) return;

  try {
    await getAdapter().replaceDb(bytes);
  } catch (e) {
    await alert({
      title: "导入失败",
      message: `写入数据库失败：${String(e)}。请刷新页面后重试。`,
    });
    return;
  }
  location.reload();
}
