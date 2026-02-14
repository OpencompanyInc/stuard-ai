/**
 * SmartArgEditor - Main schema-aware argument editor component
 * Uses modular editors from ./editors folder
 */
import React, { useMemo, useState } from 'react';
import { Paintbrush, Plus, X, Settings, Code2, LayoutGrid } from 'lucide-react';
import type { WorkflowVariable } from '../../types';
import { getToolSchema } from '../../constants/tool-schemas';
import { SmartValueEditor } from '../SmartValueEditor';
import { EnhancedUIBuilderModal } from '../../../ui-builder/EnhancedUIBuilderModal';
import type { UIWindowConfig } from '../../../ui-builder/types';
import { extractHtmlFromPreactComponent } from '../../../ui-builder/utils/codeGenerator';
import { HotkeyEditor } from './editors/HotkeyEditor';
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
import { BooleanToggle } from './editors/BooleanToggle';
import { CronEditor } from '../CronEditor';
import { UIBuilderModal } from '../../../ui-builder';

export type { UpstreamNode };

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

  const { type, label, description, options, placeholder, itemType, itemOptions, language, suggestFrom, required } = argSchema;

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
              if (v.includes('{{') || v.includes('$vars') || v.includes('{{')) {
                onChange(v);
              } else if (v === '') {
                onChange(undefined);
              } else if (!isNaN(Number(v))) {
                // Pure number - convert to number type
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

  // Special case: custom_ui tool - show Preact component editor + visual builder + key args
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

    const handlePreactBuilderSave = (result: { component: string; css: string; window: any }) => {
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
        {/* Preact Component Editor - Primary mode */}
        <details className="text-sm border border-slate-200 rounded-xl overflow-hidden" open>
          <summary className="cursor-pointer text-slate-600 hover:text-slate-800 font-medium p-3 flex items-center gap-2 bg-gradient-to-r from-blue-50 to-sky-50 hover:from-blue-100 hover:to-sky-100 transition-colors">
<Code2 className="w-4 h-4 text-blue-600" />
            <span className="text-blue-700">Component (Preact + htm)</span>
            {hasComponent && (
              <span className="ml-auto text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">active</span>
            )}
          </summary>
          <div className="p-4 space-y-3 bg-white">
            <p className="text-[11px] text-slate-400 leading-snug">
              Define a function App() using htm templates. Hooks: useState, useEffect, useVar(name, default). API: stuard.submit(data), stuard.close(), stuard.callTool(name, args).
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
          // Extract HTML from existing Preact component so the canvas can render it
          const extracted = args.component ? extractHtmlFromPreactComponent(args.component) : { html: '', js: '' };
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
              outputMode="preact"
              windowConfig={{
                width: args.window?.width || args.width || 600,
                height: args.window?.height || args.height || 450,
                position: args.window?.position || args.position || 'center',
                alwaysOnTop: args.window?.alwaysOnTop ?? args.alwaysOnTop ?? true,
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
              onSaveComponent={handlePreactBuilderSave}
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
              width: args.window?.width || args.width || 600,
              height: args.window?.height || args.height || 450,
              position: args.window?.position || args.position || 'center',
              alwaysOnTop: args.window?.alwaysOnTop ?? args.alwaysOnTop ?? true,
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
  const visibleSchemaKeys = schemaKeys.filter((k) => !schema?.args?.[k]?.hidden);
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
