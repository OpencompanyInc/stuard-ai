// Wire protocol shared between the extension background worker and the desktop
// extension-bridge WebSocket server. Keep this in sync with
// apps/desktop/src/main/services/extension-bridge.ts.

/** Ports the desktop bridge binds, tried in order by both sides. */
export const BRIDGE_PORTS = [18791, 18792, 18793, 18794, 18795];

export const PROTOCOL_VERSION = 1;

// ── Extension → Desktop ──────────────────────────────────────────────────────
export type HelloMessage = {
  type: 'hello';
  client: 'extension';
  protocol: number;
  extId: string;
  version: string;
  token: string;
  browser: string;
};

export type PongMessage = { type: 'pong'; ts: number };

export type ResultMessage = {
  type: 'result';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type ExtensionMessage = HelloMessage | PongMessage | ResultMessage;

// ── Desktop → Extension ──────────────────────────────────────────────────────
export type WelcomeMessage = {
  type: 'welcome';
  paired: boolean;
  needPairing: boolean;
  serverVersion?: string;
};

export type PingMessage = { type: 'ping'; ts: number };

export type CommandMessage = {
  type: 'command';
  id: string;
  action: BridgeAction;
  payload?: Record<string, unknown>;
  timeoutMs?: number;
};

export type DesktopMessage = WelcomeMessage | PingMessage | CommandMessage;

export type BridgeAction =
  | 'status'
  | 'get_page'
  | 'run_script'
  | 'extract'
  | 'tabs'
  | 'capture_screenshot';
