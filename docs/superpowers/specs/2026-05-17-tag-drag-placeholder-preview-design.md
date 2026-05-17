# 标签树拖拽占位预览 · 设计文档

## 背景

`src/routes/Tags.tsx` 里的标签树已经支持拖拽重排和调整层级：

- `TagRow` 同时是拖拽源和“拖入成为子标签”的 drop target。
- `GapDrop` 表示行间插入点，用于同级排序。
- `handleDragEnd` 读取 drop payload 后调用 `tagStore.moveTag`。
- `tagStore.moveTag` 负责循环引用检测、同层 order 重排和持久化。

现有体验的问题不是功能缺失，而是拖动过程缺少可信的空间反馈：拖动中的标签只是原地变透明，目标位置只通过很薄的 gap 或行背景表达，用户很难判断松手后标签会落在哪里、缩进层级是什么、是否会成为某个标签的子标签。

## 目标

本次优化采用 **B. 占位式预览**：

拖动标签时，界面应持续给出接近最终结果的视觉反馈：

- 被拖动的原标签行在原位置淡出。
- 鼠标下方显示真实标签行样式的拖拽浮层。
- 当前可落点显示一个与标签行等高的占位块。
- 占位块的左侧缩进反映松手后的层级。
- 非法目标显示禁止态，不显示可执行的蓝色占位。

目标是让用户一眼看懂“正在拖谁、会落在哪里、会是什么层级、这个位置是否合法”。

## 非目标

本次不做整棵树的实时数据重排，也不改 `tagStore.moveTag` 的持久化语义。

不引入新的拖拽库；继续使用现有 `@dnd-kit/core`。

不改变标签 CRUD、任务计数、按标签跳转、删除级联等业务行为。

## 交互设计

### 拖动开始

用户仍然从行首拖拽手柄开始拖动。

拖动开始后：

- 原标签行保留在列表中，但降低透明度。
- 行尾 hover 操作隐藏，避免拖动中干扰。
- 拖拽浮层显示标签名称、颜色点、任务数量和基础行样式。

### 拖到行间

当指针命中 `GapDrop`：

- 显示一个等高占位块，而不是当前薄线。
- 占位块左侧缩进使用 `level` 计算，和目标层级一致。
- 占位块文案不必常驻，避免拖动时文字噪音；可用蓝色边框、虚线和浅色背景表达“将插入这里”。

松手后仍按现有 gap payload 调用：

```ts
moveTag(movedId, parentId, newIdx)
```

### 拖到标签行

当指针命中某个 `TagRow` 的主体：

- 行背景高亮，表达“松手后成为该标签的子标签”。
- 在该标签下方显示子级缩进的占位块，表达最终会追加到它的子标签列表末尾。
- 如果目标标签当前折叠，拖入时自动展开的现有行为保留。

松手后仍按现有 into payload 调用：

```ts
moveTag(movedId, overData.tagId, Number.MAX_SAFE_INTEGER)
```

### 非法目标

非法目标包括：

- 拖到自身。
- 拖到自身的后代标签内。

拖动中应提前识别这些目标：

- 自身不显示 drop 高亮。
- 后代目标显示禁用态，例如红色边框或浅红背景。
- 松手后不调用 `moveTag`，或允许 `moveTag` 拒绝但不产生成功反馈。

这里的前置识别只用于视觉和早退，最终安全仍由 `tagStore.moveTag` 的循环检测兜底。

## 技术设计

### 状态

在 `TagsPage` 中增加拖拽状态：

```ts
type ActiveDrag =
  | {
      tagId: string;
      tag: Tag;
      descendantIds: Set<string>;
    }
  | null;
```

通过 `DndContext` 增加：

- `onDragStart`：记录 active tag 和 descendants。
- `onDragEnd`：沿用现有移动逻辑，结束后清空 active drag。
- `onDragCancel`：清空 active drag。

### 拖拽浮层

引入 `DragOverlay`，渲染一个展示态 `TagDragPreview`。

`TagDragPreview` 复用 `TagRow` 的视觉元素，但不包含可点击操作、折叠按钮和 drop ref。它只负责显示：

- 拖拽手柄图标。
- 颜色点。
- 标签名。
- 任务数量。

### 占位块

新增 `TagDropPlaceholder`：

```ts
function TagDropPlaceholder({ level, invalid }: { level: number; invalid?: boolean })
```

样式：

- 高度接近标签行高度。
- `paddingLeft` 与 `TagRow` 使用同一套缩进公式。
- 合法状态：浅蓝背景、蓝色虚线边框。
- 非法状态：浅红背景、红色边框。

`GapDrop` 在 active drag 存在时，从薄线改为渲染 `TagDropPlaceholder`。

`TagRow` 在可拖入时，在行后方显示一个 `level + 1` 的占位块，表达“成为子标签并追加在末尾”。

### 合法性判断

`TagsPage` 已能通过 `collectDescendants` 得到后代列表。拖动开始时缓存 descendants，避免每个 row 重复计算。

判断规则：

```ts
const isSelf = activeDrag?.tagId === node.id;
const isDescendant = activeDrag?.descendantIds.has(node.id);
const invalidInto = isSelf || isDescendant;
```

gap 目标不需要后代判断，因为它只改变 parentId 和 index；真正非法的 gap parentId 如果是 dragged tag 的后代，也需要标记 invalid。

```ts
const invalidGap =
  parentId != null && activeDrag?.descendantIds.has(parentId);
```

### 数据流

拖动过程中的状态只影响 UI：

```text
Pointer drag
  -> DndContext active/over
  -> TagsPage activeDrag
  -> GapDrop / TagRow render placeholder
  -> DragOverlay render preview
```

最终数据变更仍只发生在 `handleDragEnd`：

```text
DragEndEvent
  -> validate payload
  -> reject illegal target
  -> moveTag(...)
  -> clear activeDrag
```

## 视觉约束

- 标签行高度不应在拖动中抖动。
- 占位块应与标签行高度接近，不能用过大的间距撑开列表。
- 原行淡出但仍保留位置，避免用户失去拖动来源。
- 拖拽浮层不显示操作按钮，避免看起来可点击。
- 合法占位和非法占位颜色必须明显区分。

## 测试与验证

手动验证：

1. 根标签拖到根列表中间，占位块显示在根级缩进，松手后顺序正确。
2. 根标签拖到另一个标签行，行下方出现子级缩进占位，松手后成为子标签。
3. 子标签拖到根列表，占位块显示根级缩进，松手后成为根标签。
4. 拖到自己时不显示合法占位，松手无变化。
5. 父标签拖到自己的后代标签时显示非法态，松手无变化。
6. 拖入折叠标签后，松手仍会展开该标签并显示新子标签。
7. 任务数量、颜色点、标签名在拖拽浮层中显示正确。

自动验证：

- 运行 TypeScript build，确保 dnd event 类型、props 和新增组件类型正确。
- 如新增纯函数用于合法性或 index 计算，补充轻量测试；否则本次以 UI 手动验证为主。
