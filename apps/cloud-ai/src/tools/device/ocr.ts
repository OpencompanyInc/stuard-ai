import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, safeToolWrite, getBridgeSecrets } from '../bridge';

/**
 * Google Cloud Vision OCR types and helpers
 */

interface VisionVertex {
  x?: number;
  y?: number;
}

interface VisionBoundingPoly {
  vertices: VisionVertex[];
}

interface VisionTextAnnotation {
  description: string;
  boundingPoly: VisionBoundingPoly;
  locale?: string;
}

interface VisionResponse {
  responses: Array<{
    textAnnotations?: VisionTextAnnotation[];
    error?: { code: number; message: string };
  }>;
}

function getBoundingBox(vertices: VisionVertex[]): { x: number; y: number; width: number; height: number } {
  const xs = vertices.map(v => v.x ?? 0);
  const ys = vertices.map(v => v.y ?? 0);
  
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Shared logic to capture screen, run OCR, and find text coordinates
 */
async function locateTextOnScreen(
  inputData: {
    context: string;
    start?: false | string;
    region?: { x: number; y: number; width: number; height: number };
    caseSensitive?: boolean;
    toolName: string;
  },
  writer: any
) {
  const { context, start, region, caseSensitive, toolName } = inputData;

  await safeToolWrite(writer, {
    type: 'tool_event',
    tool: toolName,
    status: 'started',
    context,
    start,
  });

  // Get API key from secrets
  const secrets = getBridgeSecrets();
  const apiKey = secrets?.GOOGLE_CLOUD_VISION_API_KEY || secrets?.GOOGLE_API_KEY || process.env.GOOGLE_CLOUD_VISION_API_KEY || process.env.GOOGLE_API_KEY;
  
  if (!apiKey) {
    return {
      ok: false,
      found: false,
      error: 'Google Cloud Vision API key not configured. Set GOOGLE_CLOUD_VISION_API_KEY or GOOGLE_API_KEY.',
    };
  }

  // 1. Take a screenshot
  await safeToolWrite(writer, {
    type: 'tool_event',
    tool: toolName,
    status: 'capturing_screen',
  });

  const screenshotResult = await execLocalTool('take_screenshot', { region, hideUI: true }, writer);
  const filePath = typeof screenshotResult?.filePath === 'string' ? screenshotResult.filePath : '';
  
  if (!filePath) {
    return {
      ok: false,
      found: false,
      error: 'Failed to capture screenshot',
    };
  }

  // 2. Read the screenshot as base64
  const bin = await execLocalTool('read_file_binary', { path: filePath }, writer);
  const imageData = bin?.data as string | undefined;

  if (!imageData) {
    return {
      ok: false,
      found: false,
      error: 'Failed to read screenshot data',
    };
  }

  await safeToolWrite(writer, {
    type: 'tool_event',
    tool: toolName,
    status: 'analyzing',
  });

  // 3. Call Google Cloud Vision API
  const visionUrl = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
  const requestBody = {
    requests: [
      {
        image: {
          content: imageData,
        },
        features: [
          {
            type: 'TEXT_DETECTION',
          },
        ],
      },
    ],
  };

  let visionResponse: VisionResponse;
  
  try {
    const response = await fetch(visionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vision API error: ${response.status} - ${errorText}`);
    }

    visionResponse = await response.json() as VisionResponse;
  } catch (err: any) {
    await safeToolWrite(writer, {
      type: 'tool_event',
      tool: toolName,
      status: 'error',
      error: err?.message || 'Vision API call failed',
    });

    return {
      ok: false,
      found: false,
      error: `Vision API failed: ${err?.message || 'Unknown error'}`,
    };
  }

  // 4. Check for API errors
  const apiResponse = visionResponse.responses?.[0];
  if (apiResponse?.error) {
    return {
      ok: false,
      found: false,
      error: `Vision API error: ${apiResponse.error.message}`,
    };
  }

  const textAnnotations = apiResponse?.textAnnotations;
  if (!textAnnotations || textAnnotations.length === 0) {
    await safeToolWrite(writer, {
      type: 'tool_event',
      tool: toolName,
      status: 'no_text_detected',
    });

    return {
      ok: true,
      found: false,
      fullText: '',
    };
  }

  // First annotation is the full text, rest are individual words
  const fullText = textAnnotations[0].description;
  const wordAnnotations = textAnnotations.slice(1);

  // 5. Search for the context in the detected text
  const searchContext = caseSensitive ? context : context.toLowerCase();
  
  // Find matching words or phrases
  const matches: Array<{ text: string; x: number; y: number; width: number; height: number }> = [];
  
  // First, try to find exact word matches
  for (const annotation of wordAnnotations) {
    const wordText = caseSensitive ? annotation.description : annotation.description.toLowerCase();
    
    if (wordText.includes(searchContext) || searchContext.includes(wordText)) {
      const bbox = getBoundingBox(annotation.boundingPoly.vertices);
      matches.push({
        text: annotation.description,
        ...bbox,
      });
    }
  }

  // If no word matches, try to find the phrase by combining adjacent words
  if (matches.length === 0) {
    const fullTextLower = caseSensitive ? fullText : fullText.toLowerCase();
    if (fullTextLower.includes(searchContext)) {
      const contextWords = context.split(/\s+/);
      
      for (let i = 0; i <= wordAnnotations.length - contextWords.length; i++) {
        const candidateWords = wordAnnotations.slice(i, i + contextWords.length);
        const candidateText = candidateWords.map(w => w.description).join(' ');
        const candidateTextNorm = caseSensitive ? candidateText : candidateText.toLowerCase();
        
        if (candidateTextNorm.includes(searchContext) || searchContext.includes(candidateTextNorm)) {
          const allVertices = candidateWords.flatMap(w => w.boundingPoly.vertices);
          const xs = allVertices.map(v => v.x ?? 0);
          const ys = allVertices.map(v => v.y ?? 0);
          
          matches.push({
            text: candidateText,
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
          });
          break;
        }
      }
    }
  }

  if (matches.length === 0) {
    await safeToolWrite(writer, {
      type: 'tool_event',
      tool: toolName,
      status: 'not_found',
      context,
      fullTextLength: fullText.length,
    });

    return {
      ok: true,
      found: false,
      fullText,
    };
  }

  // Use the first match as the primary result
  const primaryMatch = matches[0];
  
  let targetX: number;
  let targetY: number;

  targetY = primaryMatch.y + primaryMatch.height / 2;

  if (start === false || start === undefined) {
    targetX = primaryMatch.x + primaryMatch.width / 2;
  } else if (start === 'before') {
    targetX = primaryMatch.x;
  } else if (start === 'after') {
    targetX = primaryMatch.x + primaryMatch.width;
  } else {
    const foundText = caseSensitive ? primaryMatch.text : primaryMatch.text.toLowerCase();
    const searchSubstring = caseSensitive ? start : start.toLowerCase();
    const substringIndex = foundText.indexOf(searchSubstring);
    
    if (substringIndex >= 0) {
      const charWidth = primaryMatch.width / primaryMatch.text.length;
      targetX = primaryMatch.x + substringIndex * charWidth;
    } else {
      targetX = primaryMatch.x;
    }
  }

  // Apply region offset
  if (region) {
    targetX += region.x;
    targetY += region.y;
    
    for (const m of matches) {
      m.x += region.x;
      m.y += region.y;
    }
  }

  await safeToolWrite(writer, {
    type: 'tool_event',
    tool: toolName,
    status: 'found',
    context,
    matchCount: matches.length,
    x: Math.round(targetX),
    y: Math.round(targetY),
  });

  return {
    ok: true,
    found: true,
    x: Math.round(targetX),
    y: Math.round(targetY),
    boundingBox: {
      x: primaryMatch.x,
      y: primaryMatch.y,
      width: primaryMatch.width,
      height: primaryMatch.height,
    },
    allMatches: matches,
    fullText,
  };
}

// Input schema shared by both tools
const ocrInputSchema = z.object({
  context: z.string().describe('The text/words to find on screen'),
  start: z.union([
    z.literal(false),
    z.string(),
  ]).optional().describe('Position mode: false=center, "before"=start, "after"=end, or substring to position before'),
  region: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  }).optional().describe('Optional region to search within'),
  caseSensitive: z.boolean().optional().default(false).describe('Match case-sensitively'),
});

export const find_text_on_screen = createTool({
  id: 'find_text_on_screen',
  description: `Find text on screen using Google Cloud Vision OCR and return precise pixel coordinates.
Use this to locate text for clicking or inserting content at specific positions.`,
  inputSchema: ocrInputSchema,
  outputSchema: z.object({
    ok: z.boolean(),
    found: z.boolean(),
    x: z.number().optional(),
    y: z.number().optional(),
    boundingBox: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }).optional(),
    allMatches: z.array(z.object({
      text: z.string(),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })).optional(),
    fullText: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData: any, { writer }: any) => {
    return await locateTextOnScreen({ ...inputData, toolName: 'find_text_on_screen' }, writer);
  },
});

export const find_and_click_text = createTool({
  id: 'find_and_click_text',
  description: `Find text on screen via Google Cloud Vision OCR and click it.
Combines screenshot capture, cloud-based OCR, coordinate calculation, and mouse click action.`,
  inputSchema: ocrInputSchema,
  outputSchema: z.object({
    ok: z.boolean(),
    found: z.boolean(),
    x: z.number().optional(),
    y: z.number().optional(),
    matchedText: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData: any, { writer }: any) => {
    const result = await locateTextOnScreen({ ...inputData, toolName: 'find_and_click_text' }, writer);
    
    if (result.ok && result.found && result.x !== undefined && result.y !== undefined) {
      // Perform the click action
      await safeToolWrite(writer, {
        type: 'tool_event',
        tool: 'find_and_click_text',
        status: 'clicking',
        x: result.x,
        y: result.y,
      });

      await execLocalTool('click_at_coordinates', { x: result.x, y: result.y }, writer);

      return {
        ok: true,
        found: true,
        x: result.x,
        y: result.y,
        matchedText: result.allMatches?.[0]?.text,
      };
    }

    return {
      ok: result.ok,
      found: result.found,
      error: result.error,
    };
  },
});
