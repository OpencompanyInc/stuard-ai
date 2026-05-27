import React, { createContext, useContext } from 'react';
import type { IBotsPlatform } from './platform';

const BotsPlatformContext = createContext<IBotsPlatform | null>(null);

export function BotsPlatformProvider({
  platform,
  children,
}: {
  platform: IBotsPlatform;
  children: React.ReactNode;
}) {
  return (
    <BotsPlatformContext.Provider value={platform}>
      {children}
    </BotsPlatformContext.Provider>
  );
}

export function useBotsPlatform(): IBotsPlatform {
  const ctx = useContext(BotsPlatformContext);
  if (!ctx) {
    throw new Error('useBotsPlatform must be used within BotsPlatformProvider');
  }
  return ctx;
}
