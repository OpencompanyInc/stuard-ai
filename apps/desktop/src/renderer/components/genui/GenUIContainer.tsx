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
import { WeatherCard } from './WeatherCard';
import { EmailView } from './EmailView';
import { AgentTodoList } from './AgentTodoList';
import { FeedbackForm } from './FeedbackForm';
import { FormWizard } from './FormWizard';
import { IntegrationConnect } from './IntegrationConnect';
import type { DropzoneFile } from './FileDropzone';
import { GenUIErrorBoundary } from './GenUIErrorBoundary';

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

  // Defensive check for missing args
  const safeArgs = args || {};

  // Prevent click events from bubbling to parent elements (like chat bubbles)
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const renderContent = () => {
    switch (toolName) {
      // === Decision & Input Components ===
      case 'ask_confirmation':
      case 'confirm_action':
        return (
          <ConfirmationCard
            title={safeArgs.title}
            message={safeArgs.message}
            confirmLabel={safeArgs.confirmLabel}
            cancelLabel={safeArgs.cancelLabel}
            variant={safeArgs.variant}
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
            title={safeArgs.title}
            options={safeArgs.choices || safeArgs.options || []}
            selectedId={result?.selectedId}
            onSelect={(id) => onResult({ selectedId: id })}
            disabled={disabled}
          />
        );

      case 'pick_date':
      case 'date_picker':
        return (
          <DatePicker
            label={safeArgs.label}
            minDate={safeArgs.minDate ? new Date(safeArgs.minDate) : undefined}
            selectedDate={result?.date ? new Date(result.date) : undefined}
            onSelect={(date) => onResult({ date: date.toISOString() })}
            disabled={disabled}
          />
        );

      case 'request_files':
      case 'file_dropzone':
        return (
          <FileDropzone
            label={safeArgs.label}
            accept={safeArgs.accept}
            maxFiles={safeArgs.maxFiles}
            onDrop={(files) => {
              const fileData = (files as DropzoneFile[]).map((f) => ({
                name: f.name,
                path: f.path,
                size: f.size,
                type: f.type,
                data: f.data,
                mimeType: f.mimeType,
              }));
              onResult({ files: fileData });
            }}
          />
        );

      // === Information Display ===
      case 'show_table':
      case 'data_table':
        return (
          <DataTable
            title={safeArgs.title}
            columns={safeArgs.columns || []}
            data={safeArgs.data || []}
            pageSize={safeArgs.pageSize}
            expandable={safeArgs.expandable}
            onRowClick={disabled ? undefined : (row) => onResult({ action: 'row_click', row })}
          />
        );

      case 'show_info':
      case 'key_value_grid':
        return (
          <KeyValueGrid
            title={safeArgs.title}
            items={safeArgs.items || []}
            columns={safeArgs.columns}
          />
        );

      case 'show_details':
      case 'accordion':
        return (
          <Accordion
            sections={safeArgs.sections || []}
            allowMultiple={safeArgs.allowMultiple}
          />
        );

      case 'show_files':
      case 'file_tree':
        return (
          <FileTree
            title={safeArgs.title}
            nodes={safeArgs.nodes || safeArgs.files || []}
            onSelect={disabled ? undefined : (node) => onResult({ action: 'file_select', node })}
          />
        );

      // === Developer Tools ===
      case 'show_command':
      case 'terminal_block':
        return (
          <TerminalBlock
            command={safeArgs.command}
            output={safeArgs.output}
            title={safeArgs.title}
            autoRun={safeArgs.autoRun}
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
            title={safeArgs.title}
            data={safeArgs.data || safeArgs.json || {}}
            defaultExpanded={safeArgs.expanded}
            maxDepth={safeArgs.maxDepth}
          />
        );

      // === Media & Rich Content ===
      case 'show_link':
      case 'link_preview':
        return (
          <LinkPreview
            url={safeArgs.url}
            title={safeArgs.title}
            description={safeArgs.description}
            image={safeArgs.image}
            siteName={safeArgs.siteName}
            onClick={disabled ? undefined : (url) => onResult({ action: 'link_click', url })}
          />
        );

      case 'show_colors':
      case 'color_palette':
        return (
          <ColorPalette
            title={safeArgs.title}
            colors={safeArgs.colors || []}
          />
        );

      case 'show_progress':
      case 'progress_bar':
        return (
          <ProgressBar
            progress={safeArgs.progress || 0}
            label={safeArgs.label}
            sublabel={safeArgs.sublabel}
            variant={safeArgs.variant}
            status={safeArgs.status}
            showPercentage={safeArgs.showPercentage}
            size={safeArgs.size}
            color={safeArgs.color}
          />
        );

      case 'show_slider':
      case 'slider':
        return (
          <Slider
            label={safeArgs.label}
            min={safeArgs.min}
            max={safeArgs.max}
            step={safeArgs.step}
            unit={safeArgs.unit}
            value={result?.value}
            onChange={(val) => onResult({ value: val })}
            disabled={disabled}
          />
        );

      case 'show_chart':
      case 'chart':
        return (
          <Chart
            type={safeArgs.type || 'bar'}
            title={safeArgs.title}
            data={safeArgs.data || []}
            dataKey={safeArgs.dataKey}
            nameKey={safeArgs.nameKey}
            series={safeArgs.series}
          />
        );

      case 'show_info_card':
      case 'info_card':
        return (
          <InfoCard
            title={safeArgs.title}
            message={safeArgs.message}
            variant={safeArgs.variant}
            actionLabel={safeArgs.actionLabel}
            onAction={disabled ? undefined : () => onResult({ action: 'card_action' })}
            footer={safeArgs.footer}
          />
        );

      case 'show_weather':
      case 'weather_card':
        return (
          <WeatherCard
            location={safeArgs.location}
            temperature={safeArgs.temperature}
            condition={safeArgs.condition}
            humidity={safeArgs.humidity}
            windSpeed={safeArgs.windSpeed}
            unit={safeArgs.unit}
            forecast={safeArgs.forecast}
          />
        );

      // === Applications ===
      case 'show_email':
      case 'draft_email':
      case 'email':
        return (
          <EmailView
            to={safeArgs.to}
            from={safeArgs.from}
            cc={safeArgs.cc}
            bcc={safeArgs.bcc}
            subject={safeArgs.subject}
            body={safeArgs.body}
            attachments={safeArgs.attachments}
            isDraft={safeArgs.isDraft !== false} // Default to true if not specified
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
            items={safeArgs.items || []}
            title={safeArgs.title}
            progress={safeArgs.progress}
            compact={safeArgs.compact}
          />
        );

      // === Feedback ===
      case 'show_feedback_form':
      case 'feedback_form':
        return (
          <FeedbackForm
            type={safeArgs.type}
            title={safeArgs.title}
            description={safeArgs.description}
            severity={safeArgs.severity}
            labels={safeArgs.labels}
            suggestedLabels={safeArgs.suggestedLabels}
            allowScreenshot={safeArgs.allowScreenshot}
            onSubmit={(data) => onResult({ submitted: true, ...data })}
            onCancel={() => onResult({ submitted: false, cancelled: true })}
            isSubmitted={isCompleted && result?.submitted}
            isCancelled={isCompleted && result?.cancelled}
          />
        );

      // === Forms / Wizards ===
      case 'show_form':
      case 'form_wizard':
        return (
          <FormWizard
            title={safeArgs.title}
            description={safeArgs.description}
            pages={safeArgs.pages || []}
            submitLabel={safeArgs.submitLabel}
            cancelLabel={safeArgs.cancelLabel}
            showProgress={safeArgs.showProgress}
            onSubmit={(data) => onResult({ submitted: true, data })}
            onCancel={() => onResult({ submitted: false, cancelled: true })}
            disabled={disabled}
            isSubmitted={isCompleted && result?.submitted}
            isCancelled={isCompleted && result?.cancelled}
          />
        );

      // === Integrations ===
      case 'connect_integration':
      case 'integration_connect':
      case 'show_integrations':
        return (
          <IntegrationConnect
            title={safeArgs.title}
            message={safeArgs.message}
            integrations={safeArgs.integrations || []}
            connectedSlugs={safeArgs.connectedSlugs}
            disabled={disabled}
            onConnect={(slug) => onResult({ action: 'connect', slug })}
          />
        );

      // === Fallback ===
      default:
        return (
          <div onClick={handleContainerClick} className="p-3 border rounded-lg bg-theme-card border-theme/20 text-theme-muted text-xs font-mono my-2">
            <span className="text-theme-muted/60">GenUI:</span> {toolName}
            <pre className="mt-2 p-2 bg-theme-bg rounded border border-theme/10 text-[10px] overflow-auto max-h-[100px] genui-scrollbar">
              {JSON.stringify(safeArgs, null, 2)}
            </pre>
          </div>
        );
    }
  };

  return (
    <GenUIErrorBoundary componentName={toolName}>
      <div onClick={handleContainerClick}>
        {renderContent()}
      </div>
    </GenUIErrorBoundary>
  );
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
