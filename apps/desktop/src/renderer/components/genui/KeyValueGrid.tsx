import React, { useState, useCallback } from 'react';
import clsx from 'clsx';
import { Copy, Check } from 'lucide-react';
import { RichText } from './RichText';

export interface KeyValueItem {
  key: string;
  value: string;
  icon?: React.ReactNode;
  copyable?: boolean;
  variant?: 'default' | 'badge' | 'code';
  fullWidth?: boolean;
}

export interface KeyValueGridProps {
  title?: string;
  items: KeyValueItem[];
  columns?: 1 | 2;
}

export const KeyValueGrid: React.FC<KeyValueGridProps> = ({
  title,
  items,
  columns = 2
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleCopy = async (e: React.MouseEvent, key: string, value: string) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {}
  };

  return (
    <div onClick={handleContainerClick} className="w-full max-w-2xl bg-theme-card rounded-xl border border-theme/20 shadow-sm overflow-hidden my-3">
      {title && (
        <div className="px-4 py-2.5 bg-theme-hover/50 border-b border-theme/10">
          <h3 className="text-sm font-semibold text-theme-fg">{title}</h3>
        </div>
      )}

      <div className={clsx(
        "grid gap-px bg-theme/10 p-px",
        columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"
      )}>
        {items.map((item, idx) => (
          <div
            key={idx}
            className={clsx(
              "bg-theme-card p-3 flex items-start gap-3 group transition-colors hover:bg-theme-hover/50",
              item.fullWidth && "col-span-full"
            )}
          >
            {item.icon && (
              <div className="text-theme-muted mt-0.5 shrink-0">
                {item.icon}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-theme-muted font-medium mb-1">
                {item.key}
              </div>

              <div className="flex items-start gap-2">
                <div className={clsx(
                  "flex-1 text-sm text-theme-fg",
                  item.variant === 'code' && "font-mono text-xs bg-theme-hover p-1 rounded border border-theme/10",
                  item.variant === 'badge' && "inline-flex"
                )}>
                  {item.variant === 'badge' ? (
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium border border-primary/20">
                      {item.value}
                    </span>
                  ) : (
                    item.value.includes('\n') || item.value.includes('**') || item.value.length > 50
                      ? <RichText content={item.value} compact className="text-sm" />
                      : <span className="break-words">{item.value}</span>
                  )}
                </div>

                {item.copyable && (
                  <button
                    onClick={(e) => handleCopy(e, item.key, item.value)}
                    className="p-1.5 hover:bg-theme-hover rounded-md text-theme-muted hover:text-theme-fg transition-colors shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    title="Copy value"
                  >
                    {copiedKey === item.key ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};


