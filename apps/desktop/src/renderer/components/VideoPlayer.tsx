import React, { useState, useRef, useCallback, useEffect } from 'react';
import { clsx } from 'clsx';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, Loader2, RotateCcw, RotateCw,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Custom video player for the file preview modal. Native <video controls> looks
// out of place on the dark Stuard overlay; this matches the dashboard design:
// auto-hiding gradient control bar, primary-red seek fill, white glass buttons.
// ─────────────────────────────────────────────────────────────────────────────

export interface VideoPlayerProps {
  src: string;
  name?: string;
  autoPlay?: boolean;
  onError?: () => void;
  className?: string;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function VideoPlayer({ src, name, autoPlay = true, onError, className }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const seekRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [hoverPct, setHoverPct] = useState<number | null>(null);

  // ── Controls auto-hide ─────────────────────────────────────────────────────
  const pokeControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused) setControlsVisible(false);
    }, 2500);
  }, []);

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  // ── Video element events ──────────────────────────────────────────────────
  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!scrubbing) setCurrentTime(v.currentTime);
    try {
      if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
    } catch { /* buffered ranges can throw during teardown */ }
  }, [scrubbing]);

  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration || 0);
    setWaiting(false);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => { });
    else v.pause();
    pokeControls();
  }, [pokeControls]);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
    setCurrentTime(v.currentTime);
    pokeControls();
  }, [pokeControls]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    pokeControls();
  }, [pokeControls]);

  const changeVolume = useCallback((value: number) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(1, value));
    v.volume = clamped;
    v.muted = clamped === 0;
    setVolume(clamped);
    setMuted(v.muted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => { });
    else void el.requestFullscreen().catch(() => { });
    pokeControls();
  }, [pokeControls]);

  useEffect(() => {
    const handler = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Space / K play-pause, M mute, F fullscreen, J/L ±10s. Arrow keys stay with
  // the preview modal (prev/next navigation), matching image behaviour.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space' || e.key === 'k') { e.preventDefault(); e.stopPropagation(); togglePlay(); }
      else if (e.key === 'm') toggleMute();
      else if (e.key === 'f') toggleFullscreen();
      else if (e.key === 'j') seekBy(-10);
      else if (e.key === 'l') seekBy(10);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [togglePlay, toggleMute, toggleFullscreen, seekBy]);

  // ── Seek bar pointer handling ──────────────────────────────────────────────
  const pctFromPointer = useCallback((clientX: number): number => {
    const bar = seekRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const handleSeekPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    setScrubbing(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const pct = pctFromPointer(e.clientX);
    setCurrentTime(pct * v.duration);

    const move = (ev: PointerEvent) => {
      const p = pctFromPointer(ev.clientX);
      setCurrentTime(p * v.duration);
    };
    const up = (ev: PointerEvent) => {
      const p = pctFromPointer(ev.clientX);
      v.currentTime = p * v.duration;
      setCurrentTime(v.currentTime);
      setScrubbing(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    pokeControls();
  }, [pctFromPointer, pokeControls]);

  const playedPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;

  return (
    <div
      ref={containerRef}
      className={clsx(
        'group/player relative flex max-h-full max-w-full items-center justify-center overflow-hidden rounded-xl bg-black shadow-2xl',
        !controlsVisible && playing && 'cursor-none',
        className,
      )}
      onMouseMove={pokeControls}
      onMouseLeave={() => { if (playing) setControlsVisible(false); }}
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay={autoPlay}
        playsInline
        className="max-h-full max-w-full outline-none"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onPlay={() => { setPlaying(true); pokeControls(); }}
        onPause={() => { setPlaying(false); setControlsVisible(true); }}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onError={onError}
        onVolumeChange={() => {
          const v = videoRef.current;
          if (v) { setVolume(v.volume); setMuted(v.muted); }
        }}
      />

      {/* Buffering spinner */}
      {waiting && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-9 w-9 animate-spin text-white/80" />
        </div>
      )}

      {/* Big center play button when paused */}
      {!playing && !waiting && (
        <button
          onClick={togglePlay}
          className="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-transform hover:scale-105"
          title="Play (Space)"
        >
          <Play className="ml-1 h-7 w-7" />
        </button>
      )}

      {/* ── Control bar ── */}
      <div
        className={clsx(
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pb-2.5 pt-8 transition-opacity duration-200',
          controlsVisible || !playing ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Seek bar */}
        <div
          ref={seekRef}
          onPointerDown={handleSeekPointerDown}
          onMouseMove={e => setHoverPct(pctFromPointer(e.clientX))}
          onMouseLeave={() => setHoverPct(null)}
          className="group/seek relative mb-2 flex h-4 cursor-pointer items-center"
        >
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-all group-hover/seek:h-1.5">
            {/* Buffered */}
            <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${bufferedPct}%` }} />
            {/* Played */}
            <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${playedPct}%` }} />
          </div>
          {/* Scrub handle */}
          <div
            className={clsx(
              'absolute h-3 w-3 -translate-x-1/2 rounded-full bg-primary shadow transition-opacity',
              scrubbing || hoverPct !== null ? 'opacity-100' : 'opacity-0',
            )}
            style={{ left: `${playedPct}%` }}
          />
          {/* Hover time tooltip */}
          {hoverPct !== null && duration > 0 && (
            <div
              className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] tabular-nums text-white"
              style={{ left: `${hoverPct * 100}%` }}
            >
              {formatTime(hoverPct * duration)}
            </div>
          )}
        </div>

        {/* Buttons row */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={togglePlay}
            className="rounded-lg p-1.5 text-white/90 transition-colors hover:bg-white/15 hover:text-white"
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>

          <button
            onClick={() => seekBy(-10)}
            className="rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
            title="Back 10s (J)"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            onClick={() => seekBy(10)}
            className="rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
            title="Forward 10s (L)"
          >
            <RotateCw className="h-4 w-4" />
          </button>

          {/* Volume */}
          <div className="group/vol flex items-center gap-1.5">
            <button
              onClick={toggleMute}
              className="rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
              title={muted ? 'Unmute (M)' : 'Mute (M)'}
            >
              {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={e => changeVolume(Number(e.target.value))}
              className="h-1 w-0 cursor-pointer appearance-none rounded-full bg-white/25 opacity-0 transition-all duration-200 accent-[color:var(--primary,#e5484d)] group-hover/vol:w-16 group-hover/vol:opacity-100"
              title="Volume"
            />
          </div>

          {/* Time */}
          <span className="ml-1 text-[12px] tabular-nums text-white/85">
            {formatTime(currentTime)} <span className="text-white/45">/ {formatTime(duration)}</span>
          </span>

          <div className="flex-1" />

          {name && (
            <span className="mr-1 hidden max-w-[200px] truncate text-[12px] text-white/55 sm:block">{name}</span>
          )}

          <button
            onClick={toggleFullscreen}
            className="rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
            title={fullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
          >
            {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
