/**
 * Live Browser Subagent Diagnostic
 *
 * Connects to the running cloud-ai server and traces the browser delegation flow.
 * Run: npx tsx src/orchestrator/test-browser-live.ts
 */

import { WebSocket } from 'ws';

const CLOUD_AI_PORT = process.env.CLOUD_AI_PORT || '8082';
const CLOUD_AI_URL = `ws://localhost:${CLOUD_AI_PORT}/ws`;

function log(prefix: string, ...args: any[]) {
  console.log(`[${prefix}]`, ...args);
}

function connectWs(url: string, timeout = 5000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Connection timeout to ${url}`));
    }, timeout);
    const ws = new WebSocket(url);
    ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

async function runTest(
  ws: WebSocket,
  label: string,
  prompt: string,
  timeout = 60000,
): Promise<{
  toolEvents: any[];
  text: string;
  errors: any[];
  finals: any[];
  allMessages: any[];
}> {
  return new Promise((resolve) => {
    const result = { toolEvents: [] as any[], text: '', errors: [] as any[], finals: [] as any[], allMessages: [] as any[] };
    const requestId = `diag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const timer = setTimeout(() => {
      log(label, 'TIMEOUT after', timeout, 'ms');
      ws.removeListener('message', handler);
      resolve(result);
    }, timeout);

    function handler(data: any) {
      let msg: any;
      try {
        msg = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
      } catch { return; }

      // Only process messages for our request
      if (msg.requestId && msg.requestId !== requestId) return;

      result.allMessages.push(msg);
      const type = String(msg?.type || '');
      const event = String(msg?.event || '');

      if (type === 'error') {
        result.errors.push(msg);
        log(label, '✗ ERROR:', msg.message || msg.error);
      }

      if (type === 'progress' && event === 'delta' && msg.data?.text) {
        result.text += msg.data.text;
      }

      if (type === 'progress' && event === 'tool_event') {
        const te = msg.data || msg;
        result.toolEvents.push(te);
        const status = te.status || '';
        const tool = te.tool || '?';
        if (status === 'called') {
          log(label, `→ tool_call: ${tool}`, te.args ? JSON.stringify(te.args).slice(0, 100) : '');
        } else if (status === 'completed') {
          const resultStr = JSON.stringify(te.result || {}).slice(0, 200);
          log(label, `← tool_done: ${tool}`, resultStr);
        } else if (status === 'error') {
          log(label, `✗ tool_error: ${tool}`, te.error);
        }
      }

      if (type === 'progress' && event === 'model') {
        log(label, `Model: tier=${msg.data?.tier}, modelId=${msg.data?.modelId}`);
      }

      if (type === 'final') {
        result.finals.push(msg);
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(result);
      }
    }

    ws.on('message', handler);

    ws.send(JSON.stringify({
      type: 'chat',
      requestId,
      model: 'fast',
      text: prompt,
      messages: [{ role: 'user', content: prompt }],
    }));

    log(label, `Sent: "${prompt.slice(0, 80)}..."`);
  });
}

// ── Test 1: Direct browser_use_status via exec_tool_bridged ──────────────────

async function testDirectToolBridge(ws: WebSocket) {
  log('TEST-1', '=== Direct Tool Bridge Test (browser_use_status) ===');

  return new Promise<any>((resolve) => {
    const toolId = `tool-diag-${Date.now()}`;
    const timer = setTimeout(() => {
      log('TEST-1', '✗ TIMEOUT — tool_result never received');
      log('TEST-1', '  This means the desktop app is NOT handling exec_tool_bridged');
      log('TEST-1', '  OR the desktop bridge WS is not connected to this server.');
      ws.removeListener('message', handler);
      resolve({ timedOut: true });
    }, 10000);

    function handler(data: any) {
      let msg: any;
      try {
        msg = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
      } catch { return; }

      if (msg?.id === toolId) {
        if (msg.type === 'tool_result') {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          log('TEST-1', '✓ Got tool_result:', JSON.stringify(msg.result).slice(0, 200));
          resolve(msg.result);
        }
        if (msg.type === 'error') {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          log('TEST-1', '✗ Got error:', msg.message || msg.error);
          resolve({ error: msg.message });
        }
      }
    }

    ws.on('message', handler);
    ws.send(JSON.stringify({
      type: 'exec_tool_bridged',
      id: toolId,
      tool: 'browser_use_status',
      args: {},
    }));
    log('TEST-1', 'Sent exec_tool_bridged for browser_use_status');
  });
}

// ── Test 2: LLM-driven browser status check ─────────────────────────────────

async function testLLMBrowserStatus(ws: WebSocket) {
  log('TEST-2', '=== LLM Browser Status Test ===');

  // Log ALL raw messages for diagnosis
  const allRaw: any[] = [];
  const rawHandler = (data: any) => {
    let msg: any;
    try {
      msg = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
    } catch { return; }
    allRaw.push(msg);
    log('TEST-2', `  RAW [${msg.type || '?'}/${msg.event || '-'}]:`, JSON.stringify(msg).slice(0, 200));
  };
  ws.on('message', rawHandler);

  const result = await runTest(
    ws,
    'TEST-2',
    'Use the browser_use_status tool right now and tell me the exact JSON result. Do not explain, just call the tool.',
    30000,
  );

  ws.removeListener('message', rawHandler);

  log('TEST-2', `Result: ${result.toolEvents.length} tool events, ${result.errors.length} errors, ${allRaw.length} total raw messages`);
  log('TEST-2', `Text: ${result.text.slice(0, 200)}`);

  // Dump all raw messages for diagnosis
  if (allRaw.length === 0) {
    log('TEST-2', '✗ ZERO raw messages received — agent stream may be hanging');
    log('TEST-2', '  Possible causes:');
    log('TEST-2', '  1. LLM API key is invalid or quota exceeded');
    log('TEST-2', '  2. The model provider is down');
    log('TEST-2', '  3. Server-side error swallowed (check server console)');
  }

  const statusCalls = result.toolEvents.filter(te => te.tool === 'browser_use_status');
  const delegateCalls = result.toolEvents.filter(te => te.tool === 'delegate');
  const executeCalls = result.toolEvents.filter(te => te.tool === 'execute_tool');

  if (statusCalls.length > 0) {
    log('TEST-2', '✓ browser_use_status was called directly');
  } else if (delegateCalls.length > 0) {
    log('TEST-2', '→ Used orchestrator delegation');
    for (const dc of delegateCalls) {
      if (dc.status === 'completed') {
        log('TEST-2', '  Delegate result:', JSON.stringify(dc.result).slice(0, 200));
      }
      if (dc.status === 'error') {
        log('TEST-2', '  ✗ Delegate ERROR:', dc.error);
      }
    }
  } else if (executeCalls.length > 0) {
    log('TEST-2', '→ Used execute_tool (meta-tool)');
  } else {
    log('TEST-2', '✗ No browser tool was called — agent may have skipped tool use');
  }

  // Check for bridge errors in any tool event
  const bridgeErrors = result.toolEvents.filter(te =>
    te.status === 'error' &&
    String(te.error || '').match(/No desktop|bridge|VM/i)
  );
  if (bridgeErrors.length > 0) {
    log('TEST-2', '✗✗ BRIDGE ERROR DETECTED:');
    for (const be of bridgeErrors) {
      log('TEST-2', `   ${be.tool}: ${be.error}`);
    }
  }

  return result;
}

// ── Test 3: Browser navigation via delegation ────────────────────────────────

async function testBrowserNavigation(ws: WebSocket) {
  log('TEST-3', '=== Browser Navigation Delegation Test ===');
  const result = await runTest(
    ws,
    'TEST-3',
    'Navigate the browser to https://example.com and tell me the page title. Use the browser tools directly.',
    45000,
  );

  log('TEST-3', `Result: ${result.toolEvents.length} tool events, ${result.errors.length} errors`);

  // Summary of all tools called
  const toolSummary: Record<string, number> = {};
  for (const te of result.toolEvents) {
    const key = `${te.tool}:${te.status}`;
    toolSummary[key] = (toolSummary[key] || 0) + 1;
  }
  log('TEST-3', 'Tool summary:', toolSummary);
  log('TEST-3', `Response text: ${result.text.slice(0, 300)}`);

  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Browser Subagent Live Diagnostic                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Connect
  let ws: WebSocket;
  try {
    ws = await connectWs(CLOUD_AI_URL);
    log('CONNECT', `✓ Connected to ${CLOUD_AI_URL}`);
  } catch (err: any) {
    log('CONNECT', `✗ FAILED to connect to ${CLOUD_AI_URL}: ${err.message}`);
    log('CONNECT', 'Make sure cloud-ai server is running.');
    process.exit(1);
  }

  // Test 1: Direct tool bridge
  console.log();
  const directResult = await testDirectToolBridge(ws);

  // Test 1.5: Simple LLM test — just say hello, no tools
  console.log();
  log('TEST-1.5', '=== Simple LLM Test (no tools) ===');
  let ws1b: WebSocket;
  try {
    ws1b = await connectWs(CLOUD_AI_URL);
  } catch {
    log('CONNECT', 'Failed to reconnect for test 1.5');
    ws.close();
    process.exit(1);
  }

  const simpleResult = await runTest(ws1b, 'TEST-1.5', 'Say "hello test OK" and nothing else.', 15000);
  log('TEST-1.5', `Text: "${simpleResult.text.slice(0, 100)}"`);
  log('TEST-1.5', `Finals: ${simpleResult.finals.length}, Errors: ${simpleResult.errors.length}`);
  ws1b.close();

  if (simpleResult.text.length === 0 && simpleResult.finals.length === 0) {
    log('TEST-1.5', '✗ LLM produced NO output — API keys may be wrong or model unavailable');
    log('TEST-1.5', '  Skipping remaining tests.');

    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║  DIAGNOSTIC SUMMARY                                    ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║  Test 1 (Direct Bridge):    ✗ TIMEOUT (no desktop)     ║');
    console.log('║  Test 1.5 (Simple LLM):     ✗ NO OUTPUT               ║');
    console.log('║    → LLM API is not responding. Check API keys.        ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    ws.close();
    process.exit(1);
  }

  // Need a fresh connection for each LLM test (server tracks conversation per WS)
  console.log();
  let ws2: WebSocket;
  try {
    ws2 = await connectWs(CLOUD_AI_URL);
  } catch {
    log('CONNECT', 'Failed to reconnect for test 2');
    ws.close();
    process.exit(1);
  }

  // Test 2: LLM browser status
  const statusResult = await testLLMBrowserStatus(ws2);
  ws2.close();

  // Test 3: Browser navigation
  console.log();
  let ws3: WebSocket;
  try {
    ws3 = await connectWs(CLOUD_AI_URL);
  } catch {
    log('CONNECT', 'Failed to reconnect for test 3');
    ws.close();
    process.exit(1);
  }
  const navResult = await testBrowserNavigation(ws3);
  ws3.close();

  // ── Summary ──
  console.log();
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  DIAGNOSTIC SUMMARY                                    ║');
  console.log('╠══════════════════════════════════════════════════════════╣');

  // Direct bridge
  if (directResult?.timedOut) {
    console.log('║  Test 1 (Direct Bridge):    ✗ TIMEOUT                  ║');
    console.log('║    → Desktop bridge is NOT connected                   ║');
  } else if (directResult?.error) {
    console.log('║  Test 1 (Direct Bridge):    ✗ ERROR                    ║');
  } else if (directResult?.ok !== undefined) {
    console.log(`║  Test 1 (Direct Bridge):    ✓ OK (running=${directResult.running || directResult.serverAlive})              ║`);
  } else {
    console.log('║  Test 1 (Direct Bridge):    ? Unknown                  ║');
  }

  // LLM status
  const hasBridgeError2 = statusResult.toolEvents.some((te: any) =>
    te.status === 'error' && String(te.error || '').match(/No desktop|bridge|VM/i)
  );
  if (hasBridgeError2) {
    console.log('║  Test 2 (LLM Status):       ✗ BRIDGE ERROR             ║');
    console.log('║    → Bridge context not propagated to subagent          ║');
  } else if (statusResult.errors.length > 0) {
    console.log('║  Test 2 (LLM Status):       ✗ ERROR                    ║');
  } else if (statusResult.finals.length > 0) {
    console.log('║  Test 2 (LLM Status):       ✓ Completed                ║');
  } else {
    console.log('║  Test 2 (LLM Status):       ? Timeout/Unknown          ║');
  }

  // Navigation
  const hasBridgeError3 = navResult.toolEvents.some((te: any) =>
    te.status === 'error' && String(te.error || '').match(/No desktop|bridge|VM/i)
  );
  if (hasBridgeError3) {
    console.log('║  Test 3 (Navigation):       ✗ BRIDGE ERROR             ║');
  } else if (navResult.errors.length > 0) {
    console.log('║  Test 3 (Navigation):       ✗ ERROR                    ║');
  } else if (navResult.finals.length > 0) {
    console.log('║  Test 3 (Navigation):       ✓ Completed                ║');
  } else {
    console.log('║  Test 3 (Navigation):       ? Timeout/Unknown          ║');
  }

  console.log('╚══════════════════════════════════════════════════════════╝');

  ws.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
