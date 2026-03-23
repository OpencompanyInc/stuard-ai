import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageCircle,
  Zap,
  Bell,
  Plug,
  Calendar,
  Mail,
  Code,
  Lightbulb,
  FileText,
  FolderSearch,
  Clock,
  Sparkles,
  ListTodo,
  CalendarDays,
  Monitor,
  Workflow,
  GitPullRequest,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useDiscovery } from '../../hooks/useDiscovery';
import type { SuggestedPrompt, FeatureCategory } from './DiscoveryEngine';

// Map icon names to components
const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  MessageCircle,
  Zap,
  Bell,
  Plug,
  Calendar,
  Mail,
  Code,
  Lightbulb,
  FileText,
  FolderSearch,
  Clock,
  Sparkles,
  ListTodo,
  CalendarDays,
  Monitor,
  Workflow,
  GitPullRequest,
};

// Category badge colors
const CATEGORY_STYLES: Record<FeatureCategory | string, { bg: string; text: string; label: string }> = {
  chat: { bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'Chat' },
  workflows: { bg: 'bg-purple-500/10', text: 'text-purple-400', label: 'Workflow' },
  proactive: { bg: 'bg-amber-500/10', text: 'text-amber-400', label: 'Proactive' },
  integrations: { bg: 'bg-green-500/10', text: 'text-green-400', label: 'Integration' },
  planner: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', label: 'Planner' },
  general: { bg: 'bg-white/5', text: 'text-white/50', label: '' },
};

interface SuggestedPromptsProps {
  onSelect: (promptText: string) => void;
  maxVisible?: number;
  className?: string;
  /** Compact mode for inline use */
  compact?: boolean;
  /** Light theme variant */
  light?: boolean;
}

export function SuggestedPrompts({
  onSelect,
  maxVisible = 6,
  className,
  compact = false,
  light = false,
}: SuggestedPromptsProps) {
  const { getSuggestedPrompts, markPromptUsed } = useDiscovery();

  // Memoize prompts so they don't reshuffle on every render
  const prompts = useMemo(() => getSuggestedPrompts(maxVisible), [maxVisible]);

  const handleSelect = (prompt: SuggestedPrompt) => {
    markPromptUsed(prompt.id);
    onSelect(prompt.text);
  };

  if (prompts.length === 0) return null;

  return (
    <div className={clsx('w-full', className)}>
      {!compact && (
        <div className={clsx(
          'flex items-center gap-2 mb-4',
          light ? 'text-slate-500' : 'text-theme-muted',
        )}>
          <Sparkles className="w-3.5 h-3.5" />
          <span className="text-xs uppercase tracking-wider font-medium">Try asking</span>
        </div>
      )}

      <div className={clsx(
        'grid gap-2',
        compact
          ? 'grid-cols-1'
          : prompts.length <= 4
            ? 'grid-cols-2'
            : 'grid-cols-2 lg:grid-cols-3',
      )}>
        <AnimatePresence>
          {prompts.map((prompt, i) => {
            const IconComponent = ICON_MAP[prompt.icon] || MessageCircle;
            const style = CATEGORY_STYLES[prompt.category] || CATEGORY_STYLES.general;

            return (
              <motion.button
                key={prompt.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ delay: i * 0.05, duration: 0.2 }}
                onClick={() => handleSelect(prompt)}
                className={clsx(
                  'group text-left rounded-xl border transition-all',
                  compact ? 'p-3' : 'p-3.5',
                  light
                    ? 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                    : 'border-theme/10 bg-theme-card/70 hover:bg-theme-hover/60 hover:border-theme/20',
                  'active:scale-[0.98]',
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={clsx(
                    'shrink-0 rounded-lg flex items-center justify-center',
                    compact ? 'w-8 h-8' : 'w-9 h-9',
                    style.bg,
                  )}>
                    <IconComponent className={clsx(
                      compact ? 'w-3.5 h-3.5' : 'w-4 h-4',
                      style.text,
                    )} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={clsx(
                      'font-medium leading-snug',
                      compact ? 'text-xs' : 'text-[13px]',
                      light ? 'text-slate-800 group-hover:text-slate-900' : 'text-theme-fg group-hover:text-theme-fg',
                      'transition-colors',
                    )}>
                      {prompt.text}
                    </p>
                    {!compact && style.label && (
                      <span className={clsx(
                        'inline-block mt-1.5 text-[10px] uppercase tracking-wider font-medium',
                        style.text,
                      )}>
                        {style.label}
                      </span>
                    )}
                  </div>
                </div>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
