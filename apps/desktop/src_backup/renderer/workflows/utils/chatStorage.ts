/**
 * Chat History Storage for Workflow Assistant
 * Stores chat sessions per workflow in localStorage
 */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
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
const MAX_SESSIONS_PER_WORKFLOW = 10;

/**
 * Get all stored chat sessions
 */
export function getAllSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
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
    all[idx].messages = messages;
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
