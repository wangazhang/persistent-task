/**
 * 数据访问抽象层。
 *
 * 两种实现：
 *   - TauriAdapter：桌面端用，通过 invoke() 调 Rust commands，数据落本地 SQLite 文件。
 *   - SqliteAdapter：Web 端用，sql.js + IndexedDB，整库序列化持久化。
 *
 * 两端 schema、SQL 语义完全对齐（详见 src/lib/webDb/schema.ts 与 src-tauri/src/db.rs）。
 *
 * 调用约定：
 *   1. 启动时必须 await initAdapter() 完成初始化（main.tsx 已处理）。
 *   2. 之后任意位置 getAdapter() 即可拿到已就绪的实例。
 */

import type {
  PomodoroSession,
  Tag,
  Task,
} from "./types";
import { parseReviewLog, serializeReviewLog } from "./reviewLog";
import type {
  AnalyticsEvent,
  EventCountRow,
  EventFilter,
  EventGroupBy,
} from "./analytics/types";

export interface DataAdapter {
  // tasks
  listTasks(): Promise<Task[]>;
  upsertTask(task: Task): Promise<void>;
  deleteTask(id: string): Promise<void>;

  // tags
  listTags(): Promise<Tag[]>;
  upsertTag(tag: Tag): Promise<void>;
  deleteTag(id: string): Promise<void>;

  // pomodoros
  listPomodoros(): Promise<PomodoroSession[]>;
  insertPomodoro(s: PomodoroSession): Promise<void>;
  deletePomodoro(id: string): Promise<void>;

  /** 清空全部用户数据 */
  clearAll(): Promise<void>;

  /** 导出整库为 SQLite 字节流（备份） */
  exportDb(): Promise<Uint8Array>;
  /** 用传入字节流覆盖整库；返回后调用方应 location.reload() 让前端 re-hydrate */
  replaceDb(bytes: Uint8Array): Promise<void>;

  // events
  insertEvents(events: AnalyticsEvent[]): Promise<void>;
  queryEvents(filter: EventFilter): Promise<AnalyticsEvent[]>;
  countEvents(
    filter: EventFilter,
    groupBy: EventGroupBy
  ): Promise<EventCountRow[]>;
}

/**
 * 检测是否运行在 Tauri 环境。
 *
 * 当 window.__TAURI_INTERNALS__ 存在时，说明 webview 由 Tauri 提供。
 */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    // @ts-expect-error tauri 注入的内部对象
    typeof window.__TAURI_INTERNALS__ !== "undefined"
  );
}

/**
 * Tauri 适配器：通过 @tauri-apps/api 的 invoke 调 Rust commands。
 *
 * 字段命名约定：
 *   - 命令名 = Rust 函数名（snake_case）
 *   - 命令参数名 = Rust 函数参数名（task / tag / pomodoro / id）
 *   - 实体内字段 = camelCase（由 #[serde(rename_all = "camelCase")] 保证）
 */
class TauriAdapter implements DataAdapter {
  private async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }

  async listTasks() {
    const tasks = await this.invoke<Task[]>("list_tasks");
    // Rust 端 review_log 是 Option<String>（JSON 字符串），转回结构化数组
    return tasks.map((t) => ({
      ...t,
      reviewLog: parseReviewLog((t as { reviewLog?: unknown }).reviewLog),
    }));
  }
  upsertTask(task: Task) {
    // Rust 端 review_log 期望 Option<String>，必须先把数组序列化成 JSON 字符串，
    // 否则带 reviewLog 的 upsert 会反序列化失败并静默丢弃。
    const payload = { ...task, reviewLog: serializeReviewLog(task.reviewLog) };
    return this.invoke<void>("upsert_task", { task: payload });
  }
  deleteTask(id: string) {
    return this.invoke<void>("delete_task", { id });
  }

  listTags() {
    return this.invoke<Tag[]>("list_tags");
  }
  upsertTag(tag: Tag) {
    return this.invoke<void>("upsert_tag", { tag });
  }
  deleteTag(id: string) {
    return this.invoke<void>("delete_tag", { id });
  }

  listPomodoros() {
    return this.invoke<PomodoroSession[]>("list_pomodoros");
  }
  insertPomodoro(pomodoro: PomodoroSession) {
    return this.invoke<void>("insert_pomodoro", { pomodoro });
  }
  deletePomodoro(id: string) {
    return this.invoke<void>("delete_pomodoro", { id });
  }

  clearAll() {
    return this.invoke<void>("clear_all");
  }

  async exportDb() {
    // Tauri 命令通过 IPC 把 Vec<u8> 序列化为 number[] 返回。
    // 个人任务数据量不大（典型 < 10MB），JSON 编码可接受。
    const arr = await this.invoke<number[]>("export_db");
    return new Uint8Array(arr);
  }
  replaceDb(bytes: Uint8Array) {
    // Uint8Array → number[] 走 JSON 走 IPC。同上，量级可接受。
    return this.invoke<void>("replace_db", { bytes: Array.from(bytes) });
  }

  insertEvents(events: AnalyticsEvent[]) {
    return this.invoke<void>("insert_events", { events });
  }
  queryEvents(filter: EventFilter) {
    return this.invoke<AnalyticsEvent[]>("query_events", { filter });
  }
  countEvents(filter: EventFilter, groupBy: EventGroupBy) {
    return this.invoke<EventCountRow[]>("count_events", { filter, groupBy });
  }
}

let _adapter: DataAdapter | null = null;
let _initPromise: Promise<void> | null = null;

/**
 * 异步初始化 adapter。Web 端会加载 sql.js wasm + 从 IndexedDB 恢复 DB；
 * 桌面端直接构造 TauriAdapter（底层 SQLite 已在 Rust 的 setup 钩子里就绪）。
 *
 * Idempotent：重复调用返回同一个 promise。
 */
export function initAdapter(): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    if (isTauri()) {
      _adapter = new TauriAdapter();
    } else {
      const [{ SqliteAdapter }, { initWebDb }] = await Promise.all([
        import("./webDb/sqliteAdapter"),
        import("./webDb/sqliteDb"),
      ]);
      await initWebDb();
      _adapter = new SqliteAdapter();
    }
  })();
  return _initPromise;
}

/**
 * 拿到 adapter 实例。要求调用前 initAdapter() 已 await 完成。
 */
export function getAdapter(): DataAdapter {
  if (!_adapter) {
    throw new Error(
      "数据层尚未初始化：请在 main.tsx 入口处先 await initAdapter()"
    );
  }
  return _adapter;
}
