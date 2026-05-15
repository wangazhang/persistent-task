# 跨天任务排期 UX 优化 · 设计文档

## 问题

当前设置跨天任务的唯一方式是在 TaskEditor 里逐个添加日期 chip（选日期 → 点添加 → 重复 N 次）。对于连续区间（如 5/11–5/14）这极其低效。月视图虽然能拖任务卡到某天，但一次只加一天。

## 设计目标

- 连续区间场景（90%+）：2 次点击完成排期
- 月视图直接拖选创建跨天任务 / 拖边缘改期
- 不连续日期场景保留逃生通道
- 不引入第三方日期组件库

---

## § 1 · DateRangePicker 组件

位置：`src/components/ui/DateRangePicker.tsx`

### 触发器

一个 button，显示当前区间：
- 未排期 → "未排期"（灰色，Calendar 图标）
- 单日 → "2026-05-14（周四）"
- 跨天连续 → "2026-05-11 → 2026-05-14（4 天）"
- 跨天不连续 → "2026-05-11 → 2026-05-20（5 天 · 不连续）"

### 弹层（Popover）

```
┌──────────────────────────────────────┐
│  ‹  2026 年 5 月  ›                  │
│  [今天] [明天] [本周] [下周] [清空]   │
│                                      │
│  日 一 二 三 四 五 六                 │
│        1  2  3  4  5  6              │
│   7  8  9 10 11 12 13                │
│  14 15 16 17 18 19 20                │
│  21 22 23 24 25 26 27                │
│  28 29 30 31                          │
│                                      │
│  点起点 → 点终点                      │
└──────────────────────────────────────┘
```

### 选择逻辑

- 第 1 次点击 = 设起点（高亮单格）
- 第 2 次点击 = 设终点；若早于起点则自动交换；之间所有日期进区间
- 已有选择再点 → 视为新一轮起点（清掉旧区间）
- 单击同一天两次 = 单日任务
- 快捷预设：今天、明天、本周（周一~周日）、下周、清空

### 键盘

- Esc 关闭弹层
- Enter 确认当前选择并关闭

### Props

```ts
interface DateRangePickerProps {
  value: string[];           // 当前 scheduledDates
  onChange: (dates: string[]) => void;
  className?: string;
}
```

### 工具函数（`src/lib/dateRange.ts`）

```ts
expandRange(start: string, end: string): string[]
isContiguous(dates: string[]): boolean
getRange(dates: string[]): { start: string; end: string } | null
presetToday(): string[]
presetTomorrow(): string[]
presetThisWeek(): string[]   // 周一~周日
presetNextWeek(): string[]
```

---

## § 2 · TaskEditor 集成

### 替换现有排期区域

原来：chip 列表 + `<input type="date">` + 添加按钮

新：
```
排期日期
[📅 2026-05-11 → 2026-05-14（4 天）]  [▾ 单独添加]
```

### 「单独添加」折叠区（默认收起）

展开后保留旧 chip 列表 UI：
```
已加日期：[2026-05-11 ✕] [2026-05-15 ✕] [2026-05-20 ✕]
+ [日期框] [添加]
```

### 编辑现有任务时的展示规则

读取 `task.scheduledDates` 后判断：
- 空数组 → picker 显示「未排期」
- 1 个日期或连续多个日期 → picker 显示 start → end，折叠区收起
- 不连续日期 → picker 显示 min → max + "不连续"标记，自动展开折叠区

### 写回逻辑

- 通过 DateRangePicker 改区间 → 覆盖 scheduledDates 为 [start..end] 连续数组
- 在折叠区增删 chip → 只动 chip 那一组，picker 的 min..max 同步更新

---

## § 3 · 月视图拖拽交互

### A · 横向框选新建

在 DayCell 上层加透明框选层：

- mousedown 在空白格 → 记录起点 ISO
- mousemove → 实时画临时高亮色带（半透明蓝色）
- mouseup → 弹出迷你气泡：

```
┌──────────────────────────────────┐
│  2026-05-11 → 2026-05-14         │
│  [快速新建任务...        ]       │
│  [Enter 创建 · Esc 取消]         │
└──────────────────────────────────┘
```

回车 → 创建 `{ title, scheduledDates: [start..end], priority: 'p2', status: 'todo' }`

约束：
- 拖选不能跨周（第一版限制）；跨周拖回退到起点所在周末尾 + 灰色提示
- 拖卡片进行中时框选层 `pointer-events-none`（通过 dnd-kit active 状态判断）

### B · 色带边缘拖动改期

TaskBar 左端和右端各加 6px 宽 resize handle：

- hover 时光标 `ew-resize`，浮现 2px 高亮竖线
- mousedown → 进入 resize 模式
- mousemove → 算鼠标覆盖格子 ISO，实时更新临时显示
- mouseup → `updateTask(taskId, { scheduledDates: [newStart..newEnd] })`

约束：
- 不允许 end < start（拖过头自动 clamp 成单日）
- 仅对连续任务启用 handle；不连续任务色带不显示 handle
- handle 上 `e.stopPropagation()` + `e.preventDefault()` 阻止 dnd-kit 拾起

### C · 单击/双击保持不变

- 单击色带 = 切换 DaySection 到任务起始日
- 双击色带 = 打开编辑器
- 拖动 = 改期或新建

---

## § 4 · 边界情况

| 场景 | 处理 |
|------|------|
| 清空排期 | scheduledDates = []，允许保存 |
| 单日任务 | start === end，月视图不画色带 |
| 任务标记 done/suspended | scheduledDates 完全保留 |
| 删除任务 | 色带、handle 一起消失 |
| resize 拖到月外侧 | 允许，scheduledDates 可含当前月外日期 |
| 不连续日期的 picker 显示 | 触发器加"不连续"字样，弹层中间已选日期用次级颜色 |
| 时区 | 全程 yyyy-MM-dd 字符串，不引入 Date 对象比较 |

---

## § 5 · 测试

### 单元测试（vitest）

```
src/lib/__dateRange.test.ts
  · expandRange("2026-05-11", "2026-05-14") → 4 个 ISO
  · expandRange 起点 > 终点 → 自动交换
  · isContiguous(["5-11","5-12","5-13"]) === true
  · isContiguous(["5-11","5-13"]) === false
  · presetThisWeek → 周一~周日 7 个日期
  · presetNextWeek → 当前周一 +7 起 7 天

src/routes/tasks/views/__monthRangeDrag.test.ts
  · 同周框选 (col 2 → col 5) → start/end ISO 正确
  · 跨周框选回退到起点所在周末尾
  · resize end 拖过 start → clamp 成单日
```

### 交互测试

人工 dogfood，不写 e2e。

---

## § 6 · 实施切片

| 切片 | 内容 | 依赖 |
|------|------|------|
| 1 | DateRangePicker 组件 + dateRange 工具函数 + 单测 | 无 |
| 2 | TaskEditor 集成：换 UI + 折叠区 + 不连续检测 | 切片 1 |
| 3 | MonthView 拖拽：框选新建 + resize handle + 测试 | 切片 1 |

切片 1 独立可合并；切片 2 依赖 1；切片 3 独立于 2 但依赖 1 的工具函数。
