# 双击日期弹任务浮窗 + 拖拽改期 · 设计文档

## 问题

用户在月/周/年视图里双击某一天时，希望能直接看到那天的所有任务，并且能把任务从浮窗里拖到其他日期格上完成"移动"或"复制"，无需进入编辑器。

## 设计目标

- 月/周/年视图双击日期 → 弹出贴近格子的浮窗，显示当天任务
- 浮窗内任务卡可拖出，落到本视图其他日期格 → 移动（默认）/ 复制（按住 Option/Alt）
- 复用现有 `TaskCard`、dnd-kit 体系、`moveSchedule` action
- 不影响今日视图

---

## § 1 · DayTasksPopover 组件

`src/routes/tasks/views/_DayTasksPopover.tsx`

**Props：**
```ts
interface Props {
  iso: string;
  tasks: Task[];
  anchor: DOMRect;
  onClose: () => void;
  onEdit: (t: Task) => void;
  onStartPomodoro?: (t: Task) => void;
  onNewTask?: (iso: string) => void;
}
```

**渲染：**
- `createPortal` 挂到 `document.body`
- 320px 宽卡片，圆角 + 阴影
- 头部：日期 + 周几 + 任务数 + 关闭 X
- 列表：每条复用 `TaskCard`（继承单击切状态、双击编辑、右键菜单）
- 空状态：「这天没有任务」+「+ 新建」按钮
- 拖动期间：整体 `opacity-30 pointer-events-none`
- 顶部右侧 mode 角标：`拖动:移动 · ⌥拖:复制`

**定位（沿用 DateRangePicker 思路）：**
- 默认弹在 anchor 的右下角
- 右侧出界 → 翻到左侧
- 下方出界 → 翻到上方
- 窗口 resize / scroll → 跟随更新

**关闭：**
- Esc
- 点浮窗外（非任意 droppable）

---

## § 2 · 拖拽接入

**拖拽源** —— 浮窗内 TaskCard 用 `useDraggable`，data 与现有体系对齐：

```ts
{ type: "task", taskId, fromDate: iso, fromPopover: true }
```

`fromPopover` 标记仅用于让浮窗自身在拖动时变半透明。

**Drop targets**（按视图）：
- 月：`DroppableDayCell`（已是）
- 周：每天行的列容器（已是）
- 年：每个日格的 `<button>` —— **本次新增** `useDroppable`

**拖落处理**：调用方（MonthView / WeekView / YearView）的 `handleDragEnd` 已经处理 `{ type: "task" }`，直接复用 `moveSchedule(taskId, fromDate, toDate, mode)`：
- mode = "move"（默认）
- mode = "copy"（按住 Option/Alt）

**修饰键状态机**：复用 MonthView/WeekView 现有的 `mode` state（监听 keydown/keyup）。年视图补一个相同的 hook。

**起拖阈值**：dnd-kit 默认 `PointerSensor.activationConstraint.distance: 4`，已隐式区分单击和拖动，不另加时间阈值。

---

## § 3 · 触发器（双击）

| 视图 | 目标元素 | 加 |
|------|----------|----|
| 月 | DroppableDayCell 内覆盖 button | `onDoubleClick` |
| 周 | 每行左侧"日期标识" button | `onDoubleClick` |
| 年 | 日格 button | `onDoubleClick` + 父级 `useDroppable` |

单击与双击不冲突：双击会先触发两次 `onClick`（视图原选中日逻辑照常）+ 一次 `onDoubleClick`（开浮窗）。

---

## § 4 · 状态管理

每个视图组件持有：

```ts
const [popover, setPopover] = useState<{ iso: string; rect: DOMRect } | null>(null);
```

由该视图根据 `popover.iso` 从已有 `taskMap` / `dayMap` 派生当天任务列表，传给 `DayTasksPopover`。

---

## § 5 · 边界

| 场景 | 处理 |
|------|------|
| 当天无任务 | 浮窗显示空状态 + 新建按钮 |
| 拖到同一天 | dnd-kit `over.id === active source's day`，no-op |
| 同时只能开一个浮窗 | 双击新日期 → 关旧开新 |
| 拖出窗口未落 droppable | 浮窗恢复实体，不关闭 |
| 任务跨天 | `moveSchedule` 已处理（其他日期保留 / 删除 / 复制） |
| Esc | 关浮窗（不影响其他键盘行为） |

---

## § 6 · 测试

- 人工 dogfood 三视图
- 不写 e2e，不加单测（无新纯函数）

---

## § 7 · 实施切片

| 切片 | 内容 | 依赖 |
|------|------|------|
| 1 | `DayTasksPopover` 组件（portal + 定位 + 列表 + 空状态 + Esc 关闭，不含拖动） | 无 |
| 2 | 月/周视图双击触发 + 浮窗集成 + 拖落复用现有 handleDragEnd | 1 |
| 3 | 年视图双击触发 + `useDroppable` + mode 监听 | 1, 2 |
| 4 | 浮窗内 TaskCard 用 `useDraggable` 包装 + 拖动期间半透明 | 2 |

切片 1 独立；2、4 互依；3 独立于 4。
