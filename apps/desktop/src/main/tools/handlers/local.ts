import WebSocket from 'ws';
import { RouterContext } from '../types';

// WebSocket connection pool for Python agent
let agentWs: WebSocket | null = null;
let agentReady: Promise<WebSocket> | null = null;

function ensureAgentWs(url: string): Promise<WebSocket> {
  if (agentWs && agentWs.readyState === WebSocket.OPEN) return Promise.resolve(agentWs);
  if (agentReady) return agentReady;
  
  agentReady = new Promise<WebSocket>((resolve, reject) => {
    try {
      const ws = new WebSocket(url);
      const timeout = setTimeout(() => {
        try { ws.terminate(); } catch {}
        reject(new Error('agent_ws_timeout'));
      }, 10000);
      
      ws.on('open', () => {
        clearTimeout(timeout);
        agentWs = ws;
        resolve(ws);
      });
      ws.on('error', (e: Error) => {
        clearTimeout(timeout);
        reject(e);
      });
      ws.on('close', () => {
        agentWs = null;
        agentReady = null;
      });
    } catch (e) {
      reject(e as any);
    }
  });
  
  return agentReady;
}

/**
 * Execute a tool via the Python agent WebSocket
 */
export async function execLocalTool(tool: string, args: any, ctx: RouterContext, timeoutMs?: number): Promise<any> {
  const ws = await ensureAgentWs(ctx.agentWsUrl);
  const id = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = { type: 'tool_exec', id, tool, args };
  
  // Calculate timeout - longer for scripts with packages
  let effectiveTimeout = timeoutMs || 60000;
  if (tool === 'run_python_script' || tool === 'python_install') {
    const packages = args?.packages;
    if (Array.isArray(packages) && packages.length > 0) {
      // Add 60s per package for installation
      effectiveTimeout = Math.max(effectiveTimeout, 60000 + packages.length * 60000);
    }
  }
  
  // For long-running tools, use a keep-alive timeout pattern:
  // - Initial timeout is the full effectiveTimeout
  // - When progress events are received, reset to a shorter keep-alive timeout
  // - This prevents premature timeouts while still detecting dead connections
  const KEEPALIVE_TIMEOUT = 120000; // 2 minutes between progress events
  const isLongRunning = effectiveTimeout > 300000; // > 5 minutes
  
  return new Promise((resolve) => {
    let done = false;
    let timeoutId: NodeJS.Timeout | undefined;
    let lastMediaToolsPercent = -1;
    
const resetTimeout = (ms: number) => {
      if (done) return;
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (done) return;
        done = true;
        ws.off('message', onMessage);
        resolve({ ok: false, error: 'timeout' });
      }, ms);
    };
    
    // Start with the full timeout
    resetTimeout(effectiveTimeout);
    
    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString('utf8'));
        const t = String(msg?.type || '').toLowerCase();
        
        if (t === 'tool_event' && String(msg?.id || '') === id) {
          const status = String(msg?.status || '');
          // Handle both patterns: nested { data: {...} } and flat { key: value }
          const data = msg?.data || msg || {};
          
          // For long-running tools, receiving a progress event means the tool is alive
          // Reset to keep-alive timeout to prevent premature timeout
          if (isLongRunning && status && status !== 'approval_required') {
            resetTimeout(KEEPALIVE_TIMEOUT);
          }
          
          // Log progress events for visibility
          if (status === 'creating_env') {
            ctx.logFn(`🔧 Creating Python environment: ${data.envId || 'unknown'}`);
          } else if (status === 'env_created') {
            ctx.logFn(`✓ Environment created: ${data.envId || 'unknown'}`);
          } else if (status === 'installing_pip') {
            ctx.logFn(`📦 Setting up pip...`);
          } else if (status === 'installing_packages') {
            ctx.logFn(`📦 Installing ${data.count || 0} package(s): ${(data.packages || []).join(', ')}`);
          } else if (status === 'installing_package') {
            ctx.logFn(`  ⏳ Installing ${data.package || '?'}...`);
          } else if (status === 'package_installed') {
            ctx.logFn(`  ✓ Installed ${data.package || '?'}`);
          } else if (status === 'package_install_warning') {
            ctx.logFn(`  ⚠ Failed to install ${data.package}: ${data.error || 'unknown'}`);
          } else if (status === 'packages_ready') {
            ctx.logFn(`✓ ${data.count || 0} package(s) ready`);
          } else if (status === 'executing') {
            ctx.logFn(`▶ Running script...`);
          } else if (status === 'completed') {
            ctx.logFn(`✓ Script completed`);
          } else if (status === 'script_error') {
            ctx.logFn(`❌ Script error (exit ${data.exitCode}): ${data.stderr || ''}`);
          } else if (status === 'timeout') {
            ctx.logFn(`⏱ Script timed out after ${data.timeoutMs}ms`);
          } else if (status === 'auto_env') {
            ctx.logFn(`📁 Auto-created environment: ${data.envId}`);
          } else if (status === 'recording') {
            // Log recording start
            const mode = data.mode || 'fixed';
            const dur = data.durationMs ? ` (${Math.round(data.durationMs / 60000)} min)` : '';
            ctx.logFn(`🎤 Recording started${dur} [${mode}]`);
          } else if (status === 'recording_progress') {
            // Periodic progress during long recordings (only log every 30 seconds)
            const elapsedMs = data.elapsedMs || 0;
            const elapsedSec = Math.floor(elapsedMs / 1000);
            if (elapsedSec % 30 === 0 && elapsedSec > 0) {
              const mins = Math.floor(elapsedSec / 60);
              const secs = elapsedSec % 60;
              ctx.logFn(`🎤 Recording... ${mins}:${secs.toString().padStart(2, '0')}`);
            }
          } else if (status === 'preparing') {
            ctx.logFn(`🎤 Preparing ${data.kind || 'media'} capture...`);
          } else if (status === 'media_tools_preparing') {
            ctx.logFn(`🧰 Preparing media tools...`);
          } else if (status === 'media_tools_downloading') {
            const p = Number((data as any)?.percent);
            if (Number.isFinite(p)) {
              const pi = Math.max(0, Math.min(100, Math.round(p)));
              if (pi !== lastMediaToolsPercent && (pi === 0 || pi === 100 || pi % 10 === 0)) {
                lastMediaToolsPercent = pi;
                ctx.logFn(`⬇ Downloading media tools... ${pi}%`);
              }
            } else {
              ctx.logFn(`⬇ Downloading media tools...`);
            }
          } else if (status === 'media_tools_installing') {
            ctx.logFn(`🧰 Installing media tools...`);
          } else if (status === 'media_tools_ready') {
            ctx.logFn(`✓ Media tools ready`);
          } else if (status === 'media_tools_error') {
            ctx.logFn(`❌ Media tools error: ${(data as any)?.error || 'unknown'}`);
          } else if (status === 'approval_required') {
            if (timeoutId) clearTimeout(timeoutId);
            ws.off('message', onMessage);
            if (!done) { done = true; resolve({ ok: false, error: 'approval_required' }); }
            return;
          } else if (status) {
            // Log other events for debugging
            ctx.logFn(`[${tool}] ${status}: ${JSON.stringify(data).slice(0, 100)}`);
          }
          return;
        }
        
        if (t === 'tool_result' && String(msg?.id || '') === id) {
          if (timeoutId) clearTimeout(timeoutId);
          ws.off('message', onMessage);
          if (!done) { done = true; resolve(msg?.result ?? { ok: false, error: 'invalid_result' }); }
          return;
        }
      } catch {}
    };
    
    ws.on('message', onMessage);
    try { 
      ws.send(JSON.stringify(payload)); 
    } catch {
      if (timeoutId) clearTimeout(timeoutId);
      ws.off('message', onMessage);
      if (!done) { done = true; resolve({ ok: false, error: 'send_failed' }); }
    }
  });
}

/**
 * Calculate appropriate timeout for a tool based on its arguments
 */
export function calcToolTimeout(tool: string, args: any): number {
  // capture_media: handle fixed, until_stop, and stream modes
  if (tool === 'capture_media') {
    const mode = String(args?.mode || 'fixed');
    const stream = Boolean(args?.stream);
    if (mode === 'until_stop' || mode === 'stream' || stream) {
      // until_stop/stream modes return immediately after starting recording (non-blocking)
      // The actual recording continues in background until stop_capture is called
      // So we only need a short timeout for the initial start
      return 60000; // 60s is plenty for setup
    }
    
    // fixed mode blocks for the entire duration, so timeout must exceed durationMs
    const dur = Number(args?.durationMs || 0);
    const validDur = isNaN(dur) || dur <= 0 ? 0 : dur;
    // Use 2 minute cushion for long recordings to account for file save + network delays
    const cushion = validDur > 300000 ? 120000 : 60000; // 2 min cushion for recordings > 5 min
    return Math.max(validDur + cushion, 60000); // duration + cushion, min 60s
  }

  // capture_screen: handle fixed, until_stop, and stream modes
  if (tool === 'capture_screen') {
    const mode = String(args?.mode || 'fixed');
    const stream = Boolean(args?.stream);
    if (mode === 'until_stop' || mode === 'stream' || stream) {
      return 60000; // setup only
    }
    const dur = Number(args?.durationMs || 0);
    const validDur = isNaN(dur) || dur <= 0 ? 0 : dur;
    const cushion = validDur > 300000 ? 120000 : 60000;
    return Math.max(validDur + cushion, 60000);
  }

  // capture_system_audio: handle fixed, until_stop, and stream modes
  if (tool === 'capture_system_audio') {
    const mode = String(args?.mode || 'fixed');
    const stream = Boolean(args?.stream);
    if (mode === 'until_stop' || mode === 'stream' || stream) {
      return 60000; // setup only
    }
    const dur = Number(args?.durationMs || 0);
    const validDur = isNaN(dur) || dur <= 0 ? 0 : dur;
    const cushion = validDur > 300000 ? 120000 : 60000;
    return Math.max(validDur + cushion, 60000);
  }
  
  // stream_speech: durationMs + 60s
  if (tool === 'stream_speech') {
    const dur = Number(args?.durationMs || 0);
    return Math.max((isNaN(dur) ? 0 : dur) + 60000, 60000);
  }
  
  // run_python_script / run_node_script: timeoutMs + packages
  if (tool === 'run_python_script' || tool === 'python_install') {
    const packages = args?.packages;
    const ms = Number(args?.timeoutMs);
    const baseTimeout = Number.isFinite(ms) && ms > 0 ? ms : 30000;
    const installTime = Array.isArray(packages) ? packages.length * 60000 : 0;
    return Math.min(baseTimeout + installTime + 30000, 600000);
  }
  
  if (tool === 'run_node_script') {
    const ms = Number(args?.timeoutMs);
    if (Number.isFinite(ms) && ms > 0) {
      return Math.min(ms + 15000, 600000);
    }
    return 300000;
  }
  
  // run_command / run_system_command: user-specified or default
  if (tool === 'run_command' || tool === 'run_system_command') {
    const ms = Number(args?.timeoutMs);
    if (Number.isFinite(ms) && ms > 0) {
      return Math.min(ms + 15000, 600000);
    }
    return 300000; // 5 min default
  }
  
  // analyze_media: can take a while for transcription/analysis
  if (tool === 'analyze_media') {
    return 600000; // 10 min for long media files
  }

  // ffmpeg_setup: download/extract can be slow on first run
  if (tool === 'ffmpeg_setup') {
    return 1200000; // 20 min
  }

  // ffmpeg operations: respect timeoutMs when provided, otherwise use a reasonable default
  if (
    tool === 'ffmpeg_run' ||
    tool === 'ffmpeg_convert_media' ||
    tool === 'ffmpeg_extract_audio' ||
    tool === 'ffmpeg_trim_media' ||
    tool === 'ffmpeg_probe_media' ||
    tool === 'ffmpeg_extract_frames'
  ) {
    const ms = Number(args?.timeoutMs);
    if (Number.isFinite(ms) && ms > 0) {
      return Math.min(ms + 30000, 1800000);
    }
    return 600000;
  }
  
  // Default: 5 minutes for most tools
  return 300000;
}

