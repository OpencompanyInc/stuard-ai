import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

// =============================================================================
// TYPES
// =============================================================================

export interface ToolStatus {
  id: string;
  name: string;
  /** 'running' shows spinner, 'done' shows briefly then fades */
  status: 'running' | 'done';
}

interface VoiceToolFeedbackProps {
  tools: ToolStatus[];
}

// Human-friendly tool name mapping
function friendlyToolName(name: string): string {
  const map: Record<string, string> = {
    web_search: 'Searching the web',
    google_search: 'Searching Google',
    send_email: 'Sending email',
    read_email: 'Reading email',
    create_calendar_event: 'Creating event',
    list_calendar_events: 'Checking calendar',
    open_url: 'Opening link',
    read_file: 'Reading file',
    write_file: 'Writing file',
    execute_command: 'Running command',
    github_search: 'Searching GitHub',
    slack_send: 'Sending Slack message',
    memory_store: 'Remembering that',
    memory_search: 'Searching memory',
  };
  return map[name] || name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// =============================================================================
// COMPONENT
// =============================================================================

export function VoiceToolFeedback({ tools }: VoiceToolFeedbackProps) {
  const visible = tools.filter(t => t.status === 'running');

  return (
    <div className="flex flex-wrap justify-center gap-2">
      <AnimatePresence mode="popLayout">
        {visible.map(tool => (
          <motion.div
            key={tool.id}
            layout
            initial={{ opacity: 0, scale: 0.85, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -4 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 backdrop-blur-sm"
          >
            <Loader2 size={10} className="animate-spin text-white/40" />
            <span className="text-[11px] text-white/50 tracking-wide">{friendlyToolName(tool.name)}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
