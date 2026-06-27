import React from 'react';
import { Download, Upload, Loader2, CheckCircle, XCircle } from 'lucide-react';
import clsx from 'clsx';

export interface ProgressBarProps {
  progress: number; // 0-100
  label?: string;
  sublabel?: string;
  variant?: 'download' | 'upload' | 'task';
  status?: 'active' | 'complete' | 'error' | 'paused';
  showPercentage?: boolean;
  size?: 'sm' | 'md' | 'lg';
  color?: 'blue' | 'emerald' | 'amber' | 'purple';
}

const iconMap = {
  download: Download,
  upload: Upload,
  task: Loader2,
};

const colorMap = {
  blue: 'from-blue-500 to-blue-600',
  emerald: 'from-emerald-500 to-emerald-600',
  amber: 'from-amber-500 to-amber-600',
  purple: 'from-purple-500 to-purple-600',
};

const bgColorMap = {
  blue: 'bg-blue-100',
  emerald: 'bg-emerald-100',
  amber: 'bg-amber-100',
  purple: 'bg-purple-100',
};

export const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  label,
  sublabel,
  variant = 'task',
  status = 'active',
  showPercentage = true,
  size = 'md',
  color = 'blue'
}) => {
  const Icon = iconMap[variant];
  const clampedProgress = Math.min(100, Math.max(0, progress));
  
  const heightClass = {
    sm: 'h-1.5',
    md: 'h-2.5',
    lg: 'h-4'
  }[size];

  return (
    <div className="w-full max-w-md my-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {status === 'complete' ? (
            <CheckCircle className="w-4 h-4 text-emerald-500" />
          ) : status === 'error' ? (
            <XCircle className="w-4 h-4 text-red-500" />
          ) : (
            <Icon className={clsx(
              "w-4 h-4",
              status === 'active' && variant === 'task' && "animate-spin",
              status === 'paused' ? "text-neutral-400" : "text-neutral-600"
            )} />
          )}
          {label && (
            <span className={clsx(
              "text-sm font-medium",
              status === 'error' ? "text-red-700" : "text-neutral-800"
            )}>
              {label}
            </span>
          )}
        </div>
        
        {showPercentage && (
          <span className={clsx(
            "text-xs font-medium",
            status === 'complete' ? "text-emerald-600" :
            status === 'error' ? "text-red-600" :
            "text-neutral-500"
          )}>
            {status === 'complete' ? '100%' : `${Math.round(clampedProgress)}%`}
          </span>
        )}
      </div>
      
      {/* Progress Track */}
      <div className={clsx(
        "w-full rounded-full overflow-hidden",
        heightClass,
        bgColorMap[color]
      )}>
        <div
          className={clsx(
            "h-full rounded-full transition-all duration-300 ease-out bg-gradient-to-r",
            status === 'complete' ? 'from-emerald-500 to-emerald-600' :
            status === 'error' ? 'from-red-500 to-red-600' :
            status === 'paused' ? 'from-neutral-400 to-neutral-500' :
            colorMap[color]
          )}
          style={{ width: `${status === 'complete' ? 100 : clampedProgress}%` }}
        />
      </div>
      
      {/* Sublabel */}
      {sublabel && (
        <div className="mt-1.5">
          <span className="text-[10px] text-neutral-500">{sublabel}</span>
        </div>
      )}
    </div>
  );
};



