import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';

// Extract video ID from various YouTube URL formats
function extractVideoId(url: string): string | null {
  const patterns = [
    // youtu.be/VIDEO_ID
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    // youtube.com/watch?v=VIDEO_ID
    /youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
    // youtube.com/embed/VIDEO_ID
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    // youtube.com/v/VIDEO_ID
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
    // youtube.com/shorts/VIDEO_ID
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    // youtube.com/live/VIDEO_ID
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Extract playlist ID from YouTube URL
function extractPlaylistId(url: string): string | null {
  const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// Extract channel ID or handle from YouTube URL
function extractChannelInfo(url: string): { type: 'id' | 'handle' | 'username'; value: string } | null {
  // youtube.com/channel/CHANNEL_ID
  const channelMatch = url.match(/youtube\.com\/channel\/([a-zA-Z0-9_-]+)/);
  if (channelMatch) return { type: 'id', value: channelMatch[1] };

  // youtube.com/@handle
  const handleMatch = url.match(/youtube\.com\/@([a-zA-Z0-9_-]+)/);
  if (handleMatch) return { type: 'handle', value: handleMatch[1] };

  // youtube.com/user/USERNAME
  const userMatch = url.match(/youtube\.com\/user\/([a-zA-Z0-9_-]+)/);
  if (userMatch) return { type: 'username', value: userMatch[1] };

  // youtube.com/c/CustomName
  const customMatch = url.match(/youtube\.com\/c\/([a-zA-Z0-9_-]+)/);
  if (customMatch) return { type: 'username', value: customMatch[1] };

  return null;
}

// Format duration from ISO 8601 (PT1H2M3S) to readable format
function formatDuration(isoDuration: string): string {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return isoDuration;

  const hours = match[1] ? parseInt(match[1]) : 0;
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const seconds = match[3] ? parseInt(match[3]) : 0;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Format large numbers (views, subscribers)
function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

export const youtube_get_video = createTool({
  id: 'youtube_get_video',
  description: 'Get detailed information about a YouTube video by URL or video ID. Returns title, description, channel, duration, view count, publish date, thumbnails, and more.',
  inputSchema: z.object({
    url: z.string().optional().describe('YouTube video URL (any format: youtube.com/watch?v=, youtu.be/, shorts/, etc.)'),
    videoId: z.string().optional().describe('YouTube video ID (11 characters)'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    video: z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      channelId: z.string(),
      channelTitle: z.string(),
      publishedAt: z.string(),
      duration: z.string(),
      durationFormatted: z.string(),
      viewCount: z.number(),
      viewCountFormatted: z.string(),
      likeCount: z.number().optional(),
      commentCount: z.number().optional(),
      thumbnail: z.string(),
      thumbnailHigh: z.string(),
      tags: z.array(z.string()).optional(),
      categoryId: z.string().optional(),
      liveBroadcastContent: z.string().optional(),
      url: z.string(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const { url, videoId: providedId  } = inputData;

    if (!YOUTUBE_API_KEY) {
      return { ok: false, error: 'YOUTUBE_API_KEY not configured' };
    }

    const videoId = providedId || (url ? extractVideoId(url) : null);
    if (!videoId) {
      return { ok: false, error: 'Could not extract video ID from URL' };
    }

    try {
      const apiUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
      apiUrl.searchParams.set('key', YOUTUBE_API_KEY);
      apiUrl.searchParams.set('id', videoId);
      apiUrl.searchParams.set('part', 'snippet,contentDetails,statistics');

      const res = await fetch(apiUrl.toString());
      const data: any = await res.json();

      if (!res.ok) {
        return { ok: false, error: data.error?.message || `API error: ${res.status}` };
      }

      if (!data.items || data.items.length === 0) {
        return { ok: false, error: 'Video not found' };
      }

      const item = data.items[0];
      const snippet = item.snippet;
      const contentDetails = item.contentDetails;
      const statistics = item.statistics;

      return {
        ok: true,
        video: {
          id: videoId,
          title: snippet.title,
          description: snippet.description?.slice(0, 500) || '',
          channelId: snippet.channelId,
          channelTitle: snippet.channelTitle,
          publishedAt: snippet.publishedAt,
          duration: contentDetails.duration,
          durationFormatted: formatDuration(contentDetails.duration),
          viewCount: parseInt(statistics.viewCount || '0'),
          viewCountFormatted: formatNumber(parseInt(statistics.viewCount || '0')),
          likeCount: statistics.likeCount ? parseInt(statistics.likeCount) : undefined,
          commentCount: statistics.commentCount ? parseInt(statistics.commentCount) : undefined,
          thumbnail: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '',
          thumbnailHigh: snippet.thumbnails?.maxres?.url || snippet.thumbnails?.high?.url || '',
          tags: snippet.tags?.slice(0, 10),
          categoryId: snippet.categoryId,
          liveBroadcastContent: snippet.liveBroadcastContent,
          url: `https://www.youtube.com/watch?v=${videoId}`,
        },
      };
    } catch (e: any) {
      return { ok: false, error: e.message || String(e) };
    }
  },
});

export const youtube_get_channel = createTool({
  id: 'youtube_get_channel',
  description: 'Get information about a YouTube channel by URL, handle, or channel ID.',
  inputSchema: z.object({
    url: z.string().optional().describe('YouTube channel URL (youtube.com/@handle, /channel/, /user/, /c/)'),
    channelId: z.string().optional().describe('YouTube channel ID'),
    handle: z.string().optional().describe('YouTube handle (without @)'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    channel: z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      customUrl: z.string().optional(),
      publishedAt: z.string(),
      thumbnail: z.string(),
      subscriberCount: z.number().optional(),
      subscriberCountFormatted: z.string().optional(),
      videoCount: z.number(),
      viewCount: z.number(),
      country: z.string().optional(),
      url: z.string(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const { url, channelId: providedId, handle: providedHandle  } = inputData as any;

    if (!YOUTUBE_API_KEY) {
      return { ok: false, error: 'YOUTUBE_API_KEY not configured' };
    }

    let channelId = providedId;
    let forHandle = providedHandle;

    // Extract from URL if provided
    if (url && !channelId && !forHandle) {
      const info = extractChannelInfo(url);
      if (info) {
        if (info.type === 'id') channelId = info.value;
        else forHandle = info.value;
      }
    }

    if (!channelId && !forHandle) {
      return { ok: false, error: 'Could not extract channel info from URL' };
    }

    try {
      const apiUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
      apiUrl.searchParams.set('key', YOUTUBE_API_KEY);
      apiUrl.searchParams.set('part', 'snippet,statistics,brandingSettings');

      if (channelId) {
        apiUrl.searchParams.set('id', channelId);
      } else if (forHandle) {
        // Try forHandle (works with @handles)
        apiUrl.searchParams.set('forHandle', forHandle);
      }

      const res = await fetch(apiUrl.toString());
      const data: any = await res.json();

      if (!res.ok) {
        return { ok: false, error: data.error?.message || `API error: ${res.status}` };
      }

      if (!data.items || data.items.length === 0) {
        return { ok: false, error: 'Channel not found' };
      }

      const item = data.items[0];
      const snippet = item.snippet;
      const statistics = item.statistics;

      const subCount = statistics.hiddenSubscriberCount
        ? undefined
        : parseInt(statistics.subscriberCount || '0');

      return {
        ok: true,
        channel: {
          id: item.id,
          title: snippet.title,
          description: snippet.description?.slice(0, 500) || '',
          customUrl: snippet.customUrl,
          publishedAt: snippet.publishedAt,
          thumbnail: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '',
          subscriberCount: subCount,
          subscriberCountFormatted: subCount ? formatNumber(subCount) : 'Hidden',
          videoCount: parseInt(statistics.videoCount || '0'),
          viewCount: parseInt(statistics.viewCount || '0'),
          country: snippet.country,
          url: snippet.customUrl
            ? `https://www.youtube.com/${snippet.customUrl}`
            : `https://www.youtube.com/channel/${item.id}`,
        },
      };
    } catch (e: any) {
      return { ok: false, error: e.message || String(e) };
    }
  },
});

export const youtube_get_playlist = createTool({
  id: 'youtube_get_playlist',
  description: 'Get information about a YouTube playlist and its videos.',
  inputSchema: z.object({
    url: z.string().optional().describe('YouTube playlist URL (contains list= parameter)'),
    playlistId: z.string().optional().describe('YouTube playlist ID'),
    maxVideos: z.number().default(10).describe('Maximum number of videos to fetch (default 10, max 50)'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    playlist: z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      channelId: z.string(),
      channelTitle: z.string(),
      publishedAt: z.string(),
      thumbnail: z.string(),
      itemCount: z.number(),
      url: z.string(),
    }).optional(),
    videos: z.array(z.object({
      id: z.string(),
      title: z.string(),
      channelTitle: z.string(),
      thumbnail: z.string(),
      position: z.number(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const { url, playlistId: providedId, maxVideos = 10  } = inputData as any;

    if (!YOUTUBE_API_KEY) {
      return { ok: false, error: 'YOUTUBE_API_KEY not configured' };
    }

    const playlistId = providedId || (url ? extractPlaylistId(url) : null);
    if (!playlistId) {
      return { ok: false, error: 'Could not extract playlist ID from URL' };
    }

    try {
      // Get playlist info
      const playlistUrl = new URL('https://www.googleapis.com/youtube/v3/playlists');
      playlistUrl.searchParams.set('key', YOUTUBE_API_KEY);
      playlistUrl.searchParams.set('id', playlistId);
      playlistUrl.searchParams.set('part', 'snippet,contentDetails');

      const playlistRes = await fetch(playlistUrl.toString());
      const playlistData: any = await playlistRes.json();

      if (!playlistRes.ok || !playlistData.items?.length) {
        return { ok: false, error: playlistData.error?.message || 'Playlist not found' };
      }

      const playlist = playlistData.items[0];
      const plSnippet = playlist.snippet;

      // Get playlist items
      const itemsUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
      itemsUrl.searchParams.set('key', YOUTUBE_API_KEY);
      itemsUrl.searchParams.set('playlistId', playlistId);
      itemsUrl.searchParams.set('part', 'snippet');
      itemsUrl.searchParams.set('maxResults', Math.min(maxVideos, 50).toString());

      const itemsRes = await fetch(itemsUrl.toString());
      const itemsData: any = await itemsRes.json();

      const videos = (itemsData.items || []).map((item: any) => ({
        id: item.snippet.resourceId?.videoId || '',
        title: item.snippet.title,
        channelTitle: item.snippet.videoOwnerChannelTitle || '',
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
        position: item.snippet.position,
      }));

      return {
        ok: true,
        playlist: {
          id: playlistId,
          title: plSnippet.title,
          description: plSnippet.description?.slice(0, 500) || '',
          channelId: plSnippet.channelId,
          channelTitle: plSnippet.channelTitle,
          publishedAt: plSnippet.publishedAt,
          thumbnail: plSnippet.thumbnails?.medium?.url || plSnippet.thumbnails?.default?.url || '',
          itemCount: playlist.contentDetails?.itemCount || videos.length,
          url: `https://www.youtube.com/playlist?list=${playlistId}`,
        },
        videos,
      };
    } catch (e: any) {
      return { ok: false, error: e.message || String(e) };
    }
  },
});

export const youtube_search = createTool({
  id: 'youtube_search',
  description: 'Search YouTube for videos, channels, or playlists.',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    type: z.enum(['video', 'channel', 'playlist']).default('video').describe('Type of results to return'),
    maxResults: z.number().default(5).describe('Maximum results (1-25)'),
    order: z.enum(['relevance', 'date', 'viewCount', 'rating']).default('relevance'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    results: z.array(z.object({
      id: z.string(),
      type: z.string(),
      title: z.string(),
      description: z.string(),
      channelTitle: z.string(),
      thumbnail: z.string(),
      publishedAt: z.string(),
      url: z.string(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const { query, type = 'video', maxResults = 5, order = 'relevance'  } = inputData as any;

    if (!YOUTUBE_API_KEY) {
      return { ok: false, error: 'YOUTUBE_API_KEY not configured' };
    }

    try {
      const apiUrl = new URL('https://www.googleapis.com/youtube/v3/search');
      apiUrl.searchParams.set('key', YOUTUBE_API_KEY);
      apiUrl.searchParams.set('q', query);
      apiUrl.searchParams.set('part', 'snippet');
      apiUrl.searchParams.set('type', type);
      apiUrl.searchParams.set('maxResults', Math.min(Math.max(maxResults, 1), 25).toString());
      apiUrl.searchParams.set('order', order);

      const res = await fetch(apiUrl.toString());
      const data: any = await res.json();

      if (!res.ok) {
        return { ok: false, error: data.error?.message || `API error: ${res.status}` };
      }

      const results = (data.items || []).map((item: any) => {
        const snippet = item.snippet;
        const idObj = item.id;
        const itemType = idObj.kind?.split('#')[1] || type;
        const id = idObj.videoId || idObj.channelId || idObj.playlistId || '';

        let itemUrl = '';
        if (idObj.videoId) itemUrl = `https://www.youtube.com/watch?v=${id}`;
        else if (idObj.channelId) itemUrl = `https://www.youtube.com/channel/${id}`;
        else if (idObj.playlistId) itemUrl = `https://www.youtube.com/playlist?list=${id}`;

        return {
          id,
          type: itemType,
          title: snippet.title,
          description: snippet.description?.slice(0, 200) || '',
          channelTitle: snippet.channelTitle,
          thumbnail: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '',
          publishedAt: snippet.publishedAt,
          url: itemUrl,
        };
      });

      return { ok: true, results };
    } catch (e: any) {
      return { ok: false, error: e.message || String(e) };
    }
  },
});

// Helper to detect if a string is a YouTube URL
export function isYouTubeUrl(text: string): boolean {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(text);
}

// Quick parse for inline URL detection in chat
export const youtube_parse_url = createTool({
  id: 'youtube_parse_url',
  description: 'Parse a YouTube URL and return what type of content it links to (video, channel, playlist) with the relevant ID. Useful for quickly checking URLs in chat.',
  inputSchema: z.object({
    url: z.string().describe('YouTube URL to parse'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    type: z.enum(['video', 'channel', 'playlist', 'unknown']),
    id: z.string().optional(),
    handle: z.string().optional(),
    isShort: z.boolean().optional(),
    isLive: z.boolean().optional(),
  }),
  execute: async (inputData, context) => {
    const { url  } = inputData as any;

    const videoId = extractVideoId(url);
    if (videoId) {
      return {
        ok: true,
        type: 'video' as const,
        id: videoId,
        isShort: url.includes('/shorts/'),
        isLive: url.includes('/live/'),
      };
    }

    const playlistId = extractPlaylistId(url);
    if (playlistId) {
      return { ok: true, type: 'playlist' as const, id: playlistId };
    }

    const channelInfo = extractChannelInfo(url);
    if (channelInfo) {
      return {
        ok: true,
        type: 'channel' as const,
        id: channelInfo.type === 'id' ? channelInfo.value : undefined,
        handle: channelInfo.type === 'handle' ? channelInfo.value : undefined,
      };
    }

    return { ok: false, type: 'unknown' as const };
  },
});
