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

interface ScreenTextMatch {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
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

function normalizeTextForMatching(
  value: string,
  caseSensitive: boolean,
  stripPunctuation = false,
): string {
  let normalized = value.replace(/\s+/g, ' ').trim();

  if (stripPunctuation) {
    normalized = normalized.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  }

  return caseSensitive ? normalized : normalized.toLowerCase();
}

function isCompatibleText(candidateText: string, searchText: string, caseSensitive: boolean): boolean {
  const candidate = normalizeTextForMatching(candidateText, caseSensitive);
  const search = normalizeTextForMatching(searchText, caseSensitive);
  const candidateWordCount = candidate.split(/\s+/).filter(Boolean).length;
  const searchWordCount = search.split(/\s+/).filter(Boolean).length;
  const allowReversePartial = candidateWordCount <= 1 && searchWordCount <= 1;

  if (!candidate || !search) {
    return false;
  }

  if (candidate === search || candidate.includes(search)) {
    return true;
  }

  const minimumReverseLength = Math.max(3, Math.ceil(search.length * 0.7));
  if (allowReversePartial && search.includes(candidate) && candidate.length >= minimumReverseLength) {
    return true;
  }

  const candidateLoose = normalizeTextForMatching(candidateText, caseSensitive, true);
  const searchLoose = normalizeTextForMatching(searchText, caseSensitive, true);

  if (!candidateLoose || !searchLoose) {
    return false;
  }

  if (candidateLoose === searchLoose || candidateLoose.includes(searchLoose)) {
    return true;
  }

  return allowReversePartial && searchLoose.includes(candidateLoose) && candidateLoose.length >= Math.max(3, Math.ceil(searchLoose.length * 0.7));
}

function buildMatchFromAnnotations(
  annotations: Array<{ description: string; boundingPoly: { vertices: VisionVertex[] } }>,
): { text: string; x: number; y: number; width: number; height: number } {
  const text = annotations.map((annotation) => annotation.description).join(' ');
  const allVertices = annotations.flatMap((annotation) => annotation.boundingPoly.vertices ?? []);
  const bbox = getBoundingBox(allVertices);

  return {
    text,
    ...bbox,
  };
}

function dedupeMatches(
  matches: Array<{ text: string; x: number; y: number; width: number; height: number }>,
) {
  const seen = new Set<string>();

  return matches.filter((match) => {
    const key = [
      normalizeTextForMatching(match.text, false),
      Math.round(match.x),
      Math.round(match.y),
      Math.round(match.width),
      Math.round(match.height),
    ].join('|');

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function preferMostSpecificMatches(
  matches: Array<{ text: string; x: number; y: number; width: number; height: number }>,
  searchText: string,
  caseSensitive: boolean,
) {
  const exactMatches = matches.filter((match) => (
    normalizeTextForMatching(match.text, caseSensitive) === normalizeTextForMatching(searchText, caseSensitive)
  ));

  if (exactMatches.length > 0) {
    return dedupeMatches(exactMatches);
  }

  const looseExactMatches = matches.filter((match) => (
    normalizeTextForMatching(match.text, caseSensitive, true) ===
    normalizeTextForMatching(searchText, caseSensitive, true)
  ));

  if (looseExactMatches.length > 0) {
    return dedupeMatches(looseExactMatches);
  }

  return dedupeMatches(matches);
}

export function findOcrTextMatches(input: {
  fullText: string;
  searchText: string;
  caseSensitive?: boolean;
  wordAnnotations: Array<{ description: string; boundingPoly: { vertices: VisionVertex[] } }>;
}): Array<{ text: string; x: number; y: number; width: number; height: number }> {
  const { fullText, searchText, wordAnnotations } = input;
  const caseSensitive = input.caseSensitive ?? false;
  const searchWords = searchText.trim().split(/\s+/).filter(Boolean);
  const isSingleWordSearch = searchWords.length <= 1;
  const matches: Array<{ text: string; x: number; y: number; width: number; height: number }> = [];

  if (isSingleWordSearch) {
    for (const annotation of wordAnnotations) {
      if (isCompatibleText(annotation.description, searchText, caseSensitive)) {
        matches.push(buildMatchFromAnnotations([annotation]));
      }
    }
  }

  if (!isCompatibleText(fullText, searchText, caseSensitive)) {
    return preferMostSpecificMatches(matches, searchText, caseSensitive);
  }

  const maxWindowSize = Math.min(
    wordAnnotations.length,
    Math.max(searchWords.length + 3, searchWords.length || 1),
  );

  for (let startIndex = 0; startIndex < wordAnnotations.length; startIndex += 1) {
    const candidateWords: Array<{ description: string; boundingPoly: { vertices: VisionVertex[] } }> = [];

    for (
      let endIndex = startIndex;
      endIndex < Math.min(wordAnnotations.length, startIndex + maxWindowSize);
      endIndex += 1
    ) {
      candidateWords.push(wordAnnotations[endIndex]);
      const candidateText = candidateWords.map((word) => word.description).join(' ');
      const hasEnoughWords = isSingleWordSearch || candidateWords.length >= Math.max(1, searchWords.length - 1);

      if (hasEnoughWords && isCompatibleText(candidateText, searchText, caseSensitive)) {
        matches.push(buildMatchFromAnnotations(candidateWords));
        break;
      }

      if (
        candidateWords.length >= searchWords.length &&
        normalizeTextForMatching(candidateText, caseSensitive).length > searchText.trim().length * 1.5
      ) {
        break;
      }
    }
  }

  return preferMostSpecificMatches(matches, searchText, caseSensitive);
}

/**
 * Shared logic to capture screen, run OCR, and find text coordinates
 */
async function locateTextOnScreen(
  inputData: {
    text?: string;
    context?: string;
    start?: false | string;
    region?: { x: number; y: number; width: number; height: number };
    caseSensitive?: boolean;
    toolName: string;
  },
  writer: any
) {
  const { start, region, caseSensitive, toolName } = inputData;
  const searchText = String(inputData.text ?? inputData.context ?? '').trim();

  if (!searchText) {
    return {
      ok: false,
      found: false,
      error: 'Provide `text` or `context` to search for.',
    };
  }

  await safeToolWrite(writer, {
    type: 'tool_event',
    tool: toolName,
    status: 'started',
    text: searchText,
    context: searchText,
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
  const bin = await execLocalTool('read_file_binary', { path: filePath, inline: true }, writer);
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
  const matches = findOcrTextMatches({
    fullText,
    searchText,
    caseSensitive,
    wordAnnotations,
  });

  if (matches.length === 0) {
    await safeToolWrite(writer, {
      type: 'tool_event',
      tool: toolName,
      status: 'not_found',
      text: searchText,
      context: searchText,
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

  const normalizedMatches: ScreenTextMatch[] = matches.map((match) => ({
    ...match,
    centerX: Math.round(match.x + match.width / 2),
    centerY: Math.round(match.y + match.height / 2),
  }));
  const primaryResolvedMatch = normalizedMatches[0];
  const resolvedTargetX = Math.round(targetX);
  const resolvedTargetY = Math.round(targetY);
  const ambiguous = normalizedMatches.length > 1;

  await safeToolWrite(writer, {
    type: 'tool_event',
    tool: toolName,
    status: 'found',
    text: searchText,
    context: searchText,
    matchCount: normalizedMatches.length,
    x: resolvedTargetX,
    y: resolvedTargetY,
  });

  return {
    ok: true,
    found: true,
    ambiguous,
    matchCount: normalizedMatches.length,
    matchedText: primaryResolvedMatch.text,
    x: resolvedTargetX,
    y: resolvedTargetY,
    centerX: primaryResolvedMatch.centerX,
    centerY: primaryResolvedMatch.centerY,
    boundingBox: {
      x: primaryResolvedMatch.x,
      y: primaryResolvedMatch.y,
      width: primaryResolvedMatch.width,
      height: primaryResolvedMatch.height,
    },
    matches: normalizedMatches,
    allMatches: normalizedMatches,
    fullText,
  };
}

// Input schema shared by both tools
const ocrInputSchema = z.object({
  text: z.string().optional().describe('The text/words to find on screen'),
  context: z.string().optional().describe('Backward-compatible alias for `text`.'),
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
}).refine((value) => {
  return String(value.text || value.context || '').trim().length > 0;
}, {
  message: 'Provide `text` or `context` to search for.',
  path: ['text'],
});

const textMatchSchema = z.object({
  text: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  centerX: z.number(),
  centerY: z.number(),
});

const locatedTextOutputSchema = z.object({
  ok: z.boolean(),
  found: z.boolean(),
  ambiguous: z.boolean().optional(),
  matchCount: z.number().optional(),
  matchedText: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  centerX: z.number().optional(),
  centerY: z.number().optional(),
  boundingBox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).optional(),
  matches: z.array(textMatchSchema).optional(),
  allMatches: z.array(textMatchSchema).optional(),
  fullText: z.string().optional(),
  error: z.string().optional(),
});

export const find_text = createTool({
  id: 'find_text',
  description: `Find text on screen using Google Cloud Vision OCR and return precise pixel coordinates.
Use this to inspect matches and get center coordinates before clicking.`,
  inputSchema: ocrInputSchema,
  outputSchema: locatedTextOutputSchema,
  execute: async (inputData: any, { writer }: any) => {
    return await locateTextOnScreen({ ...inputData, toolName: 'find_text' }, writer);
  },
});

export const find_text_on_screen = createTool({
  id: 'find_text_on_screen',
  description: `Find text on screen using Google Cloud Vision OCR and return precise pixel coordinates.
Use this to locate text for clicking or inserting content at specific positions.`,
  inputSchema: ocrInputSchema,
  outputSchema: locatedTextOutputSchema,
  execute: async (inputData: any, { writer }: any) => {
    return await locateTextOnScreen({ ...inputData, toolName: 'find_text_on_screen' }, writer);
  },
});

export const find_and_click_text = createTool({
  id: 'find_and_click_text',
  description: `Find text on screen via Google Cloud Vision OCR and click it.
Combines screenshot capture, cloud-based OCR, coordinate calculation, and mouse click action.`,
  inputSchema: ocrInputSchema,
  outputSchema: locatedTextOutputSchema.extend({
    clicked: z.boolean().optional(),
  }),
  execute: async (inputData: any, { writer }: any) => {
    const result = await locateTextOnScreen({ ...inputData, toolName: 'find_and_click_text' }, writer);

    if (result.ok && result.found && result.ambiguous) {
      await safeToolWrite(writer, {
        type: 'tool_event',
        tool: 'find_and_click_text',
        status: 'ambiguous',
        text: result.matchedText,
        matchCount: result.matchCount,
      });

      return {
        ...result,
        ok: false,
        clicked: false,
        error: `Found ${result.matchCount || 0} matches. Refusing to click automatically. Use find_text to inspect coordinates first.`,
      };
    }
    
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
        ...result,
        clicked: true,
      };
    }

    return {
      ...result,
      clicked: false,
    };
  },
});
