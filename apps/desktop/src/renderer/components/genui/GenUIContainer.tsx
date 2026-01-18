import React, { useCallback } from 'react';
import { ConfirmationCard } from './ConfirmationCard';
import { ChoiceGroup } from './ChoiceGroup';
import { DatePicker } from './DatePicker';
import { FileDropzone } from './FileDropzone';
import { DataTable } from './DataTable';
import { KeyValueGrid } from './KeyValueGrid';
import { Accordion } from './Accordion';
import { FileTree } from './FileTree';
import { TerminalBlock } from './TerminalBlock';
import { JsonViewer } from './JsonViewer';
import { LinkPreview } from './LinkPreview';
import { ColorPalette } from './ColorPalette';
import { ProgressBar } from './ProgressBar';
import { Slider } from './Slider';
import { Chart } from './Chart';
import { InfoCard } from './InfoCard';
import { EmailView } from './EmailView';
import { AgentTodoList } from './AgentTodoList';

export interface GenUIProps {
  toolName: string;
  args: any;
  onResult: (result: any) => void;
  isCompleted?: boolean;
  result?: any;
}

export const GenUIContainer: React.FC<GenUIProps> = ({
  toolName,
  args,
  onResult,
  isCompleted,
  result
}) => {
  const disabled = isCompleted;

  // Prevent click events from bubbling to parent elements (like chat bubbles)
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  switch (toolName) {
    // === Decision & Input Components ===
    case 'ask_confirmation':
    case 'confirm_action':
      return (
        <ConfirmationCard
          title={args.title}
          message={args.message}
          confirmLabel={args.confirmLabel}
          cancelLabel={args.cancelLabel}
          variant={args.variant}
          onConfirm={() => onResult({ confirmed: true })}
          onCancel={() => onResult({ confirmed: false })}
          isConfirmed={isCompleted && result?.confirmed}
          isCancelled={isCompleted && result?.confirmed === false}
        />
      );

    case 'show_choices':
    case 'choice_group':
      return (
        <ChoiceGroup
          title={args.title}
          options={args.choices || args.options || []}
          selectedId={result?.selectedId}
          onSelect={(id) => onResult({ selectedId: id })}
          disabled={disabled}
        />
      );

    case 'pick_date':
    case 'date_picker':
      return (
        <DatePicker
          label={args.label}
          minDate={args.minDate ? new Date(args.minDate) : undefined}
          selectedDate={result?.date ? new Date(result.date) : undefined}
          onSelect={(date) => onResult({ date: date.toISOString() })}
          disabled={disabled}
        />
      );

    case 'request_files':
    case 'file_dropzone':
      return (
        <FileDropzone
          label={args.label}
          accept={args.accept}
          maxFiles={args.maxFiles}
          onDrop={(files) => {
            const fileData = files.map(f => ({ name: f.name, path: (f as any).path, size: f.size, type: f.type }));
            onResult({ files: fileData });
          }}
        />
      );

    // === Information Display ===
    case 'show_table':
    case 'data_table':
      return (
        <DataTable
          title={args.title}
          columns={args.columns || []}
          data={args.data || []}
          pageSize={args.pageSize}
          expandable={args.expandable}
          onRowClick={disabled ? undefined : (row) => onResult({ action: 'row_click', row })}
        />
      );

    case 'show_info':
    case 'key_value_grid':
      return (
        <KeyValueGrid
          title={args.title}
          items={args.items || []}
          columns={args.columns}
        />
      );

    case 'show_details':
    case 'accordion':
      return (
        <Accordion
          sections={args.sections || []}
          allowMultiple={args.allowMultiple}
        />
      );

    case 'show_files':
    case 'file_tree':
      return (
        <FileTree
          title={args.title}
          nodes={args.nodes || args.files || []}
          onSelect={disabled ? undefined : (node) => onResult({ action: 'file_select', node })}
        />
      );

    // === Developer Tools ===
    case 'show_command':
    case 'terminal_block':
      return (
        <TerminalBlock
          command={args.command}
          output={args.output}
          title={args.title}
          autoRun={args.autoRun}
          onRun={disabled ? undefined : async (cmd) => {
            // Delegate to desktop API for actual execution
            try {
              if ((window as any).desktopAPI?.execTool) {
                const res = await (window as any).desktopAPI.execTool('run_command', { command: cmd });
                onResult({ executed: true, output: res?.output || res?.stdout || '' });
                return { ok: res?.ok !== false, output: res?.output || res?.stdout || res?.stderr || '' };
              }
            } catch (err: any) {
              return { ok: false, output: err.message || String(err) };
            }
            return { ok: false, output: 'Command execution not available' };
          }}
        />
      );

    case 'show_json':
    case 'json_viewer':
      return (
        <JsonViewer
          title={args.title}
          data={args.data || args.json || {}}
          defaultExpanded={args.expanded}
          maxDepth={args.maxDepth}
        />
      );

    // === Media & Rich Content ===
    case 'show_link':
    case 'link_preview':
      return (
        <LinkPreview
          url={args.url}
          title={args.title}
          description={args.description}
          image={args.image}
          siteName={args.siteName}
          onClick={disabled ? undefined : (url) => onResult({ action: 'link_click', url })}
        />
      );

    case 'show_colors':
    case 'color_palette':
      return (
        <ColorPalette
          title={args.title}
          colors={args.colors || []}
        />
      );

    case 'show_progress':
    case 'progress_bar':
      return (
        <ProgressBar
          progress={args.progress || 0}
          label={args.label}
          sublabel={args.sublabel}
          variant={args.variant}
          status={args.status}
          showPercentage={args.showPercentage}
          size={args.size}
          color={args.color}
        />
      );

    case 'show_slider':
    case 'slider':
      return (
        <Slider
          label={args.label}
          min={args.min}
          max={args.max}
          step={args.step}
          unit={args.unit}
          value={result?.value}
          onChange={(val) => onResult({ value: val })}
          disabled={disabled}
        />
      );

    case 'show_chart':
    case 'chart':
      return (
        <Chart
          type={args.type || 'bar'}
          title={args.title}
          data={args.data || []}
          dataKey={args.dataKey}
          nameKey={args.nameKey}
          series={args.series}
        />
      );

    case 'show_info_card':
    case 'info_card':
      return (
        <InfoCard
          title={args.title}
          message={args.message}
          variant={args.variant}
          actionLabel={args.actionLabel}
          onAction={disabled ? undefined : () => onResult({ action: 'card_action' })}
          footer={args.footer}
        />
      );

    // === Applications ===
    case 'show_email':
    case 'draft_email':
    case 'email':
      return (
        <EmailView
          to={args.to}
          from={args.from}
          cc={args.cc}
          bcc={args.bcc}
          subject={args.subject}
          body={args.body}
          attachments={args.attachments}
          isDraft={args.isDraft !== false} // Default to true if not specified
          readOnly={isCompleted}
          onSend={(data) => onResult({ action: 'send_email', ...data })}
          onCancel={() => onResult({ action: 'cancel_email' })}
        />
      );

    // === Agent Tools ===
    case 'agent_todo':
    case 'agent_todo_list':
    case 'show_todo':
    case 'todo_list':
      return (
        <AgentTodoList
          items={args.items || []}
          title={args.title}
          progress={args.progress}
          compact={args.compact}
        />
      );

    // === Fallback ===
    default:
      return (
        <div onClick={handleContainerClick} className="p-3 border rounded-lg bg-theme-card border-theme/20 text-theme-muted text-xs font-mono my-2">
          <span className="text-theme-muted/60">GenUI:</span> {toolName}
          <pre className="mt-2 p-2 bg-theme-bg rounded border border-theme/10 text-[10px] overflow-auto max-h-[100px] genui-scrollbar">
            {JSON.stringify(args, null, 2)}
          </pre>
        </div>
      );
  }
};

// Wrapper component to stop event propagation for all GenUI components
export const GenUIWrapper: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };
  return (
    <div onClick={handleClick} onMouseDown={handleClick} className={className}>
      {children}
    </div>
  );
};
