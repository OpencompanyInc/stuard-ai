export interface TerminalSession {
  id: string;
  pid: number;
  shell: string;
  cwd: string;
  title: string;
  createdAt: number;
  lastActivity: number;
  cols: number;
  rows: number;
  status: 'running' | 'exited';
  exitCode?: number;
}

export interface TerminalCreateOptions {
  shell?: string; // 'powershell' | 'cmd' | 'bash' | 'zsh' | 'auto'
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface TerminalDataEvent {
  sessionId: string;
  data: string;
}

export interface TerminalExitEvent {
  sessionId: string;
  exitCode: number;
}

// Chunked output for AI/automation consumption (seq-based incremental reads)
export interface TerminalOutputChunk {
  seq: number;
  ts: number;
  text: string;
  // Optional: raw vs processed stream markers (future)
  stream?: 'stdout' | 'stderr' | 'pty';
}
