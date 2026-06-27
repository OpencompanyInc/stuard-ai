import React, { useState, useRef } from 'react';
import { Play, Pause, Volume2, VolumeX, AlertCircle } from 'lucide-react';
import clsx from 'clsx';

interface AudioPlayerProps {
  src: string;
  className?: string;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, className }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  // Extract filename from path/url
  const fileName = decodeURIComponent(src.split(/[/\\]/).pop() || 'Audio file').split('?')[0];

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      // Some sources can report Infinity/NaN; we guard in rendering.
      const d = audioRef.current.duration;
      setDuration(Number.isFinite(d) && d > 0 ? d : 0);
      setError(null);
    }
  };

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrentTime = Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0;
  const sliderMax = safeDuration > 0 ? safeDuration : 1;
  const sliderValue = safeDuration > 0 ? Math.min(safeCurrentTime, safeDuration) : 0;

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      return;
    }

    const p = audioRef.current.play();
    if (p && typeof (p as any).catch === 'function') {
      (p as Promise<void>).catch((e) => {
        console.error('[AudioPlayer] play() failed:', e);
        setError('Failed to play audio');
        setIsPlaying(false);
      });
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (audioRef.current) audioRef.current.currentTime = 0;
  };

  const handleError = () => {
    // Only set error if we have a src but it failed
    if (src) {
      console.error(`[AudioPlayer] Failed to load: ${src}`);
      setError("Failed to load audio");
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    if (safeDuration <= 0) return;
    const time = parseFloat(e.target.value);
    if (!Number.isFinite(time)) return;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const formatTime = (time: number) => {
    if (!Number.isFinite(time) || time < 0) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatMaybeTime = (time: number) => {
    if (!Number.isFinite(time) || time <= 0) return '--:--';
    return formatTime(time);
  };

  if (error) {
    return (
      <div className={clsx("flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs my-2 w-full max-w-sm", className)}>
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span className="truncate flex-1">{fileName}</span>
        <span>Error loading file</span>
      </div>
    );
  }

  return (
    <div className={clsx("flex flex-col gap-2 p-3 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm shadow-sm w-full max-w-sm my-2 select-none transition-colors hover:bg-white/10", className)}>
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-indigo-500 hover:bg-indigo-600 active:scale-95 text-white transition-all shrink-0 shadow-lg"
        >
          {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
        </button>

        <div className="flex flex-col min-w-0 flex-1 gap-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-white/90 truncate pr-2" title={fileName}>{fileName}</span>
            <span className="text-[10px] text-white/50 font-mono tabular-nums">
              {formatTime(safeCurrentTime)} / {formatMaybeTime(safeDuration)}
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={sliderMax}
            value={sliderValue}
            onChange={handleSeek}
            disabled={safeDuration <= 0}
            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer hover:h-1.5 transition-all [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-400 [&::-webkit-slider-thumb]:shadow-md"
          />
        </div>

        <button onClick={toggleMute} className="p-1.5 text-white/50 hover:text-white/90 transition-colors">
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>

      <audio
        ref={audioRef}
        src={src}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={handleLoadedMetadata}
        onEnded={handleEnded}
        onError={handleError}
        className="hidden"
      />
    </div>
  );
};
