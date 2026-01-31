import React, { useState, useCallback } from 'react';
import { Bug, Lightbulb, Camera, X, Send, AlertTriangle, Tag } from 'lucide-react';
import clsx from 'clsx';

export interface FeedbackFormProps {
  type?: 'bug' | 'feature';
  title?: string;
  description?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  labels?: string[];
  suggestedLabels?: string[];
  allowScreenshot?: boolean;
  onSubmit: (data: FeedbackFormData) => void;
  onCancel: () => void;
  isSubmitted?: boolean;
  isCancelled?: boolean;
}

export interface FeedbackFormData {
  type: 'bug' | 'feature';
  title: string;
  description: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  labels: string[];
  screenshots: string[];
}

const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low', color: 'emerald', description: 'Minor annoyance' },
  { value: 'medium', label: 'Medium', color: 'amber', description: 'Affects workflow' },
  { value: 'high', label: 'High', color: 'orange', description: 'Major blocker' },
  { value: 'critical', label: 'Critical', color: 'red', description: 'Data loss/security' },
] as const;

const DEFAULT_LABELS = ['ui', 'performance', 'workflow', 'bug', 'enhancement', 'documentation'];

export const FeedbackForm: React.FC<FeedbackFormProps> = ({
  type: initialType,
  title: initialTitle = '',
  description: initialDescription = '',
  severity: initialSeverity = 'medium',
  labels: initialLabels = [],
  suggestedLabels = DEFAULT_LABELS,
  allowScreenshot = true,
  onSubmit,
  onCancel,
  isSubmitted,
  isCancelled,
}) => {
  const [type, setType] = useState<'bug' | 'feature'>(initialType || 'bug');
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>(initialSeverity);
  const [selectedLabels, setSelectedLabels] = useState<string[]>(initialLabels);
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);

  const isDone = isSubmitted || isCancelled;

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleLabelToggle = (label: string) => {
    setSelectedLabels(prev => 
      prev.includes(label) 
        ? prev.filter(l => l !== label) 
        : [...prev, label]
    );
  };

  const handleCaptureScreenshot = async () => {
    if (isCapturing) return;
    setIsCapturing(true);
    try {
      if ((window as any).desktopAPI?.execTool) {
        const result = await (window as any).desktopAPI.execTool('capture_screen', {
          mode: 'screenshot',
          region: 'fullscreen',
        });
        if (result?.ok && result?.path) {
          setScreenshots(prev => [...prev, result.path]);
        }
      }
    } catch (err) {
      console.error('Screenshot capture failed:', err);
    } finally {
      setIsCapturing(false);
    }
  };

  const handleRemoveScreenshot = (index: number) => {
    setScreenshots(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!title.trim() || !description.trim()) return;
    
    onSubmit({
      type,
      title: title.trim(),
      description: description.trim(),
      severity: type === 'bug' ? severity : undefined,
      labels: selectedLabels,
      screenshots,
    });
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onCancel();
  };

  const isValid = title.trim().length >= 5 && description.trim().length >= 10;

  return (
    <div
      onClick={handleContainerClick}
      className={clsx(
        "w-full max-w-lg rounded-xl border overflow-hidden shadow-sm my-3 transition-all",
        "bg-theme-card border-theme/20",
        isDone && "opacity-70 pointer-events-none"
      )}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-theme/10 bg-theme-bg/50">
        <h3 className="font-medium text-theme-fg flex items-center gap-2">
          {type === 'bug' ? (
            <Bug className="w-4 h-4 text-red-500" />
          ) : (
            <Lightbulb className="w-4 h-4 text-amber-500" />
          )}
          {type === 'bug' ? 'Report a Bug' : 'Suggest a Feature'}
        </h3>
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        {/* Type Toggle */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setType('bug')}
            disabled={isDone}
            className={clsx(
              "flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-all flex items-center justify-center gap-2",
              type === 'bug'
                ? "bg-red-500/15 border-red-500/30 text-red-600 dark:text-red-400"
                : "bg-theme-bg border-theme/20 text-theme-muted hover:bg-theme-hover"
            )}
          >
            <Bug className="w-4 h-4" />
            Bug Report
          </button>
          <button
            type="button"
            onClick={() => setType('feature')}
            disabled={isDone}
            className={clsx(
              "flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-all flex items-center justify-center gap-2",
              type === 'feature'
                ? "bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400"
                : "bg-theme-bg border-theme/20 text-theme-muted hover:bg-theme-hover"
            )}
          >
            <Lightbulb className="w-4 h-4" />
            Feature Request
          </button>
        </div>

        {/* Title */}
        <div>
          <label className="block text-xs font-medium text-theme-muted mb-1.5">
            Title <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isDone}
            placeholder={type === 'bug' ? "Brief summary of the issue..." : "Feature name or summary..."}
            className={clsx(
              "w-full px-3 py-2 rounded-lg text-sm border transition-all",
              "bg-theme-bg border-theme/20 text-theme-fg placeholder:text-theme-muted/50",
              "focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50"
            )}
            maxLength={200}
          />
          <div className="text-[10px] text-theme-muted mt-1 text-right">{title.length}/200</div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium text-theme-muted mb-1.5">
            Description <span className="text-red-400">*</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isDone}
            placeholder={type === 'bug' 
              ? "Steps to reproduce, expected vs actual behavior..." 
              : "Describe the feature, use case, and benefits..."
            }
            rows={4}
            className={clsx(
              "w-full px-3 py-2 rounded-lg text-sm border transition-all resize-none",
              "bg-theme-bg border-theme/20 text-theme-fg placeholder:text-theme-muted/50",
              "focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50"
            )}
            maxLength={5000}
          />
        </div>

        {/* Severity (bugs only) */}
        {type === 'bug' && (
          <div>
            <label className="block text-xs font-medium text-theme-muted mb-1.5 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Severity
            </label>
            <div className="grid grid-cols-4 gap-2">
              {SEVERITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSeverity(opt.value)}
                  disabled={isDone}
                  className={clsx(
                    "px-2 py-1.5 rounded-lg text-xs font-medium border transition-all",
                    severity === opt.value
                      ? opt.color === 'emerald' ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                      : opt.color === 'amber' ? "bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400"
                      : opt.color === 'orange' ? "bg-orange-500/15 border-orange-500/30 text-orange-600 dark:text-orange-400"
                      : "bg-red-500/15 border-red-500/30 text-red-600 dark:text-red-400"
                      : "bg-theme-bg border-theme/20 text-theme-muted hover:bg-theme-hover"
                  )}
                  title={opt.description}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Labels */}
        <div>
          <label className="block text-xs font-medium text-theme-muted mb-1.5 flex items-center gap-1">
            <Tag className="w-3 h-3" />
            Labels
          </label>
          <div className="flex flex-wrap gap-1.5">
            {suggestedLabels.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => handleLabelToggle(label)}
                disabled={isDone}
                className={clsx(
                  "px-2 py-1 rounded-md text-xs font-medium border transition-all",
                  selectedLabels.includes(label)
                    ? "bg-blue-500/15 border-blue-500/30 text-blue-600 dark:text-blue-400"
                    : "bg-theme-bg border-theme/20 text-theme-muted hover:bg-theme-hover"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Screenshots */}
        {allowScreenshot && (
          <div>
            <label className="block text-xs font-medium text-theme-muted mb-1.5 flex items-center gap-1">
              <Camera className="w-3 h-3" />
              Screenshots
            </label>
            <div className="flex flex-wrap gap-2">
              {screenshots.map((path, idx) => (
                <div key={idx} className="relative group">
                  <div className="w-16 h-16 rounded-lg border border-theme/20 bg-theme-bg flex items-center justify-center text-[10px] text-theme-muted overflow-hidden">
                    <span className="truncate px-1">{path.split(/[/\\]/).pop()}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveScreenshot(idx)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={handleCaptureScreenshot}
                disabled={isDone || isCapturing}
                className={clsx(
                  "w-16 h-16 rounded-lg border-2 border-dashed transition-all flex flex-col items-center justify-center gap-1",
                  "border-theme/20 text-theme-muted hover:border-blue-500/40 hover:text-blue-500",
                  isCapturing && "opacity-50"
                )}
              >
                <Camera className="w-4 h-4" />
                <span className="text-[9px]">{isCapturing ? '...' : 'Capture'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isDone}
            className={clsx(
              "flex-1 px-4 py-2 rounded-lg text-sm font-medium border transition-all",
              "bg-theme-bg border-theme/20 text-theme-fg hover:bg-theme-hover"
            )}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isDone || !isValid}
            className={clsx(
              "flex-1 px-4 py-2 rounded-lg text-sm font-medium border transition-all flex items-center justify-center gap-2",
              "text-white shadow-sm",
              type === 'bug'
                ? "bg-red-600 border-red-600 hover:bg-red-700"
                : "bg-amber-500 border-amber-500 hover:bg-amber-600",
              (!isValid || isDone) && "opacity-50 cursor-not-allowed"
            )}
          >
            <Send className="w-4 h-4" />
            Submit {type === 'bug' ? 'Bug Report' : 'Feature Request'}
          </button>
        </div>
      </form>
    </div>
  );
};
