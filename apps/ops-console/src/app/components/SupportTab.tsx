'use client';

import { useRef, useState } from 'react';
import {
  Mail, AlertTriangle, Clock, CheckCircle2, MessageSquare, Send,
  Search, Inbox, Flame, EyeOff, Paperclip,
} from 'lucide-react';
import {
  SupportTicket, SupportTicketMessage, SupportStats, SupportAttachment,
  SupportTicketStatus, SupportTicketPriority,
  formatTimeAgo, formatDate,
  uploadSupportAttachment, formatSupportBytes,
  SUPPORT_ALLOWED_ATTACHMENT_ACCEPT,
  SUPPORT_MAX_ATTACHMENTS_PER_MESSAGE,
  SUPPORT_MAX_ATTACHMENT_BYTES,
} from '../lib/api';

const STATUS_CONFIG: Record<SupportTicketStatus, { label: string; color: string }> = {
  open:           { label: 'Open',            color: 'bg-amber-50 text-amber-700 border-amber-200' },
  pending:        { label: 'In Progress',     color: 'bg-blue-50 text-blue-700 border-blue-200' },
  awaiting_user:  { label: 'Awaiting User',   color: 'bg-violet-50 text-violet-700 border-violet-200' },
  resolved:       { label: 'Resolved',        color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  closed:         { label: 'Closed',          color: 'bg-gray-100 text-gray-600 border-gray-200' },
};

const PRIORITY_CONFIG: Record<SupportTicketPriority, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: 'bg-red-100 text-red-700' },
  high:   { label: 'High',   color: 'bg-orange-100 text-orange-700' },
  medium: { label: 'Medium', color: 'bg-yellow-100 text-yellow-700' },
  low:    { label: 'Low',    color: 'bg-gray-100 text-gray-600' },
};

const CATEGORY_LABELS: Record<string, string> = {
  general: 'General', billing: 'Billing', technical: 'Technical', account: 'Account',
  feature_request: 'Feature', bug_report: 'Bug', other: 'Other',
};

export default function SupportTab({
  tickets, stats, total, loading,
  filterStatus, filterPriority, searchQuery,
  onFilterStatusChange, onFilterPriorityChange, onSearchChange, onSearch,
  onUpdateStatus, onUpdatePriority,
  selectedTicket, selectedMessages,
  onSelectTicket, onCloseDetail, onReply,
}: {
  tickets: SupportTicket[];
  stats: SupportStats | null;
  total: number;
  loading: boolean;
  filterStatus: string;
  filterPriority: string;
  searchQuery: string;
  onFilterStatusChange: (s: string) => void;
  onFilterPriorityChange: (p: string) => void;
  onSearchChange: (q: string) => void;
  onSearch: () => void;
  onUpdateStatus: (id: string, status: SupportTicketStatus) => void;
  onUpdatePriority: (id: string, priority: SupportTicketPriority) => void;
  selectedTicket: SupportTicket | null;
  selectedMessages: SupportTicketMessage[];
  onSelectTicket: (id: string) => void;
  onCloseDetail: () => void;
  onReply: (ticketId: string, content: string, internal: boolean, attachments: SupportAttachment[]) => void;
}) {
  const [replyText, setReplyText] = useState('');
  const [internalNote, setInternalNote] = useState(false);
  const [replyAttachments, setReplyAttachments] = useState<SupportAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !selectedTicket) return;
    setUploadError(null);
    const remaining = SUPPORT_MAX_ATTACHMENTS_PER_MESSAGE - replyAttachments.length;
    if (remaining <= 0) {
      setUploadError(`Max ${SUPPORT_MAX_ATTACHMENTS_PER_MESSAGE} attachments`);
      return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, remaining)) {
        const att = await uploadSupportAttachment(file, selectedTicket.id);
        setReplyAttachments(prev => [...prev, att]);
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const send = () => {
    if (!replyText.trim() || !selectedTicket) return;
    onReply(selectedTicket.id, replyText.trim(), internalNote, replyAttachments);
    setReplyText('');
    setInternalNote(false);
    setReplyAttachments([]);
    setUploadError(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Support Tickets</h2>
        <p className="text-sm text-gray-500">{total} total tickets from website users</p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard label="Needs Reply" value={stats.needsReply} icon={Inbox} color="amber" />
          <StatCard label="Open" value={stats.open} icon={AlertTriangle} color="amber" />
          <StatCard label="In Progress" value={stats.pending} icon={Clock} color="blue" />
          <StatCard label="Urgent" value={stats.urgent} icon={Flame} color="red" />
          <StatCard label="Resolved" value={stats.resolved} icon={CheckCircle2} color="emerald" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden">
          {['', 'open', 'pending', 'awaiting_user', 'resolved', 'closed'].map(s => (
            <button key={s || 'all'} onClick={() => onFilterStatusChange(s)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                filterStatus === s ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}>
              {s ? STATUS_CONFIG[s as SupportTicketStatus]?.label : 'All'}
            </button>
          ))}
        </div>

        <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden">
          {['', 'urgent', 'high', 'medium', 'low'].map(p => (
            <button key={p || 'any'} onClick={() => onFilterPriorityChange(p)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                filterPriority === p ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}>
              {p ? PRIORITY_CONFIG[p as SupportTicketPriority]?.label : 'Any priority'}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className="input-field pl-9 pr-4 py-1.5 text-sm w-full"
            placeholder="Search subject or email..."
            value={searchQuery} onChange={e => onSearchChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSearch(); }} />
        </div>
      </div>

      <div className={`grid gap-6 ${selectedTicket ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
        <div className="card overflow-hidden">
          {loading && tickets.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              Loading tickets...
            </div>
          ) : tickets.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">No support tickets found.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {tickets.map(t => {
                const statusConf = STATUS_CONFIG[t.status] || STATUS_CONFIG.open;
                const priorityConf = PRIORITY_CONFIG[t.priority] || PRIORITY_CONFIG.medium;
                const isSelected = selectedTicket?.id === t.id;
                const needsReply = t.last_message_by === 'user' && (t.status === 'open' || t.status === 'pending');

                return (
                  <button key={t.id} onClick={() => onSelectTicket(t.id)}
                    className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50/50 border-l-2 border-blue-500' : ''}`}>
                    <div className="flex items-start gap-3">
                      <Mail className={`w-4 h-4 mt-0.5 flex-shrink-0 ${needsReply ? 'text-amber-500' : 'text-gray-400'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-gray-900 truncate">{t.subject}</span>
                          {needsReply && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Reply
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500 truncate mb-1">{t.email}</div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex px-2 py-0.5 text-[10px] font-medium rounded-full border ${statusConf.color}`}>
                            {statusConf.label}
                          </span>
                          <span className={`inline-flex px-2 py-0.5 text-[10px] font-medium rounded-full ${priorityConf.color}`}>
                            {priorityConf.label}
                          </span>
                          <span className="text-[10px] text-gray-400">{CATEGORY_LABELS[t.category] || t.category}</span>
                          {(t.messageCount ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-400">
                              <MessageSquare className="w-3 h-3" /> {t.messageCount}
                            </span>
                          )}
                          <span className="text-[10px] text-gray-400 ml-auto">{formatTimeAgo(t.last_message_at)}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selectedTicket && (
          <div className="card p-5 space-y-4 animate-fade-in">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-gray-900">{selectedTicket.subject}</h3>
                <div className="text-xs text-gray-500 mt-0.5">
                  <span className="font-medium text-gray-700">{selectedTicket.name || selectedTicket.email}</span>
                  {selectedTicket.name && <span className="text-gray-400"> • {selectedTicket.email}</span>}
                </div>
              </div>
              <button onClick={onCloseDetail} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-gray-400 block mb-1">Status</span>
                <select value={selectedTicket.status} onChange={e => onUpdateStatus(selectedTicket.id, e.target.value as SupportTicketStatus)}
                  className="input-field py-1 text-xs w-full">
                  <option value="open">Open</option>
                  <option value="pending">In Progress</option>
                  <option value="awaiting_user">Awaiting User</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div>
                <span className="text-gray-400 block mb-1">Priority</span>
                <select value={selectedTicket.priority} onChange={e => onUpdatePriority(selectedTicket.id, e.target.value as SupportTicketPriority)}
                  className="input-field py-1 text-xs w-full">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <span className="text-gray-400 block mb-1">Category</span>
                <span className="text-gray-700">{CATEGORY_LABELS[selectedTicket.category] || selectedTicket.category}</span>
              </div>
              <div>
                <span className="text-gray-400 block mb-1">Created</span>
                <span className="text-gray-700">{formatDate(selectedTicket.created_at)}</span>
              </div>
              {selectedTicket.assigned_to && (
                <div>
                  <span className="text-gray-400 block mb-1">Assigned</span>
                  <span className="text-gray-700">{selectedTicket.assigned_to}</span>
                </div>
              )}
              {selectedTicket.resolved_at && (
                <div>
                  <span className="text-gray-400 block mb-1">Resolved</span>
                  <span className="text-gray-700">{formatDate(selectedTicket.resolved_at)}</span>
                </div>
              )}
            </div>

            <div>
              <h4 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" /> Conversation ({selectedMessages.length})
              </h4>
              <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                {selectedMessages.length === 0 ? (
                  <p className="text-xs text-gray-400 p-2">No messages.</p>
                ) : selectedMessages.map(m => {
                  const isStaff = m.author_type === 'staff';
                  return (
                    <div key={m.id}
                      className={`rounded-lg p-3 border ${
                        m.internal_note
                          ? 'bg-yellow-50 border-yellow-200'
                          : isStaff
                            ? 'bg-blue-50/40 border-blue-100'
                            : 'bg-gray-50 border-gray-200'
                      }`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
                          {m.internal_note && <EyeOff className="w-3 h-3 text-yellow-700" />}
                          {isStaff ? (m.author_name || 'Support') : (m.author_name || 'User')}
                          {m.internal_note && <span className="text-[9px] uppercase font-semibold text-yellow-700">internal</span>}
                        </span>
                        <span className="text-[10px] text-gray-400">{formatTimeAgo(m.created_at)}</span>
                      </div>
                      <p className="text-xs text-gray-700 whitespace-pre-wrap">{m.content}</p>
                      <MessageAttachments attachments={m.attachments} />
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 space-y-2">
                <textarea className="input-field py-2 text-xs w-full resize-none"
                  rows={3} placeholder={internalNote ? 'Add an internal note (not visible to user)...' : 'Reply to user...'}
                  value={replyText} onChange={e => setReplyText(e.target.value)} />

                {replyAttachments.length > 0 && (
                  <div className="space-y-1">
                    {replyAttachments.map((a, idx) => (
                      <div key={a.path} className="flex items-center gap-2 text-[11px] bg-gray-50 border border-gray-200 rounded px-2 py-1">
                        <Paperclip className="w-3 h-3 text-gray-400" />
                        <span className="flex-1 truncate text-gray-700">{a.name}</span>
                        <span className="text-gray-400">{formatSupportBytes(a.size)}</span>
                        <button
                          type="button"
                          onClick={() => setReplyAttachments(prev => prev.filter((_, i) => i !== idx))}
                          className="text-gray-400 hover:text-red-600 px-1"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
                {uploadError && (
                  <div className="text-[11px] text-red-600">{uploadError}</div>
                )}

                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={internalNote}
                      onChange={e => setInternalNote(e.target.checked)} className="rounded" />
                    Internal note
                  </label>
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    disabled={uploading || replyAttachments.length >= SUPPORT_MAX_ATTACHMENTS_PER_MESSAGE}
                    className="text-[11px] text-gray-600 hover:text-gray-900 inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-50 disabled:opacity-40"
                    title={`Images & PDF, max ${formatSupportBytes(SUPPORT_MAX_ATTACHMENT_BYTES)} each`}
                  >
                    <Paperclip className="w-3 h-3" />
                    {uploading ? 'Uploading…' : 'Attach'}
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept={SUPPORT_ALLOWED_ATTACHMENT_ACCEPT}
                    multiple
                    onChange={e => handleFiles(e.target.files)}
                    className="hidden"
                  />
                  <button onClick={send} disabled={!replyText.trim() || uploading}
                    className="ml-auto btn-primary p-1.5 px-3 text-xs flex items-center gap-1.5 disabled:opacity-40">
                    <Send className="w-3.5 h-3.5" /> Send
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageAttachments({ attachments }: { attachments: SupportAttachment[] | undefined }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {attachments.map(a => {
        const isImage = a.mime?.startsWith('image/');
        if (isImage && a.url) {
          return (
            <a key={a.path} href={a.url} target="_blank" rel="noopener noreferrer"
              className="block max-w-[200px] rounded border border-gray-200 overflow-hidden hover:border-gray-300">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={a.name} className="block w-full h-auto" />
            </a>
          );
        }
        return (
          <a key={a.path} href={a.url || '#'} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] text-gray-700 hover:text-gray-900 bg-white border border-gray-200 rounded px-2 py-1">
            <Paperclip className="w-3 h-3 text-gray-400" />
            <span>{a.name}</span>
            <span className="text-gray-400">{formatSupportBytes(a.size)}</span>
          </a>
        );
      })}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: React.ElementType; color: string }) {
  const bg = { red: 'bg-red-50', purple: 'bg-purple-50', blue: 'bg-blue-50', emerald: 'bg-emerald-50', amber: 'bg-amber-50' }[color] || 'bg-gray-50';
  const iconColor = { red: 'text-red-600', purple: 'text-purple-600', blue: 'text-blue-600', emerald: 'text-emerald-600', amber: 'text-amber-600' }[color] || 'text-gray-600';
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <div>
        <div className="text-lg font-bold text-gray-900">{value}</div>
        <div className="text-xs text-gray-500">{label}</div>
      </div>
    </div>
  );
}
