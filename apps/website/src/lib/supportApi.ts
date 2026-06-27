import { supabase } from '@/lib/supabaseClient';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB per file (must match storage.buckets)
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const ALLOWED_ATTACHMENT_MIME = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
] as const;
export const ALLOWED_ATTACHMENT_ACCEPT = ALLOWED_ATTACHMENT_MIME.join(',');

export interface SupportAttachment {
  path: string;
  name: string;
  mime: string;
  size: number;
  url?: string; // populated server-side at read time (signed URL)
}

export function isAllowedAttachmentMime(mime: string): boolean {
  return (ALLOWED_ATTACHMENT_MIME as readonly string[]).includes(mime);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type SupportTicketStatus = 'open' | 'pending' | 'awaiting_user' | 'resolved' | 'closed';
export type SupportTicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type SupportTicketCategory = 'general' | 'billing' | 'technical' | 'account' | 'feature_request' | 'bug_report' | 'other';

export interface SupportTicketSummary {
  id: string;
  subject: string;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  last_message_at: string;
  last_message_by: 'user' | 'staff';
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface SupportTicket extends SupportTicketSummary {
  user_id: string | null;
  email: string;
  name: string | null;
  assigned_to: string | null;
  metadata: Record<string, unknown>;
}

export interface SupportTicketMessage {
  id: string;
  author_type: 'user' | 'staff';
  author_name: string | null;
  content: string;
  attachments: SupportAttachment[];
  created_at: string;
}

async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error('Not signed in');
  const res = await fetch(`/api/support${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

export function listTickets() {
  return request<{ tickets: SupportTicketSummary[] }>('');
}

export function getTicket(id: string) {
  return request<{ ticket: SupportTicket; messages: SupportTicketMessage[] }>(`/${id}`);
}

export function createTicket(input: {
  subject: string;
  message: string;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
  name?: string;
  attachments?: SupportAttachment[];
}) {
  return request<{ ticket: SupportTicket }>('', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function replyToTicket(id: string, content: string, attachments?: SupportAttachment[]) {
  return request<{ message: SupportTicketMessage }>(`/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, attachments }),
  });
}

export async function uploadAttachment(file: File): Promise<SupportAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`File too large (max ${formatBytes(MAX_ATTACHMENT_BYTES)})`);
  }
  if (!isAllowedAttachmentMime(file.type)) {
    throw new Error('Unsupported file type. Use PNG, JPG, GIF, WebP, or PDF.');
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');

  const form = new FormData();
  form.append('file', file);

  const res = await fetch('/api/support/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Upload failed (${res.status})`);
  return json.attachment as SupportAttachment;
}

export function closeTicket(id: string) {
  return request<{ ticket: SupportTicket }>(`/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'close' }),
  });
}

export const CATEGORY_LABELS: Record<SupportTicketCategory, string> = {
  general: 'General',
  billing: 'Billing',
  technical: 'Technical',
  account: 'Account',
  feature_request: 'Feature request',
  bug_report: 'Bug report',
  other: 'Other',
};

export const PRIORITY_LABELS: Record<SupportTicketPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: 'Open',
  pending: 'In progress',
  awaiting_user: 'Awaiting your reply',
  resolved: 'Resolved',
  closed: 'Closed',
};

export function statusColor(status: SupportTicketStatus): string {
  switch (status) {
    case 'open': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'pending': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'awaiting_user': return 'bg-violet-50 text-violet-700 border-violet-200';
    case 'resolved': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'closed': return 'bg-gray-100 text-gray-600 border-gray-200';
  }
}

export function priorityColor(priority: SupportTicketPriority): string {
  switch (priority) {
    case 'urgent': return 'bg-red-50 text-red-700 border-red-200';
    case 'high': return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'medium': return 'bg-yellow-50 text-yellow-700 border-yellow-200';
    case 'low': return 'bg-gray-50 text-gray-600 border-gray-200';
  }
}

export function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
