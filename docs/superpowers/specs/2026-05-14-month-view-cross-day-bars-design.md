# 月视图跨天任务连接条 · 设计文档

## Context

当前月视图（`src/routes/tasks/views/MonthView.tsx`）的每个日历格独立渲染当天的任务摘要（前 2 条标题截断）。当一个任务的 `scheduledDates` 包含连续多天（如 5/11–5/14 的"OKR 草稿"），用户看不出这是同一个跨天任务——只看到 4 个独立格子各列了一行标题，需要在脑里对照才能识别"哦这是同一件事"。

借鉴 Google Calendar 的多日事件条样式：跨天任务在月历上渲染为一条横向色带，从起始日延伸到结束日；跨周时在周边界处断开续接，但保留统一颜色和对位关系，让"任务跨度"在一眼之内可见。

目标：单次实现，仅 MonthView，不破坏现有的 DayCell 拖拽语义和 DaySection 详情。

---

## 设计决策（已与用户对齐）

| 决策 | 选择 |
|---|---|
| 视觉样式 | 横条贯穿（Google Calendar 风格） |
| 色带颜色 | 按任务状态：`in_progress` 橙、`todo` 蓝、`done` 灰+删除线、`suspended` 紫 |
| 色带交互 | 可点击 = 选中该任务的起始日（DaySection 跳过去），**不**做色带拖拽改期 |
| 不连续日期处理 | 拆成多段色带（[5/13,5/14,5/15,5/20] → 5/13-15 一段 + 5/20 单日块） |
| 每格容量 | bar-layer 最多 2 条色带，DayCell 内嵌摘要文字从 2 行减为 1 行 |
| 单日任务 | **不**画色带，保留原 DayCell 文字摘要的展示 |
| 同步到其他视图 | 仅 Month。Week/Year 不动 |

---

## 数据模型

### `BarSegment`

```ts
interface BarSegment {
  taskId: string;
  weekRow: number;      // 0..5（月历的第几行）
  startCol: number;     // 0..6（周内第几列，0=周一）
  endCol: number;       // 0..6（含）
  isRunStart: boolean;  // 该段对应一个连续日期块的开端
                        //   - true: 左侧圆角 + 显示标题
                        //   - false: 续接段（被周边界切开的非首段）
                        //            左侧方角、不重复标题
  isRunEnd: boolean;    // 该段对应连续块的结尾
                        //   - true: 右侧圆角
                        //   - false: 跨周续接到下一行，右侧方角
}

interface WeekBars {
  segments: BarSegment[];      // 该周最多 2 条（按 taskSorter 取 top）
  overflowCount: number;       // 第 3 条起合并为 +N
  coveredTaskIds: Set<string>; // 该周色带覆盖的任务 ids，用于 DayCell 摘要去重
}
```

### 切段算法（伪代码）

```
fn buildWeekBars(weeks: Day[][], tasks: Task[], tagFilter) -> WeekBars[]:
  for each task (过 tagFilter, scheduledDates.length > 1):
    把落在可见 42 天范围的日期排序
    扫描合并相邻 1 天的日期为 "run"（连续段）
    for each run:
      按周边界切开，每段记录 (weekRow, startCol, endCol)
      首段 isRunStart=true，其余 false
      末段 isRunEnd=true，其余 false（被切开的中间段两端都是 false）
  在每个 weekRow 上：
    按 taskSorter 排序所有 segment 的 task
    保留前 2 个 task 的所有 segment（保证跨周续接段也被保留）
    其余统计为 overflowCount
    coveredTaskIds = 保留段对应的 taskIds
```

**关键不变量**：
- 一个 task 的所有 segment 要么都被保留要么都被丢弃——避免出现"一周显示色带、下一周不显示"的诡异续接
- `isRunStart=true` 段只在 task 的**第一个 run**的第一段出现一次；同 task 后续 run 的首段也是 `isRunStart=true`（毕竟是新的一段连续期），但同 run 内的跨周续接段是 `false`

---

## 渲染结构

### MonthView 网格改造

从"42 cells 一个 grid"改为"6 个周行子 grid，每个含 bar-layer 行 + 7 cells 行"：

```tsx
{weekRows.map((weekRow, wi) => (
  <div key={wi} className="grid grid-cols-7 gap-1.5">
    {/* bar-layer：色带绝对定位在 7 列网格上方，高度固定避免行高跳动 */}
    <div className="col-span-7 relative h-[36px] grid grid-cols-7 gap-1.5">
      {weekBars[wi].segments.map(seg => (
        <TaskBar
          key={`${seg.taskId}-${seg.startCol}`}
          segment={seg}
          task={taskById.get(seg.taskId)!}
          onClick={() => onDateChange(task.scheduledDates[0])}
          style={{
            gridColumn: `${seg.startCol + 1} / span ${seg.endCol - seg.startCol + 1}`,
            // 同一周内同 layer 的多条色带通过 top 偏移堆叠
          }}
        />
      ))}
      {weekBars[wi].overflowCount > 0 && (
        <span className="absolute right-2 bottom-0 text-[10px] text-ink-400">
          +{weekBars[wi].overflowCount} 跨天
        </span>
      )}
    </div>
    {/* DayCell row */}
    {weekRow.map(day => (
      <DroppableDayCell
        key={day.toISOString()}
        day={day}
        coveredTaskIds={weekBars[wi].coveredTaskIds}
        ...
      />
    ))}
  </div>
))}
```

### TaskBar 视觉

- 高度 16px，圆角 4px（首段左圆，末段右圆，中段/续接方角）
- 内部 padding-left 8px，`isRunStart=true` 时显示任务标题（`truncate`）
- 状态色：

| 状态 | tailwind class |
|---|---|
| `in_progress` | `bg-warning-500 text-white` |
| `todo` | `bg-sky-500 text-white` |
| `suspended` | `bg-paused-400 text-white` |
| `done` | `bg-ink-300 text-white line-through` |
| `archived` | `bg-ink-200 text-ink-500` |

- hover：阴影 + 微微抬升；tooltip 显示完整标题
- 点击：`onClick(task.scheduledDates[0])`，DaySection 跳到起始日

### DayCell 内嵌摘要去重

```tsx
function DroppableDayCell({ ..., coveredTaskIds }) {
  const uncovered = info?.tasks.filter(t => !coveredTaskIds.has(t.id)) ?? [];
  // 摘要从原来的 2 行减到 1 行
  return (
    <div ...>
      ...
      {uncovered.slice(0, 1).map(t => <div>· {t.title}</div>)}
      {uncovered.length > 1 && <div>还有 {uncovered.length - 1} 个</div>}
    </div>
  );
}
```

---

## 边界情况

| 情况 | 处理 |
|---|---|
| 单日任务 | 不画色带，仅出现在 DayCell 摘要（保持现状） |
| 任务跨月（如 4/29-5/3，当前显示 5 月） | 只画落在可见 42 天的部分；被截断端方角，无圆角，无标题（如果首段被截掉） |
| 跨周（5/4 周日 → 5/5 周一） | 拆 2 段，前段右方角、后段左方角、续接段不重复标题 |
| 标签筛选 | bar 和 DayCell 摘要走同一份 `tagFilter`，先筛后切段 |
| 任务都是 done | 灰色 + line-through，仍显示 |
| 同周 3+ 条跨天任务 | 按 `taskSorter` 取前 2，第 3 条起 `+N 跨天` 提示 |
| `archived` 状态任务 | 默认不显示（与 DayCell 摘要的 archived 处理一致） |

---

## 文件清单

### 新增
- `src/routes/tasks/views/_monthBars.ts` —— `buildWeekBars()` 纯函数 + `useWeekBars()` hook（包装 `useMemo`）
- `src/routes/tasks/views/_TaskBar.tsx` —— 单条色带 chip 组件

### 修改
- `src/routes/tasks/views/MonthView.tsx`
  - 月历网格改造为周行子网格
  - 调 `useWeekBars` 拿到每周的 segments / overflow / coveredTaskIds
  - `DroppableDayCell` 新增 `coveredTaskIds` prop + 摘要去重 + 行数从 2 减 1

### 不改
- `_helpers.ts`（`useDayMap` 不变）
- `_DaySection.tsx` / `_DraggableTaskCard.tsx` / `TaskCard.tsx`
- store / 数据层

---

## 不做的事（YAGNI）

- 色带拖拽改期（端点拖动改起止 / 中段拖动整体平移）
- 跨视图同步：Week View 不引入色带（行内排列与跨天概念冲突），Year View 粒度太粗
- 跨月任务在上下月色带"延续"渲染（只画当前 42 天可见的部分）

---

## 验证

### 编译
1. `npx tsc -b` 通过
2. `npx vite build` 通过（无新增依赖）

### UI 验证（Tauri 桌面端 + preview Web 端）

实施前先用 sqlite 拉一次每个跨天任务的 `task_dates`，再对照预期渲染。命令：

```bash
sqlite3 "$HOME/Library/Application Support/com.persistenttask.app/persistent-task.db" \
  "SELECT t.id, t.title, t.status, group_concat(td.date,',') AS dates
   FROM tasks t LEFT JOIN task_dates td ON t.id=td.task_id
   GROUP BY t.id HAVING count(td.date) > 1 ORDER BY t.title;"
```

对每条结果按"切段算法"心算一遍，比较 UI 上的色带：
- 标题、颜色（按状态映射表）、段数、起止列、首末圆角是否符合
- 跨周任务的续接段是否不重复标题
- 同 task 多段是否颜色一致

### Playwright 步骤
1. `vite build && vite preview --port 4173`
2. `browser_navigate http://localhost:4173/tasks?view=month`
3. 用 `browser_evaluate` 查询 `document.querySelectorAll('[data-task-bar]').length` 应等于 segment 数
4. 用 `browser_take_screenshot` 截图人眼校验色带对位、颜色、首末圆角
5. 点击一条色带，验证 DaySection 切到该任务的起始日

### 回归 checklist
- [ ] 月历网格列宽对齐没破（色带与下方 DayCell 列严格对齐）
- [ ] DayCell 内拖拽改期仍工作
- [ ] DaySection 仍正常显示
- [ ] 单日任务不出现在色带，只出现在 DayCell 摘要
- [ ] 跨月任务（如果当前数据有）的色带在月历可见范围内被截断且端方角

---

## 提交策略

单个 commit：`feat(month): cross-day task bars in month view`
