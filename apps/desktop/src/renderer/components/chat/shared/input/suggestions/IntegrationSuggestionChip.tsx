import React, { memo } from 'react';
import { Loader2, Check, X, ArrowRight } from 'lucide-react';
import { clsx } from 'clsx';
import { getIntegrationIcon, hasBrandLogo } from '../../../../integrationIcons';
import {
  useIntegrationSuggestion,
  type UseIntegrationSuggestionArgs,
  type UseIntegrationSuggestionResult,
} from './useIntegrationSuggestion';

/**
 * Presentational chip. Driven by a suggestion controller so the same hook can feed
 * both the expanded input chip and the compact search-dropdown row.
 */
export const IntegrationSuggestionView = memo(function IntegrationSuggestionView({
  controller,
  compact = false,
}: {
  controller: UseIntegrationSuggestionResult;
  compact?: boolean;
}) {
  const { suggestion, phase, progress, error, act, retry, dismiss } = controller;
  if (!suggestion) return null;

  const working = phase === 'working';
  const done = phase === 'done';
  const errored = phase === 'error';
  const brand = hasBrandLogo(suggestion.slug);

  return (
    <div
      className={clsx(
        'w-full flex items-center gap-2 rounded-xl bg-theme-hover/70 shadow-sm no-drag relative z-20',
        'animate-in fade-in slide-in-from-bottom-1 duration-200',
        compact ? 'px-2 py-1.5' : 'px-2.5 py-1.5',
      )}
    >
      <div
        className={clsx(
          'rounded-md flex items-center justify-center shrink-0 p-1',
          compact ? 'w-6 h-6' : 'w-7 h-7',
          // White plate only for brand logos (some marks are near-black); monochrome
          // lucide icons sit on a theme tint so there's no harsh white box in dark mode.
          done ? 'bg-emerald-500/15' : brand ? 'bg-white' : 'bg-theme-card text-theme-fg',
        )}
      >
        {done ? (
          <Check className="w-3.5 h-3.5 text-emerald-500" />
        ) : (
          getIntegrationIcon(suggestion.slug, 'w-4 h-4')
        )}
      </div>

      <div className="min-w-0 flex-1 leading-tight">
        {done ? (
          <span className="text-[12px] font-semibold text-emerald-600 dark:text-emerald-400">
            {suggestion.name} connected
          </span>
        ) : errored ? (
          <span className="text-[11.5px] text-theme-fg/90 truncate block" title={error}>
            {error}
          </span>
        ) : working ? (
          <span className="text-[12px] text-theme-fg/90 truncate block">
            {progress || `${suggestion.verb === 'Connect' ? 'Connecting' : 'Installing'} ${suggestion.name}…`}
          </span>
        ) : (
          <span className="text-[12px] text-theme-fg/90 truncate block">{suggestion.blurb}</span>
        )}
      </div>

      {working ? (
        <Loader2 className="w-4 h-4 text-theme-muted animate-spin shrink-0 mr-1" />
      ) : errored ? (
        <button
          type="button"
          onClick={retry}
          className="shrink-0 text-[11px] font-bold text-primary hover:opacity-80 px-2 py-1 rounded-md hover:bg-primary/5 transition-colors"
        >
          Retry
        </button>
      ) : done ? null : (
        <button
          type="button"
          onClick={act}
          className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-primary-fg bg-primary hover:opacity-90 active:scale-95 px-2.5 py-1 rounded-md transition-all"
        >
          {suggestion.verb}
          <ArrowRight className="w-3 h-3" />
        </button>
      )}

      {!working && !done && (
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded-md text-theme-muted hover:text-theme-fg hover:bg-theme-active transition-colors"
          title="Dismiss"
        >
          <X className="w-3 h-3" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
});

interface IntegrationSuggestionChipProps extends UseIntegrationSuggestionArgs {
  compact?: boolean;
}

/**
 * Self-contained chip — owns its own suggestion hook. Used where the host doesn't
 * already lift the controller (e.g. the launcher overlay).
 */
export const IntegrationSuggestionChip = memo(function IntegrationSuggestionChip({
  query,
  accessToken,
  enabled = true,
  compact = false,
}: IntegrationSuggestionChipProps) {
  const controller = useIntegrationSuggestion({ query, accessToken, enabled });
  return <IntegrationSuggestionView controller={controller} compact={compact} />;
});
