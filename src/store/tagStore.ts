import { create } from "zustand";
import { getAdapter } from "@/lib/dataAdapter";
import type { Tag, TagNode } from "@/lib/types";
import { uid } from "@/lib/utils";
import { withTracking, type ActionMapping } from "@/lib/analytics/middleware";

interface TagStoreState {
  tags: Tag[];
  hydrated: boolean;

  hydrate: () => Promise<void>;

  addTag: (partial: Partial<Tag> & Pick<Tag, "name">) => Tag;
  updateTag: (id: string, patch: Partial<Tag>) => void;
  /** 删除标签会同时删除其所有后代（任务上的引用由调用方处理）*/
  deleteTagCascade: (id: string) => string[];

  buildTree: () => TagNode[];
  /** 返回标签 + 全部后代 id（含自身）*/
  collectDescendants: (id: string) => string[];
  /** 标签 id → 标签快速查找 */
  byId: () => Map<string, Tag>;
  /**
   * 移动标签到指定父节点的指定位置（dnd 拖拽落点用）。
   *
   * @param tagId       被移动的标签
   * @param newParentId 新父节点 id（null 表示根级）
   * @param newIndex    在新父节点的子序列中插入到第几位（含被移动节点本身计数）。
   *                    传入 number > 该层节点数视为追加到末尾。
   *
   * 内部会做：
   *   - 循环引用检测：禁止把节点拖到自己的子孙之内（含自身）
   *   - 同层 order 紧凑重排（0,1,2,…）
   *   - 持久化所有受影响节点
   *
   * @returns true 表示移动成功，false 表示被循环检测拒绝
   */
  moveTag: (tagId: string, newParentId: string | null, newIndex: number) => boolean;
}

const tagTrackingMapping: ActionMapping<TagStoreState> = {
  addTag: (ret) => {
    const t = ret as Tag;
    return [["tag.created", { tagId: t.id, parentId: t.parentId ?? null, color: t.color }]];
  },
  updateTag: (_ret, args) => {
    const [id, patch] = args as [string, Partial<Tag>];
    if (patch.name !== undefined) return [["tag.renamed", { tagId: id }]];
    return [];
  },
  deleteTagCascade: (ret, args) => {
    const [id] = args as [string];
    const removed = ret as string[];
    return [["tag.deleted", { tagId: id, cascadeCount: removed.length }]];
  },
  moveTag: (_ret, args) => {
    const [tagId, newParentId] = args as [string, string | null, number];
    return [["tag.moved", { tagId, newParentId: newParentId ?? null }]];
  },
};

function persistTag(t: Tag) {
  void getAdapter().upsertTag(t);
}
function persistDelete(id: string) {
  void getAdapter().deleteTag(id);
}

export const useTagStore = create<TagStoreState>()(
  withTracking(tagTrackingMapping)((set, get) => ({
  tags: [],
  hydrated: false,

  async hydrate() {
    if (get().hydrated) return;
    const adapter = getAdapter();
    const tags = await adapter.listTags();
    set({ tags, hydrated: true });
  },

  addTag(partial) {
    const tag: Tag = {
      id: uid("tag-"),
      name: partial.name,
      parentId: partial.parentId ?? null,
      color: partial.color ?? "#6366f1",
      order:
        partial.order ??
        get().tags.filter((t) => t.parentId === (partial.parentId ?? null))
          .length,
    };
    set((s) => ({ tags: [...s.tags, tag] }));
    persistTag(tag);
    return tag;
  },

  updateTag(id, patch) {
    set((s) => {
      const next = s.tags.map((t) => (t.id === id ? { ...t, ...patch } : t));
      const updated = next.find((t) => t.id === id);
      if (updated) persistTag(updated);
      return { tags: next };
    });
  },

  deleteTagCascade(id) {
    const ids = get().collectDescendants(id);
    set((s) => ({ tags: s.tags.filter((t) => !ids.includes(t.id)) }));
    ids.forEach(persistDelete);
    return ids;
  },

  buildTree() {
    const tags = get().tags;
    const map = new Map<string, TagNode>();
    tags.forEach((t) => map.set(t.id, { ...t, children: [] }));
    const roots: TagNode[] = [];
    map.forEach((node) => {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });
    const sortRecursive = (nodes: TagNode[]) => {
      nodes.sort((a, b) => a.order - b.order);
      nodes.forEach((n) => sortRecursive(n.children));
    };
    sortRecursive(roots);
    return roots;
  },

  collectDescendants(id) {
    const tags = get().tags;
    const result: string[] = [id];
    let queue = [id];
    while (queue.length) {
      const next: string[] = [];
      for (const pid of queue) {
        for (const t of tags) {
          if (t.parentId === pid) {
            result.push(t.id);
            next.push(t.id);
          }
        }
      }
      queue = next;
    }
    return result;
  },

  byId() {
    return new Map(get().tags.map((t) => [t.id, t]));
  },

  moveTag(tagId, newParentId, newIndex) {
    const target = get().tags.find((t) => t.id === tagId);
    if (!target) return false;
    // 循环检测：新父节点不能是被移动节点本身或其后代
    const forbidden = new Set(get().collectDescendants(tagId));
    if (newParentId !== null && forbidden.has(newParentId)) return false;

    set((s) => {
      // 同层节点（去掉被移动节点本身），按当前 order 排好
      const sameParent = s.tags
        .filter((t) => t.parentId === newParentId && t.id !== tagId)
        .sort((a, b) => a.order - b.order);

      // 在新位置插入
      const moved: Tag = { ...target, parentId: newParentId };
      const clamped = Math.max(0, Math.min(newIndex, sameParent.length));
      const reordered = [
        ...sameParent.slice(0, clamped),
        moved,
        ...sameParent.slice(clamped),
      ];

      // 重写所有受影响节点的 order
      const orderMap = new Map<string, number>();
      reordered.forEach((t, i) => orderMap.set(t.id, i));

      // 如果原父节点和新父节点不同，原父节点下的兄弟也要紧凑重排
      const fromParent = target.parentId;
      const fromSameParent =
        fromParent !== newParentId
          ? s.tags
              .filter((t) => t.parentId === fromParent && t.id !== tagId)
              .sort((a, b) => a.order - b.order)
          : [];
      const fromOrderMap = new Map<string, number>();
      fromSameParent.forEach((t, i) => fromOrderMap.set(t.id, i));

      const next = s.tags.map((t) => {
        if (t.id === tagId) {
          const updated: Tag = {
            ...t,
            parentId: newParentId,
            order: orderMap.get(tagId) ?? 0,
          };
          persistTag(updated);
          return updated;
        }
        if (orderMap.has(t.id) && t.order !== orderMap.get(t.id)) {
          const updated = { ...t, order: orderMap.get(t.id)! };
          persistTag(updated);
          return updated;
        }
        if (fromOrderMap.has(t.id) && t.order !== fromOrderMap.get(t.id)) {
          const updated = { ...t, order: fromOrderMap.get(t.id)! };
          persistTag(updated);
          return updated;
        }
        return t;
      });
      return { tags: next };
    });
    return true;
  },
})));
