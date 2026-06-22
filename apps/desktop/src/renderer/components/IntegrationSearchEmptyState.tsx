import React from 'react';
import { MessageSquarePlus, Plug, Wand2 } from 'lucide-react';
import clsx from 'clsx';
import { openIntegrationRequest } from '../utils/integrationDiscovery';

export interface IntegrationSearchEmptyStateProps {
  /** Active search string, if any. */
  query?: string;
  /** Compact layout for narrow panels (workflow toolbox). */
  variant?: 'compact' | 'card';
  /** Opens the in-app integration builder (workflow editor). When omitted, only request is offered. */
  onBuildIntegration?: () => void;
  /** Optional secondary action (e.g. clear filters). */
  secondaryAction?: { label: string; onClick: () => void };
  className?: string;
}

export function IntegrationSearchEmptyState({
  query,
  variant = 'card',
  onBuildIntegration,
  secondaryAction,
  className,
}: IntegrationSearchEmptyStateProps) {
  const trimmed = String(query || '').trim();
  const isCompact = variant === 'compact';

  const handleRequest = () => void openIntegrationRequest(trimmed || undefined);
  const handleBuild = () => {
    if (onBuildIntegration) onBuildIntegration();
  };

  return (
    <div
      className={clsx(
        'text-center',
        isCompact ? 'px-2 py-8' : 'px-6 py-10',
        className,
      )}
    >
      <div
        className={clsx(
          'mx-auto mb-3 flex items-center justify-center rounded-2xl border',
          isCompact
            ? 'h-12 w-12 wf-bg-overlay wf-border-subtle'
            : 'h-14 w-14 border-[color:var(--dashboard-panel-border)] bg-theme-hover/40',
        )}
      >
        <Plug
          className={clsx(
            isCompact ? 'h-5 w-5 wf-fg-muted' : 'h-6 w-6 text-theme-muted-soft',
          )}
        />
      </div>

      <h3
        className={clsx(
          'font-semibold text-theme-fg',
          isCompact ? 'text-xs wf-fg' : 'text-[15px]',
        )}
      >
        {trimmed ? "Can't find it?" : 'Looking for something else?'}
      </h3>

      <p
        className={clsx(
          'mt-1.5 leading-relaxed',
          isCompact
            ? 'text-[10px] wf-fg-muted max-w-[220px] mx-auto'
            : 'max-w-sm text-[12px] text-theme-muted mx-auto',
        )}
      >
        {trimmed ? (
          <>
            No match for <span className="font-medium text-theme-fg">&ldquo;{trimmed}&rdquo;</span>.
            {' '}Request an integration or build your own custom tool.
          </>
        ) : (
          <>Request an integration from our team, or build your own custom tool in minutes.</>
        )}
      </p>

      <div
        className={clsx(
          'mt-4 flex flex-col gap-2',
          !isCompact && 'sm:flex-row sm:items-center sm:justify-center',
        )}
      >
        <button
          type="button"
          onClick={handleRequest}
          className={clsx(
            'inline-flex items-center justify-center gap-1.5 font-semibold transition-colors',
            isCompact
              ? 'rounded-lg border wf-border-subtle wf-hover-bg px-3 py-2 text-[11px] wf-fg'
              : 'dashboard-refresh-button px-3.5 py-2 text-[12px]',
          )}
        >
          <MessageSquarePlus className={isCompact ? 'h-3.5 w-3.5' : 'h-3.5 w-3.5'} />
          Request integration
        </button>

        {onBuildIntegration ? (
          <button
            type="button"
            onClick={handleBuild}
            className={clsx(
              'inline-flex items-center justify-center gap-1.5 font-semibold transition-all',
              isCompact
                ? 'rounded-lg px-3 py-2 text-[11px] wf-primary-btn'
                : 'rounded-md border border-primary/25 bg-primary/10 px-3.5 py-2 text-[12px] text-primary hover:bg-primary/15',
            )}
          >
            <Wand2 className={isCompact ? 'h-3.5 w-3.5' : 'h-3.5 w-3.5'} />
            Build your own
          </button>
        ) : null}
      </div>

      {secondaryAction ? (
        <button
          type="button"
          onClick={secondaryAction.onClick}
          className={clsx(
            'mt-3 text-[11px] font-medium text-theme-muted hover:text-theme-fg transition-colors',
            isCompact && 'wf-fg-muted wf-hover-fg',
          )}
        >
          {secondaryAction.label}
        </button>
      ) : null}
    </div>
  );
}
