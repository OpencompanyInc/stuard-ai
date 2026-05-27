import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { AlertCircle, Check, Loader2, Plus, Settings2, Trash2, Zap } from 'lucide-react';
import type { Bot, BotTrigger, BotTriggerType } from './types';
import { TRIGGER_META } from './constants';
import { Toggle } from './primitives';
import { describeTrigger } from './helpers';
import {
  IntervalEditor,
  CronEditor,
  WebhookEditor,
  FileWatchEditor,
  CommandWatchEditor,
  GmailEditor,
} from './trigger-editors';
import { useBotsPlatform } from './BotsPlatformContext';

export function TriggersSection({ bot, onChanged }: { bot: Bot; onChanged: () => Promise<void> | void }) {
  const platform = useBotsPlatform();
  const readOnly = !!platform.readOnly;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleAdd = async (type: BotTriggerType) => {
    if (readOnly || !platform.addTrigger) return;
    setPickerOpen(false);
    const res = await platform.addTrigger(bot.id, { type });
    if (res?.ok && res.trigger) {
      await onChanged();
      const trigger = res.trigger as { id?: string };
      if (type !== 'manual' && trigger.id) setEditingId(trigger.id);
    } else if (res?.error === 'invalid_input') {
      alert('That trigger type is already on this agent. Pick a different one or edit the existing trigger.');
    }
  };

  const handleRemove = async (triggerId: string) => {
    if (readOnly || !platform.removeTrigger) return;
    const res = await platform.removeTrigger(bot.id, triggerId);
    if (!res?.ok) {
      alert('An agent must keep at least one trigger. Switch this one to "Manual" if you want no automation.');
      return;
    }
    await onChanged();
  };

  const handleToggleEnabled = async (trigger: BotTrigger) => {
    if (readOnly || !platform.updateTrigger) return;
    await platform.updateTrigger(bot.id, trigger.id, { enabled: !(trigger.enabled !== false) });
    await onChanged();
  };

  const editingTrigger = editingId ? bot.triggers.find(t => t.id === editingId) : null;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-theme-fg">When should this agent run?</h3>
          <p className="mt-0.5 text-[12px] text-theme-muted">Add as many triggers as you want. Any one firing wakes the agent.</p>
        </div>
        <button
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-theme bg-theme-card px-3 py-1.5 text-[12px] font-medium text-theme-fg shadow-sm transition hover:bg-theme-hover"
        >
          <Plus className="h-3 w-3" />
          Add trigger
        </button>
      </div>

      <div className="space-y-2.5">
        {bot.triggers.map(trigger => (
          <TriggerRow
            key={trigger.id}
            trigger={trigger}
            onEdit={() => setEditingId(trigger.id)}
            onToggle={() => handleToggleEnabled(trigger)}
            onRemove={bot.triggers.length > 1 ? () => handleRemove(trigger.id) : undefined}
          />
        ))}
      </div>

      {pickerOpen && (
        <TriggerPickerModal
          existing={bot.triggers}
          onClose={() => setPickerOpen(false)}
          onPick={handleAdd}
        />
      )}

      {editingTrigger && (
        <TriggerEditModal
          botId={bot.id}
          trigger={editingTrigger}
          onClose={() => setEditingId(null)}
          onSaved={async () => { setEditingId(null); await onChanged(); }}
        />
      )}
    </section>
  );
}

function TriggerRow({
  trigger,
  onEdit,
  onToggle,
  onRemove,
}: {
  trigger: BotTrigger;
  onEdit: () => void;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  const meta = TRIGGER_META[trigger.type];
  const Icon = meta?.icon || Zap;
  const enabled = trigger.enabled !== false;
  const desc = describeTrigger(trigger);

  return (
    <div className={clsx(
      'flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-sm transition',
      enabled
        ? 'border-theme/40 bg-theme-card'
        : 'border-theme/30 bg-theme-card/40 opacity-70',
    )}>
      <div className={clsx(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
        enabled ? 'bg-primary/10 text-primary' : 'bg-zinc-500/10 text-theme-muted',
      )}>
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-theme-fg">{meta?.label || trigger.type}</span>
          {trigger.requiresCloud && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
              <AlertCircle className="h-2.5 w-2.5" />
              cloud delivery pending
            </span>
          )}
        </div>
        <div className="truncate text-[12px] text-theme-muted">{desc}</div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Toggle checked={enabled} onChange={onToggle} />
        {trigger.type !== 'manual' && (
          <button
            onClick={onEdit}
            className="rounded-lg p-1.5 text-theme-muted transition hover:bg-zinc-500/10 hover:text-theme-fg"
            title="Edit"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        )}
        {onRemove && (
          <button
            onClick={onRemove}
            className="rounded-lg p-1.5 text-theme-muted transition hover:bg-rose-500/10 hover:text-rose-500"
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function TriggerPickerModal({
  existing,
  onClose,
  onPick,
}: {
  existing: BotTrigger[];
  onClose: () => void;
  onPick: (type: BotTriggerType) => void;
}) {
  // 'gmail.new_email' removed pending Google CASA verification (requires gmail.readonly restricted scope).
  const types: BotTriggerType[] = ['schedule.interval', 'schedule.cron', 'webhook', 'fs.watch', 'command.watch', /* 'gmail.new_email', */ 'manual'];
  const hasInterval = existing.some(t => t.type === 'schedule.interval');

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      style={{ WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-[color:var(--dashboard-panel-border)] bg-theme-card p-5 shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4">
          <h2 className="font-stuard text-lg font-semibold text-theme-fg">Add a trigger</h2>
          <p className="mt-0.5 text-[12px] text-theme-muted">Pick how this agent should wake up.</p>
        </div>
        <div className="space-y-2">
          {types.map(t => {
            const meta = TRIGGER_META[t];
            const Icon = meta.icon;
            const disabled = t === 'schedule.interval' && hasInterval;
            return (
              <button
                key={t}
                onClick={() => onPick(t)}
                disabled={disabled}
                className={clsx(
                  'flex w-full items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition',
                  disabled
                    ? 'cursor-not-allowed border-theme/20 bg-zinc-500/5 opacity-50'
                    : 'border-theme/40 bg-theme-card/40 hover:border-primary/50 hover:bg-primary/5',
                )}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-theme-fg">{meta.label}</div>
                  <div className="text-[11px] text-theme-muted">{meta.tagline}</div>
                  {disabled && <div className="mt-0.5 text-[10px] text-amber-400">Already on this agent</div>}
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-[13px] text-theme-muted transition hover:text-theme-fg"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TriggerEditModal({
  botId,
  trigger,
  onClose,
  onSaved,
}: {
  botId: string;
  trigger: BotTrigger;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const platform = useBotsPlatform();
  const meta = TRIGGER_META[trigger.type];
  const [args, setArgs] = useState<Record<string, any>>({ ...trigger.args });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!platform.updateTrigger) return;
    setSaving(true);
    try {
      await platform.updateTrigger(botId, trigger.id, { args });
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      style={{ WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-[color:var(--dashboard-panel-border)] bg-theme-card p-5 shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <meta.icon className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-theme-fg">{meta.label}</h2>
            <p className="text-[11px] text-theme-muted">{meta.tagline}</p>
          </div>
        </div>

        <div className="mb-4">
          {trigger.type === 'schedule.interval' && (
            <IntervalEditor args={args} setArgs={setArgs} />
          )}
          {trigger.type === 'schedule.cron' && (
            <CronEditor args={args} setArgs={setArgs} />
          )}
          {trigger.type === 'webhook' && (
            <WebhookEditor args={args} />
          )}
          {trigger.type === 'fs.watch' && (
            <FileWatchEditor args={args} setArgs={setArgs} />
          )}
          {trigger.type === 'command.watch' && (
            <CommandWatchEditor args={args} setArgs={setArgs} />
          )}
          {trigger.type === 'gmail.new_email' && (
            <GmailEditor args={args} setArgs={setArgs} />
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-[13px] text-theme-muted transition hover:text-theme-fg"
          >
            Cancel
          </button>
          {trigger.type !== 'webhook' && (
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save
            </button>
          )}
          {trigger.type === 'webhook' && (
            <button
              onClick={onClose}
              className="rounded-full bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
