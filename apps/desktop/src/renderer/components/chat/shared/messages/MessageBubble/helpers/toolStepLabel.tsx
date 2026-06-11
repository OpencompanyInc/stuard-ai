import React from 'react';
import type { ToolCall } from '../../../../../../hooks/useAgent';
import { InlineCodeChip } from '../inline/InlineCodeChip';
import { getFilenameFromPath } from './filePaths';
import { getAnalyzeMediaTarget, getQueryFromArgs, humanizeToolName } from './toolLabels';

// Build a richer, action-oriented label for the chain-of-thought trace row.
// For known tools we surface the most relevant argument (file path, command,
// query) inline so the user can scan the trace without expanding each step.
//
// Labels are tense-aware: while the call is in flight they read as the action
// happening now ("Analyzing…", "Generating image…") and flip to the completed
// past tense once it resolves ("Analyzed", "Generated image"). Tense is driven
// by the live tool status, so the trace narrates work as it happens.
export function getToolStepLabel(tool: ToolCall): React.ReactNode {
  const args = (tool.args || {}) as Record<string, any>;
  const path = typeof args.path === 'string' ? args.path : null;
  const filename = path ? getFilenameFromPath(path) : null;
  // A call is "in progress" until it completes or errors. `called` (queued by
  // the model, not yet returned) reads as in-progress too.
  const active = tool.status === 'running' || tool.status === 'called';
  // Pick the present-continuous form while active, past tense when done.
  const v = (present: string, past: string) => (active ? present : past);

  switch (tool.tool) {
    case 'write_file':
    case 'workspace_write_file': {
      if (!filename) break;
      const verb = args.append ? v('Appending to', 'Appended to') : v('Writing', 'Wrote');
      return <span>{verb} <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'file_edit': {
      if (!filename) break;
      const mode = typeof args.mode === 'string' ? args.mode : 'replace';
      const verb = mode === 'delete'
        ? v('Removing from', 'Removed from')
        : mode === 'insert_before' || mode === 'insert_after'
          ? v('Inserting into', 'Inserted into')
          : v('Editing', 'Edited');
      return <span>{verb} <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'read_file':
    case 'file_read':
    case 'workspace_read_file': {
      if (!filename) break;
      const ls = Number(args.line_start);
      const le = Number(args.line_end);
      const range = Number.isFinite(ls) && Number.isFinite(le) ? ` (L${ls}–${le})` : '';
      return <span>{v('Reading', 'Read')} <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip>{range}</span>;
    }
    case 'list_directory':
    case 'workspace_list': {
      if (!filename) break;
      return <span>{v('Listing', 'Listed')} <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'create_directory': {
      if (!filename) break;
      return <span>{v('Creating folder', 'Created folder')} <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'delete_file': {
      if (!filename) break;
      return <span>{v('Deleting', 'Deleted')} <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'move_file':
    case 'copy_file': {
      const src = typeof args.src === 'string' ? getFilenameFromPath(args.src) : null;
      const dest = typeof args.dest === 'string' ? getFilenameFromPath(args.dest) : null;
      if (!src && !dest) break;
      const verb = tool.tool === 'copy_file' ? v('Copying', 'Copied') : v('Moving', 'Moved');
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
      return <span>{v('Opening', 'Opened')} <InlineCodeChip title={path || undefined}>{filename}</InlineCodeChip></span>;
    }
    case 'analyze_media': {
      const target = getAnalyzeMediaTarget(args);
      return target
        ? <span>{v('Analyzing', 'Analyzed')} <InlineCodeChip>{target}</InlineCodeChip></span>
        : v('Analyzing media', 'Analyzed media');
    }
    case 'web_search': {
      const q = getQueryFromArgs(args);
      return q
        ? <span>{v('Searching the web for', 'Searched the web for')} <InlineCodeChip max={48}>{q}</InlineCodeChip></span>
        : v('Searching the web', 'Searched the web');
    }
    case 'search_local_workflows': {
      const q = getQueryFromArgs(args);
      return q
        ? <span>{v('Searching workflows for', 'Searched workflows for')} <InlineCodeChip max={48}>{q}</InlineCodeChip></span>
        : v('Searching local workflows', 'Searched local workflows');
    }
    case 'scrape_url': {
      const url = typeof args.url === 'string' ? args.url : (typeof args.target === 'string' ? args.target : null);
      if (!url) break;
      let host = url;
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
      return <span>{v('Scraping', 'Scraped')} <InlineCodeChip title={url}>{host}</InlineCodeChip></span>;
    }
    case 'enter_research_mode':
      return v('Entering Research Mode', 'Entered Research Mode');
    case 'exit_research_mode':
      return v('Exiting Research Mode', 'Exited Research Mode');
    case 'research_search': {
      const queries = Array.isArray(args.queries) ? args.queries.filter((q: any) => typeof q === 'string' && q.trim()) : [];
      if (queries.length === 1) {
        return <span>{v('Researching', 'Researched')} <InlineCodeChip max={48}>{queries[0]}</InlineCodeChip></span>;
      }
      if (queries.length > 1) {
        return <span>{v('Researching', 'Researched')} {queries.length} angles</span>;
      }
      return v('Searching sources', 'Searched sources');
    }
    case 'research_read': {
      const src = typeof args.source === 'string' ? args.source : null;
      if (!src) return v('Reading source', 'Read source');
      let label = src;
      if (/^https?:\/\//i.test(src)) { try { label = new URL(src).hostname.replace(/^www\./, ''); } catch {} }
      return <span>{v('Reading', 'Read')} <InlineCodeChip title={src} max={40}>{label}</InlineCodeChip></span>;
    }
    case 'research_note': {
      const count = Array.isArray(args.notes) ? args.notes.length : 0;
      if (count > 0) {
        return <span>{v('Noting', 'Noted')} {count} {count === 1 ? 'insight' : 'insights'}</span>;
      }
      return v('Distilling notes', 'Distilled notes');
    }
    case 'research_status':
      return v('Reviewing research', 'Reviewed research');
    case 'research_compile':
      return v('Compiling research', 'Compiled research');
    case 'research_report': {
      const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : null;
      return title
        ? <span>{v('Writing report', 'Delivered report')} <InlineCodeChip max={48}>{title}</InlineCodeChip></span>
        : v('Writing report', 'Delivered report');
    }
    case 'glob': {
      const pat = typeof args.pattern === 'string' ? args.pattern : null;
      return pat
        ? <span>{v('Searching files', 'Searched files')} <InlineCodeChip max={48}>{pat}</InlineCodeChip></span>
        : v('Searching files', 'Searched files');
    }
    case 'grep': {
      const pat = typeof args.pattern === 'string' ? args.pattern : null;
      return pat
        ? <span>{v('Searching code', 'Searched code')} <InlineCodeChip max={48}>{pat}</InlineCodeChip></span>
        : v('Searching code', 'Searched code');
    }
    case 'run_command':
    case 'run_terminal_command':
    case 'start_terminal':
    case 'terminal_create': {
      const cmd = typeof args.command === 'string' ? args.command : null;
      return cmd ? <span>{v('Running', 'Ran')} <InlineCodeChip max={64}>{cmd}</InlineCodeChip></span> : v('Running command', 'Ran command');
    }
    case 'cli_agent_start': {
      const provider = typeof args.provider === 'string' ? args.provider : null;
      const prompt = typeof args.prompt === 'string' ? args.prompt : null;
      if (provider && prompt) {
        return <span>{v('Starting', 'Started')} {provider} <InlineCodeChip max={48}>{prompt}</InlineCodeChip></span>;
      }
      return provider ? `${v('Starting', 'Started')} ${provider} session` : v('Starting CLI agent', 'Started CLI agent');
    }
    case 'cli_agent_send': {
      const input = typeof args.input === 'string' ? args.input : (typeof args.text === 'string' ? args.text : null);
      return input
        ? <span>{v('Sending to CLI', 'Sent to CLI')} <InlineCodeChip max={56}>{input}</InlineCodeChip></span>
        : v('Sending to CLI agent', 'Sent to CLI agent');
    }
    case 'cli_agent_wait_for': {
      const needle = typeof args.text === 'string' ? args.text : null;
      return needle
        ? <span>{v('Waiting for CLI', 'Waited for CLI')} <InlineCodeChip max={48}>{needle}</InlineCodeChip></span>
        : v('Waiting for CLI output', 'Waited for CLI output');
    }
    case 'cli_agent_read':
      return v('Reading CLI output', 'Read CLI output');
    case 'terminal_read':
      return v('Reading terminal output', 'Read terminal output');
    case 'terminal_wait_for': {
      const needle = typeof args.text === 'string' ? args.text : null;
      return needle
        ? <span>{v('Waiting for', 'Waited for')} <InlineCodeChip max={48}>{needle}</InlineCodeChip></span>
        : v('Waiting for terminal output', 'Waited for terminal output');
    }
    case 'run_python_script':
    case 'run_node_script': {
      const lang = tool.tool === 'run_python_script' ? 'script' : 'Node';
      const code = typeof args.code === 'string' ? args.code : (typeof args.script === 'string' ? args.script : null);
      const firstLine = code ? code.split('\n').find((l: string) => l.trim().length > 0) || '' : '';
      return firstLine
        ? <span>{v('Running', 'Ran')} {lang} <InlineCodeChip max={56}>{firstLine.trim()}</InlineCodeChip></span>
        : `${v('Running', 'Ran')} ${lang}`;
    }
    case 'ffmpeg_status':
      return v('Checking media tools', 'Checked media tools');
    case 'ffmpeg_setup':
      return v('Setting up media tools', 'Set up media tools');
    case 'ffmpeg_probe_media': {
      const input = typeof args.inputPath === 'string' ? getFilenameFromPath(args.inputPath) : null;
      return input
        ? <span>{v('Reading media info for', 'Read media info for')} <InlineCodeChip title={args.inputPath}>{input}</InlineCodeChip></span>
        : v('Reading media info', 'Read media info');
    }
    case 'ffmpeg_convert_media':
    case 'ffmpeg_extract_audio':
    case 'ffmpeg_trim_media':
    case 'ffmpeg_extract_frames':
    case 'ffmpeg_run': {
      const input = typeof args.inputPath === 'string' ? getFilenameFromPath(args.inputPath) : null;
      const verb = tool.tool === 'ffmpeg_extract_audio' ? v('Extracting audio from', 'Extracted audio from')
        : tool.tool === 'ffmpeg_trim_media' ? v('Trimming', 'Trimmed')
        : tool.tool === 'ffmpeg_extract_frames' ? v('Extracting frames from', 'Extracted frames from')
        : tool.tool === 'ffmpeg_run' ? v('Processing', 'Processed')
        : v('Converting', 'Converted');
      return input
        ? <span>{verb} <InlineCodeChip title={args.inputPath}>{input}</InlineCodeChip></span>
        : verb;
    }
    case 'data_load':
    case 'describe_data':
    case 'correlate_data':
    case 'plot_line':
    case 'plot_bar':
    case 'plot_scatter':
    case 'plot_hist':
    case 'plot_pie':
    case 'plot_heatmap':
    case 'plot_box':
    case 'run_data_python':
      return humanizeToolName(tool.tool);
    case 'capture_screen':
    case 'take_screenshot':
      return v('Capturing screen', 'Captured screen');
    case 'browser_use_navigate': {
      const url = typeof args.url === 'string' ? args.url : null;
      if (!url) break;
      let host = url;
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
      return <span>{v('Navigating to', 'Navigated to')} <InlineCodeChip title={url}>{host}</InlineCodeChip></span>;
    }
    case 'browser_use_click': {
      const sel = typeof args.selector === 'string' ? args.selector : (typeof args.text === 'string' ? args.text : null);
      return sel ? <span>{v('Clicking', 'Clicked')} <InlineCodeChip max={48}>{sel}</InlineCodeChip></span> : v('Clicking element', 'Clicked element');
    }
    case 'generate_image':
    case 'image_gen':
    case 'create_image':
    case 'edit_image': {
      const prompt = typeof args.prompt === 'string' ? args.prompt : null;
      const verb = tool.tool === 'edit_image' ? v('Editing image', 'Edited image') : v('Generating image', 'Generated image');
      return prompt ? <span>{verb} <InlineCodeChip max={56}>{prompt}</InlineCodeChip></span> : verb;
    }
    case 'maps_search_places': {
      const q = typeof args.query === 'string' && args.query.trim() ? args.query.trim() : null;
      const type = typeof args.included_type === 'string' && args.included_type.trim() ? args.included_type.trim().replace(/_/g, ' ') : null;
      const term = q || type;
      return term
        ? <span>{v('Finding places', 'Found places')} <InlineCodeChip max={56}>{term}</InlineCodeChip></span>
        : v('Finding places nearby', 'Found places nearby');
    }
    case 'maps_place_details': {
      return v('Looking up place details', 'Looked up place details');
    }
    case 'maps_distance_matrix': {
      const from = Array.isArray(args.origins) && args.origins.length ? String(args.origins[0]) : null;
      const to = Array.isArray(args.destinations) && args.destinations.length ? String(args.destinations[0]) : null;
      if (from && to) {
        return (
          <span>
            {v('Measuring distance', 'Measured distance')} <InlineCodeChip max={32}>{from}</InlineCodeChip>
            {' '}<span className="opacity-60">→</span>{' '}
            <InlineCodeChip max={32}>{to}</InlineCodeChip>
          </span>
        );
      }
      return v('Measuring distance & travel time', 'Measured distance & travel time');
    }
    case 'maps_static_map': {
      const center = typeof args.center === 'string' && args.center.trim() ? args.center.trim() : null;
      return center
        ? <span>{v('Rendering map of', 'Rendered map of')} <InlineCodeChip max={48}>{center}</InlineCodeChip></span>
        : v('Rendering map', 'Rendered map');
    }
  }

  // Prefer an explicit AI-supplied description when present.
  if (tool.description) return tool.description;

  // Otherwise humanize the (real, unwrapped) tool name and, for arbitrary
  // tools we don't have a bespoke label for, surface the most telling argument
  // so discovered / custom-integration tools still read as an action rather
  // than a bare name.
  const name = humanizeToolName(tool.tool);
  const detail =
    getQueryFromArgs(args)
    || (typeof args.prompt === 'string' ? args.prompt : null)
    || (typeof args.text === 'string' ? args.text : null)
    || (typeof args.message === 'string' ? args.message : null)
    || (typeof args.url === 'string' ? args.url : null)
    || (typeof args.name === 'string' ? args.name : null);
  return detail
    ? <span>{name} <InlineCodeChip max={48}>{detail}</InlineCodeChip></span>
    : name;
}
