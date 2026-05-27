import React, { useMemo } from 'react';
import { BotsView as SharedBotsView, type BotsViewProps } from '@stuardai/bots-ui';
import { createDesktopBotsPlatform } from '../adapters/desktopBotsPlatform';

export function BotsView({ scope = 'all' }: Omit<BotsViewProps, 'platform'> = {}) {
  const platform = useMemo(() => createDesktopBotsPlatform(), []);
  return <SharedBotsView scope={scope} platform={platform} />;
}

export type { BotsViewProps, BotsViewScope } from '@stuardai/bots-ui';
