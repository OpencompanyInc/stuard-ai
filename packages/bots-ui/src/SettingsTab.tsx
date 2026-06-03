import React, { useState } from 'react';
import { clsx } from 'clsx';
import {
  AlertTriangle, BellRing, Brain, Cloud, IdCard, Trash2, Wrench, Zap, ShieldCheck,
} from 'lucide-react';
import {
  NOTIFICATION_CHANNEL_LABELS,
  PROACTIVE_MODEL_MODE_LABELS,
  type NotificationChannel,
  type ProactiveModelMode,
} from './proactive-types';
import type { Bot, BotConfig } from './types';
import { COMMON_EMOJIS } from './constants';
import { ConfigRow, Select, Toggle } from './primitives';
import { TriggersSection } from './TriggersSection';
import { ToolsSection } from './ToolsSection';
import { SkillsSection } from './SkillsSection';
import { VmDeploySection } from './VmDeploySection';

type SettingsSection =
  | 'about'
  | 'triggers'
  | 'capabilities'
  | 'permissions'
  | 'deployment'
  | 'notifications'
  | 'danger';

const SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  description: string;
  icon: any;
  tone?: 'danger';
}> = [
  { id: 'about', label: 'About', description: 'Name, emoji & personality', icon: IdCard },
  { id: 'triggers', label: 'When it runs', description: 'Schedule, webhooks & more', icon: Zap },
  { id: 'capabilities', label: 'Capabilities', description: 'Tools & skills', icon: Wrench },
  { id: 'permissions', label: 'Permissions', description: 'What it can do on its own', icon: ShieldCheck },
  { id: 'deployment', label: 'Where it lives', description: 'Local computer + cloud VM', icon: Cloud },
  { id: 'notifications', label: 'Notifications', description: 'How the agent tells you things', icon: BellRing },
  { id: 'danger', label: 'Danger zone', description: 'Delete this agent', icon: AlertTriangle, tone: 'danger' },
];

export function SettingsTab({
  bot,
  config,
  onUpdateBot,
  onUpdateConfig,
  onDelete,
  onTriggersChanged,
}: {
  bot: Bot;
  config: BotConfig;
  onUpdateBot: (patch: Partial<Bot>) => Promise<void> | void;
  onUpdateConfig: (patch: Partial<BotConfig>) => void;
  onDelete: () => void;
  onTriggersChanged: () => Promise<void> | void;
}) {
  const [active, setActive] = useState<SettingsSection>('about');

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-[color:var(--dashboard-panel-border)] bg-zinc-500/10">
      <div className="grid min-h-0 flex-1 grid-cols-1 md:min-h-[420px] md:grid-cols-[220px_minmax(0,1fr)]">
        {/* Sub-nav rail — stays fixed while the section panel scrolls */}
        <nav className="shrink-0 border-b border-theme/15 p-2 md:self-start md:border-b-0 md:border-r md:p-3">
          <div className="flex flex-row gap-1 overflow-x-auto md:flex-col md:overflow-x-visible scrollbar-minimal">
            {SECTIONS.map(s => {
              const Icon = s.icon;
              const isActive = active === s.id;
              const isDanger = s.tone === 'danger';
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActive(s.id)}
                  className={clsx(
                    'group flex w-full shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition md:shrink',
                    isActive
                      ? isDanger
                        ? 'bg-red-500/10 text-red-300'
                        : 'bg-primary/10 text-primary'
                      : isDanger
                        ? 'text-red-300/70 hover:bg-red-500/5 hover:text-red-300'
                        : 'text-theme-fg/80 hover:bg-theme-hover/40 hover:text-theme-fg',
                  )}
                >
                  <Icon className={clsx('h-4 w-4 shrink-0', isActive && !isDanger && 'text-primary')} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium leading-tight">{s.label}</div>
                    <div className="mt-0.5 hidden text-[10.5px] leading-tight text-theme-muted md:block">{s.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Active section */}
        <div className="min-h-0 overflow-y-auto p-4 md:p-5 scrollbar-minimal">
          {active === 'about' && (
            <AboutSection bot={bot} onUpdateBot={onUpdateBot} />
          )}
          {active === 'triggers' && (
            <TriggersSection bot={bot} onChanged={onTriggersChanged} />
          )}
          {active === 'capabilities' && (
            <div className="space-y-6">
              <ToolsSection
                selected={config.allowedTools}
                onChange={(allowedTools) => onUpdateConfig({ allowedTools })}
              />
              <SkillsSection
                skillIds={config.skillIds}
                onChange={(skillIds) => onUpdateConfig({ skillIds })}
              />
            </div>
          )}
          {active === 'permissions' && (
            <PermissionsSection config={config} onUpdateConfig={onUpdateConfig} />
          )}
          {active === 'deployment' && (
            <div className="space-y-6">
              <VmDeploySection bot={bot} onChanged={onTriggersChanged} />
              <section>
                <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-theme-fg">
                  <Brain className="h-4 w-4" /> Intelligence
                </h3>
                <ConfigRow
                  label="Model"
                  description="Pick a smarter model for harder tasks, a lighter one to keep it cheap."
                  control={
                    <Select<ProactiveModelMode>
                      value={config.modelMode}
                      options={(Object.entries(PROACTIVE_MODEL_MODE_LABELS) as [ProactiveModelMode, { label: string; description: string }][])
                        .map(([value, meta]) => ({ value, label: meta.label }))}
                      onChange={value => onUpdateConfig({ modelMode: value })}
                    />
                  }
                />
              </section>
            </div>
          )}
          {active === 'notifications' && (
            <section>
              <div className="mb-4">
                <h3 className="flex items-center gap-2 text-[15px] font-semibold text-theme-fg">
                  <BellRing className="h-4 w-4" /> How should this agent reach you?
                </h3>
                <p className="mt-1 text-[12px] text-theme-muted">
                  The agent will only ping you when it has something useful to say.
                </p>
              </div>
              <div className="space-y-2.5">
                {(Object.entries(NOTIFICATION_CHANNEL_LABELS) as Array<[NotificationChannel, { label: string; description: string }]>).map(([ch, info]) => {
                  const isActive = config.notificationChannels.includes(ch);
                  return (
                    <ConfigRow
                      key={ch}
                      label={info.label}
                      description={info.description}
                      control={
                        <Toggle
                          checked={isActive}
                          onChange={v => {
                            const next = v
                              ? Array.from(new Set([...config.notificationChannels, ch]))
                              : config.notificationChannels.filter(c => c !== ch);
                            onUpdateConfig({ notificationChannels: next.length ? next : ['app'] });
                          }}
                        />
                      }
                    />
                  );
                })}
              </div>
            </section>
          )}
          {active === 'danger' && (
            <section className="rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-300">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold text-red-300">Delete this agent</div>
                  <p className="mt-1 text-[12px] text-theme-muted">
                    Removes the agent and stops all scheduled runs. Tasks, kanban cards, and run logs will be permanently cleared. This can't be undone.
                  </p>
                  <button
                    onClick={onDelete}
                    className="mt-4 inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-transparent px-4 py-2 text-[13px] font-medium text-red-300 transition hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete agent
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

const PERMISSION_MODE_OPTIONS: Array<{ value: NonNullable<BotConfig['permissionMode']>; label: string }> = [
  { value: 'auto', label: 'Automatic — never ask' },
  { value: 'selective', label: 'Selective — ask for some' },
  { value: 'manual', label: 'Manual — ask every time' },
];

// Sensitive tools an agent can run during a local run. Mirrors the gate in
// proactive-scheduler-utils (file-mutating + run_command + terminal).
const SENSITIVE_TOOL_OPTIONS: Array<{ id: string; label: string; description: string }> = [
  { id: 'write_file', label: 'Write file', description: 'Create or overwrite text files' },
  { id: 'write_file_base64', label: 'Write binary file', description: 'Write binary/base64 content' },
  { id: 'create_directory', label: 'Create folder', description: 'Make a new directory' },
  { id: 'copy_file', label: 'Copy file', description: 'Duplicate a file' },
  { id: 'file_edit', label: 'Edit file', description: 'Modify file contents in place' },
  { id: 'move_file', label: 'Move / rename file', description: 'Move or rename (can overwrite)' },
  { id: 'delete_file', label: 'Delete file', description: 'Remove files or folders' },
  { id: 'run_command', label: 'Run command', description: 'Execute shell commands' },
  { id: 'terminal_create', label: 'Open terminal', description: 'Start a terminal session' },
  { id: 'terminal_send_input', label: 'Terminal input', description: 'Type into a terminal' },
];

function PermissionsSection({
  config,
  onUpdateConfig,
}: {
  config: BotConfig;
  onUpdateConfig: (patch: Partial<BotConfig>) => void;
}) {
  const mode = config.permissionMode || 'selective';
  const autoApprove = Array.isArray(config.autoApproveTools)
    ? config.autoApproveTools.map(t => String(t || '').toLowerCase())
    : [];
  const approvedSet = new Set(autoApprove);

  const toggleTool = (id: string) => {
    const next = new Set(approvedSet);
    if (next.has(id)) next.delete(id); else next.add(id);
    onUpdateConfig({ autoApproveTools: [...next] });
  };

  return (
    <section className="space-y-5">
      <div>
        <h3 className="flex items-center gap-2 text-[15px] font-semibold text-theme-fg">
          <ShieldCheck className="h-4 w-4" /> What can it do on its own?
        </h3>
        <p className="mt-1 text-[12px] text-theme-muted">
          Before this agent writes or deletes files, runs commands, or uses the terminal during a run,
          it checks this. When it isn’t auto-allowed, you get a notification to approve or deny.
        </p>
      </div>

      <ConfigRow
        label="Permission mode"
        description="How often the agent should ask before doing something sensitive."
        control={
          <Select<NonNullable<BotConfig['permissionMode']>>
            value={mode}
            options={PERMISSION_MODE_OPTIONS}
            onChange={value => onUpdateConfig({ permissionMode: value })}
          />
        }
      />

      {mode === 'selective' && (
        <div>
          <div className="mb-2 text-[12px] font-medium text-theme-fg">Auto-allow these tools</div>
          <div className="space-y-2.5">
            {SENSITIVE_TOOL_OPTIONS.map(tool => (
              <ConfigRow
                key={tool.id}
                label={tool.label}
                description={tool.description}
                control={
                  <Toggle
                    checked={approvedSet.has(tool.id)}
                    onChange={() => toggleTool(tool.id)}
                  />
                }
              />
            ))}
          </div>
        </div>
      )}

      {mode === 'auto' && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3.5 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-[12px] text-theme-muted">
            This agent will write/delete files and run commands without asking. Only use this for agents you trust.
          </p>
        </div>
      )}
    </section>
  );
}

function AboutSection({
  bot,
  onUpdateBot,
}: {
  bot: Bot;
  onUpdateBot: (patch: Partial<Bot>) => Promise<void> | void;
}) {
  const [name, setName] = useState(bot.name);
  const [emoji, setEmoji] = useState(bot.emoji);
  const [systemPrompt, setSystemPrompt] = useState(bot.systemPrompt);

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-theme-fg">
          <IdCard className="h-4 w-4" /> Identity
        </h3>
        <div className="rounded-2xl border border-[color:var(--dashboard-panel-border)] bg-theme-card px-4 py-3.5 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-500/10 text-2xl transition hover:bg-zinc-500/20"
              onClick={() => {
                const idx = COMMON_EMOJIS.indexOf(emoji);
                const next = COMMON_EMOJIS[(idx + 1) % COMMON_EMOJIS.length];
                setEmoji(next);
                onUpdateBot({ emoji: next });
              }}
              title="Click to cycle"
            >
              {emoji}
            </button>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={() => name !== bot.name && onUpdateBot({ name })}
              className="flex-1 rounded-xl border border-[color:var(--dashboard-panel-border)] bg-theme-card/60 px-3 py-2.5 text-[14px] font-medium text-theme-fg outline-none transition focus:border-primary/60"
            />
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-theme-fg">
          <Brain className="h-4 w-4" /> Personality & objective
        </h3>
        <p className="mb-2 text-[12px] text-theme-muted">
          The agent reads this as its system prompt every time it wakes up. Be specific about tone, scope, and what counts as success.
        </p>
        <div className="rounded-2xl border border-[color:var(--dashboard-panel-border)] bg-theme-card px-4 py-3 shadow-sm">
          <textarea
            rows={8}
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            onBlur={() => systemPrompt !== bot.systemPrompt && onUpdateBot({ systemPrompt })}
            placeholder="You are a focused, friendly assistant that posts weekly product updates to X."
            className="w-full resize-none bg-transparent text-[13px] leading-6 text-theme-fg placeholder:text-theme-muted/50 outline-none"
          />
        </div>
      </section>
    </div>
  );
}
