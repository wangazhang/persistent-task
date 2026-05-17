import type { Tag } from "../lib/types";

export interface ActiveTagDrag {
  tagId: string;
  tag: Tag;
  descendantIds: Set<string>;
}

export interface AdjustedGapMove {
  movedId: string;
  parentId: string | null;
  newIndex: number;
}

export function createActiveTagDrag(
  tag: Tag,
  descendantIds: string[]
): ActiveTagDrag {
  return {
    tagId: tag.id,
    tag,
    descendantIds: new Set(descendantIds),
  };
}

export function isInvalidIntoTarget(
  activeDrag: ActiveTagDrag | null,
  targetTagId: string
): boolean {
  return activeDrag
    ? activeDrag.tagId === targetTagId || activeDrag.descendantIds.has(targetTagId)
    : false;
}

export function isInvalidGapTarget(
  activeDrag: ActiveTagDrag | null,
  parentId: string | null
): boolean {
  return activeDrag
    ? parentId !== null &&
        (activeDrag.tagId === parentId || activeDrag.descendantIds.has(parentId))
    : false;
}

export function adjustGapIndex(
  tags: Tag[],
  movedId: string,
  parentId: string | null,
  index: number
): AdjustedGapMove | null {
  const target = tags.find((t) => t.id === movedId);
  if (!target) return null;

  let newIndex = index;
  if (target.parentId === parentId) {
    const siblings = tags
      .filter((t) => t.parentId === parentId)
      .sort((a, b) => a.order - b.order);
    const oldIndex = siblings.findIndex((t) => t.id === movedId);
    if (oldIndex >= 0 && oldIndex < index) newIndex = index - 1;
  }

  return { movedId, parentId, newIndex };
}
