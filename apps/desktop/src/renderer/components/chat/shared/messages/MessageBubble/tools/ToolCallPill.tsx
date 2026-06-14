import React, { useState } from 'react';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import type { ToolCall } from '../../../../../../hooks/useAgent';
import { FilePathActions } from '../inline/FilePathActions';
import { extractFilePaths, isFilePath } from '../helpers/filePaths';
import { humanizeToolName } from '../helpers/toolLabels';
import { unwrapExecuteTool } from '../helpers/executeTool';

export const ToolCallPill: React.FC<{ tool: ToolCall }> = ({ tool: rawTool }) => {
  // Collapse the execute_tool meta-wrapper into the real tool so the name,
  // arguments and result shown here all belong to the tool that actually ran.
  const tool = unwrapExecuteTool(rawTool);
  const status = tool.status || 'running';
  const isCompleted = status === 'completed';
  const isError = status === 'error';
  const [showDetails, setShowDetails] = useState(false);

  const resolvedToolName = tool.tool;

  // For delegate tool, show the subagent kind and live status
  const isDelegation = resolvedToolName === 'delegate';
  const delegationLabel = isDelegation
    ? `${humanizeToolName(tool.args?.subagent || 'subagent')} agent`
    : null;

  // Use description from tool if available, otherwise humanize tool name
  const displayText = delegationLabel || tool.description || humanizeToolName(resolvedToolName);

  // Filter out internal IDs from display data
  const filterInternalIds = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(filterInternalIds);
    const filtered: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Skip ID fields and description (already shown)
      if (/^(id|.*_id|.*Id|session.*|conversation.*|description)$/i.test(key)) continue;
      filtered[key] = filterInternalIds(value);
    }
    return Object.keys(filtered).length > 0 ? filtered : null;
  };

  // Format result for display
  const formatResult = (result: any): React.ReactNode => {
    if (!result) return <span className="text-theme-muted italic">No result</span>;

    // Extract file paths first — show them prominently with actions
    const filePaths = extractFilePaths(result);

    const filtered = filterInternalIds(result);
    if (!filtered && filePaths.length === 0) return <span className="text-emerald-500">✓ Success</span>;

    // Handle common result patterns
    if (filtered?.error) {
      return <span className="text-red-500">Error: {String(filtered.error)}</span>;
    }

    return (
      <div className="space-y-1">
        {filePaths.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {filePaths.map((fp) => <FilePathActions key={fp} filePath={fp} />)}
          </div>
        )}
        {filtered && !(filtered.ok === true && Object.keys(filtered).length === 1 && filePaths.length > 0) && (
          <div className="flex flex-wrap gap-1 items-center">
            {Object.entries(filtered).slice(0, 5).map(([key, value]) => {
              // Skip keys whose values are file paths (already shown above)
              if (isFilePath(value)) return null;
              return (
                <div
                  key={key}
                  className="flex items-center gap-1 rounded px-2 py-1"
                  style={{
                    backgroundColor: 'color-mix(in srgb, rgb(16, 185, 129) 12%, transparent)',
                    border: '1px solid color-mix(in srgb, rgb(16, 185, 129) 22%, transparent)',
                  }}
                >
                  <span className="font-medium text-emerald-600 dark:text-emerald-400 text-[10px]">{key}:</span>
                  <span className="text-emerald-700 dark:text-emerald-300 text-[10px] max-w-[200px] truncate">
                    {typeof value === 'string' ? value : JSON.stringify(value)}
                  </span>
                </div>
              );
            })}
            {Object.keys(filtered).length > 5 && (
              <span className="text-theme-muted text-[10px]">+{Object.keys(filtered).length - 5} more</span>
            )}
          </div>
        )}
      </div>
    );
  };

  // Format args for display (filtered)
  const formatArgs = (args: any): React.ReactNode => {
    if (!args) return null;
    const filtered = filterInternalIds(args);
    if (!filtered || Object.keys(filtered).length === 0) return null;

    return (
      <div className="flex flex-wrap gap-1 items-center">
        {Object.entries(filtered).slice(0, 4).map(([key, value]) => (
          <div key={key} className="flex items-center gap-1 rounded px-2 py-1 bg-theme-hover/50">
            <span className="font-medium text-theme-fg text-[10px]">{key}:</span>
            <span className="text-theme-muted text-[10px] max-w-[150px] truncate">
              {typeof value === 'string' ? value : JSON.stringify(value)}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-1.5 my-1 group/tool">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={clsx(
          "flex items-center gap-2.5 text-[12px] font-semibold tracking-tight w-fit py-0.5 px-0.5 rounded-md",
          status === 'running' && "tool-glow-bar"
        )}
      >
        {/* Status indicator — small colored dot instead of icons */}
        <div className="flex items-center justify-center w-2 h-2">
          <span className={clsx(
            "block rounded-full transition-all duration-300",
            isCompleted ? "w-2 h-2 bg-emerald-500 tool-complete-fade" :
            isError ? "w-2 h-2 bg-red-500 tool-complete-fade" :
            "w-1.5 h-1.5 bg-primary animate-pulse"
          )} />
        </div>

        <div className="flex items-center gap-1.5">
          <span className={clsx(
            "transition-all duration-300",
            status === 'running' ? "tool-glow-sweep font-semibold" :
            isError ? "text-red-500" :
            "text-theme-fg tool-complete-fade"
          )}>
            {displayText}
          </span>
        </div>

        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center justify-center p-1 rounded transition-colors hover:bg-theme-hover/60"
        >
          <ChevronRight
            className={`w-3.5 h-3.5 text-theme-fg transition-transform duration-200 ${showDetails ? 'rotate-90' : ''
              }`}
          />
        </button>
      </motion.div>

      {showDetails && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="ml-8 text-[11px] text-theme-muted font-normal"
        >
          {isCompleted && tool.result ? (
            // Show results for completed tools
            <div className="py-1" data-onboarding="tool-result">
              <span className="text-theme-muted text-[10px] font-medium uppercase mb-1 block">Result:</span>
              {formatResult(tool.result)}
            </div>
          ) : isError && tool.error ? (
            // Show error
            <div className="py-1 text-red-600">
              {typeof tool.error === 'string' ? tool.error : JSON.stringify(tool.error)}
            </div>
          ) : tool.args ? (
            // Show args for running tools
            <div className="py-1">
              {formatArgs(tool.args)}
            </div>
          ) : null}
        </motion.div>
      )}
    </div>
  );
};
