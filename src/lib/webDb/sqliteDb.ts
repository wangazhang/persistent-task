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

import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
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
  return db;
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
