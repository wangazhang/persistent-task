/**
 * 「过期未完成任务」对话框开关 + 今日是否已弹过的状态。
 *
 * 真值来源：
 *   - lastPromptDate 持久化在 localStorage（pastReview.ts 提供 read/write）。
 *   - open 是 UI 临时态，不持久化。
 */

import { create } from "zustand";
import {
  readLastPromptDate,
  writeLastPromptDate,
} from "@/lib/pastReview";
import { isoDate } from "@/lib/utils";

interface PastReviewState {
  open: boolean;
  lastPromptDate: string | null;

  /** 打开对话框（不会自动改 lastPromptDate；后者由 markPromptedToday 控制） */
  openDialog: () => void;
  /** 关闭对话框 */
  closeDialog: () => void;
  /** 记录"今天已经向用户弹过"，避免同一天再次自动弹 */
  markPromptedToday: () => void;
  /** 是否需要在启动 / 跨日时自动弹 */
  shouldAutoPrompt: () => boolean;
}

export const usePastReviewStore = create<PastReviewState>((set, get) => ({
  open: false,
  lastPromptDate: readLastPromptDate(),

  openDialog() {
    set({ open: true });
  },
  closeDialog() {
    set({ open: false });
  },
  markPromptedToday() {
    const today = isoDate();
    writeLastPromptDate(today);
    set({ lastPromptDate: today });
  },
  shouldAutoPrompt() {
    return get().lastPromptDate !== isoDate();
  },
}));
