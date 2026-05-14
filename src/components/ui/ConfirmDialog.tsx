import { useEffect } from "react";
import { Modal } from "./Modal";
import { useDialogStore } from "@/store/dialogStore";
import { cn } from "@/lib/utils";

/**
 * 全局 ConfirmDialog —— 由 dialogStore 驱动，全应用只渲染一次（在 App.tsx 根布局）。
 *
 * 键盘：Esc 取消（由 Modal 提供）；回车确定。
 */
export function ConfirmDialog() {
  const open = useDialogStore((s) => s.open);
  const title = useDialogStore((s) => s.title);
  const message = useDialogStore((s) => s.message);
  const confirmText = useDialogStore((s) => s.confirmText);
  const cancelText = useDialogStore((s) => s.cancelText);
  const danger = useDialogStore((s) => s.danger);
  const showCancel = useDialogStore((s) => s.showCancel);
  const resolve = useDialogStore((s) => s.resolve);

  // 回车 = 确定
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        resolve(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, resolve]);

  return (
    <Modal
      open={open}
      onClose={() => resolve(false)}
      title={title ?? ""}
      widthClass="max-w-md"
      footer={
        <>
          {showCancel && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => resolve(false)}
            >
              {cancelText ?? "取消"}
            </button>
          )}
          <button
            type="button"
            className={cn(
              "btn-primary",
              danger && "!bg-rose-600 hover:!bg-rose-700"
            )}
            onClick={() => resolve(true)}
            autoFocus
          >
            {confirmText ?? "确定"}
          </button>
        </>
      }
    >
      <p className="whitespace-pre-line text-sm text-ink-700">{message}</p>
    </Modal>
  );
}
