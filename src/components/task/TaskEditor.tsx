import { useState } from "react";
import type { Task } from "@/lib/types";
import {
  taskEditorDraftToTaskPatch,
  type TaskEditorDraft,
} from "@/lib/taskEditorBridge";
import { useTagStore } from "@/store/tagStore";
import { useTaskStore } from "@/store/taskStore";
import { Modal } from "@/components/ui/Modal";
import { TaskEditorForm } from "./TaskEditorForm";
import { uid } from "@/lib/utils";

interface TaskEditorProps {
  open: boolean;
  task?: Task | null;
  defaultDate?: string;
  defaultTitle?: string;
  onClose: () => void;
}

export function TaskEditor({
  open,
  task,
  defaultDate,
  defaultTitle,
  onClose,
}: TaskEditorProps) {
  const tags = useTagStore((s) => s.tags);
  const addTask = useTaskStore((s) => s.addTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  // 新建模式下,自动保存第一次触发时把这个 id 用上;之后 createdId 切到 update 模式
  const [createdId, setCreatedId] = useState<string | null>(null);

  async function save(draft: TaskEditorDraft) {
    const patch = taskEditorDraftToTaskPatch(draft);
    const existingId = task?.id ?? createdId;
    if (existingId) {
      updateTask(existingId, patch);
    } else {
      const newId = uid("task-");
      addTask({ id: newId, title: draft.title, ...patch });
      setCreatedId(newId);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        setCreatedId(null);
        onClose();
      }}
      title={task ? "编辑任务" : "新建任务"}
      widthClass="max-w-xl"
    >
      <TaskEditorForm
        task={task}
        tags={tags}
        defaultDate={defaultDate}
        defaultTitle={defaultTitle}
        onSave={save}
      />
    </Modal>
  );
}
