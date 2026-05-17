import type { Task } from "@/lib/types";
import {
  taskEditorDraftToTaskPatch,
  type TaskEditorDraft,
} from "@/lib/taskEditorBridge";
import { useTagStore } from "@/store/tagStore";
import { useTaskStore } from "@/store/taskStore";
import { Modal } from "@/components/ui/Modal";
import { TaskEditorForm } from "./TaskEditorForm";

interface TaskEditorProps {
  open: boolean;
  task?: Task | null;
  defaultDate?: string;
  onClose: () => void;
}

export function TaskEditor({
  open,
  task,
  defaultDate,
  onClose,
}: TaskEditorProps) {
  const tags = useTagStore((s) => s.tags);
  const addTask = useTaskStore((s) => s.addTask);
  const updateTask = useTaskStore((s) => s.updateTask);

  async function save(draft: TaskEditorDraft) {
    const patch = taskEditorDraftToTaskPatch(draft);
    if (task) {
      updateTask(task.id, patch);
    } else {
      addTask({ title: draft.title, ...patch });
    }
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? "编辑任务" : "新建任务"}
      widthClass="max-w-xl"
    >
      <TaskEditorForm
        task={task}
        tags={tags}
        defaultDate={defaultDate}
        onCancel={onClose}
        onSave={save}
      />
    </Modal>
  );
}
