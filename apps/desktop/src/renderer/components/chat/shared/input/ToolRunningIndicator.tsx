import React from 'react';
import { clsx } from 'clsx';
import {
  hasInFlightToolCalls,
  usingToolStatusText,
  type ToolCallLike,
} from '../../../../utils/toolBrand';
import { ToolBrandStack } from './ToolBrandStack';

interface ToolRunningIndicatorProps {
  toolCalls: readonly ToolCallLike[];
  compact?: boolean;
  className?: string;
}

/**
 * In-flight tool status: overlapping brand icons + "Using Browser…" label.
 * Replaces the legacy status bar / spinner row while tools are running.
 */
export const ToolRunningIndicator: React.FC<ToolRunningIndicatorProps> = ({
  toolCalls,
  compact = false,
  className,
}) => {
  if (!hasInFlightToolCalls(toolCalls)) return null;

  const label = usingToolStatusText(toolCalls);
  if (!label) return null;

  return (
    <div
      className={clsx('flex items-center gap-2.5 min-w-0', className)}
      aria-live="polite"
      aria-label={label}
    >
      <ToolBrandStack
        toolCalls={toolCalls}
        overlap
        size={compact ? 'sm' : 'md'}
      />
      <span
        className={clsx(
          'truncate text-theme-muted font-medium',
          compact ? 'text-[11px]' : 'text-[12px]',
        )}
      >
        {label}
      </span>
    </div>
  );
};

export default ToolRunningIndicator;
