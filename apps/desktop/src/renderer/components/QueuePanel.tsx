import type React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, MoreHorizontal, X } from "lucide-react";

interface QueuedMessage {
  id: string;
  text: string;
  timestamp: number;
}

interface QueuePanelProps {
  messages: QueuedMessage[];
  queueDepth: number;
  onCancelMessage?: (id: string) => void;
}

export default function QueuePanel({ messages, queueDepth, onCancelMessage }: QueuePanelProps) {
  return (
    <div className="absolute bottom-full left-2 right-2 mb-2 z-[60] flex flex-col gap-1.5 pointer-events-none">
      <AnimatePresence mode="popLayout">
        {messages.slice(0, 3).map((msg, index) => {
          const isFirst = index === 0;
          return (
            <motion.div
              key={msg.id}
              layout
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ 
                opacity: isFirst ? 1 : 0.6, 
                y: 0, 
                scale: 1,
              }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
              className={`rounded-xl border backdrop-blur-md overflow-hidden flex items-center px-3 py-2.5 gap-3 shadow-lg pointer-events-auto group ${
                isFirst 
                  ? 'bg-theme-card/95 border-primary/30 ring-1 ring-primary/10' 
                  : 'bg-theme-card/60 border-theme/10 scale-[0.98] origin-bottom'
              }`}
            >
              <div className="relative flex items-center justify-center shrink-0">
                <Clock className={`w-4 h-4 ${isFirst ? 'text-primary' : 'text-theme-muted'}`} />
                {isFirst && (
                  <motion.div 
                    animate={{ rotate: 360 }} 
                    transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                    className="absolute inset-0 rounded-full border border-primary border-t-transparent opacity-50"
                  />
                )}
              </div>
              
              <div className="flex-1 min-w-0 flex flex-col">
                <span className={`text-sm font-medium truncate ${isFirst ? 'text-theme-fg' : 'text-theme-muted'}`}>
                  {msg.text || 'Empty message'}
                </span>
              </div>
              
              {isFirst && (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-primary flex items-center gap-1">
                    Up Next
                  </span>
                </div>
              )}
              
              {onCancelMessage && (
                <button
                  onClick={() => onCancelMessage(msg.id)}
                  className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center hover:bg-red-500/20 text-theme-muted hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                  title="Remove from queue"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
      
      <AnimatePresence>
        {messages.length > 3 && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="flex justify-center mt-1"
          >
            <span className="text-[10px] text-theme-muted font-bold tracking-wider uppercase bg-theme-card/80 px-3 py-1 rounded-full border border-theme/10 backdrop-blur-md shadow-sm flex items-center gap-1 pointer-events-auto">
              <MoreHorizontal className="w-3 h-3" />
              {messages.length - 3} more
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
