import React, { useCallback } from 'react';
import { ConfirmationCard } from './ConfirmationCard';
import { ChoiceGroup } from './ChoiceGroup';
import { FileDropzone } from './FileDropzone';
import { FileTree } from './FileTree';
import { AgentTodoList } from './AgentTodoList';
import { FormWizard } from './FormWizard';
import type { DropzoneFile } from './FileDropzone';
import { ChatUIRenderer } from './ChatUIRenderer';
import { EmailView } from './EmailView';
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

      case 'show_files':
      case 'file_tree':
        return (
          <FileTree
            title={safeArgs.title}
            nodes={safeArgs.nodes || safeArgs.files || []}
            onSelect={disabled ? undefined : (node) => onResult({ action: 'file_select', node })}
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

      // === Email ===
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
            isDraft={safeArgs.isDraft !== false}
            readOnly={isCompleted}
            onSend={(data) => onResult({ action: 'send_email', ...data })}
            onCancel={() => onResult({ action: 'cancel_email' })}
          />
        );

      // === Inline Chat UI (custom React component) ===
      case 'chat_ui':
        return (
          <ChatUIRenderer
            component={safeArgs.component || ''}
            data={safeArgs.data}
            css={safeArgs.css}
            height={safeArgs.height}
            title={safeArgs.title}
            blocking={safeArgs.blocking === true}
            onResult={onResult}
            isCompleted={isCompleted}
            result={result}
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
