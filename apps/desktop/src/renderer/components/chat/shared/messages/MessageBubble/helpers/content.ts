import { convertLatexDelims, escapeCurrencyDollars } from '../../../../../../utils/text';
import { GENUI_COMPONENT_MAP } from '../constants';
import { extractYouTubeVideoId } from './media';
import { normalizeMarkdownSpacing } from './markdown';
import type { ContentSegment } from '../types';

export function extractContentSegments(inputText: string): ContentSegment[] {
  if (!inputText) return [];
  const result: ContentSegment[] = [];

  // Regex for genui code blocks: ```genui:component\n{json}\n```
  const genuiRegex = /```genui:(\w+)\s*\n([\s\S]*?)```/g;
  const genuiIncompleteRegex = /```genui:(\w+)\s*\n([\s\S]*)$/; // Matches incomplete block at end
  const mediaRegex = /<<([^<>]+)>>/g;
  const youtubeRegex = /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})[^\s]*/gi;
  // Standalone http/https links (not in brackets, not in quotes, bounded by whitespace/newlines)
  const linkPreviewRegex = /(?:^|\s)(https?:\/\/[^\s]+)(?:$|\s)/g;
  const rawAudioRegex = /(?:[a-zA-Z]:\\[^<>:"|?*\n\r]+\.(?:wav|mp3|ogg|m4a|aac|webm)|(?:\/[^<>:"|?*\n\r]+\.(?:wav|mp3|ogg|m4a|aac|webm)))(?=\s|$)/gi;

  // First pass: extract complete GenUI blocks
  const genuiMatches: { start: number; end: number; component: string; args: any; id: string; loading?: boolean; title?: string }[] = [];
  let genuiMatch;
  let genuiCounter = 0;
  while ((genuiMatch = genuiRegex.exec(inputText)) !== null) {
    const componentName = genuiMatch[1].toLowerCase();
    const jsonContent = genuiMatch[2].trim();
    let args = {};
    try {
      args = JSON.parse(jsonContent);
    } catch (e) {
      console.warn('[GenUI] Failed to parse JSON for', componentName, ':', e);
      continue;
    }
    const toolName = GENUI_COMPONENT_MAP[componentName] || componentName;
    genuiMatches.push({
      start: genuiMatch.index,
      end: genuiMatch.index + genuiMatch[0].length,
      component: toolName,
      args,
      id: `genui-${genuiMatch.index}-${genuiCounter++}`,
    });
  }

  // Check for incomplete GenUI block at the end (streaming)
  const incompleteMatch = inputText.match(genuiIncompleteRegex);
  if (incompleteMatch) {
    const incompleteStart = inputText.lastIndexOf('```genui:');
    const alreadyMatched = genuiMatches.some(m => m.start === incompleteStart);
    if (!alreadyMatched && incompleteStart >= 0) {
      const componentName = incompleteMatch[1].toLowerCase();
      const toolName = GENUI_COMPONENT_MAP[componentName] || componentName;
      let title: string | undefined;
      try {
        const partialJson = incompleteMatch[2];
        const titleMatch = partialJson.match(/"title"\s*:\s*"([^"]+)"/);
        if (titleMatch) title = titleMatch[1];
      } catch { }
      genuiMatches.push({
        start: incompleteStart,
        end: inputText.length,
        component: toolName,
        args: {},
        id: `genui-loading-${incompleteStart}`,
        loading: true,
        title,
      });
    }
  }

  const youtubeMatches: { start: number; end: number; videoId: string; url: string }[] = [];
  let ytMatch;
  while ((ytMatch = youtubeRegex.exec(inputText)) !== null) {
    const videoId = extractYouTubeVideoId(ytMatch[0]);
    if (videoId) {
      youtubeMatches.push({
        start: ytMatch.index,
        end: ytMatch.index + ytMatch[0].length,
        videoId,
        url: ytMatch[0],
      });
    }
  }

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const processTextChunk = (chunk: string) => {
    if (!chunk) return;
    let t = chunk
      .replace(/==([\s\S]*?)==/g, '[$1](#highlight)')
      .replace(/\+\+([\s\S]*?)\+\+/g, '[$1](#underline)');
    t = normalizeMarkdownSpacing(convertLatexDelims(escapeCurrencyDollars(t)));
    result.push({ kind: 'text', value: t });
  };

  const allMatches: Array<{ type: 'image' | 'video' | 'audio' | 'youtube' | 'link_preview' | 'genui' | 'genui_loading'; start: number; end: number; data: any }> = [];

  // Add GenUI matches first (highest priority)
  for (const g of genuiMatches) {
    if (g.loading) {
      allMatches.push({
        type: 'genui_loading',
        start: g.start,
        end: g.end,
        data: { component: g.component, title: g.title },
      });
    } else {
      allMatches.push({
        type: 'genui',
        start: g.start,
        end: g.end,
        data: { component: g.component, args: g.args, id: g.id },
      });
    }
  }

  while ((match = mediaRegex.exec(inputText)) !== null) {
    const src = String(match[1] || '').trim();
    const isAudio = /\.(wav|mp3|ogg|m4a|aac)$/i.test(src);
    const isVideo = /\.(mp4|mov|m4v|webm)$/i.test(src);
    allMatches.push({
      type: isAudio ? 'audio' : isVideo ? 'video' : 'image',
      start: match.index,
      end: match.index + match[0].length,
      data: { src },
    });
  }

  while ((match = rawAudioRegex.exec(inputText)) !== null) {
    const src = match[0].trim();
    const overlap = allMatches.some(
      (m) =>
        (match!.index >= m.start && match!.index < m.end) ||
        (match!.index + src.length > m.start && match!.index + src.length <= m.end)
    );

    if (!overlap) {
      allMatches.push({
        type: 'audio',
        start: match.index,
        end: match.index + src.length,
        data: { src },
      });
    }
  }

  for (const yt of youtubeMatches) {
    const insideMedia = allMatches.some((m) => yt.start >= m.start && yt.end <= m.end);
    if (!insideMedia) {
      allMatches.push({
        type: 'youtube',
        start: yt.start,
        end: yt.end,
        data: { videoId: yt.videoId, url: yt.url },
      });
    }
  }

  while ((match = linkPreviewRegex.exec(inputText)) !== null) {
    const raw = String(match[1] || '').trim();
    if (!raw) continue;
    const urlStart = match.index + match[0].indexOf(raw);
    const urlEnd = urlStart + raw.length;
    const overlap = allMatches.some(
      (m) =>
        (urlStart >= m.start && urlStart < m.end) ||
        (urlEnd > m.start && urlEnd <= m.end) ||
        (urlStart <= m.start && urlEnd >= m.end)
    );
    if (!overlap) {
      allMatches.push({
        type: 'link_preview',
        start: urlStart,
        end: urlEnd,
        data: { url: raw },
      });
    }
  }

  allMatches.sort((a, b) => a.start - b.start);

  for (const m of allMatches) {
    if (m.start > lastIndex) {
      processTextChunk(inputText.slice(lastIndex, m.start));
    }
    if (m.type === 'genui') {
      result.push({ kind: 'genui', component: m.data.component, args: m.data.args, id: m.data.id });
    } else if (m.type === 'genui_loading') {
      result.push({ kind: 'genui_loading', component: m.data.component, title: m.data.title });
    } else if (m.type === 'image' && m.data.src) {
      result.push({ kind: 'image', src: m.data.src });
    } else if (m.type === 'video' && m.data.src) {
      result.push({ kind: 'video', src: m.data.src });
    } else if (m.type === 'audio' && m.data.src) {
      result.push({ kind: 'audio', src: m.data.src });
    } else if (m.type === 'youtube') {
      result.push({ kind: 'youtube', videoId: m.data.videoId, url: m.data.url });
    } else if (m.type === 'link_preview') {
      result.push({ kind: 'link_preview', url: m.data.url });
    }
    lastIndex = m.end;
  }

  if (lastIndex < inputText.length) {
    processTextChunk(inputText.slice(lastIndex));
  }

  return result;
}
