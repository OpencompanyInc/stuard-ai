import type { IncomingMessage, ServerResponse } from 'http';
import { OpenAIVoice } from '@mastra/voice-openai';
import { initToolRegistry } from '../tools/meta-tools';
import { getToolRegistry } from '../tools/tool-registry';
import { runWithSecrets } from '../tools/bridge';
import { verifyToken } from '../supabase';
import { CORS_ALLOWED_ORIGINS, PUBLIC_TOOLS_ALLOWLIST, REQUIRE_TOOL_AUTH, IS_DEVELOPMENT } from '../utils/config';

/**
 * Gets CORS origin header based on request and configuration.
 */
function getCorsOrigin(req: IncomingMessage): string {
  const origin = req.headers.origin || '';
  if (CORS_ALLOWED_ORIGINS === '*') return '*';
  if (!CORS_ALLOWED_ORIGINS) return '';
  const allowed = CORS_ALLOWED_ORIGINS.split(',').map(s => s.trim());
  if (allowed.includes(origin)) return origin;
  return '';
}

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => { try { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); } catch {} });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function writeJson(res: ServerResponse, status: number, obj: any, corsOrigin: string = '*') {
  try {
    const body = JSON.stringify(obj);
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    };
    if (corsOrigin) {
      headers['Access-Control-Allow-Origin'] = corsOrigin;
      headers['Vary'] = 'Origin';
    }
    res.writeHead(status, headers);
    res.end(body);
  } catch {
    try { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"internal"}'); } catch {}
  }
}

// Singleton voice instance
let _voiceInstance: OpenAIVoice | null = null;
function getVoiceInstance(): OpenAIVoice {
  if (!_voiceInstance) {
    _voiceInstance = new OpenAIVoice({
      speechModel: { name: 'tts-1' },
      speaker: 'alloy',
    });
  }
  return _voiceInstance;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function handleToolsRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const path = String(parsedUrl.pathname || '');
  const corsOrigin = getCorsOrigin(req);

  // CORS preflight
  if (req.method === 'OPTIONS' && path.startsWith('/tools/')) {
    const headers: Record<string, string> = {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
    };
    if (corsOrigin) {
      headers['Access-Control-Allow-Origin'] = corsOrigin;
      headers['Vary'] = 'Origin';
    }
    res.writeHead(204, headers);
    res.end();
    return true;
  }

  // Text-to-speech - returns audio as base64 for client to save/play
  if (req.method === 'POST' && path === '/tools/text_to_speech') {
    try {
      const body = await readJsonBody(req);
      const text = String(body?.text || '').slice(0, 4096);
      const voice = body?.voice || 'alloy';
      const speed = Number(body?.speed || 1.0);
      const format = body?.format || 'mp3';
      
      if (!text) {
        writeJson(res, 400, { ok: false, error: 'text_required' }, corsOrigin);
        return true;
      }
      
      const voiceInstance = getVoiceInstance();
      const audioStream = await voiceInstance.speak(text, {
        speaker: voice as any,
        speed,
      });
      
      const audioBuffer = await streamToBuffer(audioStream);
      const audioBase64 = audioBuffer.toString('base64');
      
      writeJson(res, 200, {
        ok: true,
        audioData: audioBase64,
        format,
        voice,
        textLength: text.length,
        mimeType: format === 'mp3' ? 'audio/mpeg' : `audio/${format}`,
      }, corsOrigin);
      return true;
    } catch (e: any) {
      console.error('[tools] text_to_speech error:', e);
      writeJson(res, 500, { ok: false, error: e?.message || 'tts_failed' }, corsOrigin);
      return true;
    }
  }

  // List TTS voices (public endpoint)
  if ((req.method === 'POST' || req.method === 'GET') && path === '/tools/list_tts_voices') {
    const voices = [
      { id: 'alloy', name: 'Alloy', description: 'Neutral, balanced voice - good for general use' },
      { id: 'echo', name: 'Echo', description: 'Warm, confident male voice' },
      { id: 'fable', name: 'Fable', description: 'Expressive, British-accented voice - good for storytelling' },
      { id: 'onyx', name: 'Onyx', description: 'Deep, authoritative male voice' },
      { id: 'nova', name: 'Nova', description: 'Friendly, upbeat female voice' },
      { id: 'shimmer', name: 'Shimmer', description: 'Clear, pleasant female voice' },
    ];
    writeJson(res, 200, { ok: true, voices }, corsOrigin);
    return true;
  }

  // Generic tool execution endpoint - /tools/:toolName
  // This allows workflows to execute any registered tool directly
  const toolMatch = path.match(/^\/tools\/([a-zA-Z0-9_-]+)$/);
  if (req.method === 'POST' && toolMatch) {
    const toolName = toolMatch[1];

    // Skip tools that have dedicated handlers
    if (toolName === 'text_to_speech' || toolName === 'list_tts_voices') {
      return false;
    }

    try {
      // Initialize tool registry if needed
      initToolRegistry();

      const registry = getToolRegistry();
      const tool = registry.get(toolName);

      if (!tool) {
        writeJson(res, 404, { ok: false, error: 'unknown_tool', message: `Tool '${toolName}' not found in registry` }, corsOrigin);
        return true;
      }

      const body = await readJsonBody(req);

      // Extract user context from auth header if present
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      let userId: string | null = null;

      if (token) {
        try {
          const authed = await verifyToken(token);
          userId = authed?.userId || null;
        } catch {}
      }

      // Security: Require auth for non-public tools in production
      const isPublicTool = PUBLIC_TOOLS_ALLOWLIST.has(toolName);
      if (REQUIRE_TOOL_AUTH && !isPublicTool && !userId) {
        writeJson(res, 401, { ok: false, error: 'unauthorized', message: 'Authentication required for this tool' }, corsOrigin);
        return true;
      }

      // Execute the tool with user context (secrets)
      const secrets = userId ? { userId } : {};
      
      // Security: Only log tool name and arg size, not full content
      console.log(`[tools] Executing ${toolName} (args: ${JSON.stringify(body).length} bytes, userId: ${userId || 'anonymous'})`);

      const result = await runWithSecrets(secrets, async () => {
        if (typeof tool.execute !== 'function') {
          throw new Error(`Tool '${toolName}' is not executable`);
        }
        return await tool.execute({ context: body } as any, {} as any);
      });

      writeJson(res, 200, { ok: true, result }, corsOrigin);
      return true;
    } catch (e: any) {
      console.error(`[tools] ${toolName} error:`, e?.message || e);
      writeJson(res, 500, { ok: false, error: e?.message || 'tool_execution_failed' }, corsOrigin);
      return true;
    }
  }

  return false;
}
