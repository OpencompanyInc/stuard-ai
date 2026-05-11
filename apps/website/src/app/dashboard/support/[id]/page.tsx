'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  closeTicket,
  formatRelative,
  getTicket,
  priorityColor,
  replyToTicket,
  statusColor,
  uploadAttachment,
  type SupportAttachment,
  type SupportTicket,
  type SupportTicketMessage,
} from '@/lib/supportApi';
import { AttachmentPicker } from '@/components/support/AttachmentPicker';

export default function SupportTicketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportTicketMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [replyAttachments, setReplyAttachments] = useState<SupportAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const data = await getTicket(id);
      setTicket(data.ticket);
      setMessages(data.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ticket');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const att = await uploadAttachment(file);
        setReplyAttachments(prev => [...prev, att]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const onReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim() || submitting || !id) return;
    try {
      setSubmitting(true);
      const { message } = await replyToTicket(id, reply.trim(), replyAttachments);
      setMessages(prev => [...prev, message]);
      setReply('');
      setReplyAttachments([]);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send reply');
    } finally {
      setSubmitting(false);
    }
  };

  const onClose = async () => {
    if (!id || closing) return;
    if (!confirm('Close this ticket? You can always open a new one.')) return;
    try {
      setClosing(true);
      await closeTicket(id);
      router.push('/dashboard/support');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to close ticket');
      setClosing(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl py-12 flex items-center justify-center text-sm text-gray-400">
        <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="max-w-3xl space-y-4">
        <Link href="/dashboard/support" className="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-900">
          <ChevronLeft className="w-3.5 h-3.5" /> Back to support
        </Link>
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error || 'Ticket not found'}</div>
      </div>
    );
  }

  const isClosed = ticket.status === 'closed' || ticket.status === 'resolved';

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/dashboard/support" className="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-900 mb-3">
          <ChevronLeft className="w-3.5 h-3.5" /> Back to support
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">{ticket.subject}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
              <span className={`inline-flex px-2 py-0.5 rounded-full border font-medium ${statusColor(ticket.status)}`}>
                {STATUS_LABELS[ticket.status]}
              </span>
              <span className={`inline-flex px-2 py-0.5 rounded-full border font-medium ${priorityColor(ticket.priority)}`}>
                {PRIORITY_LABELS[ticket.priority]}
              </span>
              <span className="text-gray-400">{CATEGORY_LABELS[ticket.category]}</span>
              <span className="text-gray-300">•</span>
              <span className="text-gray-400">Opened {formatRelative(ticket.created_at)}</span>
            </div>
          </div>
          {!isClosed && (
            <button
              onClick={onClose}
              disabled={closing}
              className="text-[12px] font-medium text-gray-500 hover:text-red-600 disabled:opacity-50 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-red-200 hover:bg-red-50 transition-colors"
            >
              {closing ? 'Closing…' : 'Close ticket'}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {messages.map(m => {
          const isStaff = m.author_type === 'staff';
          return (
            <div key={m.id} className={`flex gap-3 ${isStaff ? 'pr-8' : 'pl-8'}`}>
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold ${isStaff ? 'bg-blue-600' : 'bg-gray-900'}`}>
                {isStaff ? 'S' : (m.author_name?.charAt(0).toUpperCase() || 'Y')}
              </div>
              <div className={`flex-1 min-w-0 rounded-xl border p-4 ${isStaff ? 'bg-blue-50/40 border-blue-100' : 'bg-white border-gray-200'}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[13px] font-semibold text-gray-900">
                    {isStaff ? 'Stuard Support' : (m.author_name || 'You')}
                  </span>
                  <span className="text-[11px] text-gray-400">{formatRelative(m.created_at)}</span>
                </div>
                <div className="text-[13px] text-gray-700 whitespace-pre-wrap">{m.content}</div>
                <AttachmentList attachments={m.attachments} />
              </div>
            </div>
          );
        })}
      </div>

      {isClosed ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center text-sm text-gray-500">
          This ticket is {STATUS_LABELS[ticket.status].toLowerCase()}.{' '}
          <Link href="/dashboard/support/new" className="text-gray-900 font-medium hover:underline">Open a new ticket</Link> if you need more help.
        </div>
      ) : (
        <form onSubmit={onReply} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <label className="block text-[13px] font-medium text-gray-700">Your reply</label>
          <textarea
            value={reply}
            onChange={e => setReply(e.target.value)}
            rows={5}
            maxLength={10000}
            placeholder="Write a reply…"
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 resize-y"
          />
          <AttachmentPicker
            attachments={replyAttachments}
            onRemove={i => setReplyAttachments(prev => prev.filter((_, idx) => idx !== i))}
            onFiles={handleFiles}
            uploading={uploading}
            inputRef={fileInput}
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="submit"
              disabled={submitting || uploading || !reply.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-white bg-gray-900 rounded-lg hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Sending…' : 'Send reply'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function AttachmentList({ attachments }: { attachments: SupportAttachment[] }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {attachments.map(a => {
        const isImage = a.mime?.startsWith('image/');
        if (isImage && a.url) {
          return (
            <a
              key={a.path}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block max-w-xs rounded-lg overflow-hidden border border-gray-200 hover:border-gray-300"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={a.name} className="block w-full h-auto" />
            </a>
          );
        }
        return (
          <a
            key={a.path}
            href={a.url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-[12px] text-gray-700 hover:text-gray-900 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5"
          >
            <PaperclipIcon className="w-3.5 h-3.5 text-gray-400" />
            <span>{a.name}</span>
          </a>
        );
      })}
    </div>
  );
}

function PaperclipIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" /></svg>;
}
function ChevronLeft({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>;
}
