import React from 'react';
import { formatTokenCount } from '../helpers/toolGroups';
import type { AssistantTraceStepData } from '../types';

interface StatusTraceMetaProps {
  meta: NonNullable<AssistantTraceStepData['statusMeta']>;
}

export const StatusTraceMeta: React.FC<StatusTraceMetaProps> = ({ meta }) => {
  const { round, maxRounds, tokensBefore, tokensAfter } = meta;
  const hasRound = typeof round === 'number' && typeof maxRounds === 'number';
  const hasTokens = typeof tokensBefore === 'number' && tokensBefore > 0;
  const hasDelta = typeof tokensAfter === 'number' && tokensAfter > 0 && hasTokens;
  if (!hasRound && !hasTokens) return null;

  return (
    <div
      className="rounded-lg px-3 py-2 text-[11px] leading-relaxed"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
        color: 'color-mix(in srgb, var(--foreground) 62%, transparent)',
      }}
    >
      {hasRound ? <div>Round {round} of {maxRounds}</div> : null}
      {hasDelta ? (
        <div>
          {formatTokenCount(tokensBefore!)} <span className="opacity-60">→</span> {formatTokenCount(tokensAfter!)} tokens
        </div>
      ) : hasTokens ? (
        <div>{formatTokenCount(tokensBefore!)} tokens</div>
      ) : null}
    </div>
  );
};
