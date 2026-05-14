import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

export type DataTab = "tasks" | "tags" | "pomodoros";

const VALID: DataTab[] = ["tasks", "tags", "pomodoros"];

export function useDataUrlState(): {
  tab: DataTab;
  setTab: (t: DataTab) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("tab");
  const tab: DataTab =
    raw && (VALID as string[]).includes(raw) ? (raw as DataTab) : "tasks";

  const setTab = useCallback(
    (t: DataTab) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (t === "tasks") params.delete("tab");
          else params.set("tab", t);
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  return { tab, setTab };
}
