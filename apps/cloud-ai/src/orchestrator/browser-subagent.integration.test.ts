/**
 * Browser Subagent LIVE Integration Test
 *
 * Connects to the running cloud-ai server via WebSocket and tests
 * the full browser delegation flow end-to-end.
 *
 * Prerequisites:
 *   - Cloud-AI server running on CLOUD_AI_PORT (default 8082)
 *   - Desktop app running (for bridge to work)
 *
 * Run: npx vitest run src/orchestrator/browser-subagent.integration.test.ts
 *
 * Excluded from normal test runs (*.integration.test.ts pattern in vitest.config.ts).
 * Run manually to diagnose live delegation issues.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';

const CLOUD_AI_PORT = process.env.CLOUD_AI_PORT || '8082';
const CLOUD_AI_URL = `ws://localhost:${CLOUD_AI_PORT}/ws`;
const CONNECT_TIMEOUT = 5000;
const RESPONSE_TIMEOUT = 60000;

function connectWs(url: string, timeout = CONNECT_TIMEOUT): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Connection timeout after ${timeout}ms to ${url}`));
    }, timeout);

    const ws = new WebSocket(url);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

interface CollectedMessages {
  all: any[];
  textDeltas: string[];
  toolEvents: any[];
  errors: any[];
  finals: any[];
  progressEvents: any[];
  reasoningChunks: string[];
}

function collectMessages(ws: WebSocket, timeout = RESPONSE_TIMEOUT): Promise<CollectedMessages> {
  return new Promise((resolve) => {
    const collected: CollectedMessages = {
      all: [],
      textDeltas: [],
      toolEvents: [],
      errors: [],
      finals: [],
      progressEvents: [],
      reasoningChunks: [],
    };

    const timer = setTimeout(() => {
      ws.removeAllListeners('message');
      resolve(collected);
    }, timeout);

    ws.on('message', (data) => {
      let msg: any;
      try {
        msg = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
      } catch {
        return;
      }

      collected.all.push(msg);

      const type = String(msg?.type || '');
      const event = String(msg?.event || '');

      if (type === 'error') {
        collected.errors.push(msg);
      }

      if (type === 'final') {
        collected.finals.push(msg);
        clearTimeout(timer);
        ws.removeAllListeners('message');
        resolve(collected);
        return;
      }

      if (type === 'progress') {
        collected.progressEvents.push(msg);

        if (event === 'delta' && msg.data?.text) {
          collected.textDeltas.push(msg.data.text);
        }

        if (event === 'tool_event') {
          collected.toolEvents.push(msg.data || msg);
        }

        if (event === 'reasoning' && msg.data?.text) {
          collected.reasoningChunks.push(msg.data.text);
        }
      }
    });
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Live Browser Subagent Integration', () => {
  let ws: WebSocket | null = null;

  afterAll(() => {
    try { ws?.close(); } catch {}
  });

  it('connects to cloud-ai server', async () => {
    try {
      ws = await connectWs(CLOUD_AI_URL);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      console.log(`✓ Connected to ${CLOUD_AI_URL}`);
    } catch (err: any) {
      console.error(`✗ Could not connect to ${CLOUD_AI_URL}:`, err.message);
      throw err;
    }
  });

  it('sends browser_use_status request and gets response', async () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('Skipping: no WS connection');
      return;
    }

    // Send a simple prompt that should trigger browser_use_status
    const requestId = `test-${Date.now()}`;
    const message = {
      type: 'chat',
      requestId,
      model: 'fast',
      text: 'Check the browser status. Use browser_use_status tool and tell me what it returns.',
      messages: [
        { role: 'user', content: 'Check the browser status. Use browser_use_status tool and tell me what it returns.' },
      ],
    };

    ws.send(JSON.stringify(message));
    console.log('→ Sent browser_use_status prompt');

    const result = await collectMessages(ws, 30000);

    console.log('\n=== LIVE TEST RESULTS ===');
    console.log(`  Total messages: ${result.all.length}`);
    console.log(`  Text deltas: ${result.textDeltas.length}`);
    console.log(`  Tool events: ${result.toolEvents.length}`);
    console.log(`  Errors: ${result.errors.length}`);
    console.log(`  Finals: ${result.finals.length}`);

    // Log tool events for diagnosis
    for (const te of result.toolEvents) {
      console.log(`  Tool: ${te.tool} [${te.status}]`, te.error ? `ERROR: ${te.error}` : '');
    }

    // Log final text
    const finalText = result.textDeltas.join('');
    console.log(`  Final text (${finalText.length} chars): ${finalText.slice(0, 200)}...`);

    // Check for errors
    if (result.errors.length > 0) {
      console.error('  ERRORS:', result.errors);
    }

    console.log('========================\n');

    // Basic assertions
    expect(result.finals.length).toBeGreaterThanOrEqual(1);

    // Check if any tool was called
    const browserStatusCalls = result.toolEvents.filter(
      te => te.tool === 'browser_use_status'
    );
    const delegateCalls = result.toolEvents.filter(
      te => te.tool === 'delegate'
    );

    console.log('Browser status calls:', browserStatusCalls.length);
    console.log('Delegate calls:', delegateCalls.length);

    // The agent should either:
    // 1. Call delegate(subagent: "browser") which then calls browser_use_status
    // 2. Or call browser_use_status directly (if not using orchestrator)
    // 3. Or call execute_tool to run browser_use_status via meta-tools
    const anyBrowserInteraction = browserStatusCalls.length > 0 ||
      delegateCalls.length > 0 ||
      result.toolEvents.some(te => te.tool === 'execute_tool');

    if (!anyBrowserInteraction) {
      console.warn('WARNING: No browser-related tool was called. The agent may have responded without checking browser status.');
    }
  });

  it('sends a browser navigation request via delegation', async () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // Reconnect
      try {
        ws = await connectWs(CLOUD_AI_URL);
      } catch {
        console.warn('Skipping: cannot reconnect');
        return;
      }
    }

    const requestId = `test-nav-${Date.now()}`;
    const message = {
      type: 'chat',
      requestId,
      model: 'fast',
      text: 'Navigate the browser to https://example.com and tell me the page title.',
      messages: [
        { role: 'user', content: 'Navigate the browser to https://example.com and tell me the page title.' },
      ],
    };

    ws.send(JSON.stringify(message));
    console.log('→ Sent browser navigation prompt');

    const result = await collectMessages(ws, 45000);

    console.log('\n=== NAVIGATION TEST RESULTS ===');
    console.log(`  Total messages: ${result.all.length}`);
    console.log(`  Tool events: ${result.toolEvents.length}`);

    // Categorize tool events
    const toolCalls: Record<string, { called: number; completed: number; errors: string[] }> = {};
    for (const te of result.toolEvents) {
      const name = te.tool || 'unknown';
      if (!toolCalls[name]) toolCalls[name] = { called: 0, completed: 0, errors: [] };
      if (te.status === 'called') toolCalls[name].called++;
      if (te.status === 'completed') toolCalls[name].completed++;
      if (te.status === 'error') toolCalls[name].errors.push(te.error || 'unknown');
    }

    console.log('  Tool calls summary:');
    for (const [name, stats] of Object.entries(toolCalls)) {
      console.log(`    ${name}: called=${stats.called}, completed=${stats.completed}, errors=${stats.errors.length}`);
      for (const err of stats.errors) {
        console.log(`      ERROR: ${err}`);
      }
    }

    const finalText = result.textDeltas.join('');
    console.log(`  Final text: ${finalText.slice(0, 300)}...`);

    // Check for delegation
    if (toolCalls['delegate']) {
      console.log('  ✓ Used orchestrator delegation');
      // Check if delegate completed successfully
      if (toolCalls['delegate'].errors.length > 0) {
        console.error('  ✗ Delegation FAILED:', toolCalls['delegate'].errors);
      }
    } else if (toolCalls['browser_use_navigate']) {
      console.log('  ✓ Used direct browser_use_navigate (non-orchestrator mode)');
    } else {
      console.warn('  ✗ No browser navigation tool was called');
    }

    // Check for bridge errors
    const bridgeErrors = result.toolEvents.filter(te =>
      te.status === 'error' &&
      (te.error?.includes('No desktop') || te.error?.includes('bridge') || te.error?.includes('VM'))
    );

    if (bridgeErrors.length > 0) {
      console.error('\n  ✗✗ BRIDGE ERRORS DETECTED ✗✗');
      for (const err of bridgeErrors) {
        console.error(`    Tool: ${err.tool}, Error: ${err.error}`);
      }
      console.error('  This means the desktop bridge is not connected or the WS is not propagating.');
    }

    console.log('================================\n');

    expect(result.finals.length).toBeGreaterThanOrEqual(1);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Direct Bridge Tool Test (bypasses LLM)', () => {
  it('tests tool_request / tool_result round-trip', async () => {
    let ws: WebSocket | null = null;
    try {
      ws = await connectWs(CLOUD_AI_URL);
    } catch {
      console.warn('Skipping: cannot connect');
      return;
    }

    // Send an exec_tool_bridged message which uses bridge context directly
    const toolId = `tool-test-${Date.now()}`;
    const message = {
      type: 'exec_tool_bridged',
      id: toolId,
      tool: 'browser_use_status',
      args: {},
    };

    const resultPromise = new Promise<any>((resolve) => {
      const timer = setTimeout(() => {
        resolve({ timedOut: true });
      }, 10000);

      ws!.on('message', (data) => {
        let msg: any;
        try {
          msg = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
        } catch { return; }

        if (msg?.id === toolId && msg?.type === 'tool_result') {
          clearTimeout(timer);
          resolve(msg.result);
        }
        if (msg?.id === toolId && msg?.type === 'error') {
          clearTimeout(timer);
          resolve({ error: msg.message || msg.error });
        }
      });
    });

    ws.send(JSON.stringify(message));
    console.log('→ Sent exec_tool_bridged for browser_use_status');

    const result = await resultPromise;

    console.log('\n=== DIRECT TOOL TEST ===');
    console.log('  Result:', JSON.stringify(result, null, 2));
    console.log('========================\n');

    ws.close();

    if (result?.timedOut) {
      console.warn('  ✗ Tool request timed out — bridge may not be handling exec_tool_bridged');
    } else if (result?.error) {
      console.error('  ✗ Tool error:', result.error);
    } else {
      console.log('  ✓ Direct tool execution succeeded');
      expect(result).toBeDefined();
    }
  });
});
