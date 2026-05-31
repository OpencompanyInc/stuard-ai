import React from 'react';
import type { ToolCall } from '../../../../../../hooks/useAgent';
import { InlineCodeChip } from '../inline/InlineCodeChip';
import { getFilenameFromPath } from './filePaths';
import { getAnalyzeMediaTarget, getQueryFromArgs, humanizeToolName } from './toolLabels';

// Build a richer, action-oriented label for the chain-of-thought trace row.
// For known tools we surface the most relevant argument (file path, command,
// query) inline so the user can scan the trace without expanding each step.
// Falls back to the AI-supplied description / humanized tool name otherwise.
export function getToolStepLabel(tool: ToolCall): React.ReactNode {
  const args = (tool.args || {}) as Record<string, any>;
  const path = typeof args.path === 'string' ? args.path : null;
  const filename = path ? getFilenameFromPath(path) : null;

  switch (tool.tool) {
    case 'write_file':
    case 'workspace_write_file': {
      if (!filename) break;
      const verb = args.append ? 'Appended to' : 'Wrote';
      return <span>{verb} <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'file_edit': {
      if (!filename) break;
      const mode = typeof args.mode === 'string' ? args.mode : 'replace';
      const verb = mode === 'delete' ? 'Removed from' : mode === 'insert_before' || mode === 'insert_after' ? 'Inserted into' : 'Edited';
      return <span>{verb} <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'read_file':
    case 'file_read':
    case 'workspace_read_file': {
      if (!filename) break;
      const ls = Number(args.line_start);
      const le = Number(args.line_end);
      const range = Number.isFinite(ls) && Number.isFinite(le) ? ` (L${ls}–${le})` : '';
      return <span>Read <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip>{range}</span>;
    }
    case 'list_directory':
    case 'workspace_list': {
      if (!filename) break;
      return <span>Listed <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'create_directory': {
      if (!filename) break;
      return <span>Created folder <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'delete_file': {
      if (!filename) break;
      return <span>Deleted <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'move_file':
    case 'copy_file': {
      const src = typeof args.src === 'string' ? getFilenameFromPath(args.src) : null;
      const dest = typeof args.dest === 'string' ? getFilenameFromPath(args.dest) : null;
      if (!src && !dest) break;
      const verb = tool.tool === 'copy_file' ? 'Copied' : 'Moved';
      return (
        <span>
          {verb} <InlineCodeChip title={args.src}>{src || '?'}</InlineCodeChip>
          {' '}<span className="opacity-60">→</span>{' '}
          <InlineCodeChip title={args.dest}>{dest || '?'}</InlineCodeChip>
        </span>
      );
    }
    case 'open_file': {
      if (!filename) break;
      return <span>Opened <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'analyze_media': {
      const target = getAnalyzeMediaTarget(args);
      return target
        ? <span>Analyzed <InlineCodeChip>{target}</InlineCodeChip></span>
        : 'Analyzed media';
    }
    case 'web_search': {
      const q = getQueryFromArgs(args);
      return q ? <span>Searched the web for <InlineCodeChip max={48}>{q}</InlineCodeChip></span> : 'Searched the web';
    }
    case 'search_local_workflows': {
      const q = getQueryFromArgs(args);
      return q ? <span>Searched workflows for <InlineCodeChip max={48}>{q}</InlineCodeChip></span> : 'Searched local workflows';
    }
    case 'scrape_url': {
      const url = typeof args.url === 'string' ? args.url : (typeof args.target === 'string' ? args.target : null);
      if (!url) break;
      let host = url;
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
      return <span>Scraped <InlineCodeChip title={url}>{host}</InlineCodeChip></span>;
    }
    case 'glob': {
      const pat = typeof args.pattern === 'string' ? args.pattern : null;
      return pat ? <span>Searched files <InlineCodeChip max={48}>{pat}</InlineCodeChip></span> : 'Searched files';
    }
    case 'grep': {
      const pat = typeof args.pattern === 'string' ? args.pattern : null;
      return pat ? <span>Searched code <InlineCodeChip max={48}>{pat}</InlineCodeChip></span> : 'Searched code';
    }
    case 'run_command':
    case 'run_terminal_command':
    case 'start_terminal':
    case 'terminal_create': {
      const cmd = typeof args.command === 'string' ? args.command : null;
      return cmd ? <span>Ran <InlineCodeChip max={64}>{cmd}</InlineCodeChip></span> : 'Ran command';
    }
    case 'cli_agent_start': {
      const provider = typeof args.provider === 'string' ? args.provider : null;
      const prompt = typeof args.prompt === 'string' ? args.prompt : null;
      if (provider && prompt) {
        return <span>Started {provider} <InlineCodeChip max={48}>{prompt}</InlineCodeChip></span>;
      }
      return provider ? `Started ${provider} session` : 'Started CLI agent';
    }
    case 'cli_agent_send': {
      const input = typeof args.input === 'string' ? args.input : (typeof args.text === 'string' ? args.text : null);
      return input ? <span>Sent to CLI <InlineCodeChip max={56}>{input}</InlineCodeChip></span> : 'Sent to CLI agent';
    }
    case 'cli_agent_wait_for': {
      const needle = typeof args.text === 'string' ? args.text : null;
      return needle
        ? <span>Waiting for CLI <InlineCodeChip max={48}>{needle}</InlineCodeChip></span>
        : 'Waiting for CLI output';
    }
    case 'cli_agent_read':
      return 'Read CLI output';
    case 'terminal_read':
      return 'Read terminal output';
    case 'terminal_wait_for': {
      const needle = typeof args.text === 'string' ? args.text : null;
      return needle
        ? <span>Waiting for <InlineCodeChip max={48}>{needle}</InlineCodeChip></span>
        : 'Waiting for terminal output';
    }
    case 'run_python_script':
    case 'run_node_script': {
      const lang = tool.tool === 'run_python_script' ? 'Python' : 'Node';
      const code = typeof args.code === 'string' ? args.code : (typeof args.script === 'string' ? args.script : null);
      const firstLine = code ? code.split('\n').find((l: string) => l.trim().length > 0) || '' : '';
      return firstLine
        ? <span>Ran {lang} <InlineCodeChip max={56}>{firstLine.trim()}</InlineCodeChip></span>
        : `Ran ${lang} script`;
    }
    case 'capture_screen':
    case 'take_screenshot':
      return 'Captured screen';
    case 'browser_use_navigate': {
      const url = typeof args.url === 'string' ? args.url : null;
      if (!url) break;
      let host = url;
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
      return <span>Navigated to <InlineCodeChip title={url}>{host}</InlineCodeChip></span>;
    }
    case 'browser_use_click': {
      const sel = typeof args.selector === 'string' ? args.selector : (typeof args.text === 'string' ? args.text : null);
      return sel ? <span>Clicked <InlineCodeChip max={48}>{sel}</InlineCodeChip></span> : 'Clicked element';
    }
  }

  return tool.description || humanizeToolName(tool.tool);
}
