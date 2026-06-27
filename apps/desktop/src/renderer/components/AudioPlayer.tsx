import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, AlertCircle } from 'lucide-react';
import clsx from 'clsx';

// Theme-aware inline audio player — real waveform from decoded audio, wide layout.

interface AudioPlayerProps {
  src: string;
  className?: string;
  /** Optional display title; defaults to filename extracted from src. */
  title?: string;
}

const PEAK_COUNT = 160;

function formatTime(time: number): string {
  if (!Number.isFinite(time) || time < 0) return '0:00';
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatMaybeTime(time: number): string {
  if (!Number.isFinite(time) || time <= 0) return '--:--';
  return formatTime(time);
}

function displayNameFromSrc(src: string): string {
  const raw = String(src || '').trim();
  try {
    if (/^https?:/i.test(raw)) {
      const url = new URL(raw);
      return decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || url.hostname || 'Audio');
    }
  } catch { /* ignore */ }
  try {
    return decodeURIComponent(raw.split(/[\\/]/).pop()?.split('?')[0] || 'Audio');
  } catch {
    return raw.split(/[\\/]/).pop()?.split('?')[0] || 'Audio';
  }
}

function peaksFromAudioBuffer(buffer: AudioBuffer, barCount: number): number[] {
  const channelCount = buffer.numberOfChannels;
  const length = buffer.length;
  const samplesPerBar = Math.max(1, Math.floor(length / barCount));
  const peaks: number[] = [];

  for (let i = 0; i < barCount; i++) {
    const start = i * samplesPerBar;
    const end = Math.min(start + samplesPerBar, length);
    let max = 0;
    for (let j = start; j < end; j++) {
      let sample = 0;
      for (let c = 0; c < channelCount; c++) {
        sample += Math.abs(buffer.getChannelData(c)[j]);
      }
      sample /= channelCount;
      if (sample > max) max = sample;
    }
    peaks.push(max);
  }

  const top = Math.max(...peaks, 0.001);
  return peaks.map((p) => p / top);
}

async function decodeWaveformPeaks(src: string, barCount: number): Promise<number[]> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    return peaksFromAudioBuffer(audioBuffer, barCount);
  } finally {
    void ctx.close();
  }
}

function placeholderPeaks(barCount: number): number[] {
  const peaks: number[] = [];
  for (let i = 0; i < barCount; i++) {
    const t = i / barCount;
    peaks.push(0.18 + Math.abs(Math.sin(t * Math.PI * 6)) * 0.22 + Math.abs(Math.sin(t * Math.PI * 17)) * 0.12);
  }
  return peaks;
}

function readWaveformColors(el: HTMLElement | null) {
  const root = el ?? document.documentElement;
  const style = getComputedStyle(root);
  return {
    played: style.getPropertyValue('--foreground').trim() || '#1a1a1a',
    unplayed: style.getPropertyValue('--foreground-muted').trim() || '#64748b',
    playhead: style.getPropertyValue('--foreground').trim() || '#1a1a1a',
  };
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: number[],
  playedPct: number,
  hoverPct: number | null,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width <= 0 || height <= 0) return;

  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const { played, unplayed, playhead } = readWaveformColors(canvas.parentElement);
  const barGap = 1.5;
  const barCount = peaks.length;
  const barWidth = Math.max(1.5, (width - (barCount - 1) * barGap) / barCount);
  const mid = height / 2;

  ctx.clearRect(0, 0, width, height);

  for (let i = 0; i < barCount; i++) {
    const barHeight = Math.max(2, peaks[i] * (height - 6));
    const x = i * (barWidth + barGap);
    const barPct = ((i + 0.5) / barCount) * 100;
    ctx.fillStyle = barPct <= playedPct ? played : unplayed;
    ctx.globalAlpha = barPct <= playedPct ? 0.92 : 0.38;
    ctx.fillRect(x, mid - barHeight / 2, barWidth, barHeight);
  }

  ctx.globalAlpha = 1;

  const headX = (playedPct / 100) * width;
  ctx.strokeStyle = playhead;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(headX, 2);
  ctx.lineTo(headX, height - 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (hoverPct !== null) {
    const hoverX = hoverPct * width;
    ctx.strokeStyle = playhead;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hoverX, 0);
    ctx.lineTo(hoverX, height);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, className, title }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [scrubbing, setScrubbing] = useState(false);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [peaks, setPeaks] = useState<number[]>(() => placeholderPeaks(PEAK_COUNT));
  const [waveformReady, setWaveformReady] = useState(false);

  const fileName = title || displayNameFromSrc(src);

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrentTime = Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0;
  const playedPct = safeDuration > 0 ? Math.min(100, (safeCurrentTime / safeDuration) * 100) : 0;

  const pctFromPointer = useCallback((clientX: number) => {
    const el = waveformRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const seekToPct = useCallback((pct: number) => {
    if (!audioRef.current || safeDuration <= 0) return;
    const time = pct * safeDuration;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  }, [safeDuration]);

  const handleSeekPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (safeDuration <= 0) return;
    e.preventDefault();
    setScrubbing(true);
    seekToPct(pctFromPointer(e.clientX));

    const onMove = (ev: PointerEvent) => seekToPct(pctFromPointer(ev.clientX));
    const onUp = () => {
      setScrubbing(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [pctFromPointer, safeDuration, seekToPct]);

  const handleLoadedMetadata = useCallback(() => {
    if (!audioRef.current) return;
    const d = audioRef.current.duration;
    setDuration(Number.isFinite(d) && d > 0 ? d : 0);
    setError(null);
  }, []);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      return;
    }
    const p = audioRef.current.play();
    if (p && typeof (p as Promise<void>).catch === 'function') {
      (p as Promise<void>).catch((e) => {
        console.error('[AudioPlayer] play() failed:', e);
        setError('Failed to play audio');
        setIsPlaying(false);
      });
    }
  }, [isPlaying]);

  const toggleMute = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted]);

  const changeVolume = useCallback((value: number) => {
    if (!audioRef.current) return;
    const clamped = Math.max(0, Math.min(1, value));
    audioRef.current.volume = clamped;
    audioRef.current.muted = clamped === 0;
    setVolume(clamped);
    setIsMuted(audioRef.current.muted);
  }, []);

  useEffect(() => {
    setError(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setWaveformReady(false);
    setPeaks(placeholderPeaks(PEAK_COUNT));
  }, [src]);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;

    decodeWaveformPeaks(src, PEAK_COUNT)
      .then((decoded) => {
        if (!cancelled) {
          setPeaks(decoded);
          setWaveformReady(true);
        }
      })
      .catch((e) => {
        console.warn('[AudioPlayer] waveform decode failed:', e);
        if (!cancelled) setWaveformReady(false);
      });

    return () => { cancelled = true; };
  }, [src]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawWaveform(canvas, peaks, playedPct, hoverPct);
  }, [peaks, playedPct, hoverPct]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = waveformRef.current;
    if (!canvas || !container) return;

    const ro = new ResizeObserver(() => {
      drawWaveform(canvas, peaks, playedPct, hoverPct);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [peaks, playedPct, hoverPct]);

  useEffect(() => {
    const redraw = () => {
      const canvas = canvasRef.current;
      if (canvas) drawWaveform(canvas, peaks, playedPct, hoverPct);
    };
    const observer = new MutationObserver(redraw);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [peaks, playedPct, hoverPct]);

  if (error) {
    return (
      <div
        className={clsx(
          'audio-player audio-player--error flex items-center gap-2.5 rounded-2xl border px-3.5 py-3 text-xs my-2 w-full max-w-2xl',
          className,
        )}
      >
        <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={2} style={{ color: 'var(--destructive)' }} />
        <span className="min-w-0 flex-1 truncate font-medium text-theme-fg" title={fileName}>{fileName}</span>
        <span className="shrink-0 text-theme-muted">Unable to load</span>
      </div>
    );
  }

  return (
    <div className={clsx('audio-player my-2 w-full max-w-2xl select-none', className)}>
      <div className="audio-player__shell flex flex-col gap-2.5 rounded-2xl border px-3.5 py-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <p className="min-w-0 truncate text-[13px] font-medium leading-4 text-theme-fg" title={fileName}>
            {fileName}
          </p>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-theme-muted">
            {formatTime(safeCurrentTime)}
            <span className="mx-1 opacity-40">/</span>
            {formatMaybeTime(safeDuration)}
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={togglePlay}
            className="audio-player__icon-btn shrink-0 rounded-lg p-1.5 text-theme-fg transition-colors"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying
              ? <Pause className="h-4 w-4" strokeWidth={2.25} />
              : <Play className="ml-0.5 h-4 w-4" strokeWidth={2.25} />}
          </button>

          <div
            ref={waveformRef}
            onPointerDown={handleSeekPointerDown}
            onMouseMove={(e) => setHoverPct(pctFromPointer(e.clientX))}
            onMouseLeave={() => setHoverPct(null)}
            className={clsx(
              'audio-player__waveform relative min-w-0 flex-1',
              safeDuration <= 0 && 'cursor-wait opacity-70',
              safeDuration > 0 && 'cursor-pointer',
            )}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={safeDuration}
            aria-valuenow={safeCurrentTime}
            aria-label="Audio waveform"
          >
            <canvas
              ref={canvasRef}
              className={clsx(
                'block h-11 w-full min-w-[280px]',
                !waveformReady && 'opacity-60',
              )}
            />
            {hoverPct !== null && safeDuration > 0 && (
              <div
                className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded-md px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-theme-fg shadow-sm"
                style={{
                  left: `${hoverPct * 100}%`,
                  background: 'var(--card-bg)',
                  border: '1px solid var(--card-border)',
                }}
              >
                {formatTime(hoverPct * safeDuration)}
              </div>
            )}
          </div>

          <div className="group/vol flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={toggleMute}
              className="audio-player__icon-btn rounded-lg p-1.5 text-theme-muted transition-colors"
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted || volume === 0
                ? <VolumeX className="h-4 w-4" strokeWidth={2} />
                : <Volume2 className="h-4 w-4" strokeWidth={2} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              className="audio-player__volume h-1 w-0 cursor-pointer appearance-none rounded-full opacity-0 transition-all duration-200 group-hover/vol:w-14 group-hover/vol:opacity-100"
              title="Volume"
              aria-label="Volume"
            />
          </div>
        </div>
      </div>

      <audio
        ref={audioRef}
        src={src}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={() => {
          if (!scrubbing && audioRef.current) setCurrentTime(audioRef.current.currentTime);
        }}
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={handleLoadedMetadata}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
          if (audioRef.current) audioRef.current.currentTime = 0;
        }}
        onError={() => {
          if (src) {
            console.error(`[AudioPlayer] Failed to load: ${src}`);
            setError('Failed to load audio');
            setIsPlaying(false);
          }
        }}
        onVolumeChange={() => {
          const a = audioRef.current;
          if (a) {
            setVolume(a.volume);
            setIsMuted(a.muted);
          }
        }}
        className="hidden"
        preload="metadata"
      />
    </div>
  );
};
