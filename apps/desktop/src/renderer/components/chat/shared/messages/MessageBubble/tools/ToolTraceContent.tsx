import React, { memo } from 'react';
import type { ToolCall } from '../../../../../../hooks/useAgent';
import { FileEditDiffPreview } from '../previews/FileEditDiffPreview';
import { WriteFilePreview } from '../previews/WriteFilePreview';
import { ReadFilePreview } from '../previews/ReadFilePreview';
import { AnalyzeMediaPreview } from '../previews/AnalyzeMediaPreview';
import { MediaResultPreview } from '../previews/MediaResultPreview';
import { collectImageSources } from '../helpers/media';
import {
  extractTerminalStatus,
  extractTerminalText,
  getTerminalPanelTitle,
  getTerminalWaitingHint,
  TERMINAL_OUTPUT_TOOL_NAMES,
} from '../helpers/terminalOutput';
import { LIVE_OUTPUT_TOOL_NAMES, LiveOutputPanel } from './LiveOutputPanel';
import { TerminalOutputPanel } from './TerminalOutputPanel';
import { ToolPayloadPreview } from './ToolPayloadPreview';

// Image-generation tools may return an extensionless blob URL, so for these we
// relax detection (`assumeImage`) and treat any returned URL as an image.
// Screenshot / capture tools return real file paths (e.g. .png) and are picked
// up by extension detection instead — that also safely skips audio/video
// captures, which must NOT be forced into an <img>.
const IMAGE_RESULT_TOOL_NAMES = new Set([
  'generate_image',
  'image_gen',
  'create_image',
  'edit_image',
]);

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
    return (
      <LiveOutputPanel
        output={tool.liveOutput || ''}
        toolName={tool.tool}
        placeholder={getTerminalWaitingHint(tool.tool, tool.args) || undefined}
      />
    );
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

    if (TERMINAL_OUTPUT_TOOL_NAMES.has(tool.tool)) {
      const terminalText = extractTerminalText(tool.result, tool.liveOutput) ?? '';
      const status = extractTerminalStatus(tool.result);
      if (terminalText || status) {
        return (
          <TerminalOutputPanel
            output={terminalText}
            title={getTerminalPanelTitle(tool.tool, tool.args, tool.result)}
            status={status}
            placeholder={getTerminalWaitingHint(tool.tool, tool.args) || undefined}
          />
        );
      }
    }

    // Any tool that produced an image (generation, screenshot, capture, or just
    // happens to return an image path/URL) gets an inline thumbnail.
    const imageSrcs = collectImageSources(tool.result, {
      assumeImage: IMAGE_RESULT_TOOL_NAMES.has(tool.tool),
    });
    if (imageSrcs.length > 0) {
      return <MediaResultPreview srcs={imageSrcs} />;
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
