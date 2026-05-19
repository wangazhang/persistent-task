import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Server, Copy, Check, AlertTriangle } from "lucide-react";

type McpSettings = {
  httpEnabled: boolean;
  httpPort: number;
  actualPort: number | null;
  allowWrite: boolean;
  allowDestructive: boolean;
};

type McpStatus = {
  running: boolean;
  port: number | null;
};

/** 胶囊（iOS 风格）开关。受控组件。 */
function ToggleSwitch({
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 " +
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60 " +
        (disabled ? "cursor-not-allowed opacity-50 " : "cursor-pointer ") +
        (checked ? "bg-brand-600" : "bg-ink-200")
      }
    >
      <span
        className={
          "inline-block h-5 w-5 rounded-full bg-white shadow ring-1 ring-black/5 " +
          "transition-transform duration-200 " +
          (checked ? "translate-x-[22px]" : "translate-x-[2px]")
        }
      />
    </button>
  );
}

// 把当前 settings + status 拉下来；GUI 启动时后端会按 settings 自动启停 server
async function loadSettings(): Promise<McpSettings> {
  return await invoke<McpSettings>("get_mcp_settings");
}
async function loadStatus(): Promise<McpStatus> {
  return await invoke<McpStatus>("get_mcp_status");
}

export function AdvancedPage() {
  const [settings, setSettings] = useState<McpSettings | null>(null);
  const [status, setStatus] = useState<McpStatus>({ running: false, port: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([loadSettings(), loadStatus()]);
      setSettings(s);
      setStatus(st);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 服务器开关
  const toggleServer = async (next: boolean) => {
    setBusy(true);
    try {
      const st: McpStatus = next
        ? await invoke("start_mcp_server")
        : await invoke("stop_mcp_server");
      setStatus(st);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  // 端口修改
  const setPort = async (port: number) => {
    if (!Number.isFinite(port) || port < 1 || port > 65535) return;
    setBusy(true);
    try {
      await invoke("set_mcp_http_port", { port });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  // 权限开关
  const setAllowWrite = async (allow: boolean) => {
    setBusy(true);
    try {
      await invoke("set_mcp_allow_write", { allow });
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const setAllowDestructive = async (allow: boolean) => {
    setBusy(true);
    try {
      await invoke("set_mcp_allow_destructive", { allow });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const endpoint =
    status.running && status.port
      ? `http://127.0.0.1:${status.port}/mcp`
      : null;

  // Claude Desktop 配置 snippet：用户复制后粘贴到 claude_desktop_config.json
  const configSnippet = JSON.stringify(
    {
      mcpServers: {
        "persistent-task": {
          type: "streamable-http",
          url:
            endpoint ??
            `http://127.0.0.1:${settings?.httpPort ?? 7321}/mcp`,
        },
      },
    },
    null,
    2,
  );

  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(configSnippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may fail in webview; ignore */
    }
  };

  if (!settings) {
    return (
      <div className="p-6 text-sm text-ink-500">
        正在加载高级设置…
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-800">高级</h1>
        <p className="mt-1 text-sm text-ink-500">
          MCP 服务、AI agent 接入、危险权限开关。这里的选项只在你明确需要时开启。
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mr-1 inline h-4 w-4" />
          {error}
        </div>
      )}

      {/* MCP 服务 */}
      <section className="rounded-xl border border-ink-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <Server className="h-5 w-5 text-brand-600" />
          <h2 className="text-base font-semibold text-ink-800">MCP 服务</h2>
          <span
            className={`ml-auto rounded-full px-2 py-0.5 text-xs ${
              status.running
                ? "bg-emerald-50 text-emerald-700"
                : "bg-ink-100 text-ink-500"
            }`}
          >
            {status.running ? `运行中 · :${status.port}` : "已停止"}
          </span>
        </div>

        <p className="mb-4 text-sm text-ink-500 leading-relaxed">
          启用后，本机的 AI agent（Claude Desktop、Cursor 等）可通过 HTTP MCP 协议
          读写你的任务、标签、番茄钟。服务仅监听 <code>127.0.0.1</code>，不会暴露到局域网。
        </p>

        <div className="flex items-center gap-4">
          <div className="inline-flex items-center gap-3">
            <ToggleSwitch
              checked={status.running}
              onChange={toggleServer}
              disabled={busy}
              ariaLabel="启用 MCP 服务"
            />
            <span className="text-sm text-ink-700">启用 MCP 服务</span>
          </div>

          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-ink-500">端口</span>
            <input
              type="number"
              min={1024}
              max={65535}
              value={settings.httpPort}
              disabled={busy || status.running}
              onChange={(e) => {
                const p = Number(e.target.value);
                setSettings({ ...settings, httpPort: p });
              }}
              onBlur={(e) => setPort(Number(e.target.value))}
              className="w-24 rounded-md border border-ink-200 px-2 py-1"
            />
            {status.running && (
              <span className="text-[11px] text-ink-400">
                （需停止后才能修改）
              </span>
            )}
          </div>
        </div>

        {endpoint && (
          <div className="mt-4 rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-600">
            端点：<code className="font-mono">{endpoint}</code>
          </div>
        )}

        {/* Agent 配置 snippet */}
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-ink-600">
              Claude Desktop 配置（复制到 claude_desktop_config.json）
            </span>
            <button
              type="button"
              onClick={copyConfig}
              className="inline-flex items-center gap-1 rounded-md border border-ink-200 px-2 py-1 text-xs text-ink-700 hover:bg-ink-50"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3" /> 已复制
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" /> 复制
                </>
              )}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-md border border-ink-200 bg-ink-50 px-3 py-2 text-[11px] leading-relaxed text-ink-700">
            {configSnippet}
          </pre>
        </div>
      </section>

      {/* MCP 权限 */}
      <section className="rounded-xl border border-ink-200 bg-white p-5">
        <h2 className="mb-3 text-base font-semibold text-ink-800">MCP 权限</h2>
        <p className="mb-4 text-sm text-ink-500 leading-relaxed">
          默认情况下 MCP 仅允许读取数据。要让 agent 创建/修改/删除任务，需要明确开启对应权限。
        </p>

        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-md p-3 hover:bg-ink-50">
            <ToggleSwitch
              checked={settings.allowWrite}
              onChange={setAllowWrite}
              disabled={busy}
              ariaLabel="允许写工具"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-ink-800">允许写工具</div>
              <div className="text-xs text-ink-500">
                创建/修改/删除任务、标签、番茄记录。开启后 agent 可以替你修改数据。
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-md p-3 hover:bg-ink-50">
            <ToggleSwitch
              checked={settings.allowDestructive}
              onChange={setAllowDestructive}
              disabled={busy || !settings.allowWrite}
              ariaLabel="允许危险工具"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-ink-800">
                允许危险工具
              </div>
              <div className="text-xs text-ink-500">
                数据库导入 / 清空全部数据。强烈建议保持关闭，仅在备份恢复等场景临时开启。
                必须先开「允许写工具」。
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
