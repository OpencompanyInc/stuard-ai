'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { AttachmentPicker } from '@/components/support/AttachmentPicker';
import {
  CATEGORY_LABELS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  PRIORITY_LABELS,
  createTicket,
  uploadAttachment,
  type SupportAttachment,
  type SupportTicketCategory,
  type SupportTicketPriority,
} from '@/lib/supportApi';

const CATEGORIES = Object.keys(CATEGORY_LABELS) as SupportTicketCategory[];
const PRIORITIES = Object.keys(PRIORITY_LABELS) as SupportTicketPriority[];

export default function NewSupportTicketPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { userData } = useAuthContext();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const prefillApplied = useRef(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<SupportTicketCategory>('general');
  const [priority, setPriority] = useState<SupportTicketPriority>('medium');
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<SupportAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (prefillApplied.current) return;
    const subjectParam = searchParams.get('subject')?.trim();
    const categoryParam = searchParams.get('category')?.trim();
    const messageParam = searchParams.get('message');
    if (!subjectParam && !categoryParam && !messageParam) return;
    prefillApplied.current = true;
    if (subjectParam) setSubject(subjectParam);
    if (categoryParam && CATEGORIES.includes(categoryParam as SupportTicketCategory)) {
      setCategory(categoryParam as SupportTicketCategory);
    }
    if (messageParam) setMessage(messageParam);
  }, [searchParams]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const remaining = MAX_ATTACHMENTS_PER_MESSAGE - attachments.length;
    if (remaining <= 0) {
      setError(`Maximum ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message`);
      return;
    }
    const toUpload = Array.from(files).slice(0, remaining);
    setUploading(true);
    try {
      for (const file of toUpload) {
        const att = await uploadAttachment(file);
        setAttachments(prev => [...prev, att]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim() || submitting) return;
    try {
      setSubmitting(true);
      setError(null);
      const { ticket } = await createTicket({
        subject: subject.trim(),
        message: message.trim(),
        category,
        priority,
        name: userData?.displayName || undefined,
        attachments,
      });
      router.push(`/dashboard/support/${ticket.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create ticket');
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/dashboard/support" className="inline-flex items-center gap-1 text-[12px] text-neutral-400 hover:text-white mb-3">
          <ChevronLeft className="w-3.5 h-3.5" /> Back to support
        </Link>
        <h1 className="dash-page-title">New support ticket</h1>
        <p className="dash-page-subtitle">Describe what&apos;s going on and our team will follow up.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      <form onSubmit={submit} className="dash-card p-6 space-y-5">
        <div>
          <label className="block text-[13px] font-medium text-neutral-300 mb-1.5">Subject</label>
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            maxLength={200}
            required
            placeholder="Short summary of the issue"
            className="dash-input"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[13px] font-medium text-neutral-300 mb-1.5">Category</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value as SupportTicketCategory)}
              className="dash-input"
            >
              {CATEGORIES.map(c => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-neutral-300 mb-1.5">Priority</label>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value as SupportTicketPriority)}
              className="dash-input"
            >
              {PRIORITIES.map(p => (
                <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[13px] font-medium text-neutral-300 mb-1.5">Message</label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={8}
            maxLength={10000}
            required
            placeholder="Please include steps to reproduce, what you expected, and any error messages."
            className="dash-input resize-y"
          />
          <p className="text-[11px] text-neutral-500 mt-1">{message.length} / 10,000</p>
        </div>

        <AttachmentPicker
          attachments={attachments}
          onRemove={i => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
          onFiles={handleFiles}
          uploading={uploading}
          inputRef={fileInput}
        />

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-800">
          <Link href="/dashboard/support" className="dash-card-button dash-card-button--ghost !flex-none px-4 py-2">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting || uploading || !subject.trim() || !message.trim()}
            className="dash-card-button dash-card-button--primary !flex-none px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Submitting…' : 'Submit ticket'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ChevronLeft({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>;
}
