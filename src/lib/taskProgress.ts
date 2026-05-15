/**
 * 从任务描述（markdown）解析子任务进度。
 *
 * 约定：子任务用 GFM 任务列表写法
 *   - [ ] 待办子任务
 *   - [x] 已完成子任务
 *
 * 同行只要前导（任意 whitespace + `-` / `*` / `+`）+ `[ ]` 或 `[x]`
 * 就算一个子任务。其它普通段落不参与计数。
 */

export interface TaskProgress {
  done: number;
  total: number;
  percent: number; // 0-100，四舍五入
}

// 匹配「行首可有空白；- / * / + 任一作为列表标记；后跟空格；
//   接 [ ] 或 [x]（大小写都接受）」
const TASK_LINE_RE = /^[ \t]*[-*+][ \t]+\[([ xX])\]/gm;

/**
 * 解析 markdown 中的子任务进度。
 * - 没有子任务返回 null（调用方据此决定是否显示进度环）
 * - 否则返回 { done, total, percent }
 */
export function parseTaskProgress(md: string | undefined): TaskProgress | null {
  if (!md) return null;
  let total = 0;
  let done = 0;
  TASK_LINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TASK_LINE_RE.exec(md)) !== null) {
    total++;
    if (m[1] === "x" || m[1] === "X") done++;
  }
  if (total === 0) return null;
  return {
    done,
    total,
    percent: Math.round((done / total) * 100),
  };
}
