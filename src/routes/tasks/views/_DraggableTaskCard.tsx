import { useDraggable } from "@dnd-kit/core";
import { TaskCard } from "@/components/task/TaskCard";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 把一张 TaskCard 包装成可拖拽形态。
 *
 * 模式：useDraggable 挂在 wrapper，drag handle 通过 dragHandleProps 注入到
 * TaskCard 内的 grip 图标上，避免点击整张卡都被识别为拖拽。
 *
 * 被拖时 wrapper 半透明（opacity-30），实际跟随光标的预览由顶层 view 的
 * <DragOverlay> 渲染（每个 view 自己控制预览样式 + mode 提示）。
 *
 * data payload 约定:
 *   - type: "task"
 *   - taskId: 任务 ID
 *   - fromDate: 本卡所在的源日期 (yyyy-MM-dd)
 *
 * 与 ./_helpers 中的 isDragTask 类型守卫对应。
 *
 * 该组件必须挂在某个 <DndContext> 内部，外层 view 负责处理 onDragEnd。
 */
export function DraggableTaskCard({
  task,
  fromDate,
  onEdit,
  onStartPomodoro,
}: {
  task: Task;
  fromDate: string;
  onEdit: (t: Task) => void;
  onStartPomodoro: (t: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${fromDate}-${task.id}`,
    data: { type: "task", taskId: task.id, fromDate },
  });
  return (
    <div ref={setNodeRef} className={cn(isDragging && "opacity-30")}>
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
