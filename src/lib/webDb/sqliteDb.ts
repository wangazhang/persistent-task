/**
 * Web 端 SQLite 单例（基于 sql.js + IndexedDB）。
 *
 * 流程：
 *   1. initWebDb()：加载 wasm、从 IndexedDB 读取已存的 .db Uint8Array
 *      （没有则新建空库并执行 schema），返回 sql.js Database 实例。
 *   2. 任何写操作通过 run / tx 执行，结束后用 debounced persist
 *      把整库 db.export() 序列化回 IndexedDB。
 *   3. 读操作走 query，返回普通对象数组。
 *
 * 为什么是"整库序列化"而非增量 IndexedDB 表：
 *   本应用单用户、数据量小（个人任务量级 < 10^5），整库序列化简单、
 *   语义与 Tauri 桌面端的 SQLite 文件完全对齐，无需额外的事务/写日志层。
 */

// 显式指向 sql-wasm.js（而非通过包名走 conditional exports 选 sql-wasm-browser.js）。
// 这两份文件内容一致，但 vite dev 模式下 browser 入口的 default 导出会丢失，
// 选 sql-wasm.js 路径可以让 dev/build 行为一致。
import initSqlJs from "sql.js/dist/sql-wasm.js";
import type { Database, SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { debounce } from "../utils";
import { SCHEMA_SQL } from "./schema";

const IDB_NAME = "persistent-task";
const IDB_STORE = "kv";
const IDB_KEY = "db";

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/* ────────────────────────────────────────────────────────────
 * IndexedDB 极简 KV
 *   只存一条记录：key = "db", value = Uint8Array（SQLite 文件字节）
 * ──────────────────────────────────────────────────────────── */

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<Uint8Array | null> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(bytes: Uint8Array): Promise<void> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear(): Promise<void> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ────────────────────────────────────────────────────────────
 * 初始化
 * ──────────────────────────────────────────────────────────── */

/**
 * 启动 Web SQLite。idempotent —— 多次调用返回同一个 db 实例。
 */
export async function initWebDb(): Promise<Database> {
  if (db) return db;
  if (!SQL) {
    SQL = await initSqlJs({ locateFile: () => wasmUrl });
  }
  const bytes = await idbGet();
  db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  // 每次启动都执行一次 schema（CREATE IF NOT EXISTS 幂等）
  db.run(SCHEMA_SQL);
  // 对老 DB 补齐后加的列（与 Rust 端 ensure_column 等价）
  ensureColumn(db, "tasks", "color", "TEXT");
  ensureColumn(db, "tasks", "review_log", "TEXT");
  // 老的 tasks.doc_url/doc_title 一次性迁移到 task_docs（与 Rust 端等价）
  backfillTaskDocs(db);
  return db;
}

/**
 * 把 tasks.doc_url / doc_title 回填到 task_docs。
 * 仅迁移"该任务尚无任何 task_docs 记录"且 doc_url 非空的行。幂等。
 */
function backfillTaskDocs(database: Database): void {
  database.run(
    `INSERT INTO task_docs (task_id, id, title, url, "order")
     SELECT
        t.id,
        'doc-legacy-' || t.id,
        COALESCE(t.doc_title, ''),
        t.doc_url,
        0
     FROM tasks t
     WHERE t.doc_url IS NOT NULL
       AND TRIM(t.doc_url) <> ''
       AND NOT EXISTS (SELECT 1 FROM task_docs d WHERE d.task_id = t.id)`
  );
}

/**
 * 给已存在的表补缺失列（SQLite 不支持 ALTER TABLE ADD COLUMN IF NOT EXISTS）。
 * 与 src-tauri/src/db.rs 的 ensure_column 函数等价。
 */
function ensureColumn(database: Database, table: string, column: string, decl: string): void {
  const stmt = database.prepare(`PRAGMA table_info(${table})`);
  const names: string[] = [];
  try {
    while (stmt.step()) {
      const row = stmt.getAsObject() as { name?: string };
      if (row.name) names.push(row.name);
    }
  } finally {
    stmt.free();
  }
  if (!names.includes(column)) {
    database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

export function getDb(): Database {
  if (!db) throw new Error("Web SQLite 未初始化，请先调用 initWebDb()");
  return db;
}

/* ────────────────────────────────────────────────────────────
 * 持久化：debounce 200ms，多次写合并为一次序列化
 * ──────────────────────────────────────────────────────────── */

const schedulePersist = debounce(() => {
  if (!db) return;
  const bytes = db.export();
  void idbPut(bytes);
}, 200);

/* ────────────────────────────────────────────────────────────
 * 执行 helper
 * ──────────────────────────────────────────────────────────── */

type Param = string | number | null | Uint8Array;

/** 执行写操作（INSERT/UPDATE/DELETE/DDL），自动触发持久化 */
export function run(sql: string, params: Param[] = []): void {
  getDb().run(sql, params);
  schedulePersist();
}

/** 执行只读查询，返回行对象数组 */
export function query<T = Record<string, unknown>>(
  sql: string,
  params: Param[] = []
): T[] {
  const stmt = getDb().prepare(sql);
  try {
    stmt.bind(params);
    const out: T[] = [];
    while (stmt.step()) {
      out.push(stmt.getAsObject() as T);
    }
    return out;
  } finally {
    stmt.free();
  }
}

/** BEGIN/COMMIT 包裹的事务；fn 内任意 run/query 都自动加入事务 */
export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.run("BEGIN");
  try {
    const result = fn();
    d.run("COMMIT");
    schedulePersist();
    return result;
  } catch (e) {
    d.run("ROLLBACK");
    throw e;
  }
}

/**
 * 清库：把 IndexedDB 里的 db 字节也一并清掉，并新建空库 + 执行 schema。
 * 用于"清空数据"入口。
 */
export async function resetDb(): Promise<void> {
  if (persistTimer) clearTimeout(persistTimer);
  if (db) {
    db.close();
    db = null;
  }
  await idbClear();
  await initWebDb();
}

/* ────────────────────────────────────────────────────────────
 * 备份 / 还原（供 dbBackup.ts 使用）
 * ──────────────────────────────────────────────────────────── */

/** 导出当前 db 的完整字节（SQLite 文件格式）*/
export function exportSqliteBytes(): Uint8Array {
  return getDb().export();
}

/**
 * 用传入字节替换当前 db。
 *
 * 流程：
 *   1. 关闭当前内存中的 db 实例
 *   2. 把字节写回 IndexedDB
 *
 * 调用方负责在替换完成后 location.reload()，让 main.tsx
 * 重新走 initWebDb() 从 IndexedDB 加载新库。
 */
export async function replaceSqliteBytes(bytes: Uint8Array): Promise<void> {
  if (persistTimer) clearTimeout(persistTimer);
  if (db) {
    db.close();
    db = null;
  }
  await idbPut(bytes);
}
