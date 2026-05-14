import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  label: string;
  /** 单元格渲染。默认返回 row[key] 的字符串 */
  render?: (row: T) => ReactNode;
  /** 排序值。返回 string / number；不提供则该列不可排序 */
  sortValue?: (row: T) => string | number;
  /** 列宽 / 截断等额外 className */
  className?: string;
  /** 列头 className（默认与单元格相同）*/
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  /** 每个函数返回一段参与搜索的文本，全部 lower-case includes 匹配 */
  searchKeys: ((row: T) => string)[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** 默认排序：列 key + 方向；未提供则按原顺序 */
  defaultSort?: { key: string; dir: "asc" | "desc" };
  /** 搜索框 placeholder */
  searchPlaceholder?: string;
}

const PAGE_SIZE = 50;

export function DataTable<T>(props: DataTableProps<T>) {
  const {
    columns,
    rows,
    searchKeys,
    getRowId,
    onRowClick,
    defaultSort,
    searchPlaceholder = "搜索…",
  } = props;

  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<string | null>(
    defaultSort?.key ?? null
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">(
    defaultSort?.dir ?? "desc"
  );

  // 切换列：未选 → desc → asc → 回默认
  function toggleSort(col: Column<T>) {
    if (!col.sortValue) return;
    if (sortKey !== col.key) {
      setSortKey(col.key);
      setSortDir("desc");
      return;
    }
    if (sortDir === "desc") {
      setSortDir("asc");
      return;
    }
    if (defaultSort) {
      setSortKey(defaultSort.key);
      setSortDir(defaultSort.dir);
    } else {
      setSortKey(null);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      searchKeys.some((fn) => fn(r).toLowerCase().includes(q))
    );
  }, [rows, searchKeys, query]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    if (!col || !col.sortValue) return filtered;
    const dirSign = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va < vb) return -1 * dirSign;
      if (va > vb) return 1 * dirSign;
      return 0;
    });
  }, [filtered, columns, sortKey, sortDir]);

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  const clampedPage = Math.min(page, pageCount);
  const pageRows = sorted.slice(
    (clampedPage - 1) * PAGE_SIZE,
    clampedPage * PAGE_SIZE
  );

  function handleQueryChange(v: string) {
    setQuery(v);
    setPage(1);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-ink-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3">
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-64 max-w-full rounded border border-ink-200 px-3 py-1.5 text-xs text-ink-700 focus:border-brand-500 focus:outline-none"
        />
        <span className="text-xs text-ink-400">共 {total} 条</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-ink-50 text-ink-500">
            <tr>
              {columns.map((c) => {
                const sortable = !!c.sortValue;
                const active = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-left font-medium",
                      sortable && "cursor-pointer select-none hover:text-ink-700",
                      c.headerClassName ?? c.className
                    )}
                    onClick={() => sortable && toggleSort(c)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {sortable && active && (
                        sortDir === "asc" ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-ink-400"
                >
                  暂无数据
                </td>
              </tr>
            )}
            {pageRows.map((row) => (
              <tr
                key={getRowId(row)}
                className={cn(
                  "border-t border-ink-100 transition-colors hover:bg-ink-50",
                  onRowClick && "cursor-pointer"
                )}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-ink-700",
                      c.className
                    )}
                  >
                    {c.render ? c.render(row) : String((row as any)[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-3 border-t border-ink-200 px-4 py-2 text-xs text-ink-500">
          <button
            type="button"
            disabled={clampedPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded border border-ink-200 px-2 py-1 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            上一页
          </button>
          <span>
            {clampedPage} / {pageCount}
          </span>
          <button
            type="button"
            disabled={clampedPage >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            className="rounded border border-ink-200 px-2 py-1 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
