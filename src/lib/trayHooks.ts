/**
 * 托盘 popup 通用 hook，统一三个易错的设计点：
 *   1) listenTrayState 注册先于 requestTrayStateRefresh 调用
 *   2) request 失败用 retry（应对 listener 注册晚于 主窗口 emit 的 race）
 *   3) 防御非法 snapshot（null / 空对象）覆盖本地数据
 *
 * 同时管"popup 窗口透明背景"副作用，避免两个 popup 各抄一份。
 */

import { useEffect } from "react";
import { useTrayPopupStore } from "@/store/trayStore";
import { listenTrayState, requestTrayStateRefresh } from "./trayBridge";

/** popup 启动后 retry request 的节奏 ms */
const RETRY_TIMINGS = [0, 200, 500, 1000];

export function useTraySnapshot(tag: string) {
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    let gotState = false;

    (async () => {
      // ① 先注册 listener，再请求 → 保证 listener 总是就位
      cleanup = await listenTrayState((snap) => {
        if (disposed) return;
        if (!snap || typeof snap !== "object" || !("todayTasks" in snap)) {
          console.warn(`[${tag}] ignore invalid snapshot`, snap);
          return;
        }
        gotState = true;
        useTrayPopupStore.getState().setSnapshot(snap);
      });

      // ② retry 节奏请求，直到拿到 state（或者跑完所有 retry 还没有就放弃）
      for (const delay of RETRY_TIMINGS) {
        if (disposed || gotState) return;
        if (delay > 0) await sleep(delay);
        if (disposed || gotState) return;
        await requestTrayStateRefresh();
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** popup 窗口需要透明 body 才能露出圆角阴影 */
export function useTransparentBody() {
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    return () => {
      document.body.style.background = prev;
    };
  }, []);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
