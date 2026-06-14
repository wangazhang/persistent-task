/**
 * AI 快速录入：把确认态的草稿编排成具体的"建标签 + 加任务"指令。
 *
 * 这一步是纯计算（不触碰 store / adapter），把以下三件事原子化：
 *   1. 多张卡片命中同一个新标签名时，只新建一次（dedup by name）
 *   2. 已存在同名标签时，复用现有 id 而不是建重名
 *   3. 每张卡片的 tagIds = matchedTagIds ∪（自己勾选的新标签建出来的 id）
 *
 * 拆出来的目的：main 侧 commit 监听器只是按这里编出的指令执行 addTag / addTask；
 * 这层逻辑不依赖运行时（store / 网络），完全可单测。
 */

import type { QuickRecordCommitDraft } from "./quickRecordBridge";
import type { Tag, TaskPriority } from "./types";

/** 已经存在的标签快照（仅 id + name，按 name 不区分大小写匹配） */
export type ExistingTagLite = Pick<Tag, "id" | "name">;

/** 一条新建标签的指令 */
export interface NewTagInstruction {
  /** 用调用方提供的 id 工厂生成（例如 uid("tag-")），保持创建顺序稳定 */
  id: string;
  name: string;
}

/** 一条新建任务的指令（已合并完 tagIds） */
export interface CreateTaskInstruction {
  title: string;
  description: string;
  priority: TaskPriority;
  scheduledDates: string[];
  /** 已合并：matchedTagIds + 该卡片勾选的新标签对应的 id */
  tagIds: string[];
}

export interface CommitPlan {
  newTags: NewTagInstruction[];
  tasks: CreateTaskInstruction[];
}

/**
 * 把用户确认的草稿编排成可执行计划。
 *
 * @param drafts       用户勾选并确认的草稿列表（小窗已过滤掉未勾选的）
 * @param existingTags 当前 main 侧的全量标签快照
 * @param mintId       生成新 tag id 的工厂（注入便于测试 / main 用 uid("tag-")）
 */
export function planCommit(
  drafts: QuickRecordCommitDraft[],
  existingTags: ExistingTagLite[],
  mintId: () => string
): CommitPlan {
  const norm = (s: string) => s.trim().toLowerCase();

  // 已有标签：name(规范化) → id；同名只取第一条
  const existingByName = new Map<string, string>();
  for (const t of existingTags) {
    const k = norm(t.name);
    if (!existingByName.has(k)) existingByName.set(k, t.id);
  }

  // 本批新建：name(规范化) → 指令；保留首次出现的写法
  const minted = new Map<string, NewTagInstruction>();
  const newTags: NewTagInstruction[] = [];

  const tasks: CreateTaskInstruction[] = drafts.map((d) => {
    const tagIds: string[] = [];
    for (const id of d.matchedTagIds) tagIds.push(id);

    for (const rawName of d.selectedNewTagNames) {
      const name = rawName.trim();
      if (!name) continue;
      const k = norm(name);

      // 已有同名 → 复用
      const existingId = existingByName.get(k);
      if (existingId) {
        if (!tagIds.includes(existingId)) tagIds.push(existingId);
        continue;
      }

      // 本批已建 → 复用
      const already = minted.get(k);
      if (already) {
        if (!tagIds.includes(already.id)) tagIds.push(already.id);
        continue;
      }

      // 真新建
      const instr: NewTagInstruction = { id: mintId(), name };
      minted.set(k, instr);
      newTags.push(instr);
      tagIds.push(instr.id);
    }

    return {
      title: d.title,
      description: d.description,
      priority: d.priority,
      scheduledDates: d.scheduledDates,
      tagIds,
    };
  });

  return { newTags, tasks };
}
