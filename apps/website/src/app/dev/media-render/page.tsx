'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

type MediaAssetRow = {
  id: string;
  path: string;
  label: string;
  section: string;
  kind: 'video' | 'image';
  onDisk: boolean;
  hasIncoming?: boolean;
};

type RenderSnapshot = {
  running: boolean;
  current: { id: string; path: string; label: string; section: string } | null;
  remaining: { id: string; path: string; label: string; section: string }[];
  completed: string[];
  skipped: string[];
  error: string | null;
  log: string | null;
  assets: MediaAssetRow[];
  summary: {
    videosTotal: number;
    videosOnDisk: number;
    videosMissing: number;
    videosReadyToRender: number;
    imagesMissing: number;
  };
  incomingDir: string;
  message?: string;
  ok?: boolean;
};

export default function MediaRenderPage() {
  const [snap, setSnap] = useState<RenderSnapshot | null>(null);
  const [starting, setStarting] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/dev/media-render', { cache: 'no-store' });
      if (!res.ok) {
        setPollError(res.status === 404 ? 'Dev-only route (run npm run dev).' : `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as RenderSnapshot;
      setSnap(data);
      setPollError(null);
    } catch (e) {
      setPollError(String(e));
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (!snap?.running) return;
    const t = setInterval(() => void fetchStatus(), 800);
    return () => clearInterval(t);
  }, [snap?.running, fetchStatus]);

  const startRender = async () => {
    setStarting(true);
    try {
      await fetch('/api/dev/media-render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      await fetchStatus();
    } finally {
      setStarting(false);
    }
  };

  if (pollError) {
    return (
      <main className="min-h-screen bg-[#0A0A0B] px-6 py-16 text-white">
        <p className="text-[#f87171]">{pollError}</p>
      </main>
    );
  }

  if (!snap) {
    return (
      <main className="min-h-screen bg-[#0A0A0B] flex items-center justify-center text-[#A3A3A3]">
        <Loader2 className="h-8 w-8 animate-spin text-[#FF383C]" aria-hidden />
        <span className="sr-only">Loading render status…</span>
      </main>
    );
  }

  const videosLeft = snap.remaining.filter((r) =>
    snap.assets.some((a) => a.id === r.id && a.kind === 'video'),
  );

  return (
    <main className="min-h-screen bg-[#0A0A0B] px-4 py-12 text-white sm:px-8">
      <div className="mx-auto flex max-w-[720px] flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-[22px] font-medium">Website media render</h1>
          <p className="text-[14px] leading-relaxed text-[#A3A3A3]">
            Drop raw captures in <code className="text-[#e5e5e5]">{snap.incomingDir}</code> as{' '}
            <code className="text-[#e5e5e5]">{'{id}'}.mov</code>, then render to{' '}
            <code className="text-[#e5e5e5]">public/media/</code>.
          </p>
        </header>

        {snap.running ? (
          <div
            className="flex flex-col gap-4 rounded-2xl border border-[#FF383C]/30 bg-[#141414] p-6"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-3">
              <Loader2 className="h-6 w-6 shrink-0 animate-spin text-[#FF383C]" aria-hidden />
              <div>
                <p className="text-[15px] font-medium text-white">Rendering video…</p>
                {snap.current ? (
                  <p className="mt-1 text-[13px] text-[#D4D4D4]">
                    {snap.current.label}
                    <span className="ml-2 font-mono text-[11px] text-[#737373]">{snap.current.path}</span>
                  </p>
                ) : (
                  <p className="mt-1 text-[13px] text-[#737373]">Starting batch…</p>
                )}
              </div>
            </div>
            {snap.log ? <p className="text-[12px] text-[#737373]">{snap.log}</p> : null}
          </div>
        ) : null}

        {snap.error ? (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-300">
            {snap.error}
          </p>
        ) : null}

        <section className="flex flex-col gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[#FF383C]">
            Videos left ({videosLeft.length})
          </h2>
          {videosLeft.length === 0 ? (
            <p className="text-[14px] text-[#737373]">No videos waiting — all outputs exist or nothing queued.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {videosLeft.map((v) => {
                const row = snap.assets.find((a) => a.id === v.id);
                return (
                  <li
                    key={v.id}
                    className="rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-[13px]"
                  >
                    <span className="font-medium text-[#E5E5E5]">{v.label}</span>
                    <span className="mt-1 block font-mono text-[11px] text-[#525252]">{v.path}</span>
                    {row?.hasIncoming ? (
                      <span className="mt-1 inline-block text-[11px] text-emerald-400">Source in _incoming</span>
                    ) : (
                      <span className="mt-1 inline-block text-[11px] text-[#737373]">Missing source file</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['On disk', snap.summary.videosOnDisk],
            ['Missing', snap.summary.videosMissing],
            ['Ready', snap.summary.videosReadyToRender],
            ['Images missing', snap.summary.imagesMissing],
          ].map(([label, n]) => (
            <div key={String(label)} className="rounded-xl border border-white/10 bg-[#111111] px-3 py-3">
              <p className="text-[11px] uppercase tracking-wide text-[#737373]">{label}</p>
              <p className="text-[20px] font-semibold text-white">{n}</p>
            </div>
          ))}
        </section>

        <button
          type="button"
          disabled={snap.running || starting || snap.summary.videosReadyToRender === 0}
          onClick={() => void startRender()}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#F5F5F5] px-6 text-[14px] font-medium text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {starting || snap.running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Working…
            </>
          ) : (
            'Render videos with ffmpeg'
          )}
        </button>

        <p className="text-[12px] text-[#525252]">
          CLI: <code className="text-[#737373]">pnpm run render:media</code> from apps/website
        </p>
      </div>
    </main>
  );
}
