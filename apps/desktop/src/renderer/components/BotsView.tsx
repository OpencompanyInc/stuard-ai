import React, { useMemo } from 'react';
import { BotsView as SharedBotsView, type BotsViewProps } from '@stuardai/bots-ui';
import type { IBotsPlatform } from '@stuardai/bots-ui/platform';
import { createDesktopBotsPlatform } from '../adapters/desktopBotsPlatform';
import { ModelSelector } from './ModelSelector';

export function BotsView({ scope = 'all' }: Omit<BotsViewProps, 'platform'> = {}) {
  const platform = useMemo<IBotsPlatform>(() => ({
    ...createDesktopBotsPlatform(),
    // Same full model picker as chat; '' on the bot config side means Auto.
    renderModelSelector: ({ modelId, onChange }) => (
      <ModelSelector
        selectedModelId={modelId || 'auto'}
        onSelectModel={(id) => onChange(id === 'auto' ? '' : id)}
        side="bottom"
        align="end"
        portal
      />
    ),
  }), []);
  return <SharedBotsView scope={scope} platform={platform} />;
}

export type { BotsViewProps, BotsViewScope } from '@stuardai/bots-ui';
