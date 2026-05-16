import { useRef } from "react";
import { Download, Upload } from "lucide-react";
import { exportDbToFile, importDbFromFile } from "@/lib/dbBackup";
import { useTaskStore } from "@/store/taskStore";
import { useTagStore } from "@/store/tagStore";
import { track } from "@/lib/analytics";

export function ImportExportBar() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleExport() {
    track("ui.export", { kind: "db" });
    await exportDbToFile();
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    track("ui.import", { kind: "db" });
    const file = e.target.files?.[0];
    // 重置 input 让用户能连续选同一个文件
    e.target.value = "";
    if (!file) return;
    const counts = {
      tasks: useTaskStore.getState().tasks.length,
      tags: useTagStore.getState().tags.length,
      pomodoros: useTaskStore.getState().pomodoros.length,
    };
    await importDbFromFile(file, counts);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={openFilePicker}
        className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-700 transition-colors hover:border-ink-300 hover:bg-ink-50"
        title="从备份 .sqlite 文件覆盖导入"
      >
        <Upload className="h-3.5 w-3.5" />
        导入
      </button>
      <button
        type="button"
        onClick={handleExport}
        className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-700 transition-colors hover:border-ink-300 hover:bg-ink-50"
        title="导出当前数据库为 .sqlite 文件"
      >
        <Download className="h-3.5 w-3.5" />
        导出
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".sqlite,.db,application/x-sqlite3"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
