import { uid } from "../utils";

export interface SessionManager {
  /** 标记一次活动；如距上次活动超过 idleMs 则起新 session */
  touch(): string;
  /** 当前 session id（不更新 lastTouch） */
  current(): string;
}

export interface SessionOptions {
  /** 闲置阈值,默认 30 分钟 */
  idleMs?: number;
  /** 注入时钟,便于测试 */
  now?: () => number;
}

export function createSessionManager(opts: SessionOptions = {}): SessionManager {
  const idleMs = opts.idleMs ?? 30 * 60 * 1000;
  const now = opts.now ?? (() => Date.now());

  let id: string = `s-${uid()}`;
  let last: number = now();

  return {
    touch() {
      const t = now();
      if (t - last > idleMs) {
        id = `s-${uid()}`;
      }
      last = t;
      return id;
    },
    current() {
      return id;
    },
  };
}

/** 全局单例（生产用） */
export const sessionManager: SessionManager = createSessionManager();
