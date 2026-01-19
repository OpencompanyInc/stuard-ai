import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { TAVILY_API_KEY } from '../utils/config';

export const scrape_url = createTool({
  id: 'scrape_url',
  description: 'Extract/scrape raw page content from one or more URLs using Tavily Extract.',
  inputSchema: z.object({
    urls: z
      .array(z.string().min(1))
      .min(1)
      .max(20)
      .describe('List of URLs to extract content from (max 20).'),
    includeImages: z.boolean().optional().default(false).describe('If true, include images in the response.'),
    extractDepth: z
      .enum(['basic', 'advanced'])
      .optional()
      .default('advanced')
      .describe('Extraction depth. advanced is slower but higher quality.'),
    format: z
      .enum(['text', 'markdown'])
      .optional()
      .default('markdown')
      .describe('Response format for the extracted content.'),
    timeout: z
      .number()
      .int()
      .min(1)
      .max(120000)
      .optional()
      .describe('Request timeout (ms).'),
    includeFavicon: z.boolean().optional().default(false).describe('If true, include favicon in the response.'),
  }),
  outputSchema: z
    .object({
      results: z.array(z.any()),
      failedResults: z.array(z.any()).optional(),
      responseTime: z.number().optional(),
      requestId: z.string().optional(),
      usage: z.any().optional(),
    })
    .passthrough(),
  execute: async (args) => {
    const { urls, includeImages, extractDepth, format, timeout, includeFavicon } = args.context;

    if (!TAVILY_API_KEY) {
      throw new Error('Missing TAVILY_API_KEY configuration');
    }

    const mod: any = await import('@tavily/core');
    const client = mod.tavily({ apiKey: TAVILY_API_KEY });

    const options: any = {
      includeImages,
      extractDepth,
      format,
      timeout,
      includeFavicon,
      includeUsage: true,
    };

    Object.keys(options).forEach((k) => options[k] === undefined && delete options[k]);

    const response = Object.keys(options).length > 0
      ? await client.extract(urls, options)
      : await client.extract(urls);
    return response;
  },
});
