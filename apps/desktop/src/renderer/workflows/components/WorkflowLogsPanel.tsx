import React, { useMemo } from "react";
import { X, Send, Trash2 } from "lucide-react";

export function WorkflowLogsPanel({
    logs,
    onClear,
    onSendToChat,
    onClose,
}: {
    logs: Array<{ ts: string; msg: string }>;
    onClear: () => void;
    onSendToChat: (text: string) => void;
    onClose: () => void;
}) {
    const joined = useMemo(() => {
        return (logs || [])
            .map((l) => `[${l.ts}] ${l.msg}`)
            .join("\n");
    }, [logs]);

    return (
        <div className="flex flex-col h-full w-full rounded-r-xl overflow-hidden wf-bg-sunken wf-fg">
            <div className="flex items-center justify-between px-4 py-3 shrink-0 border-b wf-border-subtle" style={{ background: 'var(--wf-bg-overlay)' }}>
                <span className="font-semibold wf-fg text-sm">Execution Logs</span>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => onSendToChat(joined || "")}
                        className="p-1.5 rounded-lg wf-fg-faint wf-hover-fg wf-hover-bg transition-colors"
                        title="Send to Chat"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                    <button
                        onClick={onClear}
                        className="p-1.5 rounded-lg wf-fg-faint transition-colors wf-menu-item-danger"
                        title="Clear Logs"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg wf-fg-faint wf-hover-fg wf-hover-bg transition-colors ml-1"
                        title="Close"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
            <div className="flex-1 overflow-auto p-4 scrollbar-minimal">
                <pre className="m-0 text-[12px] font-mono wf-fg-muted whitespace-pre-wrap break-words">
                    {joined || "No logs available for this execution."}
                </pre>
            </div>
        </div>
    );
}
