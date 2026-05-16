/**
 * 任务列表「单栏 / 双栏」显示偏好。
 *
 * 用 localStorage + 自定义 storage 事件做轻量同步：
 *   - 同一窗口内多个组件实时联动（手动派发 storage 事件）
 *   - 浏览器多标签页之间也会跟随系统的 storage 事件
 *
 * 仅影响 TaskCard 列表容器的 grid 列数，不动单卡内部结构。
 */

import { useEffect, useState } from "react";

export type ListColumns = 1 | 2;

const LS_KEY = "task.list.columns";
const EVENT_NAME = "task-list-columns-change";

function read(): ListColumns {
  if (typeof window === "undefined") return 1;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw === "2") return 2;
    return 1;
  } catch {
    return 1;
  }
}

function write(v: ListColumns) {
  try {
    localStorage.setItem(LS_KEY, String(v));
  } catch {
    // 忽略：隐私模式 / 配额满
  }
  window.dispatchEvent(new CustomEvent<ListColumns>(EVENT_NAME, { detail: v }));
}

export function useListColumns(): [ListColumns, (v: ListColumns) => void] {
  const [cols, setCols] = useState<ListColumns>(read);

  useEffect(() => {
    function onCustom(e: Event) {
      const detail = (e as CustomEvent<ListColumns>).detail;
      if (detail === 1 || detail === 2) setCols(detail);
    }
    function onStorage(e: StorageEvent) {
      if (e.key === LS_KEY) setCols(read());
    }
    window.addEventListener(EVENT_NAME, onCustom as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT_NAME, onCustom as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return [cols, write];
}

/** 给定列数返回对应的 Tailwind grid class（1 列时仍用 grid 保证间距一致）*/
export function listColumnsClass(cols: ListColumns): string {
  return cols === 2
    ? "grid grid-cols-1 gap-2 md:grid-cols-2"
    : "grid grid-cols-1 gap-2";
}
