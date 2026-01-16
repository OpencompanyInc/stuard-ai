import React, { useState, useEffect } from 'react';
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

  // Extract domain from URL
  const domain = (() => {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return url;
    }
  })();

  // If no data provided, try to fetch meta
  useEffect(() => {
    if (providedTitle || providedDescription || providedImage) {
      setLoading(false);
      return;
    }
    
    // For now, just use the URL info since we can't fetch OG tags client-side easily
    // In production, you'd call a backend endpoint or use a service
    setData({
      title: '',
      description: '',
      image: '',
      siteName: domain
    });
    setLoading(false);
  }, [url, providedTitle, providedDescription, providedImage, domain]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onClick) {
      onClick(url);
    } else {
      try {
        (window as any).desktopAPI?.openExternal?.(url);
      } catch {
        window.open(url, '_blank');
      }
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-md bg-white rounded-xl border border-neutral-200 p-4 my-3 animate-pulse">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-neutral-100 rounded-lg" />
          <div className="flex-1">
            <div className="h-4 bg-neutral-100 rounded w-3/4 mb-2" />
            <div className="h-3 bg-neutral-100 rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <a
      href={url}
      onClick={handleClick}
      className="block w-full max-w-lg bg-white rounded-xl border border-neutral-200 overflow-hidden my-3 hover:border-neutral-300 hover:shadow-lg hover:-translate-y-0.5 transition-all group no-underline text-inherit"
    >
      {/* Image */}
      {data.image && (
        <div className={clsx(
          "bg-neutral-100 overflow-hidden relative",
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
      
      {/* Content */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Site name */}
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-4 h-4 rounded-full bg-neutral-100 flex items-center justify-center shrink-0">
                {data.image && data.image.includes('favicon') ? (
                   <img src={data.image} className="w-3 h-3" alt="" />
                ) : (
                  <Globe className="w-3 h-3 text-neutral-400" />
                )}
              </div>
              <span className="text-[11px] text-neutral-500 font-semibold uppercase tracking-wider">
                {data.siteName || domain}
              </span>
            </div>
            
            {/* Title */}
            <h4 className="text-base font-bold text-neutral-900 mb-1.5 leading-snug group-hover:text-blue-600 transition-colors">
              {data.title || domain}
            </h4>
            
            {/* Description */}
            {data.description && (
              <p className="text-sm text-neutral-600 line-clamp-2 mb-3 leading-relaxed">
                {data.description}
              </p>
            )}
            
            {/* URL */}
            <div className="flex items-center gap-1.5 text-xs text-neutral-400 group-hover:text-blue-500 transition-colors">
              <ExternalLink className="w-3 h-3" />
              <span className="truncate max-w-[200px]">{url}</span>
            </div>
          </div>

          <div className="shrink-0 self-center">
            <div className="w-8 h-8 rounded-full bg-neutral-50 flex items-center justify-center text-neutral-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
              <ArrowUpRight className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>
    </a>
  );
};


