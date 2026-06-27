import React from 'react';
import { clsx } from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar,
  FileText,
  FolderSearch,
  MessageSquare,
  Sparkles,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useLauncherPersonalization } from '../../../../hooks/useLauncherPersonalization';
import {
  LAUNCHER_SUGGESTION_COUNT,
  pickSuggestionIcon,
  type SuggestionIconKind,
} from './greeting';

interface LauncherGreetingProps {
  accessToken?: string | null;
  onSelectSuggestion?: (text: string) => void;
  className?: string;
}

const ICON_MAP: Record<SuggestionIconKind, LucideIcon> = {
  message: MessageSquare,
  search: FolderSearch,
  calendar: Calendar,
  sparkles: Sparkles,
  workflow: Workflow,
  file: FileText,
  zap: Zap,
};

export const LauncherGreeting: React.FC<LauncherGreetingProps> = ({
  accessToken,
  onSelectSuggestion,
  className,
}) => {
  const { greeting, firstName, suggestions, isLoading, suggestionsLoading } =
    useLauncherPersonalization(accessToken);

  const headline = firstName ? `${greeting}, ${firstName}` : greeting;

  return (
    <div
      className={clsx(
        'flex flex-1 flex-col items-center justify-start min-h-0 overflow-y-auto scrollbar-minimal px-4 pt-8 pb-4 select-none text-center',
        className,
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-theme-muted leading-5">
        Stuard
      </p>
      <h1
        className={clsx(
          'mt-3 text-[26px] font-semibold tracking-tight text-theme-fg leading-tight',
          isLoading && !firstName && 'animate-pulse',
        )}
      >
        {headline}
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-theme-muted max-w-md mx-auto">
        Ask anything, search your files, or run a workflow.
      </p>

      {(suggestionsLoading || suggestions.length > 0) && (
        <div className="mt-5 flex flex-col gap-2 w-full max-w-md mx-auto">
          {suggestionsLoading && suggestions.length === 0
            ? Array.from({ length: LAUNCHER_SUGGESTION_COUNT }).map((_, i) => (
                <span
                  key={`skeleton-${i}`}
                  className="launcher-suggestion-chip launcher-suggestion-chip--skeleton h-11 w-full rounded-[12px] animate-pulse"
                />
              ))
            : (
              <AnimatePresence mode="popLayout">
                {suggestions.map((suggestion, index) => {
                  const iconKind = pickSuggestionIcon(suggestion, index);
                  const Icon = ICON_MAP[iconKind];

                  return (
                    <motion.button
                      key={suggestion}
                      type="button"
                      layout
                      initial={{ opacity: 0, y: 10, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.99 }}
                      transition={{
                        duration: 0.38,
                        delay: index * 0.07,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      onClick={() => onSelectSuggestion?.(suggestion)}
                      className="launcher-suggestion-chip group flex items-center gap-3 w-full px-3 py-2.5 rounded-[12px] text-left transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 active:scale-[0.995]"
                    >
                      <span className="launcher-suggestion-chip__icon flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-theme/15">
                        <Icon className="h-4 w-4 text-theme-muted group-hover:text-primary transition-colors" strokeWidth={1.75} />
                      </span>
                      <span className="flex-1 min-w-0 text-[12.5px] font-medium leading-snug text-theme-fg/90">
                        {suggestion}
                      </span>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            )}
        </div>
      )}
    </div>
  );
};
