import React from 'react';
import { getTerminalPanelTitle } from '../helpers/terminalOutput';
import { TerminalOutputPanel } from './TerminalOutputPanel';

export const LIVE_OUTPUT_TOOL_NAMES = new Set([
  'run_command',
  'run_python_script',
  'run_node_script',
  'cli_agent_wait_for',
  'cli_agent_read',
  'terminal_read',
  'terminal_wait_for',
]);

interface LiveOutputPanelProps {
  output: string;
  toolName: string;
  placeholder?: string;
}

export const LiveOutputPanel: React.FC<LiveOutputPanelProps> = ({ output, toolName, placeholder }) => (
  <TerminalOutputPanel
    output={output}
    title={getTerminalPanelTitle(toolName)}
    isRunning
    placeholder={placeholder}
  />
);
