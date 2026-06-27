'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuthContext } from '@/components/providers/AuthProvider';
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  formatRelative,
  listTickets,
  priorityColor,
  statusColor,
  type SupportTicketSummary,
} from '@/lib/supportApi';

export default function SupportPage() {
  const { user } = useAuthContext();
  const [tickets, setTickets] = useState<SupportTicketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      const { tickets } = await listTickets();
      setTickets(tickets);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const openCount = tickets.filter(t => t.status !== 'closed' && t.status !== 'resolved').length;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="dash-page-title">Support</h1>
          <p className="dash-page-subtitle">
            {openCount > 0
              ? `You have ${openCount} active ticket${openCount === 1 ? '' : 's'}.`
              : 'Need a hand? Our team usually replies within 1 business day.'}
          </p>
        </div>
        <Link
          href="/dashboard/support/new"
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-[13px] font-medium text-white bg-gray-900 rounded-lg hover:bg-black transition-colors"
        >
          <PlusIcon className="w-4 h-4" /> New ticket
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      <div className="dash-card overflow-hidden">
        {loading ? (
          <div className="p-10 flex items-center justify-center text-sm text-gray-400">
            <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin mr-2" /> Loading tickets…
          </div>
        ) : tickets.length === 0 ? (
          <div className="p-12 text-center">
            <InboxIcon className="w-10 h-10 mx-auto text-gray-300 mb-3" />
            <h3 className="text-[15px] font-semibold text-gray-900 mb-1">No support tickets yet</h3>
            <p className="text-sm text-gray-500 mb-5">Open a ticket and we&apos;ll get back to you.</p>
            <Link
              href="/dashboard/support/new"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-white bg-gray-900 rounded-lg hover:bg-black"
            >
              <PlusIcon className="w-4 h-4" /> Create your first ticket
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-800/70">
            {tickets.map(t => (
              <li key={t.id}>
                <Link
                  href={`/dashboard/support/${t.id}`}
                  className="flex items-start gap-4 px-5 py-4 hover:bg-neutral-800/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[14px] font-medium text-gray-900 truncate">{t.subject}</span>
                      {t.last_message_by === 'staff' && t.status !== 'closed' && t.status !== 'resolved' && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> New reply
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className={`inline-flex px-2 py-0.5 rounded-full border font-medium ${statusColor(t.status)}`}>
                        {STATUS_LABELS[t.status]}
                      </span>
                      <span className={`inline-flex px-2 py-0.5 rounded-full border font-medium ${priorityColor(t.priority)}`}>
                        {PRIORITY_LABELS[t.priority]}
                      </span>
                      <span className="text-gray-400">{CATEGORY_LABELS[t.category]}</span>
                      <span className="text-gray-300">•</span>
                      <span className="text-gray-400">Updated {formatRelative(t.last_message_at)}</span>
                    </div>
                  </div>
                  <ChevronRightIcon className="w-4 h-4 text-gray-300 flex-shrink-0 mt-1" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>;
}
function ChevronRightIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>;
}
function InboxIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z" /></svg>;
}
