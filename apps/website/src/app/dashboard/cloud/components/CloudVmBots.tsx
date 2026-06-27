'use client';

import React, { useMemo } from 'react';
import { clsx } from 'clsx';
import { BotsView } from '@stuardai/bots-ui';
import { createWebVmBotsPlatform } from '@/lib/webVmBotsPlatform';

interface Props {
  engine: any;
  className?: string;
}

export function CloudVmBots({ className }: Props) {
  const platform = useMemo(() => createWebVmBotsPlatform(), []);
  // Pass a definite height down so BotsView's workspace shell (fixed header +
  // internally-scrolling content + fill-height kanban board) can size itself.
  // Without h-full here the chain collapses to content height and the board
  // can't fill, so the layout drifts on phone/web the same way it did before.
  return (
    <div className={clsx('h-full min-h-0', className)}>
      <BotsView scope="vm" platform={platform} />
    </div>
  );
}
