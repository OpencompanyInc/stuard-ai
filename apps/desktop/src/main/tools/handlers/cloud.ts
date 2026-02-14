import * as fs from 'fs';
import * as path from 'path';
import { net } from 'electron';
import WebSocket from 'ws';
import { RouterContext } from '../types';
import { TOOL_REGISTRY } from '../registry';

/**
 * Execute a tool via Cloud AI HTTP endpoint
 */
export async function execCloudTool(tool: string, args: any, ctx: RouterContext): Promise<any> {
  try {
    const entry = TOOL_REGISTRY[tool];
    let endpoint = entry?.handler || `/tools/${tool}`;
    
    // Special handling for analyze_media - need to read files and convert to base64
    if (tool === 'analyze_media') {
      return execAnalyzeMedia(args, ctx);
    }
    
    // Special handling for text_to_speech - cloud returns base64, we save/play locally
    if (tool === 'text_to_speech') {
      return execTextToSpeech(args, ctx);
    }
    
    const url = `${ctx.cloudAiUrl}${endpoint}`;

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
      const resp = await net.fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(args),
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
        return nested;
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
  let wsUrl = ctx.cloudAiUrl.replace(/\/+$/, '');
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

      // Ignore handshake and other messages
    });
  });
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
      const filePath = String(src?.path || '').trim();
      ctx.logFn(`analyze_media: checking path="${filePath}"`);
      if (!filePath) continue;
      
      const ext = filePath.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
      const mimeMap: Record<string, string> = {
        mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
        mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
      };
      const mimeType = src?.mimeType || mimeMap[ext] || 'application/octet-stream';
      
      try {
        const buf = fs.readFileSync(filePath);
        const data = buf.toString('base64');
        mediaParts.push({ data, mimeType });
        ctx.logFn(`analyze_media: Loaded ${path.basename(filePath)} (${mimeType}, ${Math.round(buf.length / 1024)}KB)`);
      } catch (e: any) {
        ctx.logFn(`analyze_media: Failed to read ${filePath}: ${e?.message}`);
        return { ok: false, error: `read_file_failed: ${filePath}` };
      }
    }
    
    if (mediaParts.length === 0) {
      return { ok: false, error: 'no_valid_media_files' };
    }
    
    const url = `${ctx.cloudAiUrl}/inference/ai/analyze-media`;
    ctx.logFn(`analyze_media: Calling Gemini...`);
    
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ctx.accessToken) {
      headers['Authorization'] = `Bearer ${ctx.accessToken}`;
    }
    
    const resp = await net.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ task, media: mediaParts }),
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
 * Special handler for text_to_speech - cloud generates audio, we save/play locally
 */
async function execTextToSpeech(args: any, ctx: RouterContext): Promise<any> {
  const { execTool } = await import('../index');

  try {
    const text = String(args?.text || '').trim();
    const voice = args?.voice || 'alloy';
    const speed = Number(args?.speed || 1.0);
    const format = args?.format || 'mp3';
    const save = args?.save !== false;
    const play = args?.play === true;
    const outputPath = args?.outputPath;
    
    if (!text) {
      return { ok: false, error: 'text_required' };
    }
    
    ctx.logFn(`TTS: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}" (voice=${voice})`);
    
    // Call cloud to generate audio
    const url = `${ctx.cloudAiUrl}/tools/text_to_speech`;
    const ttsHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ctx.accessToken) {
      ttsHeaders['Authorization'] = `Bearer ${ctx.accessToken}`;
    }
    const resp = await net.fetch(url, {
      method: 'POST',
      headers: ttsHeaders,
      body: JSON.stringify({ text, voice, speed, format }),
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
      const { tmpdir } = await import('os');
      const { join } = await import('path');
      const { writeFile, mkdir } = await import('fs/promises');
      
      const fileName = `tts_${randomUUID().slice(0, 8)}.${format}`;
      const ttsDir = join(tmpdir(), 'stuard-tts');
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
        const playResult = await execTool('play_audio', {
          path: filePath,
          block: true,
        }, ctx);
        
        if (playResult?.ok) {
          played = true;
          ctx.logFn(`TTS: Playback complete (${playResult.method || 'unknown'})`);
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
      voice,
      textLength: text.length,
      played,
    };
  } catch (e: any) {
    ctx.logFn(`TTS error: ${e?.message}`);
    return { ok: false, error: String(e?.message || 'tts_failed') };
  }
}

