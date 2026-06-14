/**
 * SmartArgEditor - Main schema-aware argument editor component
 * Uses modular editors from ./editors folder
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Paintbrush, Plus, X, Settings, Code2, LayoutGrid } from 'lucide-react';
import type { WorkflowVariable } from '../../types';
import { getToolSchema, type ArgOption } from '../../constants/tool-schemas';
import { SmartValueEditor } from '../SmartValueEditor';
import { EnhancedUIBuilderModal } from '../../../ui-builder/EnhancedUIBuilderModal';
import type { UIWindowConfig } from '../../../ui-builder/types';
import { extractHtmlFromComponent } from '../../../ui-builder/utils/codeGenerator';
import { useModelRegistry } from '../../../hooks/useModelRegistry';
import { HotkeyEditor } from './editors/HotkeyEditor';
import { AcceleratorEditor } from './editors/AcceleratorEditor';
import { SelectInput } from './editors/SelectInput';
import { MultiSelectInput } from './editors/MultiSelectInput';
import { TextInputWithVariables, type UpstreamNode } from './editors/TextInputWithVariables';
import { CodeEditor } from './editors/CodeEditor';
import { ArrayEditor } from './editors/ArrayEditor';
import { JsonEditor } from './editors/JsonEditor';
import { DriveQueryEditor } from './editors/DriveQueryEditor';
import { CreateTableEditor } from './editors/CreateTableEditor';
import { SQLQueryBuilder } from './editors/SQLQueryBuilder';
import { ParallelStepsEditor } from './editors/ParallelStepsEditor';
import { FilesEditor } from './editors/FilesEditor';
import { MemoryEditor } from './editors/MemoryEditor';
import { BooleanToggle } from './editors/BooleanToggle';
import { CronEditor } from '../CronEditor';
import { UIBuilderModal } from '../../../ui-builder';

export type { UpstreamNode };

// ─── Connected-account profile dropdown (Google, X, Notion, GitHub) ──────────
// These providers store OAuth tokens in the desktop's local encrypted store
// (not Supabase) per the device-local migration — see DEVICE_LOCAL_PROVIDERS in
// useIntegrationsState. A tool's `profile` arg selects WHICH connected account
// to act as, so we render it as a dropdown of the user's real connected
// accounts (read from the local agent's oauth_list), never a raw text box. This
// mirrors useIntegrationsState.refreshProfiles(provider).

type ProfileProvider = 'google' | 'x' | 'notion' | 'github';

const PROFILE_PROVIDER_LABEL: Record<ProfileProvider, string> = {
  google: 'Google',
  x: 'X',
  notion: 'Notion',
  github: 'GitHub',
};

/** Map a tool name to the OAuth provider whose account its `profile` arg picks. */
function profileProviderForTool(toolName: string, argKey: string): ProfileProvider | null {
  if (argKey !== 'profile') return null;
  if (
    toolName.startsWith('google_') ||
    toolName.startsWith('gmail_') ||
    toolName.startsWith('drive_') ||
    toolName.startsWith('calendar_') ||
    toolName.startsWith('sheets_') ||
    toolName.startsWith('docs_') ||
    toolName.startsWith('tasks_') ||
    toolName === 'gmail.new_email' ||
    toolName === 'drive.new_file'
  ) return 'google';
  // X tools (x_*) and X trigger types (x.new_comment, x.new_dm, …) share one account.
  if (toolName.startsWith('x_') || toolName.startsWith('x.')) return 'x';
  if (toolName.startsWith('notion_')) return 'notion';
  if (toolName.startsWith('github_')) return 'github';
  return null;
}

// Per-provider cache + in-flight dedupe so switching nodes doesn't re-hit the
// agent on every render.
const profileOptionsCache: Partial<Record<ProfileProvider, ArgOption[]>> = {};
const profileOptionsPromise: Partial<Record<ProfileProvider, Promise<ArgOption[]>>> = {};

async function fetchProfileOptions(provider: ProfileProvider): Promise<ArgOption[]> {
  const cached = profileOptionsCache[provider];
  if (cached) return cached;
  const inflight = profileOptionsPromise[provider];
  if (inflight) return inflight;

  const promise = (async () => {
    const agentHttp = (window as any).__AGENT_HTTP__ || 'http://127.0.0.1:8765';
    let tokens: any[] = [];
    try {
      const resp = await fetch(`${agentHttp}/v1/tools/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'oauth_list', args: {} }),
      });
      const json = await resp.json().catch(() => null);
      if (json && (json as any).ok && Array.isArray((json as any).tokens)) {
        tokens = (json as any).tokens;
      }
    } catch {
      return [];
    }

    const options = tokens
      .filter((t) => String(t?.provider || '').toLowerCase() === provider)
      .map((t): ArgOption | null => {
        const value = String(t?.profileLabel || t?.profile_label || '').trim();
        if (!value) return null;
        const email = String(t?.accountEmail || t?.account_email || '').trim();
        const isDefault = Boolean(t?.isDefault ?? t?.is_default);
        const primary = email || value;
        return {
          value,
          label: `${primary}${isDefault ? ' (default)' : ''}`,
          description: email && email !== value ? value : undefined,
        };
      })
      .filter((option): option is ArgOption => !!option);

    profileOptionsCache[provider] = options;
    return options;
  })().finally(() => {
    delete profileOptionsPromise[provider];
  });

  profileOptionsPromise[provider] = promise;
  return promise;
}

function useProfileOptions(provider: ProfileProvider | null): ArgOption[] {
  const [options, setOptions] = useState<ArgOption[]>(provider ? (profileOptionsCache[provider] || []) : []);

  useEffect(() => {
    if (!provider) {
      setOptions([]);
      return;
    }
    let cancelled = false;

    const load = () => {
      fetchProfileOptions(provider)
        .then((next) => { if (!cancelled) setOptions(next); })
        .catch(() => { if (!cancelled) setOptions([]); });
    };
    load();

    // Re-fetch when an account is connected/disconnected anywhere in the app.
    const refresh = () => {
      delete profileOptionsCache[provider];
      load();
    };
    window.addEventListener('integrations.connected.changed', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('integrations.connected.changed', refresh);
    };
  }, [provider]);

  return options;
}

/**
 * Unescape double-escaped component code from LLM output.
 * Converts literal \n → newline, \t → tab, \" → ", \' → '
 * so the code editor shows properly formatted code.
 */
function unescapeComponentCode(code: string): string {
  if (!code) return code;
  // Detect double-escaping: has literal \n or \" text
  const hasLiteralEscapes = code.includes('\\n') || code.includes('\\t') || code.includes('\\"');
  if (!hasLiteralEscapes) return code;
  // Preserve real backslashes first
  let result = code.replace(/\\\\/g, '\x00BSLASH\x00');
  result = result
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
  result = result.replace(/\x00BSLASH\x00/g, '\\');
  return result;
}

// AI tools whose `model` field should be powered by the live OpenRouter registry
// (same catalog used by the main Stuard chat) instead of the static models.json snapshot.
const LIVE_MODEL_TOOLS = new Set([
  'ai_inference',
  'agent_node',
  'analyze_media',
]);

function isAiModelArg(toolName: string, argKey: string): boolean {
  return argKey === 'model' && LIVE_MODEL_TOOLS.has(toolName);
}

function isTranscriptionModelArg(toolName: string, argKey: string): boolean {
  return toolName === 'ai_inference' && argKey === 'transcriptionModel';
}

// ─── Live OpenRouter STT models ────────────────────────────────────────────
// Fetched from the public, unauthenticated OpenRouter models endpoint filtered
// to transcription-capable models. Cached in localStorage with a 24h TTL so the
// dropdown is responsive offline / on cold start. ElevenLabs Scribe models are
// NOT returned by this endpoint (they use a separate direct API) and are merged
// in from the schema's static fallback list by the consumer.

interface OpenRouterSttApiModel {
  id: string;
  name: string;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
}

const STT_LS_KEY = 'stuard.transcription_models.v1';
const STT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — model lists change rarely

function readSttCache(): { fetchedAtMs: number; models: OpenRouterSttApiModel[] } | null {
  try {
    const raw = localStorage.getItem(STT_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.fetchedAtMs !== 'number') return null;
    if (!Array.isArray(parsed.models)) return null;
    return parsed as { fetchedAtMs: number; models: OpenRouterSttApiModel[] };
  } catch {
    return null;
  }
}

function writeSttCache(models: OpenRouterSttApiModel[]) {
  try {
    localStorage.setItem(STT_LS_KEY, JSON.stringify({ fetchedAtMs: Date.now(), models }));
  } catch {}
}

/**
 * Format an OpenRouter STT model into a relative cost-tier description.
 * Billing on our side is in credits — we don't surface raw USD pricing to users.
 * Instead we bucket OpenRouter's per-minute audio rate into rough tiers so users
 * can pick between cheap/standard/premium without seeing fiat numbers.
 *
 * Tier buckets (per-minute audio, USD as published by OpenRouter — used internally
 * only, never rendered): cheap < $0.005, standard < $0.05, premium ≥ $0.05.
 * Token-priced models (GPT-4o transcribe etc.) are surfaced as "premium quality".
 */
function formatSttDescription(m: OpenRouterSttApiModel): string {
  const prompt = parseFloat(m.pricing?.prompt || '0');
  const completion = parseFloat(m.pricing?.completion || '0');
  if (completion > 0) {
    return 'Premium quality · token-priced (GPT-4o-class transcription)';
  }
  if (prompt > 0) {
    if (prompt < 0.005) return 'Cheap — low credit cost';
    if (prompt < 0.05) return 'Standard cost';
    return 'Premium — higher credit cost, top accuracy';
  }
  return 'OpenRouter STT';
}

function sttModelsToOptions(models: OpenRouterSttApiModel[]): ArgOption[] {
  return models
    .filter((m) => m?.id && typeof m.id === 'string')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m): ArgOption => ({
      value: m.id,
      // Strip "Provider: " prefix the way the main model registry does for chat models.
      label: (m.name || m.id).replace(/^[^:]+:\s*/, ''),
      description: formatSttDescription(m),
      group: 'OpenRouter STT',
    }));
}

/**
 * Hook: live OpenRouter STT options merged with the schema's static fallback
 * (which holds ElevenLabs Scribe entries, since those route through a separate API).
 */
function useTranscriptionModelOptions(enabled: boolean, fallback: ArgOption[] | undefined): ArgOption[] {
  const [liveModels, setLiveModels] = useState<OpenRouterSttApiModel[]>(() => readSttCache()?.models ?? []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const cached = readSttCache();
    const isFresh = cached && Date.now() - cached.fetchedAtMs < STT_CACHE_TTL_MS;
    if (isFresh) return;

    (async () => {
      try {
        const resp = await fetch('https://openrouter.ai/api/v1/models?output_modalities=transcription', { cache: 'no-store' });
        if (!resp.ok) return;
        const json = await resp.json() as { data?: OpenRouterSttApiModel[] };
        if (!Array.isArray(json?.data) || cancelled) return;
        setLiveModels(json.data);
        writeSttCache(json.data);
      } catch {
        // Best-effort: fall back to whatever's already in state (cached or empty).
      }
    })();

    return () => { cancelled = true; };
  }, [enabled]);

  return useMemo(() => {
    const liveOptions = sttModelsToOptions(liveModels);
    const fallbackList = Array.isArray(fallback) ? fallback : [];
    if (liveOptions.length === 0) return fallbackList;
    // Merge: live OpenRouter first, then any non-OpenRouter fallback entries
    // (i.e. ElevenLabs Scribe, which isn't in the OpenRouter catalog).
    const liveIds = new Set(liveOptions.map((o) => String(o.value)));
    const extras = fallbackList.filter((o) => !liveIds.has(String(o.value)));
    return [...liveOptions, ...extras];
  }, [liveModels, fallback]);
}

/**
 * Convert the live OpenRouter-backed model registry into ArgOption[] for SelectInput.
 * Grouped by provider for readability, sorted by category (smart → balanced → fast).
 */
function useLiveModelOptions(enabled: boolean): ArgOption[] {
  const { models } = useModelRegistry();

  return useMemo(() => {
    if (!enabled) return [];
    const categoryOrder: Record<string, number> = { smart: 0, balanced: 1, fast: 2, research: 3 };
    const sorted = [...models].sort((a, b) => {
      const ca = categoryOrder[a.category as string] ?? 99;
      const cb = categoryOrder[b.category as string] ?? 99;
      if (ca !== cb) return ca - cb;
      return String(a.name).localeCompare(String(b.name));
    });
    return sorted.map((m): ArgOption => {
      const provider = m.provider || String(m.id).split('/')[0];
      const tier = m.category ? String(m.category) : '';
      const tierLabel = tier ? `${tier.charAt(0).toUpperCase()}${tier.slice(1)}` : '';
      return {
        value: m.id,
        label: m.name,
        description: [provider, tierLabel].filter(Boolean).join(' · '),
      };
    });
  }, [enabled, models]);
}

export interface SmartArgEditorProps {
  toolName: string;
  argKey: string;
  value: any;
  onChange: (value: any) => void;
  upstreamNodes?: UpstreamNode[];
  workflowVariables?: WorkflowVariable[];
}

/**
 * Main SmartArgEditor component - renders appropriate editor based on schema
 */
export function SmartArgEditor({ toolName, argKey, value, onChange, upstreamNodes, workflowVariables }: SmartArgEditorProps) {
  const schema = useMemo(() => getToolSchema(toolName), [toolName]);
  const argSchema = schema?.args[argKey];
  const profileProvider = profileProviderForTool(toolName, argKey);
  const profileOptions = useProfileOptions(profileProvider);
  const isAiModel = isAiModelArg(toolName, argKey);
  const liveModelOptions = useLiveModelOptions(isAiModel);
  const isTranscriptionModel = isTranscriptionModelArg(toolName, argKey);
  const transcriptionModelOptions = useTranscriptionModelOptions(isTranscriptionModel, argSchema?.options);

  // If no schema, infer the best editor from the value type
  if (!argSchema) {
    // Boolean → toggle
    if (typeof value === 'boolean') {
      return (
        <div className="space-y-2">
          <label className="text-sm font-semibold wf-fg">{argKey}</label>
          <BooleanToggle value={value} onChange={onChange} />
        </div>
      );
    }
    // Array → array editor
    if (Array.isArray(value)) {
      return (
        <div className="space-y-2">
          <label className="text-sm font-semibold wf-fg">{argKey}</label>
          <ArrayEditor
            value={value}
            onChange={onChange}
            upstreamNodes={upstreamNodes}
            workflowVariables={workflowVariables}
            argKey={argKey}
          />
        </div>
      );
    }
    // Object → JSON editor
    if (typeof value === 'object' && value !== null) {
      return (
        <div className="space-y-2">
          <label className="text-sm font-semibold wf-fg">{argKey}</label>
          <JsonEditor
            value={value}
            onChange={onChange}
            upstreamNodes={upstreamNodes}
            workflowVariables={workflowVariables}
          />
        </div>
      );
    }
    // Number → number-aware text input
    if (typeof value === 'number') {
      return (
        <div className="space-y-2">
          <label className="text-sm font-semibold wf-fg">{argKey}</label>
          <TextInputWithVariables
            value={String(value)}
            onChange={(v: string) => {
              if (v === '') onChange(undefined);
              else if (!isNaN(Number(v))) onChange(Number(v));
              else onChange(v);
            }}
            placeholder={argKey}
            upstreamNodes={upstreamNodes}
            workflowVariables={workflowVariables}
          />
        </div>
      );
    }
    // Default: string text input
    return (
      <div className="space-y-2">
        <label className="text-sm font-semibold wf-fg">{argKey}</label>
        <TextInputWithVariables
          value={String(value ?? '')}
          onChange={onChange}
          upstreamNodes={upstreamNodes}
          workflowVariables={workflowVariables}
          placeholder={argKey}
        />
      </div>
    );
  }

  const { type, label, description, options, placeholder, itemType, itemOptions, language, suggestFrom, required, allowFreeform } = argSchema;

  // Render based on type
  const renderEditor = () => {
    // Special case: Drive query builder
    if (toolName === 'drive_list_files' && argKey === 'query') {
      return <DriveQueryEditor value={String(value || '')} onChange={onChange} />;
    }

    // Special case: Create Table visual builder
    if (toolName === 'db_query' && argKey === 'query' && typeof value === 'string' && /CREATE\s+TABLE/i.test(value)) {
      return <CreateTableEditor value={value} onChange={onChange} />;
    }

    // Special case: SQL Query visual builder (non-CREATE TABLE)
    if (toolName === 'db_query' && argKey === 'query' && !(typeof value === 'string' && /CREATE\s+TABLE/i.test(value))) {
      return <SQLQueryBuilder value={String(value || '')} onChange={onChange} />;
    }

    // Special case: Parallel/Sequential steps builder
    if ((toolName === 'run_parallel' || toolName === 'run_sequential') && argKey === 'steps') {
      return (
        <ParallelStepsEditor
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
          upstreamNodes={upstreamNodes}
          workflowVariables={workflowVariables}
          isParallel={toolName === 'run_parallel'}
        />
      );
    }

    if (profileProvider) {
      const providerLabel = PROFILE_PROVIDER_LABEL[profileProvider];
      return (
        <SelectInput
          value={value}
          onChange={onChange}
          options={profileOptions}
          placeholder={profileOptions.length > 0 ? `Use default ${providerLabel} account` : `No ${providerLabel} accounts connected`}
          allowFreeform
        />
      );
    }

    switch (type) {
      case 'boolean':
        return <BooleanToggle value={Boolean(value)} onChange={onChange} />;

      case 'number':
        // Allow template syntax like {{step.output}} as well as plain numbers
        const numValue = value ?? '';
        const isTemplateOrString = typeof numValue === 'string' && (numValue.includes('{{') || numValue.includes('$vars'));
        return (
          <TextInputWithVariables
            value={String(numValue)}
            onChange={(v: string) => {
              // If it looks like a template or variable reference, keep as string
              if (v.includes('{{') || v.includes('$vars')) {
                onChange(v);
              } else if (v === '') {
                onChange(undefined);
              } else if (v === '.' || v === '-' || v === '-.' || v.endsWith('.')) {
                // Intermediate decimal input — keep as string so user can keep typing
                onChange(v);
              } else if (!isNaN(Number(v))) {
                // Complete number — convert to number type
                onChange(Number(v));
              } else {
                // Keep as string for partial input
                onChange(v);
              }
            }}
            placeholder={placeholder || '0'}
            upstreamNodes={upstreamNodes}
            workflowVariables={workflowVariables}
          />
        );

      case 'select': {
        // For AI model fields, use the live OpenRouter registry (matches main Stuard chat).
        // For transcription model fields, use the live OpenRouter STT registry merged
        // with ElevenLabs entries from the schema fallback. Both fall back to the
        // static schema options while the live fetch is in flight.
        const effectiveOptions = isAiModel && liveModelOptions.length > 0
          ? liveModelOptions
          : isTranscriptionModel && transcriptionModelOptions.length > 0
            ? transcriptionModelOptions
            : options;
        const effectivePlaceholder = isAiModel
          ? 'Search OpenRouter models...'
          : isTranscriptionModel
            ? 'Search transcription models...'
            : placeholder;
        return effectiveOptions ? (
          <SelectInput
            value={value}
            onChange={onChange}
            options={effectiveOptions}
            placeholder={effectivePlaceholder}
            allowFreeform={isAiModel || isTranscriptionModel ? true : allowFreeform}
          />
        ) : (
          <TextInputWithVariables
            value={String(value ?? '')}
            onChange={onChange}
            placeholder={placeholder || label || argKey}
            upstreamNodes={upstreamNodes}
            workflowVariables={workflowVariables}
            suggestFrom={suggestFrom}
          />
        );
      }

      case 'multiselect':
        return options ? (
          <MultiSelectInput
            value={Array.isArray(value) ? value : (value ? [value] : [])}
            onChange={onChange}
            options={options}
            placeholder={placeholder}
          />
        ) : null;

      case 'hotkey':
        return <HotkeyEditor value={Array.isArray(value) ? value : []} onChange={onChange} />;

      case 'accelerator':
        return <AcceleratorEditor value={String(value || '')} onChange={onChange} />;

      case 'cron':
        return <CronEditor value={String(value || '')} onChange={onChange} />;

      case 'code':
        return <CodeEditor value={String(value || '')} onChange={onChange} language={language} />;

      case 'path':
        return (
          <div className="relative flex gap-2">
            <div className="flex-1 relative">
              <TextInputWithVariables
                value={String(value || '')}
                onChange={onChange}
                placeholder={placeholder}
                upstreamNodes={upstreamNodes}
                workflowVariables={workflowVariables}
                suggestFrom={suggestFrom}
              />
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  const api = (window as any).desktopAPI;
                  if (!api?.pickFiles && !api?.pickFolder) return;

                  const isFolder = argKey.toLowerCase().includes('folder') ||
                    argKey.toLowerCase().includes('directory') ||
                    argKey.toLowerCase().includes('dir');

                  if (isFolder) {
                    const result = await api.pickFolder({ title: 'Select Folder' });
                    if (result?.ok && result.folders?.length > 0) {
                      onChange(result.folders[0]);
                    }
                  } else {
                    const result = await api.pickFiles({ title: 'Select File', multiple: false });
                    if (result?.ok && result.files?.length > 0) {
                      const file = result.files[0];
                      onChange(typeof file === 'string' ? file : file.path);
                    }
                  }
                } catch (e) {
                  console.error('Failed to pick path:', e);
                }
              }}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-slate-600 hover:text-slate-800 transition-all flex items-center gap-1.5 text-sm font-medium shrink-0"
              title="Browse..."
            >
              Browse
            </button>
          </div>
        );

      case 'files':
        return (
          <FilesEditor
            value={Array.isArray(value) ? value : []}
            onChange={onChange}
          />
        );

      case 'array':
        const arrayValue = Array.isArray(value)
          ? value
          : (value !== undefined && value !== null && value !== '' ? [value] : []);
        return (
          <ArrayEditor
            value={arrayValue}
            onChange={onChange}
            itemType={itemType}
            itemOptions={itemOptions}
            upstreamNodes={upstreamNodes}
            workflowVariables={workflowVariables}
            argKey={argKey}
          />
        );

      case 'memory':
        return (
          <MemoryEditor
            value={value}
            onChange={onChange}
            upstreamNodes={upstreamNodes}
            workflowVariables={workflowVariables}
          />
        );

      case 'json':
      case 'object':
        return (
          <JsonEditor 
            value={value || {}} 
            onChange={onChange} 
            upstreamNodes={upstreamNodes}
            workflowVariables={workflowVariables}
          />
        );

      case 'string':
      default:
        const isMultiline = !!argKey.match(/code|html|content|body|script|text|message/i) ||
          String(value || '').includes('\n');
        return (
          <TextInputWithVariables
            value={String(value || '')}
            onChange={onChange}
            placeholder={placeholder}
            upstreamNodes={upstreamNodes}
            workflowVariables={workflowVariables}
            suggestFrom={suggestFrom}
            multiline={isMultiline}
          />
        );
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-0.5 mb-1">
        <label className="text-sm font-semibold wf-fg flex items-center gap-1.5">
          {label || argKey}
          {required && <span className="text-red-400 text-xs">*</span>}
        </label>
        {description && (
          <p className="text-[11px] wf-fg-faint leading-snug">
            {description}
          </p>
        )}
      </div>
      {renderEditor()}
    </div>
  );
}

/**
 * Full arguments editor for a tool - renders all arguments with schema
 */
export function ToolArgsEditor({
  toolName,
  args,
  onUpdate,
  upstreamNodes,
  workflowVariables,
}: {
  toolName: string;
  args: Record<string, any>;
  onUpdate: (args: Record<string, any>) => void;
  upstreamNodes?: UpstreamNode[];
  workflowVariables?: WorkflowVariable[];
}) {
  const schema = useMemo(() => getToolSchema(toolName), [toolName]);
  const [showAddArg, setShowAddArg] = useState(false);
  const [newArgKey, setNewArgKey] = useState('');
  const [showUIBuilder, setShowUIBuilder] = useState(false);
  const [showAdvancedArgs, setShowAdvancedArgs] = useState(false);

  // Special case: custom_ui tool - show React component editor + visual builder + key args
  if (toolName === 'custom_ui') {
    const hasComponent = typeof args.component === 'string' && args.component.trim().length > 0;
    const isBlocking = !(
      args.blocking === false ||
      args.blocking === 'false' ||
      args.window?.blocking === false ||
      args.window?.blocking === 'false'
    );
    const timeoutMsValue =
      typeof args.timeoutMs === 'number'
        ? args.timeoutMs
        : typeof args.timeoutMs === 'string' && args.timeoutMs.trim() !== '' && !Number.isNaN(Number(args.timeoutMs))
          ? Number(args.timeoutMs)
          : '';
    const keepOpenAfterResolve = args.keepOpen === true;

    const handleUIBuilderSave = (result: { html: string; css: string; js: string; window: UIWindowConfig; pages?: Record<string, any>; startPage?: string }) => {
      const newArgs: Record<string, any> = {
        ...args,
        html: result.html,
        css: result.css,
        js: result.js || args.js,
        script: result.js || args.script,
        window: result.window,
      };
      // Include pages if provided
      if (result.pages && Object.keys(result.pages).length > 0) {
        newArgs.pages = result.pages;
        newArgs.startPage = result.startPage || Object.keys(result.pages)[0];
      }
      onUpdate(newArgs);
    };

    const handleReactBuilderSave = (result: { component: string; css: string; window: any }) => {
      onUpdate({
        ...args,
        component: result.component,
        css: result.css,
        window: result.window,
      });
    };

    const hasPages = args.pages && typeof args.pages === 'object' && Object.keys(args.pages).length > 0;
    const setBlockingMode = (nextBlocking: boolean) => {
      onUpdate({ ...args, blocking: nextBlocking });
    };
    const setTimeoutMs = (nextValue: string) => {
      const trimmed = nextValue.trim();
      const nextArgs = { ...args };
      if (!trimmed) {
        delete nextArgs.timeoutMs;
      } else {
        nextArgs.timeoutMs = Math.max(0, Number(trimmed));
      }
      onUpdate(nextArgs);
    };
    const setKeepOpenAfterResolve = (nextKeepOpen: boolean) => {
      const nextArgs = { ...args };
      if (nextKeepOpen) nextArgs.keepOpen = true;
      else delete nextArgs.keepOpen;
      onUpdate(nextArgs);
    };

    // Add custom property handler for custom_ui
    const addCustomArg = () => {
      if (!newArgKey.trim()) return;
      onUpdate({ ...args, [newArgKey.trim()]: '' });
      setNewArgKey('');
      setShowAddArg(false);
    };

    return (
      <div className="space-y-5">
        {/* React Component Editor - Primary mode */}
        <details className="text-sm border wf-border-subtle rounded-xl overflow-hidden" open>
          <summary className="cursor-pointer wf-fg-muted wf-hover-fg font-medium p-3 flex items-center gap-2 bg-gradient-to-r from-blue-500/10 to-sky-500/10 hover:from-blue-500/15 hover:to-sky-500/15 transition-colors">
            <Code2 className="w-4 h-4 text-blue-400" />
            <span className="text-blue-400">Component (React)</span>
            {hasComponent && (
              <span className="ml-auto text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">active</span>
            )}
          </summary>
          <div className="p-4 space-y-3 wf-bg-elevated">
            <p className="text-[11px] wf-fg-faint leading-snug">
              Define a function App() using JSX. Hooks: useState, useEffect, useVar(name, default), useStream(streamId). API: stuard.submit(data), stuard.close(), stuard.callNode(nodeIdOrLabel, data). Use callNode wires for worker actions; callTool is legacy and invisible.
            </p>
            <button
              onClick={() => setShowUIBuilder(true)}
              className="w-full py-2.5 text-white rounded-xl font-semibold flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all group bg-gradient-to-r from-blue-500 to-sky-600 hover:from-blue-600 hover:to-sky-700 text-sm"
            >
              <Paintbrush className="w-4 h-4 group-hover:scale-110 transition-transform" />
              <span>Design UI Visually</span>
            </button>
            <SmartArgEditor
              toolName={toolName}
              argKey="component"
              value={unescapeComponentCode(args.component || '')}
              onChange={v => onUpdate({ ...args, component: v })}
              upstreamNodes={upstreamNodes}
              workflowVariables={workflowVariables}
            />
            <SmartArgEditor
              toolName={toolName}
              argKey="css"
              value={args.css || ''}
              onChange={v => onUpdate({ ...args, css: v })}
              upstreamNodes={upstreamNodes}
              workflowVariables={workflowVariables}
            />
          </div>
        </details>

        {/* UI Identity */}
        <div className="border wf-border-subtle rounded-xl overflow-hidden wf-bg-elevated">
          <div className="px-4 py-3 border-b wf-border-subtle wf-bg-overlay">
            <div className="text-sm font-semibold wf-fg">UI Details</div>
            <p className="text-[11px] wf-fg-muted mt-1">
              Give the window a clear title and a stable ID so you can update or close it later.
            </p>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <SmartArgEditor
                toolName={toolName}
                argKey="title"
                value={args.title}
                onChange={v => onUpdate({ ...args, title: v })}
                upstreamNodes={upstreamNodes}
                workflowVariables={workflowVariables}
              />
              <SmartArgEditor
                toolName={toolName}
                argKey="id"
                value={args.id}
                onChange={v => onUpdate({ ...args, id: v })}
                upstreamNodes={upstreamNodes}
                workflowVariables={workflowVariables}
              />
            </div>
            <SmartArgEditor
              toolName={toolName}
              argKey="data"
              value={args.data}
              onChange={v => onUpdate({ ...args, data: v })}
              upstreamNodes={upstreamNodes}
              workflowVariables={workflowVariables}
            />
          </div>
        </div>

        {/* Runtime Behavior */}
        <div className="border wf-border-subtle rounded-xl overflow-hidden wf-bg-elevated">
          <div className="px-4 py-3 border-b wf-border-subtle wf-bg-overlay">
            <div className="text-sm font-semibold wf-fg">Run Behavior</div>
            <p className="text-[11px] wf-fg-muted mt-1">
              Choose whether this UI pauses the workflow for a decision or behaves like a live panel in the background.
            </p>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => setBlockingMode(true)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition-all ${
                  isBlocking
                    ? 'border-[color:var(--wf-accent)]/35 bg-[color:var(--wf-accent-soft)]'
                    : 'border wf-border-subtle wf-hover-bg'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold wf-fg">Wait for a response</div>
                    <p className="text-[11px] wf-fg-muted mt-1">
                      Best for forms, confirmations, and approval flows. The workflow continues after `stuard.submit()` or closing the window.
                    </p>
                  </div>
                  <div className={`h-5 w-5 rounded-full border-2 shrink-0 ${isBlocking ? 'border-[color:var(--wf-accent)] bg-[color:var(--wf-accent)]' : 'border-[color:var(--wf-border)] bg-transparent'}`} />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setBlockingMode(false)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition-all ${
                  !isBlocking
                    ? 'border-[color:var(--wf-accent)]/35 bg-[color:var(--wf-accent-soft)]'
                    : 'border wf-border-subtle wf-hover-bg'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold wf-fg">Show it and keep going</div>
                    <p className="text-[11px] wf-fg-muted mt-1">
                      Best for widgets, overlays, and status panels. The UI stays open while the workflow continues immediately.
                    </p>
                  </div>
                  <div className={`h-5 w-5 rounded-full border-2 shrink-0 ${!isBlocking ? 'border-[color:var(--wf-accent)] bg-[color:var(--wf-accent)]' : 'border-[color:var(--wf-border)] bg-transparent'}`} />
                </div>
              </button>
            </div>

            {isBlocking ? (
              <div className="rounded-xl border wf-border-subtle wf-bg-overlay p-4 space-y-4">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold wf-fg">Auto-timeout (ms)</label>
                    <p className="text-[11px] wf-fg-muted">
                      Optional. Leave blank or `0` to wait indefinitely.
                    </p>
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      value={timeoutMsValue}
                      onChange={e => setTimeoutMs(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 text-sm border wf-border-subtle rounded-xl wf-input wf-fg focus:outline-none"
                    />
                  </div>

                  <label className="flex items-start gap-3 rounded-xl border wf-border-subtle wf-bg-elevated px-3 py-3 cursor-pointer wf-hover-bg transition-colors">
                    <input
                      type="checkbox"
                      checked={keepOpenAfterResolve}
                      onChange={e => setKeepOpenAfterResolve(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border wf-border-subtle text-[color:var(--wf-accent)] focus:ring-[color:var(--wf-accent)]/30"
                    />
                    <div>
                      <div className="text-sm font-semibold wf-fg">Keep window open after resolve</div>
                      <p className="text-[11px] wf-fg-muted mt-1">
                        Useful when submit should unblock the workflow but the UI should remain visible.
                      </p>
                    </div>
                  </label>
                </div>

                <div className="rounded-lg border wf-border-subtle wf-bg-elevated px-3 py-2 text-[11px] wf-fg-muted">
                  The workflow will wait for `stuard.submit(...)`, `stuard.close()`, a manual close, or the timeout above.
                </div>
              </div>
            ) : (
              <div className="rounded-xl border wf-border-subtle wf-bg-overlay px-4 py-3 text-[11px] wf-fg-muted">
                The workflow continues right away. Use `update_custom_ui` to refresh this panel and `close_custom_ui` when you are done with it.
              </div>
            )}
          </div>
        </div>

        {/* Window Configuration - Collapsible */}
        <details className="text-sm border wf-border-subtle rounded-xl overflow-hidden">
          <summary className="cursor-pointer wf-fg-muted wf-hover-fg font-medium p-3 flex items-center gap-2 wf-bg-overlay wf-hover-bg transition-colors">
            <Settings className="w-4 h-4" />
            Window Settings
            <span className="ml-auto text-xs wf-fg-faint">
              {args.window?.width || args.width || 600}×{args.window?.height || args.height || 450}
            </span>
          </summary>
          <div className="p-4 space-y-4 wf-bg-elevated">
            <SmartArgEditor
              toolName={toolName}
              argKey="window"
              value={args.window || {}}
              onChange={v => onUpdate({ ...args, window: v })}
              upstreamNodes={upstreamNodes}
              workflowVariables={workflowVariables}
            />
          </div>
        </details>

        {/* Pages System - Collapsible */}
        <details className="text-sm border wf-border-subtle rounded-xl overflow-hidden" open={hasPages}>
          <summary className="cursor-pointer wf-fg-muted wf-hover-fg font-medium p-3 flex items-center gap-2 wf-bg-overlay wf-hover-bg transition-colors">
            <LayoutGrid className="w-4 h-4" />
            Pages (Multi-page SPA)
            {hasPages && (
              <span className="ml-auto text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">
                {Object.keys(args.pages).length} page(s)
              </span>
            )}
          </summary>
          <div className="p-4 space-y-4 wf-bg-elevated">
            <SmartArgEditor
              toolName={toolName}
              argKey="pages"
              value={args.pages || {}}
              onChange={v => onUpdate({ ...args, pages: v })}
              upstreamNodes={upstreamNodes}
              workflowVariables={workflowVariables}
            />
            {hasPages && (
              <SmartArgEditor
                toolName={toolName}
                argKey="startPage"
                value={args.startPage || ''}
                onChange={v => onUpdate({ ...args, startPage: v })}
                upstreamNodes={upstreamNodes}
                workflowVariables={workflowVariables}
              />
            )}
          </div>
        </details>

        {/* Add Custom Property */}
        {showAddArg ? (
          <div className="flex gap-2 items-center p-3 wf-bg-overlay rounded-xl border border-[color:color-mix(in_srgb,var(--wf-accent)_30%,transparent)] shadow-sm animate-in fade-in slide-in-from-bottom-2">
            <input
              value={newArgKey}
              onChange={e => setNewArgKey(e.target.value)}
              placeholder="custom_property_name"
              className="flex-1 px-3 py-2 text-sm border wf-border-subtle rounded-lg focus:outline-none font-mono wf-input wf-fg"
              onKeyDown={e => e.key === 'Enter' && addCustomArg()}
              autoFocus
            />
            <button
              onClick={addCustomArg}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 shadow-sm transition-colors"
            >
              Add
            </button>
            <button
              onClick={() => { setShowAddArg(false); setNewArgKey(''); }}
              className="p-2 wf-fg-faint hover:wf-fg wf-hover-bg rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAddArg(true)}
            className="w-full py-3 border border-dashed wf-border-subtle rounded-xl text-xs font-semibold wf-fg-faint hover:text-blue-400 hover:border-blue-500/40 hover:bg-blue-500/10 transition-all flex items-center justify-center gap-2 group"
          >
            <div className="w-6 h-6 rounded-full wf-bg-overlay group-hover:bg-blue-500/10 flex items-center justify-center transition-colors">
              <Plus className="w-3.5 h-3.5" />
            </div>
            Add Custom Property
          </button>
        )}

        {showUIBuilder && (() => {
          // Extract HTML from existing React component so the canvas can render it
          const extracted = args.component ? extractHtmlFromComponent(args.component) : { html: '', js: '' };
          const builderHtml = args.html || extracted.html || '';
          const builderJs = args.js || args.script || extracted.js || '';
          return (
            <EnhancedUIBuilderModal
              html={builderHtml}
              css={args.css || ''}
              js={builderJs}
              pages={args.pages || (extracted as any).pages}
              startPage={args.startPage || (extracted as any).startPage}
              mainJsx={(extracted as any).mainJsx}
              mode="create"
              outputMode="react"
              originalComponent={args.component || ''}
              windowConfig={{
                width: args.window?.width ?? args.width ?? 600,
                height: args.window?.height ?? args.height ?? 450,
                position: args.window?.position ?? args.position ?? 'center',
                alwaysOnTop: args.window?.alwaysOnTop ?? args.alwaysOnTop ?? true,
                frameless: args.window?.frameless ?? args.frameless ?? false,
                transparent: args.window?.transparent ?? args.transparent ?? false,
                borderRadius: args.window?.borderRadius ?? args.borderRadius ?? 12,
                resizable: args.window?.resizable ?? args.resizable ?? false,
                draggable: args.window?.draggable,
                title: args.window?.title ?? args.title,
                backgroundType: args.window?.backgroundType,
                backgroundColor: args.window?.backgroundColor,
                gradient: args.window?.gradient,
                backgroundImage: args.window?.backgroundImage,
                shadow: args.window?.shadow,
                border: args.window?.border,
                animation: args.window?.animation,
                contentPadding: args.window?.contentPadding ?? 24,
                margin: args.window?.margin,
              }}
              onSave={handleUIBuilderSave}
              onSaveComponent={handleReactBuilderSave}
              onClose={() => setShowUIBuilder(false)}
            />
          );
        })()}
      </div>
    );
  }

  // Special case: update_custom_ui tool - visual editor for updating existing UI
  if (toolName === 'update_custom_ui') {
    const handleUIBuilderSave = (result: { html: string; css: string; js: string; window: UIWindowConfig; pages?: Record<string, any>; startPage?: string }) => {
      const newArgs: Record<string, any> = {
        ...args,
        html: result.html,
        css: result.css,
        js: result.js || args.js,
        script: result.js || args.script,
        window: result.window,
      };
      // Include pages if provided
      if (result.pages && Object.keys(result.pages).length > 0) {
        newArgs.pages = result.pages;
        newArgs.navigateTo = result.startPage;
      }
      onUpdate(newArgs);
    };

    const keyArgs = ['id', 'data', 'navigateTo'];
    const hasPages = args.pages && typeof args.pages === 'object' && Object.keys(args.pages).length > 0;

    return (
      <div className="space-y-5">
        {/* UI Update Button */}
        <button
          onClick={() => setShowUIBuilder(true)}
          className="w-full py-3.5 text-white rounded-xl font-semibold flex items-center justify-center gap-2.5 shadow-lg hover:shadow-xl transition-all group bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700"
        >
          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
            <Paintbrush className="w-5 h-5" />
          </div>
          <span>Edit UI Design</span>
        </button>

        {/* Key Arguments */}
        <div className="space-y-4">
          {keyArgs.map(key => (
            <SmartArgEditor
              key={key}
              toolName={toolName}
              argKey={key}
              value={args[key]}
              onChange={v => onUpdate({ ...args, [key]: v })}
              upstreamNodes={upstreamNodes}
              workflowVariables={workflowVariables}
            />
          ))}
        </div>

        {/* Pages Navigation - if pages exist */}
        {hasPages && (
          <details className="text-sm border wf-border-subtle rounded-xl overflow-hidden" open>
            <summary className="cursor-pointer wf-fg-muted wf-hover-fg font-medium p-3 flex items-center gap-2 wf-bg-overlay wf-hover-bg transition-colors">
              <LayoutGrid className="w-4 h-4" />
              Pages
              <span className="ml-auto text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
                {Object.keys(args.pages).length} page(s)
              </span>
            </summary>
            <div className="p-4 space-y-4 wf-bg-elevated">
              <SmartArgEditor
                toolName={toolName}
                argKey="pages"
                value={args.pages || {}}
                onChange={v => onUpdate({ ...args, pages: v })}
                upstreamNodes={upstreamNodes}
                workflowVariables={workflowVariables}
              />
              <SmartArgEditor
                toolName={toolName}
                argKey="navigateTo"
                value={args.navigateTo || ''}
                onChange={v => onUpdate({ ...args, navigateTo: v })}
                upstreamNodes={upstreamNodes}
                workflowVariables={workflowVariables}
              />
            </div>
          </details>
        )}

        {/* Raw Code Editing */}
        <details className="text-sm border wf-border-subtle rounded-xl overflow-hidden">
          <summary className="cursor-pointer wf-fg-muted wf-hover-fg font-medium p-3 flex items-center gap-2 wf-bg-overlay wf-hover-bg transition-colors">
            <Code2 className="w-4 h-4" />
            Edit HTML/CSS/JS
          </summary>
          <div className="p-4 space-y-4 wf-bg-elevated">
            <SmartArgEditor
              toolName={toolName}
              argKey="html"
              value={args.html || ''}
              onChange={v => onUpdate({ ...args, html: v })}
              upstreamNodes={upstreamNodes}
              workflowVariables={workflowVariables}
            />
            <SmartArgEditor
              toolName={toolName}
              argKey="css"
              value={args.css || ''}
              onChange={v => onUpdate({ ...args, css: v })}
              upstreamNodes={upstreamNodes}
              workflowVariables={workflowVariables}
            />
            <SmartArgEditor
              toolName={toolName}
              argKey="js"
              value={args.js || ''}
              onChange={v => onUpdate({ ...args, js: v })}
              upstreamNodes={upstreamNodes}
              workflowVariables={workflowVariables}
            />
          </div>
        </details>

        {showUIBuilder && (
          <EnhancedUIBuilderModal
            html={args.html || ''}
            css={args.css || ''}
            js={args.js || args.script || ''}
            pages={args.pages}
            startPage={args.navigateTo || args.startPage}
            mode="update"
            windowConfig={{
              width: args.window?.width ?? args.width ?? 600,
              height: args.window?.height ?? args.height ?? 450,
              position: args.window?.position ?? args.position ?? 'center',
              alwaysOnTop: args.window?.alwaysOnTop ?? args.alwaysOnTop ?? true,
              frameless: args.window?.frameless ?? args.frameless ?? false,
              transparent: args.window?.transparent ?? args.transparent ?? false,
              borderRadius: args.window?.borderRadius ?? args.borderRadius ?? 12,
              resizable: args.window?.resizable ?? args.resizable ?? false,
              draggable: args.window?.draggable,
              title: args.window?.title ?? 'Update UI',
              backgroundType: args.window?.backgroundType,
              backgroundColor: args.window?.backgroundColor,
              gradient: args.window?.gradient,
              backgroundImage: args.window?.backgroundImage,
              shadow: args.window?.shadow,
              border: args.window?.border,
              animation: args.window?.animation,
              contentPadding: args.window?.contentPadding ?? 24,
              margin: args.window?.margin,
            }}
            onSave={handleUIBuilderSave}
            onClose={() => setShowUIBuilder(false)}
          />
        )}
      </div>
    );
  }

  // Special case: MediaPipe image tools — structured input/output UX
  const MEDIAPIPE_IMAGE_TOOLS = [
    'mediapipe_pose', 'mediapipe_hands', 'mediapipe_face_detection',
    'mediapipe_face_mesh', 'mediapipe_segmentation', 'mediapipe_holistic',
  ];

  if (MEDIAPIPE_IMAGE_TOOLS.includes(toolName)) {
    const inputMode: 'file' | 'base64' = ('imageData' in args && !('imagePath' in args)) ? 'base64' : 'file';
    const setInputMode = (mode: 'file' | 'base64') => {
      if (mode === inputMode) return;
      const newArgs = { ...args };
      if (mode === 'file') {
        delete newArgs.imageData;
        newArgs.imagePath = args.imagePath || '';
      } else {
        delete newArgs.imagePath;
        newArgs.imageData = args.imageData || '';
      }
      onUpdate(newArgs);
    };

    // Tool-specific keys that appear between I/O sections
    const toolSpecificKeys: string[] = [];
    if (toolName === 'mediapipe_pose' || toolName === 'mediapipe_holistic') {
      toolSpecificKeys.push('drawLandmarks');
    } else if (toolName === 'mediapipe_hands') {
      toolSpecificKeys.push('drawLandmarks', 'maxNumHands');
    } else if (toolName === 'mediapipe_face_detection') {
      toolSpecificKeys.push('drawDetections');
    } else if (toolName === 'mediapipe_face_mesh') {
      toolSpecificKeys.push('drawLandmarks', 'maxNumFaces', 'refineLandmarks');
    } else if (toolName === 'mediapipe_segmentation') {
      toolSpecificKeys.push('backgroundColor', 'blurBackground');
    }

    return (
      <div className="space-y-5">
        {/* Input Source */}
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center gap-1 p-1.5 bg-slate-50">
            <button
              type="button"
              onClick={() => setInputMode('file')}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                inputMode === 'file'
                  ? 'bg-white text-lime-700 shadow-sm border border-lime-200'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
              }`}
            >
              📁 Image File
            </button>
            <button
              type="button"
              onClick={() => setInputMode('base64')}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                inputMode === 'base64'
                  ? 'bg-white text-lime-700 shadow-sm border border-lime-200'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
              }`}
            >
              🔗 Base64 / Data URL
            </button>
          </div>
          <div className="p-3 bg-white">
            {inputMode === 'file' ? (
              <SmartArgEditor
                toolName={toolName}
                argKey="imagePath"
                value={args.imagePath || ''}
                onChange={v => onUpdate({ ...args, imagePath: v })}
                upstreamNodes={upstreamNodes}
                workflowVariables={workflowVariables}
              />
            ) : (
              <SmartArgEditor
                toolName={toolName}
                argKey="imageData"
                value={args.imageData || ''}
                onChange={v => onUpdate({ ...args, imageData: v })}
                upstreamNodes={upstreamNodes}
                workflowVariables={workflowVariables}
              />
            )}
          </div>
        </div>

        {/* Output Format */}
        <SmartArgEditor
          toolName={toolName}
          argKey="outputFormat"
          value={args.outputFormat || 'base64'}
          onChange={v => onUpdate({ ...args, outputFormat: v })}
          upstreamNodes={upstreamNodes}
          workflowVariables={workflowVariables}
        />

        {/* Output path — show only when outputFormat=file */}
        {args.outputFormat === 'file' && (
          <SmartArgEditor
            toolName={toolName}
            argKey="outputPath"
            value={args.outputPath || ''}
            onChange={v => onUpdate({ ...args, outputPath: v })}
            upstreamNodes={upstreamNodes}
            workflowVariables={workflowVariables}
          />
        )}

        {/* Tool-specific settings */}
        {toolSpecificKeys.length > 0 && (
          <div className="space-y-4">
            {toolSpecificKeys.map(key => (
              <SmartArgEditor
                key={key}
                toolName={toolName}
                argKey={key}
                value={args[key]}
                onChange={v => onUpdate({ ...args, [key]: v })}
                upstreamNodes={upstreamNodes}
                workflowVariables={workflowVariables}
              />
            ))}
          </div>
        )}

        {/* Advanced Settings */}
        {schema && (() => {
          const advKeys = Object.keys(schema.args).filter(k => schema.args[k]?.advanced && !['outputPath'].includes(k));
          if (advKeys.length === 0) return null;
          return (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowAdvancedArgs(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors text-xs font-semibold text-slate-600"
              >
                <span>Advanced Settings</span>
                <span className="text-[10px] text-slate-400">{advKeys.length} option(s)</span>
              </button>
              {showAdvancedArgs && (
                <div className="p-4 space-y-4 bg-white border-t border-slate-200">
                  {advKeys.map(key => (
                    <SmartArgEditor
                      key={key}
                      toolName={toolName}
                      argKey={key}
                      value={args[key]}
                      onChange={v => onUpdate({ ...args, [key]: v })}
                      upstreamNodes={upstreamNodes}
                      workflowVariables={workflowVariables}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    );
  }

  const updateArg = (key: string, value: any) => {
    onUpdate({ ...args, [key]: value });
  };

  const deleteArg = (key: string) => {
    const newArgs = { ...args };
    delete newArgs[key];
    onUpdate(newArgs);
  };

  const addArg = () => {
    if (!newArgKey.trim()) return;
    onUpdate({ ...args, [newArgKey.trim()]: '' });
    setNewArgKey('');
    setShowAddArg(false);
  };

  const schemaKeys = schema ? Object.keys(schema.args) : [];
  const extraKeys = Object.keys(args).filter(k => !schemaKeys.includes(k));
  
  // Check if arg should be visible based on showWhen condition
  const checkShowWhen = (argSchema: any): boolean => {
    if (!argSchema?.showWhen) return true;
    const { field, value, values } = argSchema.showWhen;
    if (!field) return true;
    const currentValue = args[field];
    if (values && Array.isArray(values)) {
      return values.includes(currentValue);
    }
    return currentValue === value;
  };
  
  const visibleSchemaKeys = schemaKeys.filter((k) => !schema?.args?.[k]?.hidden && checkShowWhen(schema?.args?.[k]));
  const baseSchemaKeys = visibleSchemaKeys.filter((k) => !schema?.args?.[k]?.advanced);
  const advancedSchemaKeys = visibleSchemaKeys.filter((k) => !!schema?.args?.[k]?.advanced);
  const allBaseKeys = [...baseSchemaKeys, ...extraKeys];

  return (
    <div className="space-y-6">
      {allBaseKeys.length === 0 && !showAddArg && advancedSchemaKeys.length === 0 ? (
        <div className="py-8 px-4 text-center rounded-xl bg-slate-50 border border-dashed border-slate-200">
          <p className="text-sm text-slate-500 font-medium">No configuration needed</p>
          <p className="text-xs text-slate-400 mt-1">This step doesn't require any settings.</p>
        </div>
      ) : (
        allBaseKeys.map(key => {
          const argSchema = schema?.args[key];
          const isExtra = !schemaKeys.includes(key);

          return (
            <div key={key} className="group relative transition-all">
              <SmartArgEditor
                toolName={toolName}
                argKey={key}
                value={args[key]}
                onChange={v => updateArg(key, v)}
                upstreamNodes={upstreamNodes}
                workflowVariables={workflowVariables}
              />
              {(isExtra || !argSchema?.required) && (
                <button
                  onClick={() => deleteArg(key)}
                  className="absolute right-0 top-0 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0"
                  title="Remove argument"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })
      )}

      {advancedSchemaKeys.length > 0 && (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAdvancedArgs((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors text-xs font-semibold text-slate-600"
          >
            <span>Advanced Settings</span>
            <span className="text-[10px] text-slate-400">{advancedSchemaKeys.length} option(s)</span>
          </button>
          {showAdvancedArgs && (
            <div className="p-4 space-y-4 bg-white border-t border-slate-200">
              {advancedSchemaKeys.map((key) => (
                <SmartArgEditor
                  key={key}
                  toolName={toolName}
                  argKey={key}
                  value={(args as any)[key]}
                  onChange={(v) => onUpdate({ ...args, [key]: v })}
                  upstreamNodes={upstreamNodes}
                  workflowVariables={workflowVariables}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {showAddArg ? (
        <div className="flex gap-2 items-center p-3 wf-bg-overlay rounded-xl border wf-border-subtle shadow-sm animate-in fade-in slide-in-from-bottom-2">
          <input
            value={newArgKey}
            onChange={e => setNewArgKey(e.target.value)}
            placeholder="custom_property_name"
            className="flex-1 px-3 py-2 text-sm border wf-border-subtle rounded-lg wf-input font-mono wf-bg-elevated wf-fg"
            onKeyDown={e => e.key === 'Enter' && addArg()}
            autoFocus
          />
          <button
            onClick={addArg}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 shadow-sm transition-colors"
          >
            Add
          </button>
          <button
            onClick={() => { setShowAddArg(false); setNewArgKey(''); }}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowAddArg(true)}
          className="w-full py-3 border border-dashed border-slate-200 rounded-xl text-xs font-semibold text-slate-400 hover:wf-accent-fg hover:border-[color:color-mix(in_srgb,var(--wf-accent)_40%,transparent)] wf-accent-soft-bg/30 transition-all flex items-center justify-center gap-2 group"
        >
          <div className="w-6 h-6 rounded-full bg-slate-50 group-wf-accent-soft-bg flex items-center justify-center transition-colors">
            <Plus className="w-3.5 h-3.5" />
          </div>
          Add Custom Property
        </button>
      )}
    </div>
  );
}
