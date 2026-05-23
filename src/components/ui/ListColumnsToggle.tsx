import { Columns2, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useListColumns } from "@/lib/listColumns";

interface Props {
  className?: string;
}

export function ListColumnsToggle({ className }: Props) {
  const [columns, setColumns] = useListColumns();
  return (
    <div
      className={cn(
        "inline-flex shrink-0 overflow-hidden rounded-md border border-ink-200 bg-white",
        className
      )}
      role="group"
      aria-label="列表显示密度"
    >
      <button
        type="button"
        onClick={() => setColumns(1)}
        className={cn(
          "inline-flex h-6 w-8 items-center justify-center transition-colors",
          columns === 1
            ? "bg-brand-600 text-white"
            : "bg-white text-ink-500 hover:bg-ink-50 hover:text-ink-700"
        )}
        aria-label="单栏显示"
        title="单栏显示"
        aria-pressed={columns === 1}
      >
        <Rows3 className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => setColumns(2)}
        className={cn(
          "inline-flex h-6 w-8 items-center justify-center transition-colors",
          columns === 2
            ? "bg-brand-600 text-white"
            : "bg-white text-ink-500 hover:bg-ink-50 hover:text-ink-700"
        )}
        aria-label="双栏显示"
        title="双栏显示"
        aria-pressed={columns === 2}
      >
        <Columns2 className="h-3 w-3" />
      </button>
    </div>
  );
}
