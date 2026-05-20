import React, { memo } from 'react';
import type { ToolCall } from '../../../../../../hooks/useAgent';
import { FileEditDiffPreview } from '../previews/FileEditDiffPreview';
import { WriteFilePreview } from '../previews/WriteFilePreview';
import { ReadFilePreview } from '../previews/ReadFilePreview';
import { AnalyzeMediaPreview } from '../previews/AnalyzeMediaPreview';
import { LIVE_OUTPUT_TOOL_NAMES, LiveOutputPanel } from './LiveOutputPanel';
import { ToolPayloadPreview } from './ToolPayloadPreview';

export const ToolTraceContent: React.FC<{ tool: ToolCall }> = memo(({ tool }) => {
  if (tool.status === 'error') {
    const errorText =
      typeof tool.error === 'string'
        ? tool.error
        : JSON.stringify(tool.error || 'Tool failed', null, 2);

    return (
      <div className="rounded-lg px-3 py-2 text-[11px] leading-relaxed text-red-500/90 whitespace-pre-wrap break-words"
        style={{ backgroundColor: 'color-mix(in srgb, var(--destructive) 8%, transparent)' }}
      >
        {errorText}
      </div>
    );
  }

  if (
    (tool.status === 'running' || tool.status === 'called')
    && LIVE_OUTPUT_TOOL_NAMES.has(tool.tool)
  ) {
    return <LiveOutputPanel output={tool.liveOutput || ''} toolName={tool.tool} />;
  }

  if (tool.status === 'completed') {
    const args = (tool.args || {}) as Record<string, any>;

    if (tool.tool === 'file_edit') {
      return (
        <FileEditDiffPreview
          oldText={String(args.old_string ?? '')}
          newText={String(args.new_string ?? '')}
          mode={typeof args.mode === 'string' ? args.mode : undefined}
          description={typeof args.description === 'string' ? args.description : undefined}
        />
      );
    }

    if (tool.tool === 'write_file' || tool.tool === 'workspace_write_file') {
      return (
        <WriteFilePreview
          path={typeof args.path === 'string' ? args.path : undefined}
          content={typeof args.content === 'string' ? args.content : undefined}
          description={typeof args.description === 'string' ? args.description : undefined}
          appended={Boolean(args.append)}
        />
      );
    }

    if (
      tool.tool === 'read_file'
      || tool.tool === 'file_read'
      || tool.tool === 'workspace_read_file'
    ) {
      return (
        <ReadFilePreview
          path={typeof args.path === 'string' ? args.path : undefined}
          result={tool.result}
        />
      );
    }

    if (tool.tool === 'analyze_media' || tool.tool === 'browser_use_analyze_screenshot') {
      return <AnalyzeMediaPreview args={args} result={tool.result} />;
    }

    return (
      <ToolPayloadPreview
        data={tool.result}
        toolName={tool.tool}
        toolArgs={tool.args}
        emptyLabel=""
      />
    );
  }

  return null;
});
