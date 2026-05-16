// src/lib/analytics/middleware.ts
import type { StateCreator } from "zustand";
import { track } from "./index";
import type { EventMap } from "./registry";

/**
 * 单个 action 的映射函数。
 *   ret  -- action 的返回值
 *   args -- action 调用参数（数组）
 *   ctx  -- { prev: 调用前 store 切片, next: 调用后 store 切片 }
 *
 * 返回 [type, props][] —— 一次 action 可发多事件,空数组表示不打点。
 */
export type ActionMapper<S, K extends keyof EventMap = keyof EventMap> = (
  ret: unknown,
  args: unknown[],
  ctx: { prev: S; next: S }
) => Array<[K, EventMap[K]]>;

export type ActionMapping<S> = {
  // 用 string 而不是 keyof S,允许写宽松
  [actionName: string]: ActionMapper<S>;
};

export interface WithTrackingOptions {
  /** 测试时注入；默认调 track() */
  sink?: <K extends keyof EventMap>(type: K, props: EventMap[K]) => void;
}

/**
 * Zustand 中间件：拦截 mapping 中列出的 action,执行后 emit 事件。
 *
 * 用法：
 *   create<S>()(withTracking(mapping)((set, get) => ({...})))
 */
export function withTracking<S extends object>(
  mapping: ActionMapping<S>,
  opts: WithTrackingOptions = {}
) {
  const sink = opts.sink ?? ((type, props) => track(type as never, props as never, { source: "auto" }));

  return (initializer: StateCreator<S, [], []>): StateCreator<S, [], []> =>
    (set, get, store) => {
      const baseState = initializer(set, get, store);
      // 遍历 baseState 的方法,凡命中 mapping 的 action 都包一层
      const wrapped: Record<string, unknown> = { ...(baseState as Record<string, unknown>) };
      for (const [name, mapper] of Object.entries(mapping)) {
        const original = (baseState as Record<string, unknown>)[name];
        if (typeof original !== "function") {
          try {
            if ((import.meta as any).env?.DEV) {
              console.warn(`[analytics] action not found in store: ${name}`);
            }
          } catch {}
          continue;
        }
        const fn = original as (...a: unknown[]) => unknown;
        wrapped[name] = (...args: unknown[]) => {
          const prev = get();
          const ret = fn(...args);
          const next = get();
          try {
            const events = mapper(ret, args, { prev, next });
            for (const [type, props] of events) {
              sink(type, props as EventMap[typeof type]);
            }
          } catch (err) {
            try {
              if ((import.meta as any).env?.DEV) {
                console.warn(`[analytics] mapper '${name}' threw`, err);
              }
            } catch {}
          }
          return ret;
        };
      }
      return wrapped as S;
    };
}
