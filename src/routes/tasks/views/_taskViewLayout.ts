import { useEffect, useState } from "react";

export type TaskViewLayout = "single" | "double" | "gantt";

const LS_KEY = "task.range.view.layout";
const EVENT_NAME = "task-range-view-layout-change";

function read(): TaskViewLayout {
  if (typeof window === "undefined") return "single";
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw === "double" || raw === "gantt") return raw;
    return "single";
  } catch {
    return "single";
  }
}

function write(layout: TaskViewLayout) {
  try {
    localStorage.setItem(LS_KEY, layout);
  } catch {
    // localStorage may be unavailable in privacy modes; in-memory state still updates.
  }
  window.dispatchEvent(
    new CustomEvent<TaskViewLayout>(EVENT_NAME, { detail: layout })
  );
}

export function useTaskViewLayout(): [
  TaskViewLayout,
  (layout: TaskViewLayout) => void,
] {
  const [layout, setLayout] = useState<TaskViewLayout>(read);

  useEffect(() => {
    function onCustom(e: Event) {
      const detail = (e as CustomEvent<TaskViewLayout>).detail;
      if (detail === "single" || detail === "double" || detail === "gantt") {
        setLayout(detail);
      }
    }
    function onStorage(e: StorageEvent) {
      if (e.key === LS_KEY) setLayout(read());
    }
    window.addEventListener(EVENT_NAME, onCustom as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT_NAME, onCustom as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return [layout, write];
}
