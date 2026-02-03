import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';

export const analyzeYouTubeVideoTool = createTool({
  id: 'analyze_youtube_video',
  description: 'Analyze a YouTube video using Gemini. Provide the YouTube URL and an optional task prompt (e.g., summarize, extract key points, action items).',
  inputSchema: z.object({
    url: z.string().url().describe('YouTube video URL (e.g., https://www.youtube.com/watch?v=...)'),
    task: z.string().default('Summarize this video with key takeaways and a brief outline.'),
    thinking: z.boolean().default(false),
  }),
  outputSchema: z.object({ summary: z.string() }),
  execute: async (inputData, { writer }) => {
    const { url, task, thinking  } = inputData as {
      url: string;
      task: string;
      thinking: boolean;
    };

    await (writer as any)?.write?.({ type: 'tool_event', tool: 'analyze_youtube_video', status: 'started', url, thinking });
    try { await (writer as any)?.custom?.({ type: 'tool_event', tool: 'analyze_youtube_video', status: 'started', url, thinking }); } catch {}

    const modelId = thinking ? 'gemini-1.5-pro' : 'gemini-1.5-flash';

    const parts: any[] = [
      { type: 'text', text: task },
      { type: 'file', data: url, mediaType: 'video/mp4' },
    ];

    const messages = [{ role: 'user' as const, content: parts }];
    const res = await generateText({ model: google(modelId) as any, messages, temperature: 0.2 });
    const summary = (await res.text).trim();

    await (writer as any)?.write?.({ type: 'tool_event', tool: 'analyze_youtube_video', status: 'completed', length: summary.length });
    try { await (writer as any)?.custom?.({ type: 'tool_event', tool: 'analyze_youtube_video', status: 'completed', length: summary.length }); } catch {}

    return { summary };
  },
});
