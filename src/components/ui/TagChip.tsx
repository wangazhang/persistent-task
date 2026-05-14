import { X } from "lucide-react";
import type { Tag } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TagChipProps {
  tag: Tag;
  onRemove?: () => void;
  size?: "sm" | "md";
  className?: string;
}

/** 把 hex 颜色转换为带半透明背景的样式 */
function colorStyle(hex: string) {
  return {
    backgroundColor: `${hex}1A`, // ~10% opacity
    color: hex,
    borderColor: `${hex}40`,
  };
}

export function TagChip({
  tag,
  onRemove,
  size = "sm",
  className,
}: TagChipProps) {
  return (
    <span
      className={cn(
        "chip border",
        size === "md" && "px-2.5 py-1 text-sm",
        className
      )}
      style={colorStyle(tag.color)}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: tag.color }}
      />
      <span>{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 text-current/60 hover:text-current"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
