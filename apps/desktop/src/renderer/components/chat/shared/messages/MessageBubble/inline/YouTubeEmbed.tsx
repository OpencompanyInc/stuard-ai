import React, { memo, useEffect, useState } from 'react';
import { Play, ExternalLink } from 'lucide-react';

interface YouTubeEmbedProps {
  videoId: string;
  url: string;
}

// YouTube embed component with oEmbed fetch (memoized)
export const YouTubeEmbed: React.FC<YouTubeEmbedProps> = memo(({ videoId, url }) => {
  const [data, setData] = useState<{ title: string; author: string; thumbnail: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchInfo = async () => {
      try {
        // Use YouTube oEmbed API (no key needed)
        const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
        const res = await fetch(oembedUrl);
        if (!res.ok) throw new Error('Failed to fetch');
        const json = await res.json();
        if (!cancelled) {
          setData({
            title: json.title || 'YouTube Video',
            author: json.author_name || '',
            thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
          });
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          // Fallback - just show basic embed
          setData({
            title: 'YouTube Video',
            author: '',
            thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
          });
          setLoading(false);
        }
      }
    };
    fetchInfo();
    return () => { cancelled = true; };
  }, [videoId]);

  const handleClick = () => {
    try {
      (window as any).desktopAPI.openExternal(url);
    } catch {
      window.open(url, '_blank');
    }
  };

  if (loading) {
    return (
      <div className="my-2 w-full max-w-[320px] bg-black/30 rounded-xl border border-white/10 p-3 animate-pulse">
        <div className="aspect-video bg-white/5 rounded-lg mb-2" />
        <div className="h-4 bg-white/10 rounded w-3/4 mb-1" />
        <div className="h-3 bg-white/5 rounded w-1/2" />
      </div>
    );
  }

  return (
    <div
      onClick={handleClick}
      className="my-2 w-full max-w-[320px] bg-gradient-to-br from-red-600/10 to-black/30 rounded-xl border border-red-500/20 overflow-hidden cursor-pointer hover:border-red-500/40 hover:from-red-600/15 transition-all group shadow-lg"
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-black">
        <img
          src={data?.thumbnail}
          alt={data?.title}
          className="w-full h-full object-cover"
        />
        {/* Play overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
          <div className="w-14 h-10 bg-red-600 rounded-xl flex items-center justify-center shadow-lg group-hover:bg-red-500 group-hover:scale-105 transition-all">
            <Play className="w-5 h-5 text-white fill-white ml-0.5" />
          </div>
        </div>
        {/* YouTube badge */}
        <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/70 rounded text-[10px] text-white/80 font-medium">
          YouTube
        </div>
      </div>
      {/* Info */}
      <div className="p-3">
        <h4 className="text-sm font-medium text-white/90 line-clamp-2 leading-snug group-hover:text-white transition-colors">
          {data?.title}
        </h4>
        {data?.author && (
          <p className="text-xs text-white/50 mt-1 flex items-center gap-1">
            <span className="truncate">{data.author}</span>
            <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </p>
        )}
      </div>
    </div>
  );
});
