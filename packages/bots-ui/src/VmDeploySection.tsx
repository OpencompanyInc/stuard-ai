import React, { useState } from 'react';
import { AlertCircle, Cloud, Loader2, Monitor, Pause } from 'lucide-react';
import type { Bot, BadgeTone } from './types';
import { DashboardBadge } from './primitives';
import { humanizeVmError, timeAgo } from './helpers';
import { useBotsPlatform } from './BotsPlatformContext';

export function VmDeploySection({ bot, onChanged }: { bot: Bot; onChanged: () => Promise<void> | void }) {
  const platform = useBotsPlatform();
  const readOnly = !!platform.readOnly;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onVm = !!bot.vmDeployedAt;

  const deploy = async () => {
    if (readOnly || !platform.deploy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await platform.deploy(bot.id);
      if (!res?.ok) setError(humanizeVmError(res?.error));
      else await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (readOnly || !platform.stopOnVm) return;
    setBusy(true);
    setError(null);
    try {
      const res = await platform.stopOnVm(bot.id);
      if (!res?.ok) setError(humanizeVmError(res?.error));
      else await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">Deployment</h3>
      <div className="space-y-2.5">
        <DeployRow
          icon={Monitor}
          title="This computer"
          subtitle="Always on while Stuard is open. Free."
          status="Running"
          tone="success"
        />
        <DeployRow
          icon={Cloud}
          title="Cloud VM (24/7)"
          subtitle={onVm
            ? `Deployed ${timeAgo(bot.vmDeployedAt)} · the VM keeps running this even when your laptop is closed.`
            : 'Push this agent to your cloud VM so it keeps running when your laptop is closed.'}
          status={onVm ? 'On VM' : 'Not deployed'}
          tone={onVm ? 'primary' : 'neutral'}
          action={
            onVm ? (
              <button
                onClick={stop}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full border border-theme bg-theme-card px-3 py-1.5 text-[12px] font-medium text-theme-fg shadow-sm transition hover:bg-theme-hover disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
                Stop on VM
              </button>
            ) : (
              <button
                onClick={deploy}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
                Deploy to VM
              </button>
            )
          }
        />
      </div>
      {error && (
        <div className="mt-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] text-red-300">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertCircle className="h-3 w-3" /> {error}
          </div>
        </div>
      )}
      <p className="mt-2 text-[11px] text-theme-muted/80">
        Deployed agents run on the VM alongside local runs, with their private kanban synced back into this tab.
      </p>
    </section>
  );
}

function DeployRow({
  icon: Icon,
  title,
  subtitle,
  status,
  tone,
  action,
}: {
  icon: any;
  title: string;
  subtitle: string;
  status: string;
  tone: BadgeTone;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[color:var(--dashboard-panel-border)] bg-theme-card px-4 py-3 shadow-sm">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-500/10 text-theme-fg">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-theme-fg">{title}</span>
          <DashboardBadge label={status} tone={tone} />
        </div>
        <p className="mt-0.5 text-[12px] text-theme-muted">{subtitle}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
