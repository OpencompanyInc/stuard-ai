'use client';

import React, { useMemo } from 'react';
import { BotsView } from '@stuardai/bots-ui';
import { createWebVmBotsPlatform } from '@/lib/webVmBotsPlatform';

interface Props {
  engine: any;
  className?: string;
}

export function CloudVmBots({ className }: Props) {
  const platform = useMemo(() => createWebVmBotsPlatform(), []);
  return (
    <div className={className}>
      <BotsView scope="vm" platform={platform} />
    </div>
  );
}
