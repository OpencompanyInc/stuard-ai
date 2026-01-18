import React, { useState, useEffect, useCallback } from 'react';
import { ExternalLink, Globe, Loader2, ArrowUpRight } from 'lucide-react';
import clsx from 'clsx';

export interface LinkPreviewProps {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  onClick?: (url: string) => void;
  variant?: 'small' | 'large';
}

export const LinkPreview: React.FC<LinkPreviewProps> = ({
  url,
  title: providedTitle,
  description: providedDescription,
  image: providedImage,
  siteName: providedSiteName,
  onClick,
  variant = 'large'
}) => {
  const [loading, setLoading] = useState(!providedTitle);
  const [data, setData] = useState({
    title: providedTitle || '',
    description: providedDescription || '',
    image: providedImage || '',
    siteName: providedSiteName || ''
  });

  const domain = (() => {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return url;
    }
  })();

  useEffect(() => {
    if (providedTitle || providedDescription || providedImage) {
      setLoading(false);
      return;
    }

    setData({
      title: '',
      description: '',
      image: '',
      siteName: domain
    });
    setLoading(false);
  }, [url, providedTitle, providedDescription, providedImage, domain]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onClick) {
      onClick(url);
    } else {
      try {
        (window as any).desktopAPI?.openExternal?.(url);
      } catch {
        window.open(url, '_blank');
      }
    }
  }, [onClick, url]);

  if (loading) {
    return (
      <div className="w-full max-w-md bg-theme-card rounded-xl border border-theme/20 p-4 my-3 animate-pulse">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-theme-hover rounded-lg" />
          <div className="flex-1">
            <div className="h-4 bg-theme-hover rounded w-3/4 mb-2" />
            <div className="h-3 bg-theme-hover rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <a
      href={url}
      onClick={handleClick}
      className="block w-full max-w-lg bg-theme-card rounded-xl border border-theme/20 overflow-hidden my-3 hover:border-theme/40 hover:shadow-lg hover:-translate-y-0.5 transition-all group no-underline text-inherit"
    >
      {data.image && (
        <div className={clsx(
          "bg-theme-hover overflow-hidden relative",
          variant === 'large' ? "aspect-video" : "aspect-[3/1]"
        )}>
          <img
            src={data.image}
            alt={data.title || domain}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-4 h-4 rounded-full bg-theme-hover flex items-center justify-center shrink-0">
                {data.image && data.image.includes('favicon') ? (
                   <img src={data.image} className="w-3 h-3" alt="" />
                ) : (
                  <Globe className="w-3 h-3 text-theme-muted" />
                )}
              </div>
              <span className="text-[11px] text-theme-muted font-semibold uppercase tracking-wider">
                {data.siteName || domain}
              </span>
            </div>

            <h4 className="text-base font-bold text-theme-fg mb-1.5 leading-snug group-hover:text-primary transition-colors">
              {data.title || domain}
            </h4>

            {data.description && (
              <p className="text-sm text-theme-fg/80 line-clamp-2 mb-3 leading-relaxed">
                {data.description}
              </p>
            )}

            <div className="flex items-center gap-1.5 text-xs text-theme-muted group-hover:text-primary transition-colors">
              <ExternalLink className="w-3 h-3" />
              <span className="truncate max-w-[200px]">{url}</span>
            </div>
          </div>

          <div className="shrink-0 self-center">
            <div className="w-8 h-8 rounded-full bg-theme-hover flex items-center justify-center text-theme-muted group-hover:bg-primary/10 group-hover:text-primary transition-colors">
              <ArrowUpRight className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>
    </a>
  );
};


