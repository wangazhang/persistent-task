import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";

interface ReasonPromptDialogProps {
  open: boolean;
  /** 标题，例如「今天继续：写周报」*/
  title: string;
  /** 输入框 placeholder */
  placeholder?: string;
  /** 提交按钮文案，例如「确认继续」/「确认挂起」*/
  confirmText: string;
  onCancel: () => void;
  /** 用户确认时回调；reason 为空字符串视作未填写 */
  onConfirm: (reason: string) => void;
}

export function ReasonPromptDialog({
  open,
  title,
  placeholder = "原因（可选）",
  confirmText,
  onCancel,
  onConfirm,
}: ReasonPromptDialogProps) {
  const [reason, setReason] = useState("");

  // 打开时清空，避免与上一次的输入串味
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      widthClass="max-w-sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onConfirm(reason.trim())}
            autoFocus
          >
            {confirmText}
          </button>
        </>
      }
    >
      <textarea
        className="w-full resize-none rounded-md border border-ink-200/70 bg-white px-3 py-2 text-sm text-ink-700 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none"
        rows={3}
        placeholder={placeholder}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Modal>
  );
}
