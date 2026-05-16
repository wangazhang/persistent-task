// src/lib/analytics/buffer.ts
import type { AnalyticsEvent } from "./types";

export interface BufferOptions {
  /** 满 threshold 条立即 flush */
  threshold?: number;
  /** 每 intervalMs 检查一次 */
  intervalMs?: number;
  /** 实际写库函数（一次一批，事务里跑） */
  writer: (batch: AnalyticsEvent[]) => Promise<void>;
  /** 命中即立即 flush 的事件类型 */
  criticalTypes?: Set<string>;
  /** writer 连续失败几次后丢弃这批,默认 3 */
  maxRetries?: number;
}

export interface Buffer {
  push(e: AnalyticsEvent): void;
  /** 立刻把当前 buffer 中的事件全部写入 */
  flushNow(): Promise<void>;
  /** 当前队列长度 */
  size(): number;
  /** 关闭定时器 */
  dispose(): void;
}

export function createBuffer(opts: BufferOptions): Buffer {
  const threshold = opts.threshold ?? 50;
  const intervalMs = opts.intervalMs ?? 2000;
  const maxRetries = opts.maxRetries ?? 3;
  const critical = opts.criticalTypes ?? new Set<string>();

  const queue: AnalyticsEvent[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  const ensureTimer = () => {
    if (timer != null) return;
    timer = setInterval(() => {
      if (queue.length > 0) void flushOnce(false);
    }, intervalMs);
    // Node/Deno 下可被 unref;浏览器无此函数
    timer?.unref?.();
  };

  /**
   * 写一次。两种模式：
   *   - exhaustRetries=true（threshold/critical/flushNow）：内联跑满 maxRetries 次,失败后丢弃。
   *   - exhaustRetries=false（interval tick）：单次尝试,失败把整批退回队首,等下次 tick。
   *
   * 已知限制：interval 路径没有跨 tick 的 retry 计数,permanent-fail 的 writer 下队列会增长。
   * 对本应用（本地 SQLite,writer 几乎不会持续失败）可接受;且 critical/threshold 路径会先把队列耗尽。
   */
  async function flushOnce(exhaustRetries: boolean): Promise<void> {
    if (inFlight) return;
    if (queue.length === 0) return;
    inFlight = true;
    const batch = queue.splice(0, queue.length);

    try {
      if (exhaustRetries) {
        // Retry loop: keep trying until success or maxRetries exceeded
        let attempt = 0;
        let lastErr: unknown;
        while (attempt < maxRetries) {
          attempt++;
          try {
            await opts.writer(batch);
            lastErr = undefined;
            break; // success
          } catch (err) {
            lastErr = err;
            if (attempt < maxRetries) {
              if (typeof console !== "undefined") {
                console.warn(
                  `[analytics] flush failed (attempt ${attempt}/${maxRetries}), retrying`,
                  err
                );
              }
              // brief yield between retries
              await new Promise((r) => setTimeout(r, 0));
            }
          }
        }
        if (lastErr !== undefined) {
          if (typeof console !== "undefined") {
            console.error(
              "[analytics] flush failed after retries, dropping batch",
              { dropped: batch.length, err: lastErr }
            );
          }
          // batch is dropped (not re-queued)
        }
      } else {
        // Single attempt for interval-triggered flushes
        try {
          await opts.writer(batch);
        } catch (err) {
          // Re-queue at front for next interval attempt
          queue.unshift(...batch);
          if (typeof console !== "undefined") {
            console.warn("[analytics] flush failed, will retry on next interval", err);
          }
        }
      }
    } finally {
      inFlight = false;
    }
  }

  return {
    push(e) {
      queue.push(e);
      ensureTimer();
      if (critical.has(e.type) || queue.length >= threshold) {
        // 微任务里排空,避免在 push 调用栈里同步抛错
        // exhaustRetries=true: threshold/critical flush retries until drop
        Promise.resolve().then(() => flushOnce(true));
      }
    },
    async flushNow() {
      while (inFlight) {
        await new Promise((r) => setTimeout(r, 0));
      }
      await flushOnce(true);
    },
    size() {
      return queue.length;
    },
    dispose() {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
