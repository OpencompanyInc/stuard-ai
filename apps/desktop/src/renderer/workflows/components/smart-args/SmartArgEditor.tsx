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
import { supabase } from '../../../lib/supabaseClient';
import { getCloudAiHttp } from '../../../utils/cloud';
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

interface IntegrationProfileOption {
  provider: string;
  profile: string;
  email?: string | null;
  isDefault?: boolean;
}

let googleProfileOptionsCache: ArgOption[] | null = null;
let googleProfileOptionsPromise: Promise<ArgOption[]> | null = null;

function isGoogleProfileArg(toolName: string, argKey: string): boolean {
  if (argKey !== 'profile') return false;
  return (
    toolName.startsWith('google_') ||
    toolName.startsWith('gmail_') ||
    toolName.startsWith('drive_') ||
    toolName.startsWith('calendar_') ||
    toolName.startsWith('sheets_') ||
    toolName.startsWith('docs_') ||
    toolName.startsWith('tasks_') ||
    toolName === 'gmail.new_email' ||
    toolName === 'drive.new_file'
  );
}

async function fetchGoogleProfileOptions(): Promise<ArgOption[]> {
  if (googleProfileOptionsCache) return googleProfileOptionsCache;
  if (googleProfileOptionsPromise) return googleProfileOptionsPromise;

  googleProfileOptionsPromise = (async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return [];

    const resp = await fetch(`${getCloudAiHttp()}/integrations/profiles?provider=google`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await resp.json().catch(() => null);
    const profiles = Array.isArray(json?.profiles) ? json.profiles as IntegrationProfileOption[] : [];

    const options = profiles
      .map((profile): ArgOption | null => {
        const value = String((profile as any).profile || (profile as any).profile_label || '').trim();
        if (!value) return null;
        const email = String((profile as any).email || (profile as any).account_email || '').trim();
        const isDefault = Boolean((profile as any).isDefault ?? (profile as any).is_default);
        return {
          value,
          label: email ? `${email}${isDefault ? ' (default)' : ''}` : `${value}${isDefault ? ' (default)' : ''}`,
          description: email && email !== value ? value : undefined,
        };
      })
      .filter((option): option is ArgOption => !!option);

    googleProfileOptionsCache = options;
    return options;
  })().finally(() => {
    googleProfileOptionsPromise = null;
  });

  return googleProfileOptionsPromise;
}

function useGoogleProfileOptions(enabled: boolean): ArgOption[] {
  const [options, setOptions] = useState<ArgOption[]>(googleProfileOptionsCache || []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    fetchGoogleProfileOptions()
      .then((nextOptions) => {
        if (!cancelled) setOptions(nextOptions);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });

    const refresh = () => {
      googleProfileOptionsCache = null;
      fetchGoogleProfileOptions()
        .then((nextOptions) => {
          if (!cancelled) setOptions(nextOptions);
        })
        .catch(() => {
          if (!cancelled) setOptions([]);
        });
    };

    window.addEventListener('integrations.connected.changed', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('integrations.connected.changed', refresh);
    };
  }, [enabled]);

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
  const isGoogleProfile = isGoogleProfileArg(toolName, argKey);
  const googleProfileOptions = useGoogleProfileOptions(isGoogleProfile);

  // If no schema, infer the best editor from the value type
  if (!argSchema) {
    // Boolean → toggle
    if (typeof value === 'boolean') {
      return (
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-700">{argKey}</label>
          <BooleanToggle value={value} onChange={onChange} />
        </div>
      );
    }
    // Array → array editor
    if (Array.isArray(value)) {
      return (
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-700">{argKey}</label>
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
          <label className="text-sm font-semibold text-slate-700">{argKey}</label>
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
          <label className="text-sm font-semibold text-slate-700">{argKey}</label>
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
        <label className="text-sm font-semibold text-slate-700">{argKey}</label>
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

    if (isGoogleProfile) {
      return (
        <SelectInput
          value={value}
          onChange={onChange}
          options={googleProfileOptions}
          placeholder={googleProfileOptions.length > 0 ? 'Use default Google account' : 'No Google accounts connected'}
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
        <label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
          {label || argKey}
          {required && <span className="text-red-400 text-xs">*</span>}
        </label>
        {description && (
          <p className="text-[11px] text-slate-400 leading-snug">
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
        <details className="text-sm border border-slate-200 rounded-xl overflow-hidden" open>
          <summary className="cursor-pointer text-slate-600 hover:text-slate-800 font-medium p-3 flex items-center gap-2 bg-gradient-to-r from-blue-50 to-sky-50 hover:from-blue-100 hover:to-sky-100 transition-colors">
<Code2 className="w-4 h-4 text-blue-600" />
            <span className="text-blue-700">Component (React)</span>
            {hasComponent && (
              <span className="ml-auto text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">active</span>
            )}
          </summary>
          <div className="p-4 space-y-3 bg-white">
            <p className="text-[11px] text-slate-400 leading-snug">
              Define a function App() using JSX. Hooks: useState, useEffect, useVar(name, default). API: stuard.submit(data), stuard.close(), stuard.callTool(name, args). Use useState for multi-page navigation.
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
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/80">
            <div className="text-sm font-semibold text-slate-700">UI Details</div>
            <p className="text-[11px] text-slate-500 mt-1">
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
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
          <div className="px-4 py-3 border-b border-slate-200 bg-gradient-to-r from-violet-50 to-sky-50">
            <div className="text-sm font-semibold text-slate-700">Run Behavior</div>
            <p className="text-[11px] text-slate-500 mt-1">
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
                    ? 'border-violet-300 bg-violet-50 shadow-sm'
                    : 'border-slate-200 hover:border-violet-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">Wait for a response</div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Best for forms, confirmations, and approval flows. The workflow continues after `stuard.submit()` or closing the window.
                    </p>
                  </div>
                  <div className={`h-5 w-5 rounded-full border flex items-center justify-center ${isBlocking ? 'border-violet-500 bg-violet-500' : 'border-slate-300 bg-white'}`}>
                    {isBlocking && <div className="h-2 w-2 rounded-full bg-white" />}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setBlockingMode(false)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition-all ${
                  !isBlocking
                    ? 'border-emerald-300 bg-emerald-50 shadow-sm'
                    : 'border-slate-200 hover:border-emerald-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">Show it and keep going</div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Best for widgets, overlays, and status panels. The UI stays open while the workflow continues immediately.
                    </p>
                  </div>
                  <div className={`h-5 w-5 rounded-full border flex items-center justify-center ${!isBlocking ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300 bg-white'}`}>
                    {!isBlocking && <div className="h-2 w-2 rounded-full bg-white" />}
                  </div>
                </div>
              </button>
            </div>

            {isBlocking ? (
              <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 space-y-4">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-slate-700">Auto-timeout (ms)</label>
                    <p className="text-[11px] text-slate-500">
                      Optional. Leave blank or `0` to wait indefinitely.
                    </p>
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      value={timeoutMsValue}
                      onChange={e => setTimeoutMs(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
                    />
                  </div>

                  <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 cursor-pointer hover:border-violet-200 transition-colors">
                    <input
                      type="checkbox"
                      checked={keepOpenAfterResolve}
                      onChange={e => setKeepOpenAfterResolve(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                    />
                    <div>
                      <div className="text-sm font-semibold text-slate-700">Keep window open after resolve</div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Useful when submit should unblock the workflow but the UI should remain visible.
                      </p>
                    </div>
                  </label>
                </div>

                <div className="rounded-lg border border-violet-200 bg-white/80 px-3 py-2 text-[11px] text-slate-600">
                  The workflow will wait for `stuard.submit(...)`, `stuard.close()`, a manual close, or the timeout above.
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-[11px] text-slate-600">
                The workflow continues right away. Use `update_custom_ui` to refresh this panel and `close_custom_ui` when you are done with it.
              </div>
            )}
          </div>
        </div>

        {/* Window Configuration - Collapsible */}
        <details className="text-sm border border-slate-200 rounded-xl overflow-hidden">
          <summary className="cursor-pointer text-slate-600 hover:text-slate-800 font-medium p-3 flex items-center gap-2 bg-slate-50 hover:bg-slate-100 transition-colors">
            <Settings className="w-4 h-4" />
            Window Settings
            <span className="ml-auto text-xs text-slate-400">
              {args.window?.width || args.width || 600}×{args.window?.height || args.height || 450}
            </span>
          </summary>
          <div className="p-4 space-y-4 bg-white">
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
        <details className="text-sm border border-slate-200 rounded-xl overflow-hidden" open={hasPages}>
          <summary className="cursor-pointer text-slate-600 hover:text-slate-800 font-medium p-3 flex items-center gap-2 bg-slate-50 hover:bg-slate-100 transition-colors">
            <LayoutGrid className="w-4 h-4" />
            Pages (Multi-page SPA)
            {hasPages && (
              <span className="ml-auto text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                {Object.keys(args.pages).length} page(s)
              </span>
            )}
          </summary>
          <div className="p-4 space-y-4 bg-white">
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
          <div className="flex gap-2 items-center p-3 bg-slate-50 rounded-xl border border-indigo-200 shadow-sm animate-in fade-in slide-in-from-bottom-2">
            <input
              value={newArgKey}
              onChange={e => setNewArgKey(e.target.value)}
              placeholder="custom_property_name"
className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 font-mono bg-white"
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
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAddArg(true)}
className="w-full py-3 border border-dashed border-slate-200 rounded-xl text-xs font-semibold text-slate-400 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50/30 transition-all flex items-center justify-center gap-2 group"
            >
              <div className="w-6 h-6 rounded-full bg-slate-50 group-hover:bg-blue-50 flex items-center justify-center transition-colors">
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
          <details className="text-sm border border-slate-200 rounded-xl overflow-hidden" open>
            <summary className="cursor-pointer text-slate-600 hover:text-slate-800 font-medium p-3 flex items-center gap-2 bg-slate-50 hover:bg-slate-100 transition-colors">
              <LayoutGrid className="w-4 h-4" />
              Pages
              <span className="ml-auto text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                {Object.keys(args.pages).length} page(s)
              </span>
            </summary>
            <div className="p-4 space-y-4 bg-white">
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
        <details className="text-sm border border-slate-200 rounded-xl overflow-hidden">
          <summary className="cursor-pointer text-slate-600 hover:text-slate-800 font-medium p-3 flex items-center gap-2 bg-slate-50 hover:bg-slate-100 transition-colors">
            <Code2 className="w-4 h-4" />
            Edit HTML/CSS/JS
          </summary>
          <div className="p-4 space-y-4 bg-white">
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
        <div className="flex gap-2 items-center p-3 bg-slate-50 rounded-xl border border-indigo-200 shadow-sm animate-in fade-in slide-in-from-bottom-2">
          <input
            value={newArgKey}
            onChange={e => setNewArgKey(e.target.value)}
            placeholder="custom_property_name"
            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 font-mono bg-white"
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
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowAddArg(true)}
          className="w-full py-3 border border-dashed border-slate-200 rounded-xl text-xs font-semibold text-slate-400 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all flex items-center justify-center gap-2 group"
        >
          <div className="w-6 h-6 rounded-full bg-slate-50 group-hover:bg-indigo-50 flex items-center justify-center transition-colors">
            <Plus className="w-3.5 h-3.5" />
          </div>
          Add Custom Property
        </button>
      )}
    </div>
  );
}
