import React from 'react';
import clsx from 'clsx';
import { Check, Ban } from 'lucide-react';

export type InputStatusVariant = 'activity' | 'system' | 'planner' | 'discovery';
export type InputStatusActivityState = 'working' | 'done' | 'blocked' | 'idle';

const LABEL =
  'truncate text-[12px] font-normal leading-[16px] tracking-normal text-theme-muted/75';

/** Status strings that should never occupy the input status row. */
export function isMeaningfulInputStatus(text: string | null | undefined): boolean {
  const t = (text || '').trim().toLowerCase();
  return !!t && !['ready', 'idle', 'connected', 'online'].includes(t);
}

interface InputStatusLineProps {
  text?: string | null;
  variant?: InputStatusVariant;
  activityState?: InputStatusActivityState;
  connectionStatus?: 'connected' | 'connecting' | 'disconnected' | 'error';
  /** Optional leading slot — e.g. planner icon chip. */
  leading?: React.ReactNode;
  /** Shown after the tip when variant is `discovery` and the tip is actionable. */
  actionLabel?: string | null;
  onClick?: () => void;
  className?: string;
}

/**
 * Single-line status above the chat input. Calm, sentence-case typography —
 * never the legacy uppercase “READY” treatment.
 */
export const InputStatusLine: React.FC<InputStatusLineProps> = ({
  text,
  variant = 'system',
  activityState = 'working',
  connectionStatus = 'connected',
  leading,
  actionLabel,
  onClick,
  className,
}) => {
  const label = (text || '').trim();
  const hasLabel = variant === 'discovery'
    ? !!label
    : isMeaningfulInputStatus(label);
  const needsConnection =
    variant === 'system' && connectionStatus !== 'connected';
  const action = (actionLabel || '').trim();
  const isInteractive = variant === 'discovery' && !!onClick && (!!action || !!label);

  if (!hasLabel && !leading && !needsConnection) return null;

  const labelClass =
    variant === 'discovery'
      ? 'truncate text-[12px] font-normal leading-[16px] tracking-normal text-theme-muted/70'
      : variant === 'planner'
      ? 'truncate text-[12px] font-medium leading-[16px] tracking-normal text-theme-muted'
      : variant === 'activity'
        ? LABEL
        : clsx(
            LABEL,
            connectionStatus === 'connecting' && 'text-amber-600/85 dark:text-amber-500/85',
            connectionStatus === 'error' && 'text-red-500/90',
          );

  const content = (
    <>
      {leading}
      {!leading && variant === 'discovery' && (
        <span className="shrink-0 text-[12px] font-medium leading-[16px] text-theme-muted/35 select-none">
          /
        </span>
      )}
      {!leading && variant === 'activity' && (
        <>
          {activityState === 'done' && (
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500/90" strokeWidth={2} />
          )}
          {activityState === 'blocked' && (
            <Ban className="h-3.5 w-3.5 shrink-0 text-amber-500/90" strokeWidth={2} />
          )}
          {activityState === 'working' && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-theme-muted/55" />
          )}
        </>
      )}
      {!leading && variant === 'system' && connectionStatus === 'connecting' && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/75" />
      )}
      {!leading && variant === 'system' && connectionStatus === 'error' && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500/90" />
      )}
      {!leading && variant === 'system' && connectionStatus === 'disconnected' && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-theme-muted/45" />
      )}
      {hasLabel ? <span className={labelClass}>{label}</span> : null}
      {variant === 'discovery' && action ? (
        <span className="shrink-0 text-[11px] font-medium leading-[16px] text-theme-muted/45">
          {action}
        </span>
      ) : null}
    </>
  );

  if (isInteractive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={clsx(
          'flex min-w-0 items-center gap-2 text-left transition-opacity hover:opacity-90',
          className,
        )}
        aria-live="polite"
      >
        {content}
      </button>
    );
  }

  return (
    <div className={clsx('flex min-w-0 items-center gap-2', className)} aria-live="polite">
      {content}
    </div>
  );
};

export default InputStatusLine;
