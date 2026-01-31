/**
 * SmartArgEditor - Main schema-aware argument editor component
 * Uses modular editors from ./editors folder
 */
import React, { useState, useMemo } from 'react';
import { Plus, X, Code2, Paintbrush, Settings } from 'lucide-react';
import { getToolSchema } from '../../constants/tool-schemas';
import type { WorkflowVariable } from '../../types';

// Import editors
import { BooleanToggle } from './editors/BooleanToggle';
import { HotkeyEditor } from './editors/HotkeyEditor';
import { SelectInput } from './editors/SelectInput';
import { TextInputWithVariables, type UpstreamNode } from './editors/TextInputWithVariables';
import { CodeEditor } from './editors/CodeEditor';
import { ArrayEditor } from './editors/ArrayEditor';
import { JsonEditor } from './editors/JsonEditor';
import { DriveQueryEditor } from './editors/DriveQueryEditor';
import { ParallelStepsEditor } from './editors/ParallelStepsEditor';
import { FilesEditor } from './editors/FilesEditor';
import { CronEditor } from '../CronEditor';
import { UIBuilderModal } from '../../../ui-builder';

export type { UpstreamNode };

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

  // If no schema, fall back to basic text input
  if (!argSchema) {
    return (
      <TextInputWithVariables
        value={String(value || '')}
        onChange={onChange}
        upstreamNodes={upstreamNodes}
        workflowVariables={workflowVariables}
        placeholder={argKey}
      />
    );
  }

  const { type, label, description, options, placeholder, itemType, itemOptions, language, suggestFrom, required } = argSchema;

  // Render based on type
  const renderEditor = () => {
    // Special case: Drive query builder
    if (toolName === 'drive_list_files' && argKey === 'query') {
      return <DriveQueryEditor value={String(value || '')} onChange={onChange} />;
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
        return (
          <input
            type="number"
            value={value ?? ''}
            onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            placeholder={placeholder || '0'}
            className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 transition-all shadow-sm"
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

  // Special case: custom_ui tool - show visual UI builder + key args
  if (toolName === 'custom_ui') {
    const handleUIBuilderSave = (result: { html: string; css: string; js: string; window: any }) => {
      onUpdate({
        ...args,
        html: result.html,
        css: result.css,
        js: result.js || args.js,
        script: result.js || args.script,
        ...result.window,
      });
    };

    // Key args to show prominently (in order)
    const keyArgs = ['id', 'title', 'data', 'blocking'];
    const windowArgs = ['width', 'height', 'position', 'alwaysOnTop', 'frameless'];

    // Add custom property handler for custom_ui
    const addCustomArg = () => {
      if (!newArgKey.trim()) return;
      onUpdate({ ...args, [newArgKey.trim()]: '' });
      setNewArgKey('');
      setShowAddArg(false);
    };

    return (
      <div className="space-y-5">
        {/* UI Builder Button */}
        <button
          onClick={() => setShowUIBuilder(true)}
          className="w-full py-3.5 text-white rounded-xl font-semibold flex items-center justify-center gap-2.5 shadow-lg hover:shadow-xl transition-all group bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
        >
          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
            <Paintbrush className="w-5 h-5" />
          </div>
          <span>Design UI</span>
        </button>

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
              {args.width || 400}×{args.height || 500}
            </span>
          </summary>
          <div className="p-4 space-y-4 bg-white">
            {windowArgs.map(key => (
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
        </details>

        {/* Advanced: Raw Code Editing - Collapsible */}
        <details className="text-sm border border-slate-200 rounded-xl overflow-hidden">
          <summary className="cursor-pointer text-slate-600 hover:text-slate-800 font-medium p-3 flex items-center gap-2 bg-slate-50 hover:bg-slate-100 transition-colors">
            <Code2 className="w-4 h-4" />
            Edit HTML/CSS/JS Manually
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

        {/* Add Custom Property */}
        {showAddArg ? (
          <div className="flex gap-2 items-center p-3 bg-slate-50 rounded-xl border border-indigo-200 shadow-sm animate-in fade-in slide-in-from-bottom-2">
            <input
              value={newArgKey}
              onChange={e => setNewArgKey(e.target.value)}
              placeholder="custom_property_name"
              className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 font-mono bg-white"
              onKeyDown={e => e.key === 'Enter' && addCustomArg()}
              autoFocus
            />
            <button
              onClick={addCustomArg}
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

        {showUIBuilder && (
          <UIBuilderModal
            html={args.html || ''}
            css={args.css || ''}
            js={args.js || args.script || ''}
            windowConfig={{
              width: args.width || args.window?.width || 800,
              height: args.height || args.window?.height || 600,
              title: args.title || args.window?.title,
              position: args.position || args.window?.position,
              alwaysOnTop: args.alwaysOnTop ?? args.window?.alwaysOnTop,
              frameless: args.frameless ?? args.window?.frameless,
              borderRadius: args.borderRadius || args.window?.borderRadius,
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
  const allKeys = [...schemaKeys, ...extraKeys];

  return (
    <div className="space-y-6">
      {allKeys.length === 0 && !showAddArg ? (
        <div className="py-8 px-4 text-center rounded-xl bg-slate-50 border border-dashed border-slate-200">
          <p className="text-sm text-slate-500 font-medium">No configuration needed</p>
          <p className="text-xs text-slate-400 mt-1">This step doesn't require any settings.</p>
        </div>
      ) : (
        allKeys.map(key => {
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
