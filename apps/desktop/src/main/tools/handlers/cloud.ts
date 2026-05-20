import * as fs from 'fs';
import * as path from 'path';
import { net } from 'electron';
import WebSocket from 'ws';
import { RouterContext } from '../types';
import { TOOL_REGISTRY } from '../registry';
import { resolveRedactedFilePath } from './redacted-path';
import { getMediaLibrarySourceDir } from '../../services/media-library';

const DEFAULT_CLOUD_AI_URL = 'http://localhost:8082';

function getCloudAiUrl(ctx: RouterContext): string {
  return String(ctx.cloudAiUrl || DEFAULT_CLOUD_AI_URL).trim().replace(/\/+$/, '') || DEFAULT_CLOUD_AI_URL;
}

/**
 * Execute a tool via Cloud AI HTTP endpoint
 */
export async function execCloudTool(tool: string, args: any, ctx: RouterContext): Promise<any> {
  try {
    const entry = TOOL_REGISTRY[tool];
    let endpoint = entry?.handler || `/tools/${tool}`;
    
    // Special handling for image-based vision tools - need local file reads / screenshot capture
    if (tool === 'analyze_image') {
      return execAnalyzeImage(args, ctx);
    }
    if (tool === 'analyze_current_screen') {
      return execAnalyzeCurrentScreen(args, ctx);
    }
    if (tool === 'cloud_ai_vision') {
      return execCloudAiVision(args, ctx);
    }

    // Special handling for analyze_media - need to read files and convert to base64
    if (tool === 'analyze_media') {
      return execAnalyzeMedia(args, ctx);
    }

    // Special handling for ai_inference with media sources -
    // reads local files as base64 and forwards to the Mastra tool endpoint
    // (the legacy /inference/ai/text route is text-only and ignores sources/model)
    if (tool === 'ai_inference') {
      return execAiInference(args, ctx);
    }
    
    // Special handling for text_to_speech - cloud returns base64, we save/play locally
    if (tool === 'text_to_speech') {
      return execTextToSpeech(args, ctx);
    }

    // Special handling for generate_image - cloud returns base64, we save locally
    if (tool === 'generate_image') {
      return execGenerateImage(args, ctx);
    }

    // Special handling for cloud_storage_upload - read local file, stream to cloud
    if (tool === 'cloud_storage_upload') {
      return execCloudStorageUpload(args, ctx);
    }
    
    const cloudAiUrl = getCloudAiUrl(ctx);
    const url = `${cloudAiUrl}${endpoint}`;

    // Agent tools use the bridged WS path so they can call local tools
    const isAgentTool = tool === 'agent_node' || tool === 'agent_decision' || tool === 'agent_extract';
    if (isAgentTool) {
      return execAgentToolBridged(tool, args, ctx);
    }

    ctx.logFn(`Cloud AI: ${tool}`);

    // Build headers with optional auth token
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ctx.accessToken) {
      headers['Authorization'] = `Bearer ${ctx.accessToken}`;
    }

    const controller = new AbortController();
    const timeoutMs = 120000; // 2 min default for cloud tools
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const bodyPayload = ctx.sourceLabel ? { ...args, source_label: ctx.sourceLabel } : args;
      const resp = await net.fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload),
        signal: controller.signal as any,
      });
      
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return { ok: false, error: `cloud_error_${resp.status}: ${errText}` };
      }
      
      const result = await resp.json();

      // Backward-compat for generic /tools route response shape: { ok: true, result: <toolResult> }
      const nested = result?.result;
      if (result?.ok === true && nested && typeof nested === 'object') {
        if ((nested as any).ok === false) return nested;
        if ((nested as any).validationErrors) {
          return {
            ok: false,
            error: (nested as any).message || (nested as any).error || 'validation_failed',
            validationErrors: (nested as any).validationErrors,
          };
        }
        // Preserve ok: true when unwrapping — tools like web_search return
        // { results: [...] } without an ok field, and the workflow engine
        // treats missing ok as failure.
        return { ok: true, ...nested };
      }

      return { ok: true, ...result };
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    ctx.logFn(`Cloud AI error: ${e?.message}`);
    return { ok: false, error: String(e?.message || 'cloud_failed') };
  }
}

/**
 * Execute agent tools (agent_node, agent_decision, agent_extract) via a temporary
 * WebSocket bridge to the cloud. This allows the cloud-side agent to relay
 * tool_request messages back to the desktop for local tool execution.
 */
async function execAgentToolBridged(tool: string, args: any, ctx: RouterContext): Promise<any> {
  const model = args?.model || 'balanced';
  const mode = args?.outputMode || '';
  ctx.logFn(`🤖 AI Agent: ${tool} (model=${model}${mode ? ', mode=' + mode : ''})`);

  // Convert HTTP URL to WS URL
  let wsUrl = getCloudAiUrl(ctx);
  if (wsUrl.startsWith('https://')) wsUrl = 'wss://' + wsUrl.slice('https://'.length);
  else if (wsUrl.startsWith('http://')) wsUrl = 'ws://' + wsUrl.slice('http://'.length);
  wsUrl += '/ws';

  const reqId = `bridged-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const totalTimeoutMs = Math.max(Number(args?.timeoutMs || 0), 300000) + 60000; // tool timeout + 60s buffer

  return new Promise<any>((resolve) => {
    let done = false;
    const finish = (result: any) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(connectTimeout);
      try { ws.removeAllListeners(); } catch {}
      try { ws.close(); } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      ctx.logFn(`✗ Agent timed out after ${totalTimeoutMs / 1000}s`);
      finish({ ok: false, error: 'agent_timeout' });
    }, totalTimeoutMs);

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e: any) {
      clearTimeout(timer);
      ctx.logFn(`✗ Agent WS connect failed: ${e?.message}`);
      resolve({ ok: false, error: `ws_connect_failed: ${e?.message}` });
      return;
    }

    const connectTimeout = setTimeout(() => {
      if (!done) {
        ctx.logFn(`✗ Agent WS connect timed out`);
        finish({ ok: false, error: 'ws_connect_timeout' });
      }
    }, 15000);

    ws.on('error', (e: Error) => {
      clearTimeout(connectTimeout);
      ctx.logFn(`✗ Agent WS error: ${e?.message}`);
      finish({ ok: false, error: `ws_error: ${e?.message}` });
    });

    ws.on('close', () => {
      clearTimeout(connectTimeout);
      if (!done) {
        finish({ ok: false, error: 'ws_closed_unexpectedly' });
      }
    });

    ws.on('open', () => {
      clearTimeout(connectTimeout);
      // Send the bridged tool execution request
      try {
        ws.send(JSON.stringify({
          type: 'exec_tool_bridged',
          id: reqId,
          tool,
          args,
          auth: ctx.accessToken ? { accessToken: ctx.accessToken } : undefined,
        }));
      } catch (e: any) {
        finish({ ok: false, error: `ws_send_failed: ${e?.message}` });
      }
    });

    ws.on('message', async (buf: WebSocket.RawData) => {
      let msg: any;
      try {
        msg = JSON.parse(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf));
      } catch { return; }

      const type = String(msg?.type || '').toLowerCase();

      // Cloud agent wants to execute a local tool — relay it
      if (type === 'tool_request') {
        const toolReqId = String(msg?.id || '');
        const reqTool = String(msg?.tool || '').trim();
        const reqArgs = msg?.args || {};

        if (!reqTool || !toolReqId) return;

        ctx.logFn(`  ↳ Agent calling: ${reqTool}`);
        try {
          const { execTool } = await import('../index');
          const result = await execTool(reqTool, reqArgs, ctx);
          // Send result back to cloud
          try {
            ws.send(JSON.stringify({ type: 'tool_result', id: toolReqId, result }));
          } catch {}
        } catch (e: any) {
          try {
            ws.send(JSON.stringify({ type: 'tool_result', id: toolReqId, result: { ok: false, error: e?.message || 'local_exec_failed' } }));
          } catch {}
        }
        return;
      }

      // Final result from the bridged tool execution
      if (type === 'exec_tool_bridged_result' && String(msg?.id || '') === reqId) {
        const result = msg?.result || { ok: false, error: 'empty_result' };
        const dur = result?.durationMs ? `${(result.durationMs / 1000).toFixed(1)}s` : '';
        const calls = result?.toolCalls ? `, ${result.toolCalls} tool calls` : '';
        if (result?.ok !== false) {
          ctx.logFn(`✓ Agent done${dur ? ' in ' + dur : ''}${calls}`);
        } else {
          ctx.logFn(`✗ Agent failed: ${result?.error || 'unknown'}`);
        }
        finish(result);
        return;
      }

      // Relay subagent protocol messages to renderer
      if (type === 'subagent_event' || type === 'subagent_question' || type === 'subagent_answer' || type === 'subagent_complete') {
        try {
          const { BrowserWindow } = require('electron');
          for (const win of BrowserWindow.getAllWindows()) {
            try { win.webContents.send('subagent:message', msg); } catch {}
          }
        } catch {}
        return;
      }

      // Ignore handshake and other messages
    });
  });
}

/**
 * Shared MIME sniffing for local media/image paths.
 */
function inferMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  const mimeMap: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    tif: 'image/tiff',
    tiff: 'image/tiff',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * Read a local image file as base64 for cloud vision endpoints.
 */
function readImageAsBase64(filePath: string): { ok: true; data: string; mimeType: string } | { ok: false; error: string } {
  const resolvedPath = String(filePath || '').trim();
  if (!resolvedPath) return { ok: false, error: 'missing_image_path' };

  try {
    const buf = fs.readFileSync(resolvedPath);
    return {
      ok: true,
      data: buf.toString('base64'),
      mimeType: inferMimeType(resolvedPath),
    };
  } catch {
    return { ok: false, error: `read_image_failed: ${resolvedPath}` };
  }
}

/**
 * Special handler for analyze_image - reads a local image and sends it via multimodal analyze-media.
 */
async function execAnalyzeImage(args: any, ctx: RouterContext): Promise<any> {
  const imagePath = String(args?.imagePath || args?.path || args?.filePath || '').trim();
  const prompt = String(args?.prompt || 'Analyze this image and describe what is important.').trim();

  if (!imagePath) {
    return { ok: false, error: 'missing_image_path' };
  }

  const result = await execAnalyzeMedia(
    {
      task: prompt,
      mode: args?.mode,
      sources: [
        {
          path: imagePath,
          mimeType: args?.mimeType || inferMimeType(imagePath),
        },
      ],
    },
    ctx,
  );

  if (!result?.ok) return result;
  return {
    ok: true,
    text: String(result?.summary || result?.text || ''),
    summary: String(result?.summary || result?.text || ''),
    filePath: imagePath,
    ...result,
  };
}

/**
 * Structured AI vision helper for workflow tools that expect JSON output.
 */
async function execCloudAiVision(args: any, ctx: RouterContext): Promise<any> {
  try {
    const prompt = String(args?.prompt || '').trim() || 'Analyze the image and return structured results.';
    const imagePath = String(args?.imagePath || args?.path || args?.filePath || '').trim();
    const schema = args?.schema;

    if (!imagePath) return { ok: false, error: 'missing_image_path' };
    if (!schema || typeof schema !== 'object') return { ok: false, error: 'missing_schema' };

    const image = readImageAsBase64(imagePath);
    if (!image.ok) return image;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ctx.accessToken) {
      headers.Authorization = `Bearer ${ctx.accessToken}`;
    }

    const resp = await net.fetch(`${getCloudAiUrl(ctx)}/inference/ai/vision-structured`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        imageB64: image.data,
        mimeType: args?.mimeType || image.mimeType || 'image/jpeg',
        schema,
        ...(ctx.sourceLabel ? { source_label: ctx.sourceLabel } : {}),
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `cloud_error_${resp.status}: ${errText}` };
    }

    const result: any = await resp.json().catch(() => ({}));
    const object = result?.object;
    const text = typeof object?.summary === 'string' ? object.summary : JSON.stringify(object || {});
    return {
      ok: true,
      object,
      json: object,
      text,
      filePath: imagePath,
      ...result,
    };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'cloud_ai_vision_failed') };
  }
}

/**
 * Special handler for analyze_current_screen - captures locally, then routes through structured vision.
 */
async function execAnalyzeCurrentScreen(args: any, ctx: RouterContext): Promise<any> {
  try {
    const { execLocalTool } = await import('./local');
    const shot = await execLocalTool('take_screenshot', {}, ctx, 60000);
    const filePath = String(shot?.filePath || shot?.path || '').trim();
    if (!filePath) {
      return { ok: false, error: 'screenshot_failed' };
    }

    const mode = String(args?.mode || 'text').trim().toLowerCase();
    const booleanKey = String(args?.booleanKey || 'value').trim() || 'value';
    const schema = args?.schema && typeof args.schema === 'object'
      ? args.schema
      : mode === 'boolean' || mode === 'bool'
        ? {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              [booleanKey]: { type: 'boolean' },
            },
          }
        : {
            type: 'object',
            properties: {
              summary: { type: 'string' },
            },
          };

    const result = await execCloudAiVision(
      {
        ...args,
        imagePath: filePath,
        schema,
      },
      ctx,
    );

    if (!result?.ok) return result;

    const object = result?.object || result?.json || {};
    const text = typeof object?.summary === 'string' ? object.summary : String(result?.text || '');
    const booleanValue = typeof object?.[booleanKey] === 'boolean'
      ? object[booleanKey]
      : typeof object?.value === 'boolean'
        ? object.value
        : undefined;

    return {
      ...result,
      filePath,
      json: object,
      text,
      ...(booleanValue !== undefined ? { boolean: booleanValue, [booleanKey]: booleanValue } : {}),
    };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'analyze_current_screen_failed') };
  }
}

/**
 * Special handler for analyze_media - reads local files and sends to cloud
 */
async function execAnalyzeMedia(args: any, ctx: RouterContext): Promise<any> {
  try {
    const sources = Array.isArray(args?.sources) ? args.sources : [];
    const task = String(args?.task || 'Transcribe or analyze this media.');
    
    ctx.logFn(`analyze_media: sources=${JSON.stringify(sources)}`);
    
    if (sources.length === 0) {
      return { ok: false, error: 'no_sources_provided' };
    }
    
    const mediaParts: Array<{ data: string; mimeType: string }> = [];
    
    for (const src of sources) {
      const requestedPath = String(src?.path || '').trim();
      const recoveredPath = resolveRedactedFilePath(requestedPath);
      const filePath = recoveredPath.path;
      const logPath = recoveredPath.recovered ? requestedPath : filePath;
      ctx.logFn(`analyze_media: checking path="${logPath}"${recoveredPath.recovered ? ' (recovered local file)' : ''}`);
      if (!filePath) continue;
      
      const mimeType = src?.mimeType || inferMimeType(filePath);
      
      try {
        const buf = fs.readFileSync(filePath);
        const data = buf.toString('base64');
        mediaParts.push({ data, mimeType });
        ctx.logFn(`analyze_media: Loaded ${recoveredPath.recovered ? 'recovered media file' : path.basename(filePath)} (${mimeType}, ${Math.round(buf.length / 1024)}KB)`);
      } catch (e: any) {
        ctx.logFn(`analyze_media: Failed to read ${logPath}: ${e?.message}`);
        return { ok: false, error: `read_file_failed: ${logPath}` };
      }
    }
    
    if (mediaParts.length === 0) {
      return { ok: false, error: 'no_valid_media_files' };
    }
    
    const url = `${getCloudAiUrl(ctx)}/inference/ai/analyze-media`;
    ctx.logFn(`analyze_media: Calling Gemini...`);
    
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ctx.accessToken) {
      headers['Authorization'] = `Bearer ${ctx.accessToken}`;
    }
    
    const modeModel = args?.mode === 'detailed' ? 'gemini-3.1-pro-preview' : '';
    const model = args?.mode === 'custom' ? (args?.model || '') : (args?.model || modeModel);
    const resp = await net.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ task, media: mediaParts, model, ...(ctx.sourceLabel ? { source_label: ctx.sourceLabel } : {}) }),
    });
    
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      ctx.logFn(`analyze_media: Cloud error ${resp.status}`);
      return { ok: false, error: `cloud_error_${resp.status}: ${errText}` };
    }
    
    const result: any = await resp.json();
    ctx.logFn(`analyze_media: Done, summary=${result?.summary?.length || 0} chars`);
    return { ok: true, summary: result?.summary || result?.text || '', ...result };
  } catch (e: any) {
    ctx.logFn(`analyze_media: Error: ${e?.message}`);
    return { ok: false, error: String(e?.message || 'analyze_media_failed') };
  }
}

/**
 * Special handler for ai_inference — reads local media from sources[].path,
 * encodes them as base64 into sources[].data, then POSTs the full payload to
 * the cloud Mastra tool at /tools/ai_inference.
 *
 * This replaces the legacy /inference/ai/text route, which was text-only and
 * ignored sources, model selection, system prompts, streaming, etc.
 */
async function execAiInference(args: any, ctx: RouterContext): Promise<any> {
  try {
    const sources = Array.isArray(args?.sources) ? args.sources : [];
    const modelId = String(args?.model || 'openai/gpt-4.1-mini');

    ctx.logFn(`ai_inference: model=${modelId}, sources=${sources.length}`);

    // Pre-load local file paths into base64 data so the cloud tool doesn't
    // need a bridge connection to read desktop files.
    const enrichedSources: any[] = [];

    for (const src of sources) {
      const requestedPath = String(src?.path || '').trim();

      // Non-file sources (URL, data, captureScreen) pass through as-is
      if (!requestedPath) {
        enrichedSources.push(src);
        continue;
      }

      const recoveredPath = resolveRedactedFilePath(requestedPath);
      const filePath = recoveredPath.path;

      if (!filePath) {
        ctx.logFn(`ai_inference: skipping empty path`);
        continue;
      }

      let mimeType = src?.mimeType || inferMimeType(filePath);
      let actualPath = filePath;
      let convertedTempPath: string | null = null;

      // OpenRouter only supports audio/mpeg (mp3) and audio/wav.
      // If we have an incompatible audio format, convert via local ffmpeg first.
      const isOpenRouter = modelId.startsWith('openrouter/');
      const isAudio = mimeType.startsWith('audio/');
      const OPENROUTER_AUDIO_OK = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav']);
      const isAudioCompatible = OPENROUTER_AUDIO_OK.has(mimeType);

      if (isOpenRouter && isAudio && !isAudioCompatible) {
        ctx.logFn(`ai_inference: converting ${path.basename(filePath)} (${mimeType}) → MP3 for OpenRouter`);
        const mp3Path = filePath.replace(/\.[^.]+$/, '_openrouter.mp3');
        try {
          const { execLocalTool: execLocal } = await import('./local');
          const convertResult = await execLocal('ffmpeg_convert_media', {
            inputPath: filePath,
            outputPath: mp3Path,
            overwrite: true,
          }, ctx, 120_000);
          if (convertResult?.ok) {
            actualPath = mp3Path;
            mimeType = 'audio/mpeg';
            convertedTempPath = mp3Path;
            ctx.logFn(`ai_inference: converted to MP3 → ${path.basename(mp3Path)}`);
          } else {
            ctx.logFn(`ai_inference: ffmpeg convert failed: ${convertResult?.error || 'unknown'}`);
            // Fall through — send the original, cloud will attempt its own conversion
          }
        } catch (e: any) {
          ctx.logFn(`ai_inference: ffmpeg convert error: ${e?.message}`);
        }
      }

      // Normalize mp3 alias for OpenRouter
      if (isOpenRouter && mimeType === 'audio/mp3') {
        mimeType = 'audio/mpeg';
      }

      try {
        const buf = fs.readFileSync(actualPath);
        const data = buf.toString('base64');
        enrichedSources.push({
          data,
          mimeType,
          // Drop path — cloud can't access it anyway
        });
        ctx.logFn(`ai_inference: loaded ${path.basename(actualPath)} (${mimeType}, ${Math.round(buf.length / 1024)}KB)`);
      } catch (e: any) {
        ctx.logFn(`ai_inference: failed to read ${actualPath}: ${e?.message}`);
        return { ok: false, error: `read_file_failed: ${actualPath}` };
      }

      // Clean up temporary converted file
      if (convertedTempPath) {
        try { fs.unlinkSync(convertedTempPath); } catch {}
      }
    }

    // Build the full payload for the Mastra tool
    const payload: any = {
      ...args,
      sources: enrichedSources.length > 0 ? enrichedSources : undefined,
    };

    const url = `${getCloudAiUrl(ctx)}/tools/ai_inference`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ctx.accessToken) {
      headers['Authorization'] = `Bearer ${ctx.accessToken}`;
    }

    const controller = new AbortController();
    const timeoutMs = 180_000; // 3 min for media inference
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const bodyPayload = ctx.sourceLabel ? { ...payload, source_label: ctx.sourceLabel } : payload;
      const resp = await net.fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload),
        signal: controller.signal as any,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return { ok: false, error: `cloud_error_${resp.status}: ${errText}` };
      }

      const result: any = await resp.json();
      const nested = result?.result;
      if (result?.ok === true && nested && typeof nested === 'object') {
        if ((nested as any).ok === false) return nested;
        return { ok: true, ...nested };
      }
      return { ok: true, ...result };
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    ctx.logFn(`ai_inference error: ${e?.message}`);
    return { ok: false, error: String(e?.message || 'ai_inference_failed') };
  }
}

/**
 * Special handler for text_to_speech - cloud generates audio, we save/play locally
 */
async function execTextToSpeech(args: any, ctx: RouterContext): Promise<any> {
  const { execTool } = await import('../index');

  try {
    const text = String(args?.text || '').trim();
    const voiceId = args?.voice_id || args?.voice || 'JBFqnCBsd6RMkjVDRZzb';
    const modelId = args?.model_id || 'eleven_multilingual_v2';
    const languageCode = args?.language_code || '';
    const speed = args?.speed;
    const stability = args?.stability;
    const similarityBoost = args?.similarity_boost;
    const style = args?.style;
    const format = args?.format || 'mp3';
    const save = args?.save !== false;
    const play = args?.play === true;
    const outputPath = args?.outputPath;
    
    if (!text) {
      return { ok: false, error: 'text_required' };
    }
    
    ctx.logFn(`TTS: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}" (voice_id=${voiceId}, model=${modelId}${languageCode ? ', lang=' + languageCode : ''})`);
    
    // Call cloud to generate audio
    const url = `${getCloudAiUrl(ctx)}/tools/text_to_speech`;
    const ttsHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ctx.accessToken) {
      ttsHeaders['Authorization'] = `Bearer ${ctx.accessToken}`;
    }
    
    const requestBody: any = { text, voice_id: voiceId, model_id: modelId, format };
    if (languageCode) requestBody.language_code = languageCode;
    if (speed !== undefined) requestBody.speed = speed;
    if (stability !== undefined) requestBody.stability = stability;
    if (similarityBoost !== undefined) requestBody.similarity_boost = similarityBoost;
    if (style !== undefined) requestBody.style = style;
    
    const resp = await net.fetch(url, {
      method: 'POST',
      headers: ttsHeaders,
      body: JSON.stringify(requestBody),
    });
    
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `cloud_error_${resp.status}: ${errText}` };
    }
    
    const result: any = await resp.json();
    if (!result.ok || !result.audioData) {
      return { ok: false, error: result.error || 'no_audio_data' };
    }
    
    // Decode base64 audio
    const audioBuffer = Buffer.from(result.audioData, 'base64');
    let filePath: string | undefined;
    let played = false;
    
    // Save to file if requested
    if (save || play) {
      const { randomUUID } = await import('crypto');
      const { join } = await import('path');
      const { writeFile, mkdir } = await import('fs/promises');

      const fileName = `tts_${randomUUID().slice(0, 8)}.${format}`;
      const ttsDir = getMediaLibrarySourceDir('generated-audio');
      const targetPath = outputPath || join(ttsDir, fileName);
      filePath = targetPath;

      // Ensure directory exists
      try {
        await mkdir(ttsDir, { recursive: true });
      } catch {}
      
      // Write file
      await writeFile(targetPath, audioBuffer);
      ctx.logFn(`TTS: Saved to ${filePath}`);
    }
    
    // Play the audio if requested
    if (play && filePath) {
      try {
        ctx.logFn(`TTS: Playing audio...`);
        const playResult = await execTool('launch_application_or_uri', {
          target: filePath,
        }, ctx);
        
        if (playResult?.ok) {
          played = true;
          ctx.logFn(`TTS: Playback started`);
        } else {
          ctx.logFn(`TTS: Play failed: ${playResult?.error || 'unknown'}`);
        }
      } catch (e: any) {
        ctx.logFn(`TTS: Play failed: ${e?.message}`);
      }
    }
    
    return {
      ok: true,
      filePath: save ? filePath : undefined,
      format,
      voice_id: voiceId,
      model_id: modelId,
      textLength: text.length,
      played,
    };
  } catch (e: any) {
    ctx.logFn(`TTS error: ${e?.message}`);
    return { ok: false, error: String(e?.message || 'tts_failed') };
  }
}

/**
 * Special handler for generate_image - cloud generates image(s), we save locally
 */
async function execGenerateImage(args: any, ctx: RouterContext): Promise<any> {
  try {
    const prompt = String(args?.prompt || '').trim();
    const model = args?.model || 'gemini-3.1-flash-image-preview';
    const format = args?.format || 'png';

    if (!prompt) {
      return { ok: false, error: 'prompt_required' };
    }

    ctx.logFn(`Image Gen: "${prompt.slice(0, 60)}${prompt.length > 60 ? '...' : ''}" (model=${model})`);

    // Encode local input_images to base64 before sending to cloud
    // Cloud can't access local desktop file paths
    const cloudArgs = { ...args };
    if (Array.isArray(args.input_images) && args.input_images.length > 0) {
      const encodedImages: Array<{ path: string; filename?: string; contentType?: string; data?: string }> = [];
      for (const img of args.input_images) {
        const filePath = String(img?.path || '').trim();
        if (!filePath) continue;
        try {
          const buf = fs.readFileSync(filePath);
          const ext = path.extname(filePath).toLowerCase();
          const mimeMap: Record<string, string> = {
            '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif',
          };
          const mimeType = img.contentType || mimeMap[ext] || 'image/png';
          encodedImages.push({
            path: filePath,
            filename: img.filename || path.basename(filePath),
            contentType: mimeType,
            data: buf.toString('base64'),
          });
          ctx.logFn(`Image Gen: Encoded input ${path.basename(filePath)} (${mimeType}, ${Math.round(buf.length / 1024)}KB)`);
        } catch (e: any) {
          ctx.logFn(`Image Gen: Failed to read input image ${filePath}: ${e?.message}`);
          return { ok: false, error: `failed_to_read_input_image: ${filePath}` };
        }
      }
      cloudArgs.input_images = encodedImages;
    }

    // Call cloud to generate image
    const url = `${getCloudAiUrl(ctx)}/tools/generate_image`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ctx.accessToken) {
      headers['Authorization'] = `Bearer ${ctx.accessToken}`;
    }

    const resp = await net.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(cloudArgs),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `cloud_error_${resp.status}: ${errText}` };
    }

    const cloudResult: any = await resp.json();
    const result = cloudResult?.result || cloudResult;

    if (!result?.ok || !result?.images?.length) {
      return { ok: false, error: result?.error || 'no_images_generated' };
    }

    // Re-save images locally using _b64 from cloud, since cloud temp paths aren't accessible
    const { randomUUID } = await import('crypto');
    const { join } = await import('path');
    const { writeFile, mkdir } = await import('fs/promises');

    const imgDir = getMediaLibrarySourceDir('generated');
    try { await mkdir(imgDir, { recursive: true }); } catch {}

    const savedImages: Array<{ filePath: string; format: string; sizeBytes?: number; revisedPrompt?: string }> = [];

    for (const img of result.images) {
      const imgFormat = img.format || format;
      const ext = imgFormat === 'jpeg' ? 'jpg' : imgFormat;

      if (img._b64) {
        // Cloud provided base64 data — save locally
        const fileName = `img_${randomUUID().slice(0, 8)}.${ext}`;
        const filePath = join(imgDir, fileName);
        const buffer = Buffer.from(img._b64, 'base64');
        await writeFile(filePath, buffer);
        savedImages.push({
          filePath,
          format: imgFormat,
          sizeBytes: buffer.length,
          revisedPrompt: img.revisedPrompt,
        });
        ctx.logFn(`Image Gen: Saved ${filePath} (${Math.round(buffer.length / 1024)}KB)`);
      } else if (img.filePath) {
        // Cloud already saved, path is directly usable (same-machine / VM scenario)
        savedImages.push({
          filePath: img.filePath,
          format: imgFormat,
          sizeBytes: img.sizeBytes,
          revisedPrompt: img.revisedPrompt,
        });
        ctx.logFn(`Image Gen: Using ${img.filePath}`);
      }
    }

    return {
      ok: true,
      images: savedImages,
      model: result.model || model,
      provider: result.provider,
      prompt,
    };
  } catch (e: any) {
    ctx.logFn(`Image Gen error: ${e?.message}`);
    return { ok: false, error: String(e?.message || 'image_gen_failed') };
  }
}

/**
 * Special handler for cloud_storage_upload - reads local file, uploads via proxy endpoint,
 * then optionally sets visibility to public.
 */
async function execCloudStorageUpload(args: any, ctx: RouterContext): Promise<any> {
  try {
    const filePath = String(args?.path || '').trim();
    const folder = String(args?.folder || '').trim();
    const visibility = String(args?.visibility || 'private').trim();
    const filenameOverride = String(args?.filename || '').trim();

    if (!filePath) {
      return { ok: false, error: 'missing_path' };
    }

    ctx.logFn(`Cloud Storage: uploading ${path.basename(filePath)} (visibility=${visibility})`);

    // Read the local file
    let fileBuffer: Buffer;
    try {
      fileBuffer = fs.readFileSync(filePath);
    } catch (e: any) {
      ctx.logFn(`Cloud Storage: failed to read ${filePath}: ${e?.message}`);
      return { ok: false, error: `read_file_failed: ${filePath}` };
    }

    const filename = filenameOverride || path.basename(filePath);
    const ext = path.extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
      '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
      '.pdf': 'application/pdf', '.json': 'application/json', '.csv': 'text/csv',
      '.txt': 'text/plain', '.html': 'text/html', '.xml': 'text/xml', '.zip': 'application/zip',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';

    // Upload via proxy endpoint using JSON+base64 to avoid Electron net.fetch
    // binary body issues (net::ERR_INVALID_ARGUMENT with raw Uint8Array/Buffer)
    const uploadUrl = `${getCloudAiUrl(ctx)}/v1/cloud-storage/upload`;
    const uploadHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (ctx.accessToken) {
      uploadHeaders['Authorization'] = `Bearer ${ctx.accessToken}`;
    }

    const uploadResp = await net.fetch(uploadUrl, {
      method: 'POST',
      headers: uploadHeaders,
      body: JSON.stringify({
        filename,
        folder: folder || undefined,
        contentType,
        visibility,
        data: fileBuffer.toString('base64'),
      }),
    });

    if (!uploadResp.ok) {
      const errText = await uploadResp.text().catch(() => '');
      return { ok: false, error: `upload_failed_${uploadResp.status}: ${errText}` };
    }

    const uploadResult: any = await uploadResp.json();
    if (!uploadResult?.ok) {
      return { ok: false, error: uploadResult?.error || 'upload_failed' };
    }

    const objectName = String(uploadResult.objectName || '');
    const url = String(uploadResult.url || '');

    ctx.logFn(`Cloud Storage: uploaded ${objectName} (${Math.round(fileBuffer.length / 1024)}KB, ${visibility})`);

    return {
      ok: true,
      objectName,
      url,
      visibility,
      bytesWritten: fileBuffer.length,
      contentType,
    };
  } catch (e: any) {
    ctx.logFn(`Cloud Storage error: ${e?.message}`);
    return { ok: false, error: String(e?.message || 'cloud_storage_upload_failed') };
  }
}
