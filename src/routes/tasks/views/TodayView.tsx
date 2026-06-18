import { useMemo, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { TaskCard } from "@/components/task/TaskCard";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ListColumnsToggle } from "@/components/ui/ListColumnsToggle";
import { PriorityPicker } from "@/components/ui/PriorityPicker";
import type { Task, TaskPriority } from "@/lib/types";
import { isoDate } from "@/lib/utils";
import { listColumnsClass, useListColumns } from "@/lib/listColumns";
import { usePomodoroStore } from "@/store/pomodoroStore";
import { useTaskStore } from "@/store/taskStore";
import { taskSorter, useTagFilterSet } from "./_helpers";

/**
 * Today view：聚焦今日，保留快速添加输入框和同日内拖拽排序。
 * Editor 实例由父级 (TasksHub) 统一持有，via onEdit / onCreate 回调通讯。
 *
 * 注：这个 view 故意比其他 view 更窄（max-w-3xl），让"今天"看起来更聚焦、不发散。
 */

function SortableTaskItem({
  task,
  onEdit,
  onStartPomodoro,
}: {
  task: Task;
  onEdit: (t: Task) => void;
  onStartPomodoro: (t: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <TaskCard
        task={task}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
        onEdit={onEdit}
        onStartPomodoro={onStartPomodoro}
      />
    </div>
  );
}

interface Props {
  /** 当前选中日（yyyy-MM-dd），默认今天 */
  date: string;
  onDateChange: (d: string) => void;
  onEdit: (t: Task) => void;
  /** 打开完整编辑器；可带上快速输入框里已敲的标题做预填 */
  onCreate: (title?: string) => void;
  /** 从 URL 来的标签筛选；空数组 = 不过滤 */
  tags: string[];
}

export function TodayView({ date, onDateChange, onEdit, onCreate, tags }: Props) {
  const navigate = useNavigate();
  const selected = date;
  const realToday = isoDate();
  const isToday = selected === realToday;
  const tasks = useTaskStore((s) => s.tasks);
  const reorder = useTaskStore((s) => s.reorderForDate);
  const addTask = useTaskStore((s) => s.addTask);
  const tagFilter = useTagFilterSet(tags);
  const passTag = (t: Task) =>
    !tagFilter || t.tagIds.some((id) => tagFilter.has(id));

  const todayTasks = useMemo(() => {
    return tasks
      .filter(
        (t) =>
          t.scheduledDates.includes(selected) &&
          t.status !== "done" &&
          t.status !== "suspended" &&
          passTag(t)
      )
      .sort(taskSorter);
  }, [tasks, selected, tagFilter]);

  const suspendedToday = useMemo(() => {
    return tasks
      .filter(
        (t) =>
          t.status === "suspended" &&
          t.scheduledDates.includes(selected) &&
          passTag(t)
      )
      .sort(taskSorter);
  }, [tasks, selected, tagFilter]);

  const completedToday = useMemo(() => {
    return tasks
      .filter(
        (t) =>
          t.status === "done" &&
          t.scheduledDates.includes(selected) &&
          passTag(t)
      )
      .sort((a, b) => {
        const ta = a.completedAt ?? a.updatedAt;
        const tb = b.completedAt ?? b.updatedAt;
        return new Date(tb).getTime() - new Date(ta).getTime();
      });
  }, [tasks, selected, tagFilter]);

  const [quickInput, setQuickInput] = useState("");
  const [quickPriority, setQuickPriority] = useState<TaskPriority>("p2");
  const [cols] = useListColumns();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = todayTasks.map((t) => t.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(ids, oldIndex, newIndex);
    reorder(selected, next);
  }

  function handleQuickAdd() {
    const title = quickInput.trim();
    if (!title) return;
    addTask({ title, scheduledDates: [selected], priority: quickPriority });
    setQuickInput("");
  }

  // 点「详细…」：把已敲的标题带进完整编辑器预填，并清空快速输入框，
  // 避免标题既留在这里、又出现在编辑器里造成两份。
  function handleOpenDetail() {
    const title = quickInput.trim();
    onCreate(title || undefined);
    setQuickInput("");
  }

  const selectTask = usePomodoroStore((s) => s.selectTask);
  const setType = usePomodoroStore((s) => s.setType);
  function startPomodoroFor(task: Task) {
    setType("focus");
    selectTask(task.id);
    navigate("/pomodoro");
  }

  return (
    <div className={cols === 2 ? "mx-auto max-w-5xl" : "mx-auto max-w-3xl"}>
      {/* 今日大日期 banner —— Today view 独有的"仪式感" */}
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <div className="mb-1 text-xs uppercase tracking-wider text-ink-400">
            {format(parseISO(selected), "EEEE", { locale: zhCN })}
          </div>
          <h2 className="text-2xl font-semibold text-ink-800">
            {format(parseISO(selected), "yyyy 年 M 月 d 日")}
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            {isToday ? "今日有 " : "共 "}
            <span className="font-medium text-brand-600">{todayTasks.length}</span>{" "}
            项待办
            {completedToday.length > 0 && (
              <>
                ，已完成{" "}
                <span className="font-medium text-success-600">
                  {completedToday.length}
                </span>{" "}
                项
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isToday && (
            <button
              type="button"
              className="btn-secondary mr-1 text-xs"
              onClick={() => onDateChange(isoDate())}
            >
              回到今天
            </button>
          )}
          <button
            type="button"
            className="rounded-lg border border-ink-200 p-1.5 text-ink-500 hover:bg-ink-50"
            onClick={() => onDateChange(isoDate(addDays(parseISO(selected), -1)))}
            aria-label="前一天"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-lg border border-ink-200 p-1.5 text-ink-500 hover:bg-ink-50"
            onClick={() => onDateChange(isoDate(addDays(parseISO(selected), 1)))}
            aria-label="后一天"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* 快速新建 */}
      <div className="card mb-4 flex items-center gap-2 px-3 py-2">
        <Plus className="h-4 w-4 text-ink-400" />
        <input
          className="flex-1 border-none bg-transparent text-sm outline-none placeholder:text-ink-400"
          placeholder={
            isToday
              ? "快速新建今日任务，回车保存"
              : `快速新建 ${format(parseISO(selected), "M 月 d 日")} 的任务，回车保存`
          }
          value={quickInput}
          onChange={(e) => setQuickInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleQuickAdd();
          }}
        />
        <PriorityPicker priority={quickPriority} onChange={setQuickPriority} />
        <button className="btn-ghost text-xs" onClick={handleOpenDetail}>
          详细…
        </button>
        <ListColumnsToggle />
      </div>

      {todayTasks.length === 0 ? (
        <div className="card flex flex-col items-center justify-center px-6 py-12 text-center">
          <Sparkles className="mb-2 h-6 w-6 text-brand-400" />
          <p className="text-sm text-ink-500">
            {isToday ? "今日无待办，享受片刻宁静吧" : "这一天没有待办"}
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={todayTasks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className={listColumnsClass(cols)}>
              {todayTasks.map((task) => (
                <SortableTaskItem
                  key={task.id}
                  task={task}
                  onEdit={onEdit}
                  onStartPomodoro={startPomodoroFor}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <CollapsibleSection
        title="已挂起"
        count={suspendedToday.length}
        tone="paused"
        defaultOpen
      >
        {suspendedToday.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            onEdit={onEdit}
            onStartPomodoro={startPomodoroFor}
          />
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        title={isToday ? "今日已完成" : "已完成"}
        count={completedToday.length}
        tone="success"
        defaultOpen
      >
        {completedToday.map((t) => (
          <TaskCard key={t.id} task={t} onEdit={onEdit} />
        ))}
      </CollapsibleSection>
    </div>
  );
}
