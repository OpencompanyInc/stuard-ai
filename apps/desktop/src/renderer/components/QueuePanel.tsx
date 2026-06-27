import type React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Circle, CornerDownRight, ListTodo, Paperclip, Workflow, X } from "lucide-react";

interface QueuedMessage {
  id: string;
  text: string;
  timestamp: number;
  attachments?: unknown[];
  contextPaths?: unknown[];
  kind?: "message" | "steer";
  subagentTarget?: { id: string; kind: string };
}

const humanizeSubagentKind = (kind: string) =>
  String(kind || "subagent")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

interface QueuePanelProps {
  messages: QueuedMessage[];
  queueDepth: number;
  onCancelMessage?: (id: string) => void;
}

export default function QueuePanel({ messages, queueDepth, onCancelMessage }: QueuePanelProps) {
  const visibleMessages = messages.slice(0, 4);
  const total = Math.max(queueDepth, messages.length);
  const overflowCount = Math.max(0, total - visibleMessages.length);

  if (total <= 0) return null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0, y: 8 }}
      animate={{ opacity: 1, height: "auto", y: 0 }}
      exit={{ opacity: 0, height: 0, y: 8, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className="overflow-hidden"
    >
      <div className="rounded-t-[24px] rounded-b-md bg-theme-hover/35 border-b border-theme/10 px-2.5 pt-2 pb-1.5">
        <div className="flex items-center justify-between gap-3 px-1 pb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <ListTodo className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--primary)" }} />
            <span className="text-[10px] font-black uppercase tracking-widest text-theme-muted">
              In queue
            </span>
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest shrink-0" style={{ color: "var(--primary)" }}>
            {total}
            {overflowCount > 0 ? ` (+${overflowCount} more)` : ""}
          </span>
        </div>

        <ol className="space-y-0.5">
          <AnimatePresence initial={false}>
            {visibleMessages.map((msg, index) => {
              const isFirst = index === 0;
              const isSteer = msg.kind === "steer";
              const subagentLabel = msg.subagentTarget
                ? `${humanizeSubagentKind(msg.subagentTarget.kind)} agent`
                : null;
              // Delegated-agent steer carries the indigo agent accent; orchestrator
              // steer + plain messages stay on the brand red / neutral language.
              const accent = subagentLabel ? "var(--agent-accent)" : "var(--primary)";
              const attachmentCount = (Array.isArray(msg.attachments) ? msg.attachments.length : 0)
                + (Array.isArray(msg.contextPaths) ? msg.contextPaths.length : 0);

              return (
                <motion.li
                  key={msg.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8, transition: { duration: 0.14 } }}
                  className="group flex items-start gap-2 px-2 py-1 rounded-md hover:bg-theme-hover/60 transition-colors"
                >
                  <div className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                    {isSteer ? (
                      subagentLabel ? (
                        <Workflow
                          className="w-3.5 h-3.5"
                          strokeWidth={2.2}
                          style={{ color: isFirst ? accent : "var(--foreground-muted)", opacity: isFirst ? 1 : 0.7 }}
                        />
                      ) : (
                        <CornerDownRight
                          className={isFirst ? "w-3.5 h-3.5" : "w-3.5 h-3.5 text-theme-muted/70"}
                          style={isFirst ? { color: "var(--primary)" } : undefined}
                        />
                      )
                    ) : (
                      <>
                        <Circle
                          className={isFirst ? "w-3.5 h-3.5" : "w-3.5 h-3.5 text-theme-muted/70"}
                          style={isFirst ? { color: "var(--primary)" } : undefined}
                        />
                        <span className="absolute text-[9px] font-black text-theme-fg/80">{index + 1}</span>
                      </>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className={isFirst
                        ? "text-[12px] font-semibold text-theme-fg truncate"
                        : "text-[12px] font-medium text-theme-muted truncate"}>
                        {msg.text || "Empty message"}
                      </p>
                      {subagentLabel && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest shrink-0 border"
                          style={{
                            background: "var(--agent-accent-soft)",
                            color: "var(--agent-accent)",
                            borderColor: "color-mix(in srgb, var(--agent-accent) 22%, transparent)",
                          }}
                        >
                          <span className="relative flex h-1.5 w-1.5">
                            <span
                              className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
                              style={{ background: "var(--agent-accent)" }}
                            />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: "var(--agent-accent)" }} />
                          </span>
                          {subagentLabel}
                        </span>
                      )}
                      {attachmentCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-theme-muted shrink-0">
                          <Paperclip className="w-3 h-3" />
                          {attachmentCount}
                        </span>
                      )}
                    </div>
                    {isFirst && (
                      <div className="text-[10px] font-medium text-theme-muted">
                        {isSteer
                          ? subagentLabel
                            ? `Steers the ${subagentLabel} next`
                            : "Steers the next step"
                          : "Up next"}
                      </div>
                    )}
                  </div>

                  {onCancelMessage && (
                    <button
                      onClick={() => onCancelMessage(msg.id)}
                      className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center hover:bg-red-500/15 text-theme-muted hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                      title="Remove from queue"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      </div>
    </motion.div>
  );
}
