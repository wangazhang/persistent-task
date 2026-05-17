# Tag Drag Placeholder Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the Tags page drag experience with an equal-height placeholder preview, drag overlay, and illegal-target feedback.

**Architecture:** Keep the existing `@dnd-kit/core` implementation and `tagStore.moveTag` persistence path. Extract pure drag helper logic into a small testable module, then update `Tags.tsx` to track active drag state, render a `DragOverlay`, and replace thin gap feedback with placeholder blocks.

**Tech Stack:** React 18, TypeScript, `@dnd-kit/core`, Tailwind CSS, existing `npx tsx` script-style tests, `npm run build`.

---

## File Structure

- Create: `src/routes/tagDragHelpers.ts`
  - Owns pure drag state helpers and same-parent index adjustment.
  - No React imports.
- Create: `src/routes/__tagDragHelpers.test.ts`
  - Script-style assertions matching the repo's current test pattern.
- Modify: `src/routes/Tags.tsx`
  - Adds `DragOverlay`, `onDragStart`, `onDragCancel`, active drag state, placeholder UI, invalid target feedback, and helper integration.

Do not modify `src/store/tagStore.ts`. Its cycle protection and persistence remain the final data safety boundary.

---

### Task 1: Add Pure Drag Helpers

**Files:**
- Create: `src/routes/tagDragHelpers.ts`
- Test: `src/routes/__tagDragHelpers.test.ts`

- [ ] **Step 1: Write the failing helper test**

Create `src/routes/__tagDragHelpers.test.ts` with this exact content:

```ts
// 用法：npx tsx src/routes/__tagDragHelpers.test.ts
import type { Tag } from "../lib/types";
import {
  adjustGapIndex,
  createActiveTagDrag,
  isInvalidGapTarget,
  isInvalidIntoTarget,
} from "./tagDragHelpers";

let fail = 0;

function eq<T>(label: string, got: T, expect: T) {
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) {
    console.log("  got:   ", got);
    console.log("  expect:", expect);
    fail++;
  }
}

function makeTag(
  id: string,
  parentId: string | null,
  order: number,
  name = id
): Tag {
  return {
    id,
    name,
    parentId,
    order,
    color: "#6366f1",
  };
}

const tags: Tag[] = [
  makeTag("root-a", null, 0),
  makeTag("root-b", null, 1),
  makeTag("root-c", null, 2),
  makeTag("child-a", "root-a", 0),
  makeTag("child-b", "root-a", 1),
  makeTag("grandchild-a", "child-a", 0),
];

const active = createActiveTagDrag(tags[0], [
  "root-a",
  "child-a",
  "child-b",
  "grandchild-a",
]);

eq(
  "createActiveTagDrag caches blocked ids",
  [...active.descendantIds].sort(),
  ["child-a", "child-b", "grandchild-a", "root-a"]
);

eq("null active allows into target", isInvalidIntoTarget(null, "root-b"), false);
eq("self is invalid into target", isInvalidIntoTarget(active, "root-a"), true);
eq("descendant is invalid into target", isInvalidIntoTarget(active, "child-a"), true);
eq("unrelated tag is valid into target", isInvalidIntoTarget(active, "root-b"), false);

eq("root gap is valid", isInvalidGapTarget(active, null), false);
eq("descendant parent gap is invalid", isInvalidGapTarget(active, "child-a"), true);
eq("unrelated parent gap is valid", isInvalidGapTarget(active, "root-b"), false);

eq(
  "same parent downward index adjusts after removing active item",
  adjustGapIndex(tags, "root-a", null, 3),
  { movedId: "root-a", parentId: null, newIndex: 2 }
);

eq(
  "same parent upward index stays unchanged",
  adjustGapIndex(tags, "root-c", null, 1),
  { movedId: "root-c", parentId: null, newIndex: 1 }
);

eq(
  "cross parent index stays unchanged",
  adjustGapIndex(tags, "child-a", null, 1),
  { movedId: "child-a", parentId: null, newIndex: 1 }
);

eq("missing moved tag returns null", adjustGapIndex(tags, "missing", null, 1), null);

if (fail > 0) {
  console.log(`\n${fail} 项失败`);
  process.exit(1);
}

console.log("\n全部通过");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx tsx src/routes/__tagDragHelpers.test.ts
```

Expected: FAIL with a module resolution error for `./tagDragHelpers`.

- [ ] **Step 3: Create the helper module**

Create `src/routes/tagDragHelpers.ts` with this exact content:

```ts
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
  return activeDrag ? activeDrag.descendantIds.has(targetTagId) : false;
}

export function isInvalidGapTarget(
  activeDrag: ActiveTagDrag | null,
  parentId: string | null
): boolean {
  return activeDrag ? parentId !== null && activeDrag.descendantIds.has(parentId) : false;
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
```

- [ ] **Step 4: Run the helper test**

Run:

```bash
npx tsx src/routes/__tagDragHelpers.test.ts
```

Expected: PASS and prints `全部通过`.

- [ ] **Step 5: Build**

Run:

```bash
npm run build
```

Expected: PASS. If this fails because unrelated dirty worktree files do not build, record the error and continue only after confirming whether the failure is related to this task.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/routes/tagDragHelpers.ts src/routes/__tagDragHelpers.test.ts
git commit -m "test(tags): cover tag drag helper logic"
```

Expected: one commit containing only the new helper and test files.

---

### Task 2: Add Active Drag State And Safe Drop Handling

**Files:**
- Modify: `src/routes/Tags.tsx`
- Uses: `src/routes/tagDragHelpers.ts`

- [ ] **Step 1: Update imports**

In `src/routes/Tags.tsx`, replace the `@dnd-kit/core` import block with:

```ts
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
```

Add this import after `PRESET_COLORS`:

```ts
import {
  adjustGapIndex,
  createActiveTagDrag,
  isInvalidGapTarget,
  isInvalidIntoTarget,
  type ActiveTagDrag,
} from "./tagDragHelpers";
```

- [ ] **Step 2: Add active drag state**

Inside `TagsPage`, immediately after the `collapsed` state and `toggleCollapse`, add:

```ts
  const [activeDrag, setActiveDrag] = useState<ActiveTagDrag | null>(null);

  function clearActiveDrag() {
    setActiveDrag(null);
  }
```

- [ ] **Step 3: Add drag start handler**

Insert this function above the existing `handleDragEnd`:

```ts
  function handleDragStart(e: DragStartEvent) {
    const activeData = e.active.data.current as DragData | undefined;
    if (!activeData || activeData.kind !== "tag") {
      clearActiveDrag();
      return;
    }

    const tag = tags.find((t) => t.id === activeData.tagId);
    if (!tag) {
      clearActiveDrag();
      return;
    }

    setActiveDrag(createActiveTagDrag(tag, collectDescendants(tag.id)));
  }
```

- [ ] **Step 4: Replace `handleDragEnd`**

Replace the full existing `handleDragEnd` function with:

```ts
  function handleDragEnd(e: DragEndEvent) {
    try {
      const activeData = e.active.data.current as DragData | undefined;
      const overData = e.over?.data.current as DropData | undefined;
      if (!activeData || activeData.kind !== "tag" || !overData) return;
      const movedId = activeData.tagId;

      if (overData.kind === "into") {
        // 拖到节点行 → 变成该节点的最后一个子节点
        if (overData.tagId === movedId) return;
        if (isInvalidIntoTarget(activeDrag, overData.tagId)) return;

        const moved = moveTag(movedId, overData.tagId, Number.MAX_SAFE_INTEGER);
        if (!moved) return;

        // 自动展开收纳节点
        setCollapsed((prev) => {
          const next = new Set(prev);
          next.delete(overData.tagId);
          return next;
        });
        return;
      }

      if (overData.kind === "gap") {
        const { parentId, index } = overData;
        if (isInvalidGapTarget(activeDrag, parentId)) return;

        const adjusted = adjustGapIndex(tags, movedId, parentId, index);
        if (!adjusted) return;

        moveTag(adjusted.movedId, adjusted.parentId, adjusted.newIndex);
      }
    } finally {
      clearActiveDrag();
    }
  }
```

- [ ] **Step 5: Wire drag lifecycle into `DndContext`**

Update the `DndContext` opening tag to include start and cancel handlers:

```tsx
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={clearActiveDrag}
        >
```

- [ ] **Step 6: Pass active drag state through the tree**

Update the first root gap call:

```tsx
            <GapDrop
              parentId={null}
              index={0}
              level={0}
              activeDrag={activeDrag}
            />
```

Update the root `TagTreeNode` call:

```tsx
                <TagTreeNode
                  node={node}
                  level={0}
                  collapsed={collapsed}
                  activeDrag={activeDrag}
                  toggleCollapse={toggleCollapse}
                  taskCountByTag={taskCountByTag}
                  onAddChild={openNew}
                  onEdit={openEdit}
                  onDelete={deleteTag}
                  onLocate={locateTasks}
                />
```

Update the root trailing gap:

```tsx
                <GapDrop
                  parentId={null}
                  index={i + 1}
                  level={0}
                  activeDrag={activeDrag}
                />
```

- [ ] **Step 7: Extend component props**

Add `activeDrag` to `GapDrop`:

```ts
function GapDrop({
  parentId,
  index,
  level,
  activeDrag,
}: {
  parentId: string | null;
  index: number;
  level: number;
  activeDrag: ActiveTagDrag | null;
}) {
```

Add `activeDrag` to `TagTreeNodeProps`:

```ts
interface TagTreeNodeProps {
  node: TagNode;
  level: number;
  collapsed: Set<string>;
  activeDrag: ActiveTagDrag | null;
  toggleCollapse: (id: string) => void;
  taskCountByTag: Map<string, number>;
  onAddChild: (parentId: string | null) => void;
  onEdit: (tag: Tag) => void;
  onDelete: (tag: Tag) => void;
  onLocate: (tagId: string) => void;
}
```

Destructure `activeDrag` inside `TagTreeNode` and pass it to `TagRow`, nested `GapDrop`, and nested `TagTreeNode`:

```tsx
  const {
    node,
    level,
    collapsed,
    activeDrag,
    toggleCollapse,
    taskCountByTag,
    onAddChild,
    onEdit,
    onDelete,
    onLocate,
  } = props;
```

Use this prop in the child calls:

```tsx
        activeDrag={activeDrag}
```

- [ ] **Step 8: Build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add src/routes/Tags.tsx
git commit -m "feat(tags): track active tag drag state"
```

Expected: one commit containing only `Tags.tsx`.

---

### Task 3: Render Placeholder Blocks And Invalid Target Feedback

**Files:**
- Modify: `src/routes/Tags.tsx`

- [ ] **Step 1: Add shared indentation helpers**

Below `const ROOT_KEY = "__root__";`, add:

```ts
const TAG_INDENT_BASE = 16;
const TAG_INDENT_STEP = 24;

function tagIndentStyle(level: number) {
  return { paddingLeft: `${TAG_INDENT_BASE + level * TAG_INDENT_STEP}px` };
}
```

Replace existing inline indentation expressions:

```tsx
style={{ paddingLeft: `${16 + level * 24}px` }}
```

with:

```tsx
style={tagIndentStyle(level)}
```

- [ ] **Step 2: Add `TagDropPlaceholder`**

Insert this component above `GapDrop`:

```tsx
function TagDropPlaceholder({
  level,
  invalid = false,
}: {
  level: number;
  invalid?: boolean;
}) {
  return (
    <div style={tagIndentStyle(level)} className="py-1">
      <div
        className={cn(
          "h-8 rounded-lg border border-dashed transition-colors",
          invalid
            ? "border-red-300 bg-red-50"
            : "border-brand-300 bg-brand-50"
        )}
      />
    </div>
  );
}
```

- [ ] **Step 3: Replace `GapDrop` rendering**

Replace the full `GapDrop` function body after `const dragging = !!active;` with:

```tsx
  const invalid = isInvalidGapTarget(activeDrag, parentId);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "overflow-hidden transition-all",
        dragging ? (isOver ? "h-10" : "h-2") : "h-0"
      )}
    >
      {dragging &&
        (isOver ? (
          <TagDropPlaceholder level={level} invalid={invalid} />
        ) : (
          <div style={tagIndentStyle(level)} className="h-full">
            <div className="h-full rounded-full bg-ink-200/50" />
          </div>
        ))}
    </div>
  );
```

- [ ] **Step 4: Update `TagRow` legality and row wrapper**

Inside `TagRow`, replace:

```ts
  // 自身或自身后代不能成为放置目标（但让其它判定交给 store；这里只控制视觉提示）
  const activeIsSelf = active?.id === `tag-${node.id}`;
  const showIntoHighlight = isOver && !activeIsSelf;
```

with:

```ts
  const dragging = !!active;
  const activeIsSelf = active?.id === `tag-${node.id}`;
  const invalidInto = isInvalidIntoTarget(activeDrag, node.id);
  const showInvalidInto = isOver && invalidInto && !activeIsSelf;
  const showIntoHighlight = isOver && !invalidInto;
```

Then wrap the existing row `<div ref={setRefs} ...>` in an outer `<div>`. The returned shape should be:

```tsx
  return (
    <div>
      <div
        ref={setRefs}
        className={cn(
          "group relative flex items-center gap-2 px-4 py-2.5 transition-colors",
          showIntoHighlight
            ? "bg-brand-50 ring-1 ring-inset ring-brand-200"
            : showInvalidInto
              ? "bg-red-50 ring-1 ring-inset ring-red-200"
              : "hover:bg-ink-50",
          isDragging && "opacity-30"
        )}
        style={tagIndentStyle(level)}
      >
        {/* existing row contents stay here */}
      </div>

      {showIntoHighlight && <TagDropPlaceholder level={level + 1} />}
      {showInvalidInto && <TagDropPlaceholder level={level + 1} invalid />}
    </div>
  );
```

Keep every existing row child inside the inner row `<div>`.

- [ ] **Step 5: Replace row hint text**

Replace the existing hint block:

```tsx
      {/* "拖到此处会成为子节点"的提示 */}
      {showIntoHighlight && (
        <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-brand-700 shadow-sm">
          放到此处 → 成为「{node.name}」的子标签
        </span>
      )}
```

with:

```tsx
        {showIntoHighlight && (
          <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-brand-700 shadow-sm">
            将成为「{node.name}」的子标签
          </span>
        )}
        {showInvalidInto && (
          <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-red-600 shadow-sm">
            不能放到自己的子标签内
          </span>
        )}
```

- [ ] **Step 6: Hide row actions during drag**

Replace the row action container class:

```tsx
      <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
```

with:

```tsx
        <div
          className={cn(
            "ml-auto flex items-center gap-1 opacity-0 transition-opacity",
            dragging ? "pointer-events-none" : "group-hover:opacity-100"
          )}
        >
```

Make sure the closing `</div>` still closes the action container, not the row wrapper.

- [ ] **Step 7: Build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/routes/Tags.tsx
git commit -m "feat(tags): show placeholder drop targets"
```

Expected: one commit containing only `Tags.tsx`.

---

### Task 4: Add Drag Overlay Preview

**Files:**
- Modify: `src/routes/Tags.tsx`

- [ ] **Step 1: Add preview component**

Insert this component above `TagDropPlaceholder`:

```tsx
function TagDragPreview({ tag, count }: { tag: Tag; count: number }) {
  return (
    <div className="pointer-events-none flex min-w-64 max-w-sm items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 py-2.5 shadow-card">
      <GripVertical className="h-4 w-4 text-ink-300" />
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: tag.color }}
      />
      <span className="truncate text-sm font-medium text-ink-800">{tag.name}</span>
      <span className="shrink-0 text-xs text-ink-400">{count} 个任务</span>
    </div>
  );
}
```

- [ ] **Step 2: Render `DragOverlay` inside `DndContext`**

Inside `DndContext`, after the `<div className="card overflow-hidden">...</div>` tree and before `</DndContext>`, add:

```tsx
          <DragOverlay dropAnimation={null}>
            {activeDrag ? (
              <TagDragPreview
                tag={activeDrag.tag}
                count={taskCountByTag.get(activeDrag.tagId) ?? 0}
              />
            ) : null}
          </DragOverlay>
```

- [ ] **Step 3: Confirm original row still fades**

Verify `TagRow` still includes:

```tsx
          isDragging && "opacity-30"
```

Do not remove it; this is the source-row fade required by the design.

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/routes/Tags.tsx
git commit -m "feat(tags): add drag overlay preview"
```

Expected: one commit containing only `Tags.tsx`.

---

### Task 5: Run End-To-End Verification

**Files:**
- Verify: `src/routes/Tags.tsx`
- Verify: `src/routes/tagDragHelpers.ts`
- Verify: `src/routes/__tagDragHelpers.test.ts`

- [ ] **Step 1: Run helper test**

Run:

```bash
npx tsx src/routes/__tagDragHelpers.test.ts
```

Expected: PASS and prints `全部通过`.

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Start the dev server**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Expected: Vite prints a local URL such as `http://127.0.0.1:5173/`.

- [ ] **Step 4: Browser-check the Tags page**

Open the Vite URL and navigate to `/tags`.

Verify manually:

1. Drag a root tag between two root tags. The active gap expands to an equal-height placeholder at root indentation.
2. Drag a root tag over another tag row. The row highlights and a child-level placeholder appears below it.
3. Drag a child tag to the root list. The placeholder appears at root indentation.
4. Drag a parent tag over one of its descendants. The row/placeholder shows red invalid feedback.
5. Release on an invalid descendant target. The tag remains in its original location.
6. During drag, the original row fades and the cursor follows a compact preview row with color dot, label, and task count.
7. Existing actions still work after drag: view tasks, add child tag, edit tag, delete tag.

- [ ] **Step 5: Stop the dev server**

Stop the foreground Vite server with `Ctrl-C`.

- [ ] **Step 6: Final status check**

Run:

```bash
git status --short
```

Expected: only intended files are modified or untracked. Do not stage unrelated user changes.

- [ ] **Step 7: Commit any final polish**

If Task 5 required small fixes, commit only those files:

```bash
git add src/routes/Tags.tsx src/routes/tagDragHelpers.ts src/routes/__tagDragHelpers.test.ts
git commit -m "fix(tags): polish tag drag placeholder preview"
```

If Task 5 found no changes after verification, skip this commit.

---

## Self-Review

Spec coverage:

- Source row fade: Task 4 Step 3.
- Drag overlay with real row styling: Task 4 Steps 1-2.
- Equal-height placeholder for gap targets: Task 3 Steps 2-3.
- Child-level placeholder when dragging into a row: Task 3 Step 4.
- Illegal target feedback: Task 1 helper tests, Task 2 safe drop handling, Task 3 invalid UI.
- Preserve `moveTag` and existing persistence: Task 2 uses existing `moveTag` only.
- No real-time tree data reorder: plan only adds UI placeholders.

Placeholder scan:

- No unresolved markers or undefined follow-up instructions remain.
- Every code-changing step includes exact code or an exact replacement target.

Type consistency:

- `ActiveTagDrag`, `createActiveTagDrag`, `isInvalidIntoTarget`, `isInvalidGapTarget`, and `adjustGapIndex` are defined in Task 1 and reused consistently in later tasks.
- `activeDrag` is passed through `TagsPage` → `TagTreeNode` → `TagRow` / `GapDrop`.
