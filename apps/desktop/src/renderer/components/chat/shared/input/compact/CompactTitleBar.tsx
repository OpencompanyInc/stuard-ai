import React from 'react';
import { clsx } from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';

import {
  TabHistoryMenu,
  type ConversationHistoryItem,
} from '../../TabHistoryMenu';

interface CompactTitleBarProps {
  show: boolean;
  /** Bump height in px — caller controls layout reservation. */
  bumpHeight: number;
  /** How many px the bump overlaps the pill below it. */
  overlap: number;
  /** Title text to render in the centered bump. */
  title: string;
  /** Mirror the pill's working state with an animated green dot. */
  isAiWorking: boolean;

  /** Tab-history menu props passed through unchanged. */
  chatMenuOpen: boolean;
  onChatMenuOpenChange: (open: boolean) => void;
  conversations: ConversationHistoryItem[];
  loadingConversations: boolean;
  activeConversationId?: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
}

/**
 * Centered title bump above the compact input pill. Mounts/unmounts with
 * a layered scale animation so it feels like the pill is "growing" a tab.
 */
export const CompactTitleBar: React.FC<CompactTitleBarProps> = ({
  show,
  bumpHeight,
  overlap,
  title,
  isAiWorking,
  chatMenuOpen,
  onChatMenuOpenChange,
  conversations,
  loadingConversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
}) => {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="compact-title-bump"
          className="absolute left-1/2 flex items-center gap-1.5 pl-2.5 pr-1.5 pointer-events-auto compact-title-bump"
          style={{
            bottom: '100%',
            marginBottom: -overlap,
            height: bumpHeight,
            width: 'min(68%, 220px)',
            minWidth: 108,
            zIndex: 4,
            transformOrigin: 'bottom center',
          }}
          initial={{ opacity: 0, x: '-50%', scaleX: 0.82, scaleY: 0.55 }}
          animate={{ opacity: 1, x: '-50%', scaleX: 1, scaleY: 1 }}
          exit={{ opacity: 0, x: '-50%', scaleX: 0.86, scaleY: 0.6 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          <div
            className={clsx(
              'w-1.5 h-1.5 rounded-full shrink-0',
              isAiWorking ? 'bg-emerald-400 animate-pulse' : 'bg-pill-fg/30',
            )}
          />
          <span
            className="flex-1 min-w-0 text-[10px] font-medium text-pill-fg/80 truncate"
            title={title}
          >
            {title}
          </span>
          <TabHistoryMenu
            open={chatMenuOpen}
            onOpenChange={onChatMenuOpenChange}
            variant="compact"
            align="center"
            conversations={conversations}
            loadingConversations={loadingConversations}
            activeConversationId={activeConversationId}
            onSelectConversation={onSelectConversation}
            onNewChat={onNewChat}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CompactTitleBar;
