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
import { supabase } from '../../../lib/supabaseClient';

export type { UpstreamNode };

const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || 'http://127.0.0.1:8082';

interface IntegrationProfile {
  provider: string;
  profile_label: string;
  is_default: boolean;
  account_email?: string | null;
}

function buildIntegrationProfileOptions(profiles: IntegrationProfile[], provider: string, providerLabel: string): ArgOption[] {
  const filteredProfiles = [...profiles]
    .filter((profile) => profile.provider === provider)
    .sort((a, b) => {
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      return String(a.account_email || a.profile_label || '').localeCompare(String(b.account_email || b.profile_label || ''));
    });

  if (filteredProfiles.length === 0) {
    return [];
  }

  const defaultProfile = filteredProfiles.find((profile) => profile.is_default);
  const options: ArgOption[] = [
    {
      value: '',
      label: defaultProfile?.account_email ? `Default: ${defaultProfile.account_email}` : `Default ${providerLabel} account`,
      description: defaultProfile?.profile_label
        ? `Uses profile "${defaultProfile.profile_label}"`
        : `Use the default connected ${providerLabel} account`,
    },
  ];

  for (const profile of filteredProfiles) {
    const label = profile.account_email || profile.profile_label || `${providerLabel} account`;
    const suffix = profile.is_default ? 'default' : `profile "${profile.profile_label}"`;
    options.push({
      value: profile.profile_label,
      label,
      description: profile.account_email && profile.account_email !== profile.profile_label
        ? `${profile.profile_label} • ${suffix}`
        : suffix,
    });
  }

  return options;
}

function getProfileProvider(toolName: string, argKey: string): { provider: string; label: string } | null {
  if (argKey !== 'profile' && argKey !== 'account') return null;
  if (toolName.startsWith('google_') || toolName.startsWith('gmail_') || toolName.startsWith('calendar_') || toolName.startsWith('drive_') || toolName.startsWith('docs_') || toolName.startsWith('sheets_') || toolName.startsWith('tasks_') || toolName === 'gmail_send') {
    return { provider: 'google', label: 'Google' };
  }
  if (toolName.startsWith('facebook_')) return { provider: 'facebook', label: 'Facebook' };
  if (toolName.startsWith('instagram_')) return { provider: 'instagram', label: 'Instagram' };
  if (toolName.startsWith('threads_')) return { provider: 'threads', label: 'Threads' };
  if (toolName.startsWith('outlook_')) return { provider: 'outlook', label: 'Outlook' };
  if (toolName.startsWith('github_')) return { provider: 'github', label: 'GitHub' };
  if (toolName.startsWith('discord_')) return { provider: 'discord', label: 'Discord' };
  if (toolName.startsWith('reddit_')) return { provider: 'reddit', label: 'Reddit' };
  return null;
}

/**
 * Unescape double-escaped component code from LLM output.
 * Converts literal \n → newline, \t → tab, \" → ", \' → '
 * so the code editor shows properly formatted code.
 *
 * Only triggers when the code has NO real newlines (indicating double JSON
 * encoding). If the code already has real newlines, \n sequences are
 * legitimate JS escape sequences (e.g., 'Hello\nWorld') and must stay.
 */
function unescapeComponentCode(code: string): string {
  if (!code) return code;
  // If code already has real newlines, the \n sequences are real JS escapes — don't touch
  if (code.includes('\n')) return code;
  // Detect double-escaping: has literal \n or \" text but no real newlines
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
  const profileProvider = useMemo(() => getProfileProvider(toolName, argKey), [toolName, argKey]);
  const shouldUseIntegrationProfileDropdown = !!profileProvider;
  const [integrationProfileOptions, setIntegrationProfileOptions] = useState<ArgOption[]>([]);
  const [integrationProfilesLoading, setIntegrationProfilesLoading] = useState(false);

  // Dynamic agent tools for agent_node multiselect
  const isAgentToolsPicker = toolName === 'agent_node' && argKey === 'tools';
  const [dynamicAgentTools, setDynamicAgentTools] = useState<ArgOption[] | null>(null);

  useEffect(() => {
    if (!isAgentToolsPicker) return;
    let cancelled = false;
    const api = (window as any).desktopAPI;
    if (!api?.workflowsGetAgentToolOptions) return;
    api.workflowsGetAgentToolOptions().then((result: any) => {
      if (cancelled) return;
      if (result?.ok && Array.isArray(result.tools)) {
        setDynamicAgentTools(result.tools);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isAgentToolsPicker]);

  useEffect(() => {
    if (!shouldUseIntegrationProfileDropdown || !profileProvider) return;

    let cancelled = false;

    const loadProfiles = async () => {
      setIntegrationProfilesLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          if (!cancelled) setIntegrationProfileOptions([]);
          return;
        }

        const resp = await fetch(`${CLOUD_AI_HTTP}/integrations/profiles?provider=${encodeURIComponent(profileProvider.provider)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await resp.json().catch(() => null);
        const rawProfiles = Array.isArray(json?.profiles) ? json.profiles : [];
        const profiles: IntegrationProfile[] = rawProfiles.map((profile: any) => ({
          provider: profile.provider || profileProvider.provider,
          profile_label: profile.profile || profile.profile_label || 'default',
          is_default: !!(profile.isDefault ?? profile.is_default),
          account_email: profile.email || profile.account_email || null,
        }));

        if (!cancelled) {
          setIntegrationProfileOptions(buildIntegrationProfileOptions(profiles, profileProvider.provider, profileProvider.label));
        }
      } catch {
        if (!cancelled) setIntegrationProfileOptions([]);
      } finally {
        if (!cancelled) setIntegrationProfilesLoading(false);
      }
    };

    void loadProfiles();

    const handleProfilesChanged = () => {
      void loadProfiles();
    };

    window.addEventListener('integrations.connected.changed', handleProfilesChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('integrations.connected.changed', handleProfilesChanged);
    };
  }, [shouldUseIntegrationProfileDropdown, profileProvider]);

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

    if (shouldUseIntegrationProfileDropdown && profileProvider) {
      return (
        <div className="space-y-2">
          <SelectInput
            value={String(value ?? '')}
            onChange={onChange}
            options={integrationProfileOptions}
            placeholder={
              integrationProfilesLoading
                ? `Loading connected ${profileProvider.label} accounts...`
                : integrationProfileOptions.length > 0
                  ? `Select connected ${profileProvider.label} account`
                  : `No ${profileProvider.label} accounts connected`
            }
            allowFreeform={integrationProfileOptions.length === 0}
          />
          {!integrationProfilesLoading && integrationProfileOptions.length === 0 && (
            <p className="text-[11px] wf-fg-faint leading-snug">
              Connect a {profileProvider.label} account in Integrations to populate this list.
            </p>
          )}
        </div>
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

      case 'select':
        return options ? (
          <SelectInput
            value={value}
            onChange={onChange}
            options={options}
            placeholder={placeholder}
            allowFreeform={allowFreeform}
          />
        ) : null;

      case 'multiselect': {
        const resolvedOptions = isAgentToolsPicker && dynamicAgentTools
          ? dynamicAgentTools
          : (options && options.length > 0 ? options : undefined);
        return resolvedOptions ? (
          <MultiSelectInput
            value={Array.isArray(value) ? value : (value ? [value] : [])}
            onChange={onChange}
            options={resolvedOptions}
            placeholder={isAgentToolsPicker && !dynamicAgentTools ? 'Loading tools...' : placeholder}
          />
        ) : (
          isAgentToolsPicker ? (
            <div className="px-4 py-3 text-sm wf-fg-faint wf-bg-overlay rounded-xl border wf-border-subtle">
              Loading available tools...
            </div>
          ) : null
        );
      }

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
              className="px-3 py-2 wf-bg-overlay wf-hover-bg border wf-border-subtle rounded-xl wf-fg-muted wf-hover-fg transition-all flex items-center gap-1.5 text-sm font-medium shrink-0"
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
        // Allow string variable references (e.g. "{{step.items}}") to pass through
        const isVarRefArray = typeof value === 'string' && value.includes('{{');
        const arrayValue = isVarRefArray
          ? value
          : Array.isArray(value)
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

    // Key args to show prominently (in order)
    const keyArgs = ['id', 'title', 'data', 'blocking'];
    const hasPages = args.pages && typeof args.pages === 'object' && Object.keys(args.pages).length > 0;

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
          <summary className="cursor-pointer wf-fg-muted wf-hover-fg font-medium p-3 flex items-center gap-2 bg-gradient-to-r from-blue-500/10 to-sky-500/10 hover:from-blue-500/20 hover:to-sky-500/20 transition-colors">
            <Code2 className="w-4 h-4 text-blue-400" />
            <span className="text-blue-400">Component (React)</span>
            {hasComponent && (
              <span className="ml-auto text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full">active</span>
            )}
          </summary>
          <div className="p-4 space-y-3 bg-black/20">
            <p className="text-[11px] wf-fg-faint leading-snug">
              Define a function App() using JSX. <b className="wf-fg-muted">Hooks:</b> useState, useEffect, useVar(name, default), useStyles(css), useInterval, useTimeout, useLocalStorage. <b className="wf-fg-muted">Animation:</b> motion.div (Framer Motion), AnimatePresence, useAnimation, useMotionValue. <b className="wf-fg-muted">Components:</b> Badge, Progress, Spinner, Skeleton, Tooltip, Switch, Toast, Avatar, Divider, Kbd. <b className="wf-fg-muted">API:</b> stuard.submit(data), stuard.close(), stuard.callTool(name, args). <b className="wf-fg-muted">Fonts:</b> Inter, Outfit, Space Grotesk, JetBrains Mono.
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

        {/* Key Arguments - Always Visible */}
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

        {/* Window Configuration - Collapsible */}
        <details className="text-sm border wf-border-subtle rounded-xl overflow-hidden">
          <summary className="cursor-pointer wf-fg-muted wf-hover-fg font-medium p-3 flex items-center gap-2 wf-bg-overlay hover:wf-bg-overlay transition-colors">
            <Settings className="w-4 h-4" />
            Window Settings
            <span className="ml-auto text-xs wf-fg-faint">
              {args.window?.width || args.width || 600}×{args.window?.height || args.height || 450}
            </span>
          </summary>
          <div className="p-4 space-y-4 bg-black/20">
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
          <summary className="cursor-pointer wf-fg-muted wf-hover-fg font-medium p-3 flex items-center gap-2 wf-bg-overlay hover:wf-bg-overlay transition-colors">
            <LayoutGrid className="w-4 h-4" />
            Pages (Multi-page SPA)
            {hasPages && (
              <span className="ml-auto text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full">
                {Object.keys(args.pages).length} page(s)
              </span>
            )}
          </summary>
          <div className="p-4 space-y-4 bg-black/20">
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
          <div className="flex gap-2 items-center p-3 bg-black/20 rounded-xl border border-indigo-500/30 shadow-sm animate-in fade-in slide-in-from-bottom-2">
            <input
              value={newArgKey}
              onChange={e => setNewArgKey(e.target.value)}
              placeholder="custom_property_name"
              className="flex-1 px-3 py-2 text-sm border wf-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 font-mono wf-bg-overlay wf-fg"
              onKeyDown={e => e.key === 'Enter' && addCustomArg()}
              autoFocus
            />
            <button
              onClick={addCustomArg}
              className="px-4 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg text-sm font-medium hover:bg-blue-500/30 shadow-sm transition-colors"
            >
              Add
            </button>
            <button
              onClick={() => { setShowAddArg(false); setNewArgKey(''); }}
              className="p-2 wf-fg-faint wf-hover-fg hover:wf-bg-overlay rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAddArg(true)}
            className="w-full py-3 border border-dashed wf-border-subtle rounded-xl text-xs font-semibold wf-fg-faint hover:text-blue-400 hover:border-blue-500/50 hover:bg-blue-500/10 transition-all flex items-center justify-center gap-2 group"
          >
            <div className="w-6 h-6 rounded-full wf-bg-overlay group-hover:bg-blue-500/20 flex items-center justify-center transition-colors">
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
              pages={args.pages}
              startPage={args.startPage}
              mode="create"
              outputMode="react"
              originalComponent={args.component || ''}
              windowConfig={{
                width: args.window?.width || args.width || 600,
                height: args.window?.height || args.height || 450,
                position: args.window?.position || args.position || 'center',
                alwaysOnTop: args.window?.alwaysOnTop ?? args.alwaysOnTop ?? false,
                frameless: args.window?.frameless ?? args.frameless ?? false,
                transparent: args.window?.transparent ?? args.transparent ?? false,
                borderRadius: args.window?.borderRadius || args.borderRadius || 12,
                resizable: args.window?.resizable ?? args.resizable ?? false,
                title: args.title || args.window?.title || 'Custom UI',
                backgroundType: args.window?.backgroundType || 'color',
                backgroundColor: args.window?.backgroundColor || '#1a1a2e',
                gradient: args.window?.gradient,
                backgroundImage: args.window?.backgroundImage,
                shadow: args.window?.shadow || { enabled: true, color: '#00000040', blur: 20, spread: 0, x: 0, y: 8 },
                border: args.window?.border,
                animation: args.window?.animation || { open: 'fade', close: 'fade', duration: 300, easing: 'ease-out' },
                contentPadding: args.window?.contentPadding || 24,
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
            <summary className="cursor-pointer wf-fg-muted wf-hover-fg font-medium p-3 flex items-center gap-2 wf-bg-overlay hover:wf-bg-overlay transition-colors">
              <LayoutGrid className="w-4 h-4" />
              Pages
              <span className="ml-auto text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
                {Object.keys(args.pages).length} page(s)
              </span>
            </summary>
            <div className="p-4 space-y-4 wf-bg-overlay">
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
          <summary className="cursor-pointer wf-fg-muted wf-hover-fg font-medium p-3 flex items-center gap-2 wf-bg-overlay hover:wf-bg-overlay transition-colors">
            <Code2 className="w-4 h-4" />
            Edit HTML/CSS/JS
          </summary>
          <div className="p-4 space-y-4 wf-bg-overlay">
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
              width: args.window?.width || args.width || 600,
              height: args.window?.height || args.height || 450,
              position: args.window?.position || args.position || 'center',
              alwaysOnTop: args.window?.alwaysOnTop ?? args.alwaysOnTop ?? false,
              frameless: args.window?.frameless ?? args.frameless ?? false,
              transparent: args.window?.transparent ?? args.transparent ?? false,
              borderRadius: args.window?.borderRadius || args.borderRadius || 12,
              resizable: args.window?.resizable ?? args.resizable ?? false,
              title: 'Update UI',
              // Enhanced properties from existing window config if available
              backgroundType: args.window?.backgroundType || 'color',
              backgroundColor: args.window?.backgroundColor || '#1a1a2e',
              gradient: args.window?.gradient,
              backgroundImage: args.window?.backgroundImage,
              shadow: args.window?.shadow || { enabled: true, color: '#00000040', blur: 20, spread: 0, x: 0, y: 8 },
              border: args.window?.border,
              animation: args.window?.animation || { open: 'fade', close: 'fade', duration: 300, easing: 'ease-out' },
              contentPadding: args.window?.contentPadding || 24,
            }}
            onSave={handleUIBuilderSave}
            onClose={() => setShowUIBuilder(false)}
          />
        )}
      </div>
    );
  }

  // Special case: analyze_media — structured sources editor with file path pickers
  if (toolName === 'analyze_media') {
    const sources: Array<{ path?: string; url?: string; data?: string; captureScreen?: boolean }> =
      Array.isArray(args.sources) ? args.sources : [{ path: '' }];

    const updateSource = (idx: number, update: Record<string, any>) => {
      const newSources = [...sources];
      newSources[idx] = { ...newSources[idx], ...update };
      onUpdate({ ...args, sources: newSources });
    };

    const addSource = () => {
      onUpdate({ ...args, sources: [...sources, { path: '' }] });
    };

    const removeSource = (idx: number) => {
      const newSources = sources.filter((_, i) => i !== idx);
      onUpdate({ ...args, sources: newSources.length > 0 ? newSources : [{ path: '' }] });
    };

    return (
      <div className="space-y-5">
        {/* Task */}
        <SmartArgEditor
          toolName={toolName}
          argKey="task"
          value={args.task || ''}
          onChange={v => onUpdate({ ...args, task: v })}
          upstreamNodes={upstreamNodes}
          workflowVariables={workflowVariables}
        />

        {/* Media Sources */}
        <div className="space-y-2">
          <label className="text-sm font-semibold wf-fg flex items-center gap-1.5">
            Media Sources
            <span className="text-red-400 text-xs">*</span>
          </label>
          <p className="text-[11px] wf-fg-faint leading-snug">
            Add the media files to analyze. Use template variables like {'{{step_N.filePath}}'} to reference outputs from previous steps.
          </p>

          <div className="space-y-2">
            {sources.map((source, idx) => {
              const sourceType = source.captureScreen ? 'screen' : source.url ? 'url' : source.data ? 'data' : 'file';

              return (
                <div key={idx} className="border wf-border-subtle rounded-xl overflow-hidden wf-bg-overlay">
                  {/* Source type tabs */}
                  <div className="flex items-center gap-1 p-1.5 wf-bg-overlay border-b wf-border-subtle">
                    <button
                      type="button"
                      onClick={() => {
                        const newSources = [...sources];
                        newSources[idx] = { path: source.path || '' };
                        onUpdate({ ...args, sources: newSources });
                      }}
                      className={`flex-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-all ${sourceType === 'file'
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'wf-fg-faint hover:wf-fg-muted hover:wf-bg-overlay'
                        }`}
                    >
                      📁 File Path
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const newSources = [...sources];
                        newSources[idx] = { url: source.url || '' };
                        onUpdate({ ...args, sources: newSources });
                      }}
                      className={`flex-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-all ${sourceType === 'url'
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'wf-fg-faint hover:wf-fg-muted hover:wf-bg-overlay'
                        }`}
                    >
                      🔗 URL
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const newSources = [...sources];
                        newSources[idx] = { captureScreen: true };
                        onUpdate({ ...args, sources: newSources });
                      }}
                      className={`flex-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-all ${sourceType === 'screen'
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'wf-fg-faint hover:wf-fg-muted hover:wf-bg-overlay'
                        }`}
                    >
                      🖥️ Screen
                    </button>
                    {sources.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeSource(idx)}
                        className="p-1 wf-fg-faint hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                        title="Remove source"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Source value */}
                  <div className="p-3">
                    {sourceType === 'screen' ? (
                      <p className="text-xs wf-fg-muted italic">Will capture the current screen when executed.</p>
                    ) : sourceType === 'url' ? (
                      <TextInputWithVariables
                        value={source.url || ''}
                        onChange={v => updateSource(idx, { url: v })}
                        placeholder="https://youtube.com/watch?v=... or direct media URL"
                        upstreamNodes={upstreamNodes}
                        workflowVariables={workflowVariables}
                      />
                    ) : (
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <TextInputWithVariables
                            value={source.path || ''}
                            onChange={v => updateSource(idx, { path: v })}
                            placeholder="C:/path/to/media.mp4 or {{step_N.filePath}}"
                            upstreamNodes={upstreamNodes}
                            workflowVariables={workflowVariables}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const api = (window as any).desktopAPI;
                              if (!api?.pickFiles) return;
                              const result = await api.pickFiles({
                                title: 'Select Media File',
                                multiple: false,
                                filters: [
                                  { name: 'Media Files', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp'] },
                                  { name: 'All Files', extensions: ['*'] },
                                ],
                              });
                              if (result?.ok && result.files?.length > 0) {
                                const file = result.files[0];
                                updateSource(idx, { path: typeof file === 'string' ? file : file.path });
                              }
                            } catch (e) {
                              console.error('Failed to pick file:', e);
                            }
                          }}
                          className="px-3 py-2 wf-bg-overlay wf-hover-bg border wf-border-subtle rounded-xl wf-fg-muted wf-hover-fg transition-all flex items-center gap-1.5 text-sm font-medium shrink-0"
                          title="Browse for media file"
                        >
                          Browse
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add source button */}
          <button
            type="button"
            onClick={addSource}
            className="w-full py-2.5 border border-dashed wf-border-subtle rounded-xl text-xs font-semibold wf-fg-faint hover:text-blue-400 hover:border-blue-500/50 hover:bg-blue-500/10 transition-all flex items-center justify-center gap-2 group"
          >
            <div className="w-5 h-5 rounded-full wf-bg-overlay group-hover:bg-blue-500/20 flex items-center justify-center transition-colors">
              <Plus className="w-3 h-3" />
            </div>
            Add Another Source
          </button>
        </div>

        {/* Mode */}
        <SmartArgEditor
          toolName={toolName}
          argKey="mode"
          value={args.mode || 'fast'}
          onChange={v => onUpdate({ ...args, mode: v })}
          upstreamNodes={upstreamNodes}
          workflowVariables={workflowVariables}
        />
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
        <div className="border wf-border-subtle rounded-xl overflow-hidden">
          <div className="flex items-center gap-1 p-1.5 wf-bg-overlay">
            <button
              type="button"
              onClick={() => setInputMode('file')}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${inputMode === 'file'
                ? 'bg-white/[0.08] text-lime-400 shadow-sm border border-lime-500/30'
                : 'wf-fg-muted hover:wf-fg hover:wf-bg-overlay'
                }`}
            >
              📁 Image File
            </button>
            <button
              type="button"
              onClick={() => setInputMode('base64')}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${inputMode === 'base64'
                ? 'bg-white/[0.08] text-lime-400 shadow-sm border border-lime-500/30'
                : 'wf-fg-muted hover:wf-fg hover:wf-bg-overlay'
                }`}
            >
              🔗 Base64 / Data URL
            </button>
          </div>
          <div className="p-3 wf-bg-overlay">
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
            <div className="border wf-border-subtle rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowAdvancedArgs(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2 wf-bg-overlay hover:wf-bg-overlay transition-colors text-xs font-semibold wf-fg-muted"
              >
                <span>Advanced Settings</span>
                <span className="text-[10px] wf-fg-faint">{advKeys.length} option(s)</span>
              </button>
              {showAdvancedArgs && (
                <div className="p-4 space-y-4 wf-bg-overlay border-t wf-border-subtle">
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
        <div className="py-8 px-4 text-center rounded-xl wf-bg-overlay border border-dashed wf-border-subtle">
          <p className="text-sm wf-fg-muted font-medium">No configuration needed</p>
          <p className="text-xs wf-fg-faint mt-1">This step doesn't require any settings.</p>
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
                  className="absolute right-0 top-0 p-1.5 wf-fg-faint hover:text-red-400 hover:bg-red-500/10 rounded-lg opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0"
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
        <div className="border wf-border-subtle rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAdvancedArgs((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 wf-bg-overlay hover:wf-bg-overlay transition-colors text-xs font-semibold wf-fg-muted"
          >
            <span>Advanced Settings</span>
            <span className="text-[10px] wf-fg-faint">{advancedSchemaKeys.length} option(s)</span>
          </button>
          {showAdvancedArgs && (
            <div className="p-4 space-y-4 wf-bg-overlay border-t wf-border-subtle">
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
        <div className="flex gap-2 items-center p-3 wf-bg-overlay rounded-xl border border-indigo-500/30 shadow-sm animate-in fade-in slide-in-from-bottom-2">
          <input
            value={newArgKey}
            onChange={e => setNewArgKey(e.target.value)}
            placeholder="custom_property_name"
            className="flex-1 px-3 py-2 text-sm border wf-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 font-mono wf-bg-overlay wf-fg"
            onKeyDown={e => e.key === 'Enter' && addArg()}
            autoFocus
          />
          <button
            onClick={addArg}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 shadow-sm transition-colors"
          >
            Add
          </button>
          <button
            onClick={() => { setShowAddArg(false); setNewArgKey(''); }}
            className="p-2 wf-fg-faint hover:wf-fg-muted hover:wf-bg-overlay rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowAddArg(true)}
          className="w-full py-3 border border-dashed wf-border-subtle rounded-xl text-xs font-semibold wf-fg-faint hover:text-blue-400 hover:border-blue-500/50 hover:bg-blue-500/10 transition-all flex items-center justify-center gap-2 group"
        >
          <div className="w-6 h-6 rounded-full wf-bg-overlay group-hover:bg-blue-500/20 flex items-center justify-center transition-colors">
            <Plus className="w-3.5 h-3.5" />
          </div>
          Add Custom Property
        </button>
      )}
    </div>
  );
}
