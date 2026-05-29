import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Cloud, Loader2, Plus } from 'lucide-react';
import type { Bot, BotsViewScope } from './types';
import { StatCard } from './primitives';
import { padCount } from './helpers';
import { BotCard } from './BotCard';
import { CreateBotModal } from './CreateBotModal';
import { BotDetailView } from './BotDetailView';
import { BotsPlatformProvider, useBotsPlatform } from './BotsPlatformContext';
import type { IBotsPlatform } from './platform';
import { platformConfirm, platformNotify } from './dialogs';

export interface BotsViewProps {
  scope?: BotsViewScope;
  platform: IBotsPlatform;
}

function BotsViewInner({ scope = 'all' }: { scope?: BotsViewScope }) {
  const platform = useBotsPlatform();
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await platform.list();
      if (res?.ok && Array.isArray(res.bots)) setBots(res.bots);
    } catch (e) {
      console.error('Failed to list agents', e);
    }
  }, [platform]);

  useEffect(() => {
    (async () => { await refresh(); setLoading(false); })();
  }, [refresh]);

  // Re-fetch every 10s so cards reflect status / next-run / last-run changes.
  useEffect(() => {
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  const visibleBots = useMemo(
    () => (scope === 'vm' ? bots.filter(b => !!b.vmDeployedAt) : bots),
    [bots, scope],
  );

  const selectedBot = useMemo(() => bots.find(b => b.id === selectedBotId) || null, [bots, selectedBotId]);

  const handleDeleteFromList = useCallback(async (bot: Bot) => {
    const ok = await platformConfirm(platform, {
      title: `Delete “${bot.name}”?`,
      message: 'This permanently removes the agent and its tasks. This can’t be undone.',
      confirmLabel: 'Delete agent',
      tone: 'danger',
    });
    if (!ok) return;
    const res = await platform.delete(bot.id);
    if (res?.ok) {
      if (selectedBotId === bot.id) setSelectedBotId(null);
      await refresh();
    } else if (res?.error) {
      await platformNotify(platform, { title: 'Couldn’t delete agent', message: res.error, tone: 'danger' });
    }
  }, [refresh, selectedBotId, platform]);

  const runningCount = visibleBots.filter(b => b.status === 'running').length;
  const erroredCount = visibleBots.filter(b => b.status === 'errored').length;
  const onVmCount = bots.filter(b => !!b.vmDeployedAt).length;
  const localOnlyCount = bots.filter(b => !b.vmDeployedAt).length;

  const isVmScope = scope === 'vm';
  const headerTitle = isVmScope ? 'Agents on VM' : 'Agents';
  const headerSubtitle = isVmScope
    ? 'Agents running 24/7 on your cloud VM — independent of whether your laptop is open.'
    : 'Build and deploy 24/7 agents — each with its own personality, tools, and memory.';

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-sm text-theme-muted">Loading agents…</span>
      </div>
    );
  }

  if (selectedBot) {
    return (
      <BotDetailView
        bot={selectedBot}
        onBack={() => setSelectedBotId(null)}
        onChange={refresh}
        scope={scope}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col animate-in fade-in duration-300">
      <div className="mb-6 flex flex-shrink-0 items-start justify-between gap-4 px-1">
        <div className="min-w-0">
          <h1 className="font-stuard text-[28px] font-semibold leading-none tracking-tight text-theme-fg">{headerTitle}</h1>
          <p className="mt-2 flex items-center gap-2 text-[13px] text-theme-muted">
            {isVmScope && <Cloud className="h-3.5 w-3.5 shrink-0 text-primary/80" />}
            <span>{headerSubtitle}</span>
          </p>
        </div>
        {!platform.readOnly && (
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            New Agent
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4 scrollbar-minimal">
        <div className="space-y-7">
          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-theme-fg">Overview</h2>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <StatCard value={padCount(visibleBots.length)} label={isVmScope ? 'On VM' : 'Total Agents'} />
              <StatCard value={padCount(runningCount)} label="Running" />
              <StatCard
                value={padCount(isVmScope ? localOnlyCount : onVmCount)}
                label={isVmScope ? 'Local only' : 'On VM'}
              />
              <StatCard value={padCount(erroredCount)} label="Errored" />
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold text-theme-fg">{isVmScope ? 'Deployed to VM' : 'Agents'}</h2>
              <span className="text-[12px] text-theme-muted">
                {visibleBots.length} {isVmScope ? 'on VM' : 'total'}
              </span>
            </div>
            {visibleBots.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-theme/40 bg-zinc-500/5 px-6 py-14 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Cloud className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-[15px] font-semibold text-theme-fg">
                    {isVmScope ? 'No agents on this VM yet' : 'No agents yet'}
                  </h3>
                  <p className="max-w-sm text-[12px] text-theme-muted">
                    {isVmScope
                      ? 'Open any agent and choose “Deploy to VM” so it keeps running even when your laptop is closed.'
                      : 'Create your first agent to put it to work in the background.'}
                  </p>
                </div>
                {!isVmScope && (
                  <button
                    onClick={() => setCreateOpen(true)}
                    className="mt-1 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[12px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New Agent
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visibleBots.map(bot => (
                  <BotCard
                    key={bot.id}
                    bot={bot}
                    onClick={() => setSelectedBotId(bot.id)}
                    onDelete={() => handleDeleteFromList(bot)}
                  />
                ))}
                {!isVmScope && (
                  <button
                    onClick={() => setCreateOpen(true)}
                    className="flex min-h-[140px] items-center justify-center gap-2 rounded-2xl border border-dashed border-theme/40 bg-zinc-500/5 text-[13px] text-theme-muted transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                  >
                    <Plus className="h-4 w-4" />
                    New Agent
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {createOpen && !platform.readOnly && (
        <CreateBotModal
          onClose={() => setCreateOpen(false)}
          onCreated={async (newBot) => {
            setCreateOpen(false);
            await refresh();
            setSelectedBotId(newBot.id);
          }}
        />
      )}
    </div>
  );
}

export function BotsView({ scope = 'all', platform }: BotsViewProps) {
  return (
    <BotsPlatformProvider platform={platform}>
      <BotsViewInner scope={scope} />
    </BotsPlatformProvider>
  );
}
