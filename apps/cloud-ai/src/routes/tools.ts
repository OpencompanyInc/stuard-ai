import type { IncomingMessage, ServerResponse } from 'http';
import { OpenAIVoice } from '@mastra/voice-openai';
import { getToolRegistry, initToolRegistry } from '../tools/meta-tools';
import { runWithSecrets } from '../tools/bridge';
import { verifyToken } from '../supabase';

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

function writeJson(res: ServerResponse, status: number, obj: any) {
  try {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
  } catch {
    try { res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end('{"ok":false,"error":"internal"}'); } catch {}
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

  // CORS preflight
  if (req.method === 'OPTIONS' && path.startsWith('/tools/')) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
    });
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
        writeJson(res, 400, { ok: false, error: 'text_required' });
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
      });
      return true;
    } catch (e: any) {
      console.error('[tools] text_to_speech error:', e);
      writeJson(res, 500, { ok: false, error: e?.message || 'tts_failed' });
      return true;
    }
  }

  // List TTS voices
  if ((req.method === 'POST' || req.method === 'GET') && path === '/tools/list_tts_voices') {
    const voices = [
      { id: 'alloy', name: 'Alloy', description: 'Neutral, balanced voice - good for general use' },
      { id: 'echo', name: 'Echo', description: 'Warm, confident male voice' },
      { id: 'fable', name: 'Fable', description: 'Expressive, British-accented voice - good for storytelling' },
      { id: 'onyx', name: 'Onyx', description: 'Deep, authoritative male voice' },
      { id: 'nova', name: 'Nova', description: 'Friendly, upbeat female voice' },
      { id: 'shimmer', name: 'Shimmer', description: 'Clear, pleasant female voice' },
    ];
    writeJson(res, 200, { ok: true, voices });
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
        writeJson(res, 404, { ok: false, error: 'unknown_tool', message: `Tool '${toolName}' not found in registry` });
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

      // Execute the tool with user context (secrets)
      const secrets = userId ? { userId } : {};
      
      console.log(`[tools] Executing ${toolName} with args:`, JSON.stringify(body).slice(0, 200));

      const result = await runWithSecrets(secrets, async () => {
        return await tool.execute({ context: body }, {});
      });

      writeJson(res, 200, { ok: true, result });
      return true;
    } catch (e: any) {
      console.error(`[tools] ${toolName} error:`, e);
      writeJson(res, 500, { ok: false, error: e?.message || 'tool_execution_failed' });
      return true;
    }
  }

  return false;
}
