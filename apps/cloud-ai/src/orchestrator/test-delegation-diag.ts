/**
 * Delegation Diagnostic — traces WHY browser subagent doesn't call tools.
 * 
 * Connects to the running cloud-ai server, sends a browser task with a
 * specified model, and logs every WS message to understand the delegation flow.
 * 
 * Run: npx tsx src/orchestrator/test-delegation-diag.ts
 */

import { WebSocket } from 'ws';

const CLOUD_AI_PORT = process.env.CLOUD_AI_PORT || '8082';
const CLOUD_AI_URL = `ws://localhost:${CLOUD_AI_PORT}/ws`;
const MODEL_ID = process.env.TEST_MODEL || 'openrouter/qwen/qwen3.6-plus:free';

function log(tag: string, ...args: any[]) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}][${tag}]`, ...args);
}

function connectWs(url: string, timeout = 5000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error(`Timeout connecting to ${url}`)); }, timeout);
    const ws = new WebSocket(url);
    ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

async function waitForMessages(ws: WebSocket, timeoutMs: number): Promise<any[]> {
  const messages: any[] = [];
  let finalReceived = false;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      log('TIMEOUT', `Waited ${timeoutMs}ms — collected ${messages.length} messages`);
      resolve(messages);
    }, timeoutMs);

    ws.on('message', (buf: Buffer) => {
      try {
        const msg = JSON.parse(buf.toString('utf8'));
        messages.push(msg);

        const type = msg.type || '';
        const event = msg.event || '';

        if (type === 'handshake') {
          log('WS', '✓ Handshake received');
        } else if (type === 'progress' && event === 'model') {
          log('MODEL', `tier=${msg.data?.tier} modelId=${msg.data?.modelId}`);
        } else if (type === 'progress' && event === 'ack') {
          log('ACK', `ts=${msg.data?.ts}`);
        } else if (type === 'progress' && event === 'routing') {
          log('ROUTING', JSON.stringify(msg.data));
        } else if (type === 'progress' && event === 'tool_event') {
          const d = msg.data || {};
          log('TOOL', `${d.tool} → ${d.status}${d.args ? ' args=' + JSON.stringify(d.args).slice(0, 200) : ''}`);
          if (d.result) {
            log('TOOL_RESULT', JSON.stringify(d.result).slice(0, 300));
          }
        } else if (type === 'progress' && event === 'text') {
          log('TEXT', `"${String(msg.data?.text || '').slice(0, 200)}"`);
        } else if (type === 'progress' && event === 'reasoning') {
          log('REASONING', `"${String(msg.data?.text || '').slice(0, 200)}"`);
        } else if (type === 'final') {
          log('FINAL', `text=${String(msg.text || '').length}chars`);
          log('FINAL_PREVIEW', `"${String(msg.text || '').slice(0, 300)}"`);
          finalReceived = true;
          clearTimeout(timer);
          setTimeout(() => resolve(messages), 500);
        } else if (type === 'error') {
          log('ERROR', msg.message || JSON.stringify(msg));
        } else if (type === 'conversation') {
          log('CONV', `id=${msg.conversationId}`);
        } else if (type === 'tool_request') {
          log('TOOL_REQ', `tool=${msg.tool} id=${msg.id}`);
          // Auto-respond to tool_request to simulate desktop
          handleToolRequest(ws, msg);
        } else if (type === 'subagent_event') {
          log('SUBAGENT', `${msg.event} subagentId=${msg.subagentId} kind=${msg.data?.kind || ''}`);
        } else {
          log('MSG', `type=${type} event=${event} keys=${Object.keys(msg).join(',')}`);
        }
      } catch (e: any) {
        log('PARSE_ERR', e.message);
      }
    });
  });
}

function handleToolRequest(ws: WebSocket, msg: any) {
  const { id, tool, args } = msg;
  log('TOOL_REQ_HANDLE', `Handling ${tool} (id=${id})`);

  let result: any;
  if (tool === 'browser_use_status') {
    result = {
      ok: true,
      installed: true,
      running: true,
      mode: 'headed',
      profile: 'default',
      currentUrl: 'about:blank',
      title: 'New Tab',
    };
  } else if (tool === 'browser_use_navigate') {
    result = { ok: true, url: args?.url || 'about:blank', title: 'Page loaded' };
  } else if (tool === 'browser_use_screenshot') {
    result = { ok: true, screenshot: '(base64 data)', width: 1920, height: 1080 };
  } else if (tool === 'browser_use_get_interactive_elements') {
    result = {
      ok: true,
      elements: [
        { elementId: 'e1', tag: 'input', type: 'text', placeholder: 'What is happening?!' },
        { elementId: 'e2', tag: 'button', text: 'Post' },
      ],
    };
  } else if (tool === 'get_local_time') {
    result = { ok: true, iso: new Date().toISOString(), time: new Date().toLocaleTimeString() };
  } else {
    result = { ok: true, message: `Mock response for ${tool}` };
  }

  log('TOOL_REQ_REPLY', `Sending tool_result for ${tool}`);
  ws.send(JSON.stringify({ type: 'tool_result', id, result }));
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Delegation Diagnostic — Browser Subagent               ║');
  console.log(`║  Model: ${MODEL_ID.padEnd(46)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Connect
  let ws: WebSocket;
  try {
    ws = await connectWs(CLOUD_AI_URL, 5000);
    log('CONNECT', `✓ Connected to ${CLOUD_AI_URL}`);
  } catch (e: any) {
    log('CONNECT', `✗ FAILED: ${e.message}`);
    process.exit(1);
  }

  // Send chat message that should trigger delegation to browser subagent
  const chatMsg = {
    type: 'chat',
    text: 'Go to https://example.com in my browser, take a screenshot, and tell me what you see. Use the browser subagent via delegate.',
    model: 'balanced',
    modelId: MODEL_ID,
    requestId: `diag-${Date.now()}`,
  };

  log('SEND', `Sending chat with modelId=${MODEL_ID}`);
  log('SEND', `Text: "${chatMsg.text}"`);
  ws.send(JSON.stringify(chatMsg));

  // Wait for all messages (2 minute timeout)
  const messages = await waitForMessages(ws, 120_000);

  // Analysis
  console.log();
  console.log('═══════════════════════ ANALYSIS ═══════════════════════');
  console.log(`Total messages received: ${messages.length}`);

  const toolEvents = messages.filter(m => m.type === 'progress' && m.event === 'tool_event');
  const toolRequests = messages.filter(m => m.type === 'tool_request');
  const subagentEvents = messages.filter(m => m.type === 'subagent_event');
  const textChunks = messages.filter(m => m.type === 'progress' && m.event === 'text');
  const finalMsg = messages.find(m => m.type === 'final');
  const errorMsgs = messages.filter(m => m.type === 'error');

  console.log(`  Tool events (from LLM): ${toolEvents.length}`);
  console.log(`  Tool requests (bridge): ${toolRequests.length}`);
  console.log(`  Subagent events: ${subagentEvents.length}`);
  console.log(`  Text chunks: ${textChunks.length}`);
  console.log(`  Errors: ${errorMsgs.length}`);

  if (toolEvents.length > 0) {
    console.log();
    console.log('  Tool event details:');
    for (const te of toolEvents) {
      const d = te.data || {};
      console.log(`    ${d.tool} → ${d.status}`);
    }
  }

  if (subagentEvents.length > 0) {
    console.log();
    console.log('  Subagent event details:');
    for (const se of subagentEvents) {
      console.log(`    ${se.event} (kind=${se.data?.kind || '?'}) subagentId=${se.subagentId}`);
    }
  }

  if (finalMsg) {
    const finalText = String(finalMsg.text || '');
    console.log();
    console.log(`  Final response (${finalText.length} chars):`);
    console.log(`    "${finalText.slice(0, 500)}"`);

    if (finalText.includes('desktop') || finalText.includes('VM') || finalText.includes("can't access")) {
      console.log();
      console.log('  ⚠️  ISSUE DETECTED: Response mentions desktop/VM unavailability');
      console.log('  This means the subagent did NOT attempt to call browser tools.');
      console.log('  Possible causes:');
      console.log('    1. hasClientBridge() returned false inside the subagent');
      console.log('    2. The model chose not to call tools (bad tool definitions)');
      console.log('    3. The model does not support function/tool calling');
    }
  }

  if (errorMsgs.length > 0) {
    console.log();
    console.log('  Errors:');
    for (const e of errorMsgs) {
      console.log(`    ${e.message || JSON.stringify(e)}`);
    }
  }

  console.log();
  console.log('═══════════════════════════════════════════════════════');

  ws.close();
  setTimeout(() => process.exit(0), 1000);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
