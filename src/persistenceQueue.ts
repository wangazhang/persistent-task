let tail: Promise<void> = Promise.resolve();
let pendingError: unknown = null;

/**
 * 串行化持久化写入，避免同一时刻多个异步写操作交错。
 *
 * store 侧仍保持同步 UI 更新；这里只负责把真正的 DB 写入排队。
 */
export function enqueuePersist(op: () => Promise<void>): Promise<void> {
  const next = tail.then(op, op);
  tail = next.then(
    () => undefined,
    (err) => {
      pendingError = err;
      console.error("[persist] write failed:", err);
      return undefined;
    }
  );
  return next.catch(() => undefined);
}

/** 等待当前排队的持久化写入全部完成。 */
export async function flushPersistQueue(): Promise<void> {
  await tail;
  if (pendingError) {
    const err = pendingError;
    pendingError = null;
    throw err;
  }
}
