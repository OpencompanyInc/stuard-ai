import type React from "react";
import { useEffect, useState } from "react";

interface QueuedMessage {
  id: string;
  text: string;
  timestamp: number;
}

interface QueuePanelProps {
  messages: QueuedMessage[];
  queueDepth: number;
}

export default function QueuePanel({ messages, queueDepth }: QueuePanelProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (queueDepth > 0) {
      setVisible(true);
    } else {
      // Delay hiding to allow exit animation
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [queueDepth]);

  if (!visible && queueDepth === 0) return null;

  return (
    <div
      className={`absolute bottom-full left-2 right-2 mb-1 transition-all duration-300 ease-out z-[60] ${
        queueDepth > 0 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      }`}
      style={{ maxHeight: '72px' }}
    >
      <div className="rounded-xl border border-theme/20 bg-theme-card/80 backdrop-blur-md shadow-xl overflow-hidden">
        {/* Header */}
        <div className="px-3 py-2 flex items-center gap-2 text-theme-fg">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-sm shadow-primary/20" />
          <span className="text-[11px] font-black uppercase tracking-widest text-primary">Queued {queueDepth}</span>
          <span className="text-[11px] text-theme-muted">•</span>
          <span className="text-[11px] truncate font-bold text-theme-muted" title={messages[0]?.text || ''}>
            {(messages[0]?.text || '').length > 60
              ? (messages[0]?.text || '').slice(0, 60) + '…'
              : (messages[0]?.text || '')}
          </span>
          {queueDepth > 1 && (
            <span className="ml-auto text-[10px] text-theme-muted font-black uppercase tracking-widest bg-theme-hover/50 px-1.5 py-0.5 rounded">+{queueDepth - 1} more</span>
          )}
        </div>

        {/* Footer with progress indicator */}
        {queueDepth > 0 && (
          <div className="h-0.5 w-full bg-theme-hover relative overflow-hidden">
            <div className="absolute inset-0 bg-primary/30 w-1/3 animate-[progressSlide_2s_infinite_linear]" />
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(-8px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes progressSlide {
          0% {
            transform: translateX(-100%);
          }
          50% {
            transform: translateX(250%);
          }
          100% {
            transform: translateX(-100%);
          }
        }

        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
