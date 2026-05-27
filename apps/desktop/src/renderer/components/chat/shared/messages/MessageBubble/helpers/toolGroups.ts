import { humanizeToolName } from './toolLabels';

export const TOOL_GROUP_LABELS: Record<string, { singular: string; plural: string }> = {
  list_directory: { singular: 'Listed directory', plural: 'Listed {n} directories' },
  read_file: { singular: 'Read file', plural: 'Read {n} files' },
  file_read: { singular: 'Read file', plural: 'Read {n} files' },
  write_file: { singular: 'Wrote file', plural: 'Wrote {n} files' },
  file_edit: { singular: 'Edited file', plural: 'Edited {n} files' },
  search_workflows: { singular: 'Searched workflows', plural: 'Searched {n} workflows' },
  search_local_workflows: { singular: 'Searched workflows', plural: 'Searched {n} workflows' },
  web_search: { singular: 'Searched the web', plural: 'Ran {n} web searches' },
  scrape_url: { singular: 'Scraped URL', plural: 'Scraped {n} URLs' },
  glob: { singular: 'Searched files', plural: 'Ran {n} file searches' },
  grep: { singular: 'Searched code', plural: 'Ran {n} code searches' },
  run_command: { singular: 'Ran command', plural: 'Ran {n} commands' },
  cli_agent_wait_for: { singular: 'Waited for CLI output', plural: 'Waited for CLI output ×{n}' },
  cli_agent_read: { singular: 'Read CLI output', plural: 'Read CLI output ×{n}' },
  terminal_read: { singular: 'Read terminal', plural: 'Read terminal ×{n}' },
  terminal_wait_for: { singular: 'Waited for terminal output', plural: 'Waited for terminal output ×{n}' },
  capture_screen: { singular: 'Captured screen', plural: 'Captured {n} screenshots' },
  browser_use_screenshot: { singular: 'Took screenshot', plural: 'Took {n} screenshots' },
  browser_use_analyze_screenshot: { singular: 'Analyzed browser screenshot', plural: 'Analyzed {n} browser screenshots' },
  browser_use_navigate: { singular: 'Navigated', plural: 'Navigated {n} pages' },
  browser_use_click: { singular: 'Clicked element', plural: 'Clicked {n} elements' },
};

export function getGroupLabel(toolName: string, count: number): string {
  const entry = TOOL_GROUP_LABELS[toolName];
  if (!entry) {
    const humanized = humanizeToolName(toolName);
    return count === 1 ? humanized : `${humanized} ×${count}`;
  }
  return count === 1 ? entry.singular : entry.plural.replace('{n}', String(count));
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(Math.round(n));
}
