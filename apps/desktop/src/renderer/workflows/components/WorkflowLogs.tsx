import React, { useMemo } from "react";

export function WorkflowLogs({
  logs,
  isOpen,
  onToggle,
  onClear,
  onSendToChat,
}: {
  logs: Array<{ ts: string; msg: string }>;
  isOpen: boolean;
  onToggle: () => void;
  onClear: () => void;
  onSendToChat: (text: string) => void;
}) {
  const joined = useMemo(() => {
    return (logs || [])
      .map((l) => `[${l.ts}] ${l.msg}`)
      .join("\n");
  }, [logs]);

  return (
    <div className="absolute top-4 right-4 z-40">
      <button
        type="button"
        onClick={onToggle}
        className="px-3 py-2 rounded-lg text-[12px] font-semibold bg-white/[0.06] backdrop-blur-2xl border border-white/[0.1] shadow-lg text-white/70 hover:bg-white/[0.1] hover:text-white transition-colors"
      >
        {isOpen ? "Hide Logs" : "Show Logs"}
      </button>

      {isOpen && (
        <div className="mt-2 w-[420px] max-w-[90vw] bg-white/[0.06] backdrop-blur-2xl border border-white/[0.1] rounded-xl shadow-2xl overflow-hidden">
          <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between">
            <div className="text-[12px] font-semibold text-white/80">Logs</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSendToChat(joined || "")}
                className="text-[12px] text-indigo-400 hover:text-indigo-300"
              >
                Send to chat
              </button>
              <button
                type="button"
                onClick={onClear}
                className="text-[12px] text-white/40 hover:text-white/70"
              >
                Clear
              </button>
            </div>
          </div>
          <pre className="m-0 p-3 text-[11px] text-white/60 whitespace-pre-wrap break-words max-h-[260px] overflow-auto scrollbar-minimal bg-black/20">
            {joined || "(no logs)"}
          </pre>
        </div>
      )}
    </div>
  );
}
