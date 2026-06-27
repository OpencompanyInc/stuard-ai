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
        className="px-3 py-2 rounded-lg text-[12px] font-semibold bg-white border border-slate-200 shadow-sm hover:bg-slate-50"
      >
        {isOpen ? "Hide Logs" : "Show Logs"}
      </button>

      {isOpen && (
        <div className="mt-2 w-[420px] max-w-[90vw] bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
            <div className="text-[12px] font-semibold text-slate-800">Logs</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSendToChat(joined || "")}
                className="text-[12px] text-indigo-600 hover:text-indigo-800"
              >
                Send to chat
              </button>
              <button
                type="button"
                onClick={onClear}
                className="text-[12px] text-slate-500 hover:text-slate-800"
              >
                Clear
              </button>
            </div>
          </div>
          <pre className="m-0 p-3 text-[11px] text-slate-700 whitespace-pre-wrap break-words max-h-[260px] overflow-auto scrollbar-minimal bg-slate-50">
            {joined || "(no logs)"}
          </pre>
        </div>
      )}
    </div>
  );
}
