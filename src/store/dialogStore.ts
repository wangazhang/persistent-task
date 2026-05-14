/**
 * 全局对话框 store + Promise API。
 *
 * 用法：
 *   const ok = await confirm({ title, message, danger: true });
 *   if (!ok) return;
 *   await alert({ title: "校验失败", message: "标题不能为空" });
 *
 * 设计：
 *   - 只支持单实例对话框（同一时刻只显示一个），符合本应用的"小弹窗"场景。
 *   - 后来的 confirm/alert 调用会替换前一个未关闭的对话框，并以 false / void 解决前者。
 *     这避免了对话框"叠盘子"——但也意味着调用方不应该不 await 直接连开多个。
 */

import { create } from "zustand";

export interface DialogOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作（删除等）：确定按钮用红色 */
  danger?: boolean;
}

interface DialogState extends Partial<DialogOptions> {
  open: boolean;
  showCancel: boolean;
  resolver: ((ok: boolean) => void) | null;
}

interface DialogActions {
  /** 内部：UI 点击确定/取消时关闭并 resolve */
  resolve: (ok: boolean) => void;
}

export const useDialogStore = create<DialogState & DialogActions>((set, get) => ({
  open: false,
  showCancel: true,
  resolver: null,

  resolve(ok) {
    const r = get().resolver;
    set({ open: false, resolver: null });
    r?.(ok);
  },
}));

function openDialog(
  opts: DialogOptions,
  showCancel: boolean
): Promise<boolean> {
  return new Promise((resolve) => {
    // 替换语义：若有未关闭对话框，先以 false 解决它
    const prev = useDialogStore.getState().resolver;
    if (prev) prev(false);
    useDialogStore.setState({
      open: true,
      showCancel,
      resolver: resolve,
      title: opts.title,
      message: opts.message,
      confirmText: opts.confirmText,
      cancelText: opts.cancelText,
      danger: opts.danger,
    });
  });
}

/** 询问确认；true=用户点了确定，false=取消/关闭/被新对话框替代 */
export function confirm(opts: DialogOptions): Promise<boolean> {
  return openDialog(opts, true);
}

/** 显示提示信息（只有确定按钮）。返回的 Promise 在用户关闭时 resolve。 */
export function alert(opts: DialogOptions): Promise<void> {
  return openDialog(opts, false).then(() => undefined);
}
