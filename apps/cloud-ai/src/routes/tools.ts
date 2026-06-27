import type { IncomingMessage, ServerResponse } from 'http';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { initToolRegistry } from '../tools/meta-tools';
import { getToolRegistry } from '../tools/tool-registry';
import { runWithSecrets } from '../tools/bridge';
import { verifyToken, checkAccess, logUsageEvent } from '../supabase';
import { verifyVMAuthFromRequest } from '../services/vm-tokens';
import { CORS_ALLOWED_ORIGINS, PUBLIC_TOOLS_ALLOWLIST, REQUIRE_TOOL_AUTH, IS_DEVELOPMENT } from '../utils/config';
import { isOpenRouterTtsModel, synthesizeSpeechOpenRouter } from '../media/openrouter-tts';

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

let _elevenLabsClient: ElevenLabsClient | null = null;
function getElevenLabsClient(): ElevenLabsClient {
  if (!_elevenLabsClient) {
    _elevenLabsClient = new ElevenLabsClient();
  }
  return _elevenLabsClient;
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return Buffer.from(result);
}

const DEFAULT_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';
const TTS_USAGE_MODEL = 'elevenlabs/tts';
const FORMAT_MAP: Record<string, string> = {
  mp3: 'mp3_44100_128',
  opus: 'opus_48000_128',
  wav: 'wav_44100',
  aac: 'mp3_44100_128',
  flac: 'wav_44100',
};

function estimateTtsCostUsd(textLength: number): number {
  const envPrice = Number(process.env.PRICE_ELEVENLABS_TTS_PER_1K_CHARS_USD);
  const pricePer1kChars = Number.isFinite(envPrice) && envPrice > 0 ? envPrice : 0.3;
  const chars = Math.max(0, textLength);
  const usd = (chars / 1000) * pricePer1kChars;
  return Number(usd.toFixed(8));
}

export async function handleToolsRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const path = String(parsedUrl.pathname || '');
  const corsOrigin = getCorsOrigin(req);

  if (req.method === 'OPTIONS' && path.startsWith('/tools/')) {
    const headers: Record<string, string> = {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-VM-User-Id',
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

  if (req.method === 'POST' && path === '/tools/text_to_speech') {
    try {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const authed = token ? await verifyToken(token) : null;
      const userId = authed?.userId || null;

      if (!userId && !IS_DEVELOPMENT) {
        writeJson(res, 401, { ok: false, error: 'unauthorized' }, corsOrigin);
        return true;
      }

      if (userId) {
        const access = await checkAccess(userId);
        if (!access.allowed) {
          writeJson(res, 403, {
            ok: false,
            error: access.reason || 'access_denied',
            plan: access.plan,
            limit: access.limit,
            used: access.used,
            remaining: access.remaining,
          }, corsOrigin);
          return true;
        }
      }

      const body = await readJsonBody(req);
      const text = String(body?.text || '').slice(0, 5000);
      const voiceId = body?.voice_id || body?.voice || DEFAULT_VOICE_ID;
      const modelId = body?.model_id || 'eleven_multilingual_v2';
      const languageCode = body?.language_code;
      const speed = body?.speed != null ? Number(body.speed) : undefined;
      const stability = body?.stability;
      const similarityBoost = body?.similarity_boost;
      const style = body?.style;
      const format = body?.format || 'mp3';
      const outputFormat = FORMAT_MAP[format] || 'mp3_44100_128';

      if (!text) {
        writeJson(res, 400, { ok: false, error: 'text_required' }, corsOrigin);
        return true;
      }

      // OpenRouter audio models (e.g. openai/gpt-audio) are served through
      // OpenRouter instead of ElevenLabs. The model id picks the provider;
      // ElevenLabs stays the default and an equally valid choice.
      if (isOpenRouterTtsModel(modelId)) {
        const tts = await synthesizeSpeechOpenRouter({
          model: modelId,
          text,
          voice: body?.voice || body?.voice_id,
          format,
        });

        if (userId) {
          try {
            await logUsageEvent(userId, null, tts.model, {
              totalTokens: 0,
              ...(tts.costUsd > 0 ? { costUsd: tts.costUsd } : {}),
              provider: 'openrouter',
              endpoint: '/tools/text_to_speech',
              textLength: text.length,
              source_label: 'Text to Speech',
              modelId: tts.model,
              format: tts.format,
            });
          } catch {}
        }

        writeJson(res, 200, {
          ok: true,
          audioData: tts.audioBuffer.toString('base64'),
          format: tts.format,
          voice_id: voiceId,
          model_id: tts.model,
          textLength: text.length,
          transcript: tts.transcript,
          mimeType: tts.mimeType,
        }, corsOrigin);
        return true;
      }

      const client = getElevenLabsClient();

      const voiceSettings: Record<string, any> = {};
      if (speed !== undefined && speed !== 1.0) voiceSettings.speed = speed;
      if (stability !== undefined) voiceSettings.stability = stability;
      if (similarityBoost !== undefined) voiceSettings.similarity_boost = similarityBoost;
      if (style !== undefined) voiceSettings.style = style;

      const requestParams: Record<string, any> = {
        text,
        modelId,
        outputFormat,
      };
      if (languageCode) requestParams.languageCode = languageCode;
      if (Object.keys(voiceSettings).length > 0) {
        requestParams.voiceSettings = voiceSettings;
      }

      const audioStream = await client.textToSpeech.convert(voiceId, requestParams as any);
      const audioBuffer = await streamToBuffer(audioStream);
      const audioBase64 = audioBuffer.toString('base64');

      if (userId) {
        const costUsd = estimateTtsCostUsd(text.length);
        try {
          await logUsageEvent(userId, null, TTS_USAGE_MODEL, {
            totalTokens: 0,
            costUsd,
            provider: 'elevenlabs',
            endpoint: '/tools/text_to_speech',
            textLength: text.length,
            source_label: 'Text to Speech',
            voiceId,
            modelId,
            format,
          });
        } catch {}
      }

      writeJson(res, 200, {
        ok: true,
        audioData: audioBase64,
        format,
        voice_id: voiceId,
        model_id: modelId,
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

  if ((req.method === 'POST' || req.method === 'GET') && path === '/tools/list_tts_voices') {
    try {
      const client = getElevenLabsClient();
      const voicesResponse = await client.voices.search();
      const voices = (voicesResponse.voices || []).map((v: any) => ({
        id: v.voice_id,
        name: v.name,
        description: v.description || `Voice: ${v.name}`,
        labels: v.labels,
      }));
      writeJson(res, 200, { ok: true, voices }, corsOrigin);
    } catch (e: any) {
      console.error('[tools] list_tts_voices error:', e);
      const fallbackVoices = [
        { id: DEFAULT_VOICE_ID, name: 'Default Voice', description: 'Default ElevenLabs voice' },
      ];
      writeJson(res, 200, { ok: true, voices: fallbackVoices }, corsOrigin);
    }
    return true;
  }

  if ((req.method === 'POST' || req.method === 'GET') && path === '/tools/get_tts_models') {
    try {
      const client = getElevenLabsClient();
      const modelsResponse = await client.models.list();
      const models = (modelsResponse || [])
        .filter((m: any) => m.can_do_text_to_speech)
        .map((m: any) => ({
          id: m.model_id,
          name: m.name,
          description: m.description || `Model: ${m.name}`,
        }));
      writeJson(res, 200, { ok: true, models }, corsOrigin);
    } catch (e: any) {
      const fallbackModels = [
        { id: 'eleven_multilingual_v2', name: 'Multilingual v2', description: 'Best for multiple languages' },
        { id: 'eleven_turbo_v2_5', name: 'Turbo v2.5', description: 'Fast, good quality' },
        { id: 'eleven_monolingual_v1', name: 'Monolingual v1', description: 'High quality English' },
      ];
      writeJson(res, 200, { ok: true, models: fallbackModels }, corsOrigin);
    }
    return true;
  }

  const toolMatch = path.match(/^\/tools\/([a-zA-Z0-9_-]+)$/);
  if (req.method === 'POST' && toolMatch) {
    const toolName = toolMatch[1];

    if (toolName === 'text_to_speech' || toolName === 'list_tts_voices' || toolName === 'get_tts_models') {
      return false;
    }

    try {
      initToolRegistry();

      const registry = getToolRegistry();
      const tool = registry.get(toolName);

      if (!tool) {
        writeJson(res, 404, { ok: false, error: 'unknown_tool', message: `Tool '${toolName}' not found in registry` }, corsOrigin);
        return true;
      }

      const body = await readJsonBody(req);

      const auth = req.headers.authorization || '';
      const vmUserIdHeader = req.headers['x-vm-user-id'] as string | undefined;
      let userId: string | null = null;

      if (vmUserIdHeader) {
        // VM HMAC auth — no Supabase JWT needed; verified against per-VM secret in DB
        try {
          const vmAuth = await verifyVMAuthFromRequest(auth, vmUserIdHeader);
          userId = vmAuth?.userId || null;
        } catch {}
      } else {
        // Standard Supabase JWT auth
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (token) {
          try {
            const authed = await verifyToken(token);
            userId = authed?.userId || null;
          } catch {}
        }
      }

      const isPublicTool = PUBLIC_TOOLS_ALLOWLIST.has(toolName);
      if (REQUIRE_TOOL_AUTH && !isPublicTool && !userId) {
        writeJson(res, 401, { ok: false, error: 'unauthorized', message: 'Authentication required for this tool' }, corsOrigin);
        return true;
      }

      // Check credits before executing paid tools
      if (userId) {
        try {
          const access = await checkAccess(userId);
          if (!access.allowed) {
            writeJson(res, 403, { ok: false, error: access.reason || 'credit_limit_exceeded' }, corsOrigin);
            return true;
          }
        } catch {}
      }

      const secrets = userId ? { userId } : {};
      console.log(`[tools] Executing ${toolName} (args: ${JSON.stringify(body).length} bytes, userId: ${userId || 'anonymous'})`);

      const result = await runWithSecrets(secrets, async () => {
        if (typeof tool.execute !== 'function') {
          throw new Error(`Tool '${toolName}' is not executable`);
        }
        const toolArgs = (
          body &&
          typeof body === 'object' &&
          !Array.isArray(body) &&
          Object.keys(body).length === 1 &&
          Object.prototype.hasOwnProperty.call(body, 'context')
        )
          ? (body as any).context
          : body;
        return await tool.execute(toolArgs as any, {} as any);
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