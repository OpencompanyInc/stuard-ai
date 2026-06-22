import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { DiscoveryTip } from '../../../onboarding/DiscoveryEngine';

interface DiscoveryStatusTickerProps {
  tip: DiscoveryTip;
  onTipAction?: (tip: DiscoveryTip) => void;
  className?: string;
}

/**
 * One tip at a time — slides in from the side, holds, then clears until the
 * next random interval (driven by useStatusDiscoveryTipCycle).
 */
export const DiscoveryStatusTicker: React.FC<DiscoveryStatusTickerProps> = ({
  tip,
  onTipAction,
  className,
}) => {
  const [entered, setEntered] = useState(false);
  const action = (tip.actionLabel || '').trim();
  const interactive = !!tip.actionRoute && !!onTipAction;

  useEffect(() => {
    setEntered(false);
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, [tip.id]);

  const body = (
    <>
      <span className="font-medium text-theme-muted/82">{tip.title}</span>
      <span className="text-theme-muted/58"> — {tip.description}</span>
      {action ? (
        <span className="text-theme-muted/42"> · {action}</span>
      ) : null}
    </>
  );

  const slideClass = clsx(
    'discovery-status-ticker__tip min-w-0 truncate text-[12px] leading-[16px]',
    entered && 'discovery-status-ticker__tip--in',
  );

  return (
    <div
      className={clsx('discovery-status-ticker flex min-w-0 flex-1 items-center gap-2', className)}
      aria-live="polite"
    >
      <span
        className="shrink-0 select-none text-[12px] font-medium leading-[16px] text-theme-muted/35"
        aria-hidden
      >
        /
      </span>

      <div className="discovery-status-ticker__viewport relative min-w-0 flex-1 overflow-hidden">
        {interactive ? (
          <button
            type="button"
            onClick={() => onTipAction?.(tip)}
            className={clsx(
              slideClass,
              'discovery-status-ticker__segment--action w-full text-left',
            )}
          >
            {body}
          </button>
        ) : (
          <div className={slideClass}>{body}</div>
        )}
      </div>
    </div>
  );
};

export default DiscoveryStatusTicker;
