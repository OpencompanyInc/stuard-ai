
import React, { useState, useEffect, memo } from 'react';
import { ExternalLink, Globe, Link2 } from 'lucide-react';

interface LinkPreviewProps {
    url: string;
}

export const LinkPreview: React.FC<LinkPreviewProps> = memo(({ url }) => {
    const [data, setData] = useState<{ title?: string; description?: string; image?: string; siteName?: string; favicon?: string; url?: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [imageError, setImageError] = useState(false);
    const [faviconError, setFaviconError] = useState(false);

    const buildFallback = (rawUrl: string) => {
        try {
            const u = new URL(rawUrl);
            const host = u.hostname.replace(/^www\./, '') || rawUrl;
            return {
                title: host,
                siteName: host,
                description: '',
                image: '',
                favicon: `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`,
                url: rawUrl
            };
        } catch {
            return { title: rawUrl, siteName: rawUrl, description: '', image: '', favicon: '', url: rawUrl };
        }
    };

    useEffect(() => {
        let cancelled = false;
        const fetchPreview = async () => {
            try {
                setLoading(true);
                setError(false);
                setImageError(false);
                setFaviconError(false);
                const res = await window.desktopAPI.getLinkPreview(url);
                if (!cancelled) {
                    const fallback = buildFallback(url);
                    if (res.ok && res.data) {
                        setData({
                            ...fallback,
                            ...res.data,
                            title: res.data.title || fallback.title,
                            siteName: res.data.siteName || fallback.siteName,
                            favicon: (res.data as any).favicon || fallback.favicon,
                        });
                    } else {
                        setError(true);
                        setData(fallback);
                    }
                }
            } catch (err) {
                if (!cancelled) {
                    setError(true);
                    setData(buildFallback(url));
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        if (url) fetchPreview();
        return () => { cancelled = true; };
    }, [url]);

    const handleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        window.desktopAPI.openExternal(url);
    };

    if (!url) return null;

    if (loading) {
        return (
            <div className="my-2 w-full max-w-[320px] bg-black/30 rounded-xl border border-white/10 p-3 animate-pulse">
                <div className="aspect-[2/1] bg-white/5 rounded-lg mb-2" />
                <div className="h-4 bg-white/10 rounded w-3/4 mb-1" />
                <div className="h-3 bg-white/5 rounded w-1/2" />
            </div>
        );
    }

    const view = data || buildFallback(url);
    const hasImage = view.image && !imageError;

    return (
        <div
            onClick={handleClick}
            className="my-2 w-full max-w-[320px] bg-gradient-to-br from-blue-600/10 to-black/40 rounded-xl border border-white/15 overflow-hidden cursor-pointer hover:border-white/25 hover:from-blue-600/15 transition-all group shadow-lg"
        >
            {/* Image preview */}
            {hasImage && (
                <div className="relative aspect-[2/1] bg-black/30 overflow-hidden">
                    <img
                        src={view.image}
                        alt={view.title}
                        referrerPolicy="no-referrer"
                        onError={() => setImageError(true)}
                        className="w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-[1.02] transition-all duration-300"
                    />
                    {/* Gradient overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                    {/* Site badge */}
                    <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 bg-black/60 backdrop-blur-sm rounded-lg">
                        {view.favicon && !faviconError ? (
                            <img
                                src={view.favicon}
                                alt=""
                                className="w-3.5 h-3.5 rounded-sm"
                                onError={() => setFaviconError(true)}
                            />
                        ) : (
                            <Globe className="w-3.5 h-3.5 text-white/70" />
                        )}
                        <span className="text-[10px] text-white/80 font-medium truncate max-w-[120px]">
                            {view.siteName}
                        </span>
                    </div>
                    {/* External link indicator */}
                    <div className="absolute top-2 right-2 p-1.5 bg-black/50 backdrop-blur-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                        <ExternalLink className="w-3 h-3 text-white/80" />
                    </div>
                </div>
            )}

            {/* Info section */}
            <div className="p-3">
                {/* Site info - only shown when no image */}
                {!hasImage && (
                    <div className="flex items-center gap-2 mb-2">
                        {view.favicon && !faviconError ? (
                            <img
                                src={view.favicon}
                                alt=""
                                className="w-5 h-5 rounded"
                                onError={() => setFaviconError(true)}
                            />
                        ) : (
                            <div className="w-5 h-5 rounded bg-white/10 flex items-center justify-center">
                                <Link2 className="w-3 h-3 text-white/50" />
                            </div>
                        )}
                        <span className="text-[10px] uppercase tracking-wider font-bold text-white/50">
                            {view.siteName}
                        </span>
                        <ExternalLink className="w-3 h-3 text-white/40 opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                    </div>
                )}

                {/* Title */}
                <h4 className="text-sm font-medium text-white/90 line-clamp-2 leading-snug group-hover:text-white transition-colors">
                    {view.title || view.url || url}
                </h4>

                {/* Description */}
                {view.description && (
                    <p className="text-xs text-white/50 mt-1.5 line-clamp-2 leading-relaxed">
                        {view.description}
                    </p>
                )}

                {/* URL hint when no image */}
                {!hasImage && !view.description && (
                    <p className="text-[10px] text-white/30 mt-1 truncate">
                        {url}
                    </p>
                )}
            </div>
        </div>
    );
});
