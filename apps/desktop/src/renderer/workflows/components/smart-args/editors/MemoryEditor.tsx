/**
 * MemoryEditor — Visual memory configuration for AI inference & agent nodes.
 *
 * Supports two modes:
 *  1. **Visual** — rich toggles, conversation history, custom facts
 *  2. **Variable / JSON** — the whole memory config comes from a variable
 *     (e.g. {{step.output}} or raw JSON), so it can be set dynamically
 *
 * The visual config value is an object:
 * {
 *   enabled: boolean,
 *   lenses: { identity, directives, bio, relatedMemories, entities },
 *   maxFacts: number,
 *   conversationHistory: [{ role: 'user'|'assistant', content: string }],
 *   customFacts: string[],
 * }
 *
 * The variable mode value is a plain string like "{{step.memory}}" or
 * raw JSON string — parsed at runtime on the cloud side.
 *
 * Backwards compat: if value is `true`/`false`, it's treated as the old
 * boolean mode.
 */
import React, { useState, useCallback } from 'react';
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  User,
  ScrollText,
  Fingerprint,
  Search,
  MessageSquare,
  Sparkles,
  StickyNote,
  LayoutList,
  Variable,
} from 'lucide-react';
import { TextInputWithVariables } from './TextInputWithVariables';
import type { UpstreamNode } from './TextInputWithVariables';
import type { WorkflowVariable } from '../../../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MemoryLenses {
  identity: boolean;
  directives: boolean;
  bio: boolean;
  relatedMemories: boolean;
  entities: boolean;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface MemoryConfig {
  enabled: boolean;
  lenses: MemoryLenses;
  maxFacts: number;
  conversationHistory: ConversationMessage[];
  customFacts: string[];
}

const DEFAULT_LENSES: MemoryLenses = {
  identity: true,
  directives: true,
  bio: true,
  relatedMemories: true,
  entities: true,
};

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  enabled: false,
  lenses: { ...DEFAULT_LENSES },
  maxFacts: 6,
  conversationHistory: [],
  customFacts: [],
};

/** Normalise any incoming value (boolean | MemoryConfig | string | undefined) into MemoryConfig */
export function normalizeMemoryValue(raw: any): MemoryConfig {
  if (!raw) return { ...DEFAULT_MEMORY_CONFIG };
  if (typeof raw === 'boolean') return { ...DEFAULT_MEMORY_CONFIG, enabled: raw };
  if (typeof raw === 'string') return { ...DEFAULT_MEMORY_CONFIG }; // variable mode — don't parse
  return { ...DEFAULT_MEMORY_CONFIG, ...raw, lenses: { ...DEFAULT_LENSES, ...(raw?.lenses ?? {}) } };
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const LENS_META: Array<{ key: keyof MemoryLenses; icon: any; label: string; desc: string }> = [
  { key: 'identity', icon: Fingerprint, label: 'Who You Are', desc: 'Name, location, language, preferences' },
  { key: 'directives', icon: ScrollText, label: 'Your Instructions', desc: 'Custom rules & behavior you defined' },
  { key: 'bio', icon: User, label: 'Bio / About You', desc: 'Personality, background, interests' },
  { key: 'relatedMemories', icon: Search, label: 'Related Memories', desc: 'Relevant past facts matched to the prompt' },
  { key: 'entities', icon: Sparkles, label: 'People & Topics', desc: 'Known people, projects, entities mentioned' },
];

function LensToggle({
  meta,
  checked,
  onChange,
}: {
  meta: (typeof LENS_META)[number];
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-left transition-all border ${
        checked
          ? 'wf-accent-soft-bg border-[color:color-mix(in_srgb,var(--wf-accent)_30%,transparent)]'
          : 'wf-bg-overlay wf-border-subtle opacity-80 hover:opacity-100'
      }`}
    >
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
          checked ? 'wf-accent-chip' : 'wf-icon-chip'
        }`}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium ${checked ? 'wf-fg' : 'wf-fg-muted'}`}>{meta.label}</div>
        <div className="text-xs wf-fg-faint truncate">{meta.desc}</div>
      </div>
      <div
        className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
          checked ? 'bg-[var(--wf-accent)]' : 'bg-[color:color-mix(in_srgb,var(--wf-fg)_18%,transparent)]'
        }`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
            checked ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </div>
    </button>
  );
}

function ConversationHistoryEditor({
  messages,
  onChange,
  upstreamNodes,
  workflowVariables,
}: {
  messages: ConversationMessage[];
  onChange: (msgs: ConversationMessage[]) => void;
  upstreamNodes?: UpstreamNode[];
  workflowVariables?: WorkflowVariable[];
}) {
  const addPair = () => {
    onChange([
      ...messages,
      { role: 'user', content: '' },
      { role: 'assistant', content: '' },
    ]);
  };

  const updateMessage = (idx: number, content: string) => {
    const next = [...messages];
    next[idx] = { ...next[idx], content };
    onChange(next);
  };

  const removePair = (idx: number) => {
    const pairStart = idx % 2 === 0 ? idx : idx - 1;
    const next = messages.filter((_, i) => i !== pairStart && i !== pairStart + 1);
    onChange(next);
  };

  const pairs: Array<{ user: ConversationMessage; assistant: ConversationMessage; startIdx: number }> = [];
  for (let i = 0; i < messages.length - 1; i += 2) {
    pairs.push({ user: messages[i], assistant: messages[i + 1], startIdx: i });
  }

  return (
    <div className="space-y-2">
      {pairs.map((pair, pi) => (
        <div key={pi} className="relative rounded-xl border wf-border-subtle wf-bg-overlay overflow-hidden">
          <div className="flex items-start gap-2 p-2.5 wf-accent-soft-bg border-b wf-border-subtle">
            <div className="w-6 h-6 rounded-md wf-accent-chip flex items-center justify-center shrink-0 mt-0.5">
              <User className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1">
              <TextInputWithVariables
                value={pair.user.content}
                onChange={(v) => updateMessage(pair.startIdx, v)}
                placeholder="User message... (supports {{step.output}} variables)"
                upstreamNodes={upstreamNodes}
                workflowVariables={workflowVariables}
                multiline
              />
            </div>
          </div>
          <div className="flex items-start gap-2 p-2.5">
            <div className="w-6 h-6 rounded-md wf-icon-chip flex items-center justify-center shrink-0 mt-0.5">
              <Brain className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1">
              <TextInputWithVariables
                value={pair.assistant.content}
                onChange={(v) => updateMessage(pair.startIdx + 1, v)}
                placeholder="Assistant response... (supports {{step.output}} variables)"
                upstreamNodes={upstreamNodes}
                workflowVariables={workflowVariables}
                multiline
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => removePair(pair.startIdx)}
            className="absolute top-2 right-2 p-1 rounded-md wf-fg-faint hover:text-red-500 hover:bg-red-500/10 transition-colors"
            title="Remove this exchange"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addPair}
        className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl border border-dashed wf-border-subtle wf-fg-muted hover:wf-accent-fg hover:wf-accent-soft-bg transition-all text-sm font-medium"
      >
        <Plus className="w-4 h-4" />
        Add conversation exchange
      </button>
    </div>
  );
}

function CustomFactsEditor({
  facts,
  onChange,
  upstreamNodes,
  workflowVariables,
}: {
  facts: string[];
  onChange: (f: string[]) => void;
  upstreamNodes?: UpstreamNode[];
  workflowVariables?: WorkflowVariable[];
}) {
  const addFact = () => onChange([...facts, '']);
  const updateFact = (idx: number, val: string) => {
    const next = [...facts];
    next[idx] = val;
    onChange(next);
  };
  const removeFact = (idx: number) => onChange(facts.filter((_, i) => i !== idx));

  return (
    <div className="space-y-2">
      {facts.map((fact, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="w-6 h-6 rounded-md wf-icon-chip flex items-center justify-center shrink-0 mt-1">
            <StickyNote className="w-3.5 h-3.5" />
          </div>
          <div className="flex-1">
            <TextInputWithVariables
              value={fact}
              onChange={(v) => updateFact(i, v)}
              placeholder={'e.g. "The user prefers dark mode" or {{step.facts}}'}
              upstreamNodes={upstreamNodes}
              workflowVariables={workflowVariables}
            />
          </div>
          <button
            type="button"
            onClick={() => removeFact(i)}
            className="p-1.5 rounded-md wf-fg-faint hover:text-red-500 hover:bg-red-500/10 transition-colors mt-0.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addFact}
        className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl border border-dashed wf-border-subtle wf-fg-muted hover:text-amber-600 hover:border-amber-300 hover:bg-amber-500/10 transition-all text-sm font-medium"
      >
        <Plus className="w-4 h-4" />
        Add custom fact
      </button>
    </div>
  );
}

// ─── Main MemoryEditor ──────────────────────────────────────────────────────

interface MemoryEditorProps {
  value: any;
  onChange: (config: any) => void;
  upstreamNodes?: UpstreamNode[];
  workflowVariables?: WorkflowVariable[];
}

export function MemoryEditor({ value, onChange, upstreamNodes, workflowVariables }: MemoryEditorProps) {
  const isVarMode = typeof value === 'string';
  const [useVariableMode, setUseVariableMode] = useState(isVarMode);

  const config = isVarMode ? DEFAULT_MEMORY_CONFIG : normalizeMemoryValue(value);
  const [showLenses, setShowLenses] = useState(false);
  const [showConversation, setShowConversation] = useState(config.conversationHistory.length > 0);
  const [showCustomFacts, setShowCustomFacts] = useState(config.customFacts.length > 0);

  const update = (patch: Partial<MemoryConfig>) => onChange({ ...config, ...patch });
  const updateLens = (key: keyof MemoryLenses, val: boolean) =>
    update({ lenses: { ...config.lenses, [key]: val } });

  const activeLensCount = Object.values(config.lenses).filter(Boolean).length;

  const switchToVariableMode = useCallback(() => {
    setUseVariableMode(true);
    if (config.enabled) {
      onChange(JSON.stringify(config, null, 2));
    } else {
      onChange('');
    }
  }, [config, onChange]);

  const switchToVisualMode = useCallback(() => {
    setUseVariableMode(false);
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        onChange(normalizeMemoryValue(parsed));
        return;
      } catch {
        // not valid JSON — just reset
      }
    }
    onChange({ ...DEFAULT_MEMORY_CONFIG });
  }, [value, onChange]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={useVariableMode ? switchToVisualMode : undefined}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-l-lg text-xs font-medium transition-all border ${
            !useVariableMode
              ? 'wf-accent-chip'
              : 'wf-bg-overlay wf-border-subtle wf-fg-muted wf-hover-bg'
          }`}
        >
          <LayoutList className="w-3 h-3" />
          Visual
        </button>
        <button
          type="button"
          onClick={!useVariableMode ? switchToVariableMode : undefined}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-r-lg text-xs font-medium transition-all border ${
            useVariableMode
              ? 'wf-accent-chip'
              : 'wf-bg-overlay wf-border-subtle wf-fg-muted wf-hover-bg'
          }`}
        >
          <Variable className="w-3 h-3" />
          Variable / JSON
        </button>
      </div>

      {useVariableMode && (
        <div className="space-y-2">
          <p className="text-xs wf-fg-faint">
            Set the entire memory config from a variable (e.g. <code className="wf-bg-overlay px-1 rounded wf-fg-muted">{'{{step.memory}}'}</code>) or paste raw JSON.
          </p>
          <TextInputWithVariables
            value={typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2)}
            onChange={(v) => onChange(v)}
            placeholder={'{{step.memory}} or {"enabled": true, "lenses": {...}}'}
            upstreamNodes={upstreamNodes}
            workflowVariables={workflowVariables}
            multiline
          />
          <div className="text-xs wf-fg-faint wf-bg-overlay rounded-lg p-2.5 border wf-border-subtle">
            <div className="font-medium wf-fg-muted mb-1">Expected JSON shape:</div>
            <pre className="text-[10px] font-mono whitespace-pre-wrap">{`{
  "enabled": true,
  "lenses": {
    "identity": true,
    "directives": true,
    "bio": true,
    "relatedMemories": true,
    "entities": true
  },
  "maxFacts": 6,
  "conversationHistory": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "customFacts": ["fact 1", "fact 2"]
}`}</pre>
          </div>
        </div>
      )}

      {!useVariableMode && (
        <>
          <button
            type="button"
            onClick={() => update({ enabled: !config.enabled })}
            className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all border ${
              config.enabled
                ? 'wf-accent-soft-bg border-[color:color-mix(in_srgb,var(--wf-accent)_30%,transparent)] shadow-sm'
                : 'wf-bg-overlay wf-border-subtle hover:wf-hover-bg'
            }`}
          >
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                config.enabled ? 'bg-[var(--wf-accent)] text-white' : 'wf-icon-chip'
              }`}
            >
              <Brain className="w-5 h-5" />
            </div>
            <div className="flex-1 text-left">
              <div className={`text-sm font-semibold ${config.enabled ? 'wf-accent-fg' : 'wf-fg'}`}>
                Memory {config.enabled ? 'Active' : 'Off'}
              </div>
              <div className="text-xs wf-fg-faint">
                {config.enabled
                  ? `${activeLensCount} source${activeLensCount !== 1 ? 's' : ''} active`
                  : 'The AI won\u2019t use any stored memories'}
              </div>
            </div>
            <div
              className={`w-11 h-6 rounded-full transition-colors relative ${
                config.enabled ? 'bg-[var(--wf-accent)]' : 'bg-[color:color-mix(in_srgb,var(--wf-fg)_18%,transparent)]'
              }`}
            >
              <div
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                  config.enabled ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </div>
          </button>

          {config.enabled && (
            <div className="space-y-2 pl-1">
              <button
                type="button"
                onClick={() => setShowLenses(!showLenses)}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-lg wf-hover-bg transition-colors text-left"
              >
                {showLenses ? (
                  <ChevronDown className="w-4 h-4 wf-fg-faint" />
                ) : (
                  <ChevronRight className="w-4 h-4 wf-fg-faint" />
                )}
                <span className="text-sm font-medium wf-fg">Memory Sources</span>
                <span className="text-xs wf-fg-faint ml-auto">{activeLensCount}/{LENS_META.length} active</span>
              </button>
              {showLenses && (
                <div className="space-y-1.5 pl-2">
                  {LENS_META.map((meta) => (
                    <LensToggle
                      key={meta.key}
                      meta={meta}
                      checked={config.lenses[meta.key]}
                      onChange={(v) => updateLens(meta.key, v)}
                    />
                  ))}
                  <div className="px-3 py-2 flex items-center gap-3">
                    <span className="text-xs wf-fg-muted shrink-0">Max related memories</span>
                    <input
                      type="range"
                      min={1}
                      max={20}
                      value={config.maxFacts}
                      onChange={(e) => update({ maxFacts: Number(e.target.value) })}
                      className="flex-1 h-1.5 accent-[var(--wf-accent)]"
                    />
                    <span className="text-xs font-mono wf-fg-muted w-5 text-right">{config.maxFacts}</span>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowConversation(!showConversation)}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-lg wf-hover-bg transition-colors text-left"
              >
                {showConversation ? (
                  <ChevronDown className="w-4 h-4 wf-fg-faint" />
                ) : (
                  <ChevronRight className="w-4 h-4 wf-fg-faint" />
                )}
                <MessageSquare className="w-4 h-4 wf-fg-faint" />
                <span className="text-sm font-medium wf-fg">Conversation History</span>
                {config.conversationHistory.length > 0 && (
                  <span className="text-xs wf-accent-chip px-1.5 py-0.5 rounded-full ml-auto">
                    {Math.floor(config.conversationHistory.length / 2)} exchange{config.conversationHistory.length > 2 ? 's' : ''}
                  </span>
                )}
              </button>
              {showConversation && (
                <div className="pl-2">
                  <p className="text-xs wf-fg-faint mb-2 px-1">
                    Add example conversations so the AI understands context. Messages support variables like{' '}
                    <code className="wf-bg-overlay px-1 rounded wf-fg-muted">{'{{step.text}}'}</code>.
                  </p>
                  <ConversationHistoryEditor
                    messages={config.conversationHistory}
                    onChange={(msgs) => update({ conversationHistory: msgs })}
                    upstreamNodes={upstreamNodes}
                    workflowVariables={workflowVariables}
                  />
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowCustomFacts(!showCustomFacts)}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-lg wf-hover-bg transition-colors text-left"
              >
                {showCustomFacts ? (
                  <ChevronDown className="w-4 h-4 wf-fg-faint" />
                ) : (
                  <ChevronRight className="w-4 h-4 wf-fg-faint" />
                )}
                <StickyNote className="w-4 h-4 wf-fg-faint" />
                <span className="text-sm font-medium wf-fg">Custom Facts</span>
                {config.customFacts.length > 0 && (
                  <span className="text-xs bg-amber-500/15 text-amber-600 px-1.5 py-0.5 rounded-full ml-auto">
                    {config.customFacts.length}
                  </span>
                )}
              </button>
              {showCustomFacts && (
                <div className="pl-2">
                  <p className="text-xs wf-fg-faint mb-2 px-1">
                    Extra context the AI should know. Supports variables like{' '}
                    <code className="wf-bg-overlay px-1 rounded wf-fg-muted">{'{{step.json}}'}</code>.
                  </p>
                  <CustomFactsEditor
                    facts={config.customFacts}
                    onChange={(f) => update({ customFacts: f })}
                    upstreamNodes={upstreamNodes}
                    workflowVariables={workflowVariables}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
