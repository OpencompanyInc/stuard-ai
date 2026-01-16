import { z } from 'zod';
import { makeLocalTool } from './shared';

const region = z
  .object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() })
  .partial();

export const take_screenshot = makeLocalTool(
  'take_screenshot',
  'Capture screenshot with optional region and return a local file path (PNG).',
  z.object({ region: region.optional(), hideUI: z.boolean().optional() }),
  z.object({ filePath: z.string() }),
);

export const capture_screen_to_file = makeLocalTool(
  'capture_screen_to_file',
  'Save screenshot to file',
  z.object({ filePath: z.string(), region: region.optional(), hideUI: z.boolean().optional() }),
  z.object({ filePath: z.string() }),
);

export const get_screen_text = makeLocalTool(
  'get_screen_text',
  'OCR text extraction from screen (deprecated, use take_screenshot + analyze_image)',
  z.object({ region: region.optional() }),
  z.object({ text: z.string() }),
);

export const find_and_click_text = makeLocalTool(
  'find_and_click_text',
  'Find text on screen via OCR and click it',
  z.object({ text: z.string(), region: region.optional(), fuzzy: z.boolean().optional() }),
);

export const read_image_optimized = makeLocalTool(
  'read_image_optimized',
  'Read and compress images for efficient transmission',
  z.object({
    sources: z
      .array(z.object({ data: z.string(), mimeType: z.string().optional() }))
      .min(1),
    targetSizeKB: z.number().int().min(32).max(4096).default(256),
  }),
  z.object({ items: z.array(z.object({ data: z.string(), mimeType: z.string() })) }),
);
