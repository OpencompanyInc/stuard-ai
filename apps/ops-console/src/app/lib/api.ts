// Types & API helpers for the Ops Console
// All data queries go through local Next.js API routes → Supabase directly.
// No external cloud-ai dependency needed.

function getToken() {
  // Use env token first (set in .env.local), fall back to localStorage
  if (process.env.NEXT_PUBLIC_OPS_ACCESS_TOKEN) return process.env.NEXT_PUBLIC_OPS_ACCESS_TOKEN;
  return typeof window !== 'undefined' ? localStorage.getItem('stuard_access_token') : null;
}

function buildHeaders(extra?: HeadersInit): Record<string, string> {
  const h: Record<string, string> = {};
  const t = getToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  if (extra) {
    const entries = extra instanceof Headers ? Array.from(extra.entries()) : Object.entries(extra as Record<string, string>);
    for (const [k, v] of entries) h[k] = v;
  }
  return h;
}

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`/api/ops/${path}`, { ...opts, headers: buildHeaders(opts?.headers) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.ok !== false ? data : null;
  } catch { return null; }
}

export async function fetchAnalytics(days = 30) { return apiFetch<AnalyticsData>(`analytics?days=${days}`); }
export async function fetchUsers(limit = 100, offset = 0, q = '') {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (q) params.set('q', q);
  return apiFetch<{ users: UserEntry[]; total: number; planBreakdown: Record<string, number> }>(`users?${params}`);
}
export async function fetchRecentActivity(limit = 30) { return apiFetch<{ activities: Activity[] }>(`recent-activity?limit=${limit}`); }
export async function fetchServerStatus() { return apiFetch<ServerStatusData>('server-status'); }
export async function fetchSyncSystems() { return apiFetch<{ systems: SyncSystemData }>('sync-systems'); }
export async function fetchDatabaseStats() { return apiFetch<{ tables: Record<string, number> }>('database-stats'); }
export async function fetchBetaUsers() { return apiFetch<{ users: BetaUser[] }>('beta-users'); }
export async function fetchWaitlist(q = '', limit = 50) {
  const params = new URLSearchParams({ limit: String(limit), offset: '0' });
  if (q) params.set('q', q);
  return apiFetch<{ entries: WaitlistEntry[]; total: number }>(`waitlist?${params}`);
}

export async function upsertBetaUser(email: string, access_level: string, notes?: string) {
  return apiFetch('beta-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, access_level, notes: notes || null }),
  });
}

export async function deleteBetaUser(email: string) {
  return apiFetch(`beta-users/${encodeURIComponent(email)}`, { method: 'DELETE' });
}

export async function promoteWaitlistUser(email: string, access_level: string) {
  return apiFetch('waitlist/promote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, access_level, removeFromWaitlist: true }),
  });
}

export async function fetchDeployments(channel?: string, limit = 30) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (channel) params.set('channel', channel);
  return apiFetch<{ deployments: Deployment[]; latestByChannel: Record<string, Deployment> }>(`deployments?${params}`);
}

export async function recordDeployment(deploy: {
  channel: string; version?: string; git_branch?: string; git_commit_sha?: string;
  git_tag?: string; targets?: Record<string, boolean>; workflow_run_url?: string;
}) {
  return apiFetch('deployments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(deploy),
  });
}

export async function updateDeploymentStatus(id: string, updates: { status?: string; error_message?: string }) {
  return apiFetch(`deployments/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

// ── Feedback / Bugs ──
export async function fetchFeedback(opts?: { type?: string; status?: string; limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  if (opts?.type) params.set('type', opts.type);
  if (opts?.status) params.set('status', opts.status);
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));
  return apiFetch<FeedbackListResponse>(`feedback?${params}`);
}

export async function fetchFeedbackItem(id: string) {
  return apiFetch<{ item: FeedbackEntry; comments: FeedbackComment[] }>(`feedback/${id}`);
}

export async function createFeedback(fb: { type: 'bug' | 'feature'; title: string; description?: string; priority?: string; reporter_email?: string }) {
  return apiFetch<{ item: FeedbackEntry }>('feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fb),
  });
}

export async function updateFeedback(id: string, updates: { status?: string; priority?: string; assigned_to?: string | null; title?: string; description?: string }) {
  return apiFetch<{ item: FeedbackEntry }>(`feedback/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export async function addFeedbackComment(feedbackId: string, content: string, author?: string) {
  return apiFetch<{ comment: FeedbackComment }>(`feedback/${feedbackId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, author }),
  });
}

// ── Support tickets ──
export async function fetchSupportTickets(opts?: { status?: string; priority?: string; category?: string; q?: string; limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  if (opts?.status) params.set('status', opts.status);
  if (opts?.priority) params.set('priority', opts.priority);
  if (opts?.category) params.set('category', opts.category);
  if (opts?.q) params.set('q', opts.q);
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));
  return apiFetch<SupportListResponse>(`support?${params}`);
}

export async function fetchSupportTicket(id: string) {
  return apiFetch<{ ticket: SupportTicket; messages: SupportTicketMessage[] }>(`support/${id}`);
}

export async function updateSupportTicket(id: string, updates: { status?: string; priority?: string; assigned_to?: string | null; category?: string }) {
  return apiFetch<{ ticket: SupportTicket }>(`support/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export async function replyToSupportTicket(
  id: string,
  content: string,
  opts?: { internal?: boolean; author_name?: string; attachments?: SupportAttachment[] }
) {
  return apiFetch<{ message: SupportTicketMessage }>(`support/${id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      internal: opts?.internal === true,
      author_name: opts?.author_name,
      attachments: opts?.attachments,
    }),
  });
}

export const SUPPORT_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const SUPPORT_MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const SUPPORT_ALLOWED_ATTACHMENT_MIME = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
] as const;
export const SUPPORT_ALLOWED_ATTACHMENT_ACCEPT = SUPPORT_ALLOWED_ATTACHMENT_MIME.join(',');

export async function uploadSupportAttachment(file: File, ticketId: string): Promise<SupportAttachment> {
  if (file.size > SUPPORT_MAX_ATTACHMENT_BYTES) {
    throw new Error(`File too large (max ${Math.floor(SUPPORT_MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB)`);
  }
  if (!(SUPPORT_ALLOWED_ATTACHMENT_MIME as readonly string[]).includes(file.type)) {
    throw new Error('Unsupported file type. Use PNG, JPG, GIF, WebP, or PDF.');
  }
  const form = new FormData();
  form.append('file', file);
  form.append('ticket_id', ticketId);

  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch('/api/ops/support-upload', { method: 'POST', body: form, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `Upload failed (${res.status})`);
  return data.attachment as SupportAttachment;
}

export function formatSupportBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Interfaces
export interface AnalyticsData {
  period: { days: number; since: string };
  signupTrend: { date: string; count: number }[];
  usageTrend: { date: string; tokens: number; cost: number; requests: number }[];
  modelBreakdown: { model: string; tokens: number; cost: number; count: number; promptTokens: number; completionTokens: number }[];
  totals: {
    users: number;
    periodSignups: number;
    totalTokens: number; totalCost: number; totalRequests: number;
  };
}

export interface UserEntry {
  id: string; email: string; plan: string; status: string;
  monthlyTokenLimit: number; createdAt: string; lastSignIn: string | null;
  tokensLast30d: number; costLast30d: number; requestsLast30d: number;
}

export interface Activity { type: string; description: string; timestamp: string; meta?: Record<string, unknown>; }

export interface SyncSystemData {
  sharedSpaces: { status: string; total: number; recentSync: string | null };
  webhooks: { status: string; total: number; active: number; totalTriggers: number; pendingDeliveries: number };
  devices: { status: string; total: number; online: number; byPlatform: Record<string, number> };
  marketplace: { status: string; workflows: number; totalDownloads: number };
  feedback: { status: string; total: number; openBugs: number; openFeatures: number };
}

export interface ServerStatusData {
  environment: string; isProduction: boolean; publicUrl: string; nodeVersion: string;
  uptime: { seconds: number; human: string };
  memory: { rss: number; heapUsed: number; heapTotal: number; external: number };
  startedAt: string; timestamp: string;
}

export interface BetaUser {
  id: string; email: string; access_level: string;
  invited_by?: string | null; created_at?: string | null; notes?: string | null;
}

export interface WaitlistEntry {
  id: string; email: string; name?: string | null; company?: string | null;
  use_case?: string | null; referral_source?: string | null;
  position?: number | null; created_at?: string | null; notified?: boolean | null;
}

export interface StatusData {
  currentBranch: string; branches: string[]; isClean: boolean;
  modified: string[]; not_added: string[]; ahead: number; behind: number;
  latestTag: string | null; allTags: string[]; lastDeployTime: string | null;
  versions?: { desktop?: string | null; website?: string | null; cloud?: string | null };
  updates?: { stable?: UpdateChannelInfo; staging?: UpdateChannelInfo; beta?: UpdateChannelInfo };
  urls: { vercel: { preview: string; production: string }; cloudRun: { staging: string; production: string } };
}

export interface UpdateChannelInfo { ok: boolean; url: string; version?: string | null; releaseDate?: string | null; error?: string; }

export interface Deployment {
  id: string; channel: string; version: string | null; status: string;
  git_branch: string | null; git_commit_sha: string | null; git_tag: string | null;
  triggered_by: string | null; targets: Record<string, boolean>;
  workflow_run_url: string | null; workflow_run_id: string | null;
  duration_seconds: number | null; error_message: string | null;
  metadata: Record<string, unknown>; started_at: string; completed_at: string | null; created_at: string;
}

export interface FeedbackEntry {
  id: string; type: 'bug' | 'feature'; status: string; priority: string;
  title: string; description: string | null;
  reporter_email: string | null; assigned_to: string | null;
  created_at: string; updated_at: string | null; resolved_at: string | null;
  commentCount?: number;
}

export interface FeedbackComment {
  id: string; author: string; content: string; created_at: string;
}

export interface FeedbackStats {
  total: number; openBugs: number; openFeatures: number; inProgress: number; resolved: number;
  byPriority: { critical: number; high: number; medium: number; low: number };
}

export interface FeedbackListResponse {
  items: FeedbackEntry[]; total: number; limit: number; offset: number; stats: FeedbackStats;
}

// ── Support tickets ──
export type SupportTicketStatus = 'open' | 'pending' | 'awaiting_user' | 'resolved' | 'closed';
export type SupportTicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type SupportTicketCategory = 'general' | 'billing' | 'technical' | 'account' | 'feature_request' | 'bug_report' | 'other';

export interface SupportTicket {
  id: string;
  user_id: string | null;
  email: string;
  name: string | null;
  subject: string;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  assigned_to: string | null;
  metadata: Record<string, unknown>;
  last_message_at: string;
  last_message_by: 'user' | 'staff';
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  messageCount?: number;
}

export interface SupportAttachment {
  path: string;
  name: string;
  mime: string;
  size: number;
  url?: string | null;
}

export interface SupportTicketMessage {
  id: string;
  ticket_id: string;
  user_id: string | null;
  author_type: 'user' | 'staff';
  author_name: string | null;
  content: string;
  attachments: SupportAttachment[];
  internal_note: boolean;
  created_at: string;
}

export interface SupportStats {
  total: number;
  open: number;
  pending: number;
  awaitingUser: number;
  resolved: number;
  needsReply: number;
  urgent: number;
}

export interface SupportListResponse {
  tickets: SupportTicket[];
  total: number;
  limit: number;
  offset: number;
  stats: SupportStats;
}

// Utility functions
export function formatTimeAgo(dateString?: string | null) {
  if (!dateString) return 'Never';
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function formatDate(dateString?: string | null) {
  if (!dateString) return '—';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return dateString;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatNumber(n: number | null | undefined) {
  if (n == null) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function formatCurrency(n: number | null | undefined) {
  if (n == null) return '$0.00';
  return `$${n.toFixed(2)}`;
}

export function shortDate(dateStr: string) {
  return dateStr.slice(5); // "MM-DD"
}
