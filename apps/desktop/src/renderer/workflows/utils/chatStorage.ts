/**
 * Chat History Storage for Workflow Assistant
 */

export type StoredStreamItem =
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool'; event: any };

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: Array<{ path: string; name: string; dataUrl?: string; data?: string; mimeType?: string }>;
  parts?: StoredStreamItem[];
  reasoning?: string;
  draft?: boolean;
  usage?: Record<string, any>;
  modelId?: string;
}

export interface ChatSession {
  id: string;
  workflowId: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  title?: string; // Auto-generated from first user message
}

const STORAGE_KEY = 'stuard_workflow_chat_sessions';
const MAX_SESSIONS_PER_WORKFLOW = 5;
const MAX_MESSAGES_PER_SESSION = 40;
const MAX_CONTENT_CHARS = 24_000;
const MAX_REASONING_CHARS = 12_000;
const MAX_TEXT_PART_CHARS = 12_000;
const MAX_PARTS_PER_MESSAGE = 60;
const MAX_TOOL_JSON_CHARS = 24_000;

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated ${value.length - maxChars} chars]`;
}

function compactValue(value: any, maxJsonChars = MAX_TOOL_JSON_CHARS): any {
  if (value == null) return value;
  if (typeof value === 'string') return clipText(value, Math.min(maxJsonChars, MAX_CONTENT_CHARS));
  if (typeof value !== 'object') return value;

  try {
    const json = JSON.stringify(value);
    if (json.length <= maxJsonChars) return value;
  } catch {
    return '[unserializable value]';
  }

  if (Array.isArray(value)) {
    return {
      __truncated: true,
      itemCount: value.length,
      preview: value.slice(0, 20).map((item) => compactValue(item, Math.max(1_000, Math.floor(maxJsonChars / 20)))),
    };
  }

  const out: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('base64') ||
      lower === 'data' ||
      lower === 'dataurl' ||
      lower === 'imagedata' ||
      lower === 'audiodata' ||
      lower === 'videodata' ||
      lower === 'buffer'
    ) {
      out[key] = typeof entry === 'string' ? `[omitted ${entry.length} chars]` : '[omitted binary payload]';
      continue;
    }
    if (lower === 'workflow' || lower === 'spec') {
      const spec: any = entry;
      out[`${key}Summary`] = spec && typeof spec === 'object'
        ? {
          triggers: Array.isArray(spec.triggers) ? spec.triggers.length : undefined,
          nodes: Array.isArray(spec.nodes) ? spec.nodes.length : undefined,
          steps: Array.isArray(spec.steps) ? spec.steps.length : undefined,
          wires: Array.isArray(spec.wires) ? spec.wires.length : undefined,
        }
        : '[omitted large workflow payload]';
      continue;
    }
    out[key] = compactValue(entry, Math.max(1_000, Math.floor(maxJsonChars / 8)));
  }
  out.__truncated = true;
  return out;
}

function compactPart(part: any): StoredStreamItem | null {
  if (part?.type === 'tool') {
    const event = part?.event && typeof part.event === 'object' ? part.event : {};
    return {
      type: 'tool',
      event: {
        ...event,
        args: compactValue(event.args, 8_000),
        argsText: typeof event.argsText === 'string' ? clipText(event.argsText, 8_000) : event.argsText,
        result: compactValue(event.result, MAX_TOOL_JSON_CHARS),
        workflowBefore: undefined,
      },
    } satisfies StoredStreamItem;
  }
  if (part?.type === 'text') {
    return { type: 'text', content: clipText(typeof part?.content === 'string' ? part.content : '', MAX_TEXT_PART_CHARS) } satisfies StoredStreamItem;
  }
  if (part?.type === 'reasoning') {
    return { type: 'reasoning', content: clipText(typeof part?.content === 'string' ? part.content : '', MAX_REASONING_CHARS) } satisfies StoredStreamItem;
  }
  return null;
}

function compactImages(images: any): ChatMessage['images'] {
  if (!Array.isArray(images)) return undefined;
  return images.slice(0, 8).map((img: any) => ({
    path: typeof img?.path === 'string' ? img.path : '',
    name: typeof img?.name === 'string' ? img.name : 'image',
    mimeType: typeof img?.mimeType === 'string' ? img.mimeType : undefined,
  }));
}

function normalizeMessage(message: any): ChatMessage {
  return {
    role: message?.role === 'assistant' || message?.role === 'system' ? message.role : 'user',
    content: typeof message?.content === 'string' ? clipText(message.content, MAX_CONTENT_CHARS) : '',
    images: compactImages(message?.images),
    parts: Array.isArray(message?.parts)
      ? message.parts
        .slice(-MAX_PARTS_PER_MESSAGE)
        .map(compactPart)
        .filter((part: StoredStreamItem | null): part is StoredStreamItem => part !== null)
      : undefined,
    reasoning: typeof message?.reasoning === 'string' ? clipText(message.reasoning, MAX_REASONING_CHARS) : undefined,
    draft: message?.draft === true ? true : undefined,
    usage: message?.usage && typeof message.usage === 'object' ? message.usage : undefined,
    modelId: typeof message?.modelId === 'string' ? message.modelId : undefined,
  };
}

function normalizeSession(session: any): ChatSession | null {
  if (!session || typeof session !== 'object' || typeof session.id !== 'string' || typeof session.workflowId !== 'string') {
    return null;
  }

  return {
    id: session.id,
    workflowId: session.workflowId,
    messages: Array.isArray(session.messages) ? session.messages.slice(-MAX_MESSAGES_PER_SESSION).map(normalizeMessage) : [],
    createdAt: typeof session.createdAt === 'string' ? session.createdAt : new Date().toISOString(),
    updatedAt: typeof session.updatedAt === 'string' ? session.updatedAt : new Date().toISOString(),
    title: typeof session.title === 'string' ? session.title : undefined,
  };
}

/**
 * Get all stored chat sessions
 */
export function getAllSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeSession)
      .filter((session): session is ChatSession => session !== null);
  } catch {
    return [];
  }
}

/**
 * Get sessions for a specific workflow
 */
export function getSessionsForWorkflow(workflowId: string): ChatSession[] {
  const all = getAllSessions();
  return all
    .filter(s => s.workflowId === workflowId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/**
 * Get a specific session by ID
 */
export function getSession(sessionId: string): ChatSession | null {
  const all = getAllSessions();
  return all.find(s => s.id === sessionId) || null;
}

/**
 * Create a new chat session for a workflow
 */
export function createSession(workflowId: string): ChatSession {
  const session: ChatSession = {
    id: `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    workflowId,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  const all = getAllSessions();
  all.push(session);
  
  // Prune old sessions for this workflow
  pruneSessionsForWorkflow(all, workflowId, MAX_SESSIONS_PER_WORKFLOW);
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  return session;
}

/**
 * Save messages to a session
 */
export function saveSession(sessionId: string, messages: ChatMessage[]): void {
  const all = getAllSessions();
  const idx = all.findIndex(s => s.id === sessionId);
  
  if (idx >= 0) {
    all[idx].messages = messages.slice(-MAX_MESSAGES_PER_SESSION).map(normalizeMessage);
    all[idx].updatedAt = new Date().toISOString();
    
    // Auto-generate title from first user message
    if (!all[idx].title) {
      const firstUserMsg = messages.find(m => m.role === 'user');
      if (firstUserMsg) {
        all[idx].title = firstUserMsg.content.slice(0, 50) + (firstUserMsg.content.length > 50 ? '...' : '');
      }
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }
}

/**
 * Delete a session
 */
export function deleteSession(sessionId: string): void {
  const all = getAllSessions();
  const filtered = all.filter(s => s.id !== sessionId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

/**
 * Delete all sessions for a workflow
 */
export function deleteSessionsForWorkflow(workflowId: string): void {
  const all = getAllSessions();
  const filtered = all.filter(s => s.workflowId !== workflowId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

/**
 * Prune old sessions to keep only the most recent N
 */
function pruneSessionsForWorkflow(all: ChatSession[], workflowId: string, maxSessions: number): void {
  const workflowSessions = all
    .filter(s => s.workflowId === workflowId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  
  if (workflowSessions.length > maxSessions) {
    const toRemove = new Set(workflowSessions.slice(maxSessions).map(s => s.id));
    for (let i = all.length - 1; i >= 0; i--) {
      if (toRemove.has(all[i].id)) {
        all.splice(i, 1);
      }
    }
  }
}

/**
 * Get formatted time for display
 */
export function formatSessionTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
