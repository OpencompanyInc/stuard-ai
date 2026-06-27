
import React from 'react';
import { DownloadIcon, ReloadIcon, DesktopIcon, MobileIcon, ViewHorizontalIcon, RowsIcon } from "@radix-ui/react-icons";
import { clsx } from 'clsx';

interface HeaderProps {
  aiPhase: string; // 'routing' | 'tool' | 'responding' | 'error' | 'idle'
  statusText: string;
  updateState: { status: string; info?: any };
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
}

export default function Header({
  aiPhase,
  statusText,
  updateState,
  onDownloadUpdate,
  onInstallUpdate
}: HeaderProps) {

  const handleResize = (w: number, h: number) => {
    try { (window as any).desktopAPI.resize(w, h); } catch {}
  };

  return (
    <div className="drag h-9 flex items-center justify-between px-3 border-b border-white/5 bg-white/[0.02] select-none">
      {/* Status Indicator */}
      <div className="flex items-center gap-2 opacity-80 hover:opacity-100 transition-opacity">
        <div className={clsx(
          "w-2 h-2 rounded-full shadow-sm",
          aiPhase === 'routing' && "bg-blue-400 animate-pulse shadow-blue-500/50",
          aiPhase === 'tool' && "bg-emerald-400 animate-pulse shadow-emerald-500/50",
          aiPhase === 'responding' && "bg-purple-400 animate-pulse shadow-purple-500/50",
          aiPhase === 'error' && "bg-rose-500",
          !['routing', 'tool', 'responding', 'error'].includes(aiPhase) && "bg-white/20"
        )} />
        <span className={clsx(
          "text-[11px] font-medium tracking-wide",
          aiPhase === 'error' ? "text-rose-300" :
          "text-white/60"
        )}>
          {statusText || 'Ready'}
        </span>
      </div>

      {/* Right Side Actions (Updates, etc) */}
      <div className="flex items-center gap-3">
        {updateState.status === 'available' && (
          <button
            className="no-drag inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-200 border border-indigo-500/30 hover:bg-indigo-500/30 transition-all group"
            onClick={onDownloadUpdate}
          >
            <DownloadIcon className="w-3 h-3 group-hover:animate-bounce" />
            <span className="text-[10px] font-medium">Update</span>
          </button>
        )}
        {updateState.status === 'downloading' && (
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5 text-white/60 border border-white/10">
            <DownloadIcon className="w-3 h-3 animate-pulse" />
            <span className="text-[10px]">{Math.round(Number(updateState?.info?.percent || 0))}%</span>
          </div>
        )}
        {updateState.status === 'downloaded' && (
          <button
            className="no-drag inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-200 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all"
            onClick={onInstallUpdate}
          >
            <ReloadIcon className="w-3 h-3" />
            <span className="text-[10px] font-medium">Restart</span>
          </button>
        )}
        
        {/* Layout Options */}
        <div id="stuard-collapse-btn" className="flex items-center gap-0.5 bg-white/5 rounded-md p-0.5 border border-white/5 no-drag">
            <button 
                onClick={() => handleResize(520, 230)} 
                className="p-1.5 rounded hover:bg-white/10 text-white/30 hover:text-white transition-colors" 
                title="Compact Bar"
            >
                <RowsIcon className="w-3.5 h-3.5" />
            </button>
            <button 
                onClick={() => handleResize(400, 700)} 
                className="p-1.5 rounded hover:bg-white/10 text-white/30 hover:text-white transition-colors" 
                title="Tall Sidebar"
            >
                <MobileIcon className="w-3.5 h-3.5" />
            </button>
            <button 
                onClick={() => handleResize(520, 600)} 
                className="p-1.5 rounded hover:bg-white/10 text-white/30 hover:text-white transition-colors" 
                title="Standard"
            >
                <DesktopIcon className="w-3.5 h-3.5" />
            </button>
            <button 
                onClick={() => handleResize(800, 600)} 
                className="p-1.5 rounded hover:bg-white/10 text-white/30 hover:text-white transition-colors" 
                title="Wide"
            >
                <ViewHorizontalIcon className="w-3.5 h-3.5" />
            </button>
        </div>
      </div>
    </div>
  );
}
