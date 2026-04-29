import type React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Circle, CornerDownRight, ListTodo, MoreHorizontal, Paperclip, X } from "lucide-react";

interface QueuedMessage {
  id: string;
  text: string;
  timestamp: number;
  attachments?: unknown[];
  contextPaths?: unknown[];
  kind?: "message" | "steer";
}

interface QueuePanelProps {
  messages: QueuedMessage[];
  queueDepth: number;
  onCancelMessage?: (id: string) => void;
}

export default function QueuePanel({ messages, queueDepth, onCancelMessage }: QueuePanelProps) {
  const visibleMessages = messages.slice(0, 5);
  const overflowCount = Math.max(0, Math.max(queueDepth, messages.length) - visibleMessages.length);

  if (queueDepth <= 0 && messages.length === 0) return null;

  return (
    <div className="absolute bottom-full left-2 right-2 mb-2 z-[60] pointer-events-none">
      <AnimatePresence mode="popLayout">
        <motion.div
          key="queue-list"
          layout
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.16 } }}
          className="rounded-xl border border-primary/20 bg-theme-card/95 backdrop-blur-md shadow-xl pointer-events-auto overflow-hidden"
        >
          <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-theme/10">
            <div className="flex items-center gap-2 min-w-0">
              <ListTodo className="w-4 h-4 text-primary shrink-0" />
              <span className="text-[11px] font-black uppercase tracking-widest text-theme-muted">
                Message queue
              </span>
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-primary shrink-0">
              {Math.max(queueDepth, messages.length)} pending
            </span>
          </div>

          <ol className="py-1">
            {visibleMessages.map((msg, index) => {
              const isFirst = index === 0;
              const isSteer = msg.kind === "steer";
              const attachmentCount = (Array.isArray(msg.attachments) ? msg.attachments.length : 0)
                + (Array.isArray(msg.contextPaths) ? msg.contextPaths.length : 0);

              return (
                <motion.li
                  key={msg.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8, transition: { duration: 0.14 } }}
                  className="group flex items-start gap-2.5 px-3 py-2 hover:bg-theme-hover/50 transition-colors"
                >
                  <div className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                    {isSteer ? (
                      <CornerDownRight className={isFirst ? "w-4 h-4 text-primary" : "w-4 h-4 text-theme-muted/70"} />
                    ) : (
                      <>
                        <Circle className={isFirst ? "w-4 h-4 text-primary" : "w-4 h-4 text-theme-muted/70"} />
                        <span className="absolute text-[9px] font-black text-theme-fg/80">{index + 1}</span>
                      </>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className={isFirst ? "text-[13px] font-semibold text-theme-fg truncate" : "text-[13px] font-medium text-theme-muted truncate"}>
                        {msg.text || "Empty message"}
                      </p>
                      {attachmentCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-theme-muted shrink-0">
                          <Paperclip className="w-3 h-3" />
                          {attachmentCount}
                        </span>
                      )}
                    </div>
                    <div className={isFirst ? "mt-0.5 text-[10px] font-black uppercase tracking-widest text-primary" : "mt-0.5 text-[10px] font-bold uppercase tracking-widest text-theme-muted/70"}>
                      {isSteer ? "Applies next step" : isFirst ? "Up next" : "Queued"}
                    </div>
                  </div>

                  {onCancelMessage && (
                    <button
                      onClick={() => onCancelMessage(msg.id)}
                      className="mt-0.5 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center hover:bg-red-500/15 text-theme-muted hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                      title="Remove from queue"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </motion.li>
              );
            })}
          </ol>
        </motion.div>
      </AnimatePresence>
      
      <AnimatePresence>
        {overflowCount > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="flex justify-center mt-1"
          >
            <span className="text-[10px] text-theme-muted font-bold tracking-wider uppercase bg-theme-card/80 px-3 py-1 rounded-full border border-theme/10 backdrop-blur-md shadow-sm flex items-center gap-1 pointer-events-auto">
              <MoreHorizontal className="w-3 h-3" />
              {overflowCount} more
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
