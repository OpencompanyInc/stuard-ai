import type React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Circle, CornerDownRight, ListTodo, Paperclip, Sparkles, X } from "lucide-react";

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
            <ListTodo className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="text-[10px] font-black uppercase tracking-widest text-theme-muted">
              In queue
            </span>
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest text-primary/80 shrink-0">
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
                        <Sparkles className={isFirst ? "w-3.5 h-3.5 text-violet-500" : "w-3.5 h-3.5 text-violet-500/60"} strokeWidth={2.4} />
                      ) : (
                        <CornerDownRight className={isFirst ? "w-3.5 h-3.5 text-primary" : "w-3.5 h-3.5 text-theme-muted/70"} />
                      )
                    ) : (
                      <>
                        <Circle className={isFirst ? "w-3.5 h-3.5 text-primary" : "w-3.5 h-3.5 text-theme-muted/70"} />
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
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-300 text-[9px] font-black uppercase tracking-widest shrink-0 border border-violet-500/15">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-500 opacity-60" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-violet-500" />
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
                    {(isSteer || isFirst) && (
                      <div className={isFirst
                        ? subagentLabel
                          ? "text-[9px] font-black uppercase tracking-widest text-violet-600/90 dark:text-violet-400/90"
                          : "text-[9px] font-black uppercase tracking-widest text-primary/80"
                        : "text-[9px] font-bold uppercase tracking-widest text-theme-muted/70"}>
                        {isSteer
                          ? subagentLabel
                            ? `Nudges ${subagentLabel} at next step`
                            : "Applies next step"
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
