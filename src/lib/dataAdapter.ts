/**
 * 数据访问抽象层。
 *
 * 两种实现：
 *   - LocalStorageAdapter：浏览器 dev 模式用，数据落 localStorage（key 三件套）
 *   - TauriAdapter：桌面端用，通过 invoke() 调 Rust commands，数据落 SQLite
 *
 * 两者方法签名一致，store 与组件无需关心当前在哪。
 * isTauri() 在启动时一次决断：window.__TAURI_INTERNALS__ 存在 → 桌面端。
 */

import type {
  PomodoroSession,
  Tag,
  Task,
} from "./types";

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

  /**
   * 清空全部用户数据（用于「重置 demo」入口）。
   * 调用方紧接着会 location.reload()，触发 store.hydrate() 重新种 mock。
   */
  clearAll(): Promise<void>;
}

/**
 * 检测是否运行在 Tauri 环境。
 *
 * 当 window.__TAURI_INTERNALS__ 存在时，说明 webview 由 Tauri 提供。
 * 在 Web 浏览器中开发时，会回落到 mock。
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
    // 按需 import，避免 web 模式打包时拉入 tauri runtime
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }

  listTasks() {
    return this.invoke<Task[]>("list_tasks");
  }
  upsertTask(task: Task) {
    return this.invoke<void>("upsert_task", { task });
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

  clearAll() {
    return this.invoke<void>("clear_all");
  }
}

/** 浏览器/开发环境用的 mock 适配器，使用 localStorage 持久化 */
class LocalStorageAdapter implements DataAdapter {
  private TASKS_KEY = "pt:tasks";
  private TAGS_KEY = "pt:tags";
  private POMOS_KEY = "pt:pomos";

  private read<T>(key: string): T[] {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T[]) : [];
    } catch {
      return [];
    }
  }
  private write<T>(key: string, value: T[]) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  async listTasks() {
    return this.read<Task>(this.TASKS_KEY);
  }
  async upsertTask(task: Task) {
    const list = this.read<Task>(this.TASKS_KEY);
    const idx = list.findIndex((t) => t.id === task.id);
    if (idx >= 0) list[idx] = task;
    else list.push(task);
    this.write(this.TASKS_KEY, list);
  }
  async deleteTask(id: string) {
    const list = this.read<Task>(this.TASKS_KEY).filter((t) => t.id !== id);
    this.write(this.TASKS_KEY, list);
  }
  async listTags() {
    return this.read<Tag>(this.TAGS_KEY);
  }
  async upsertTag(tag: Tag) {
    const list = this.read<Tag>(this.TAGS_KEY);
    const idx = list.findIndex((t) => t.id === tag.id);
    if (idx >= 0) list[idx] = tag;
    else list.push(tag);
    this.write(this.TAGS_KEY, list);
  }
  async deleteTag(id: string) {
    const list = this.read<Tag>(this.TAGS_KEY).filter((t) => t.id !== id);
    this.write(this.TAGS_KEY, list);
  }
  async listPomodoros() {
    return this.read<PomodoroSession>(this.POMOS_KEY);
  }
  async insertPomodoro(s: PomodoroSession) {
    const list = this.read<PomodoroSession>(this.POMOS_KEY);
    list.push(s);
    this.write(this.POMOS_KEY, list);
  }
  async clearAll() {
    try {
      localStorage.removeItem(this.TASKS_KEY);
      localStorage.removeItem(this.TAGS_KEY);
      localStorage.removeItem(this.POMOS_KEY);
    } catch {
      /* ignore */
    }
  }
}

let _adapter: DataAdapter | null = null;

export function getAdapter(): DataAdapter {
  if (_adapter) return _adapter;
  _adapter = isTauri() ? new TauriAdapter() : new LocalStorageAdapter();
  return _adapter;
}
