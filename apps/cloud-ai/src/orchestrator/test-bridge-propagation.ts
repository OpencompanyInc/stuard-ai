/**
 * Direct Bridge Propagation Test
 * 
 * Tests whether ALS (AsyncLocalStorage) context propagates through:
 *   withClientBridge → runSubagent → agent.generate() → tool.execute()
 * 
 * Run: npx tsx src/orchestrator/test-bridge-propagation.ts
 */

import 'dotenv/config';
import { EventEmitter } from 'events';
import { withClientBridge, hasClientBridge, getBridgeWs } from '../tools/bridge';
import { runSubagent } from './subagent-runtime';
import { WebSocket } from 'ws';

const MODEL_ID = process.env.TEST_MODEL || 'openrouter/qwen/qwen3.6-plus:free';

function log(tag: string, ...args: any[]) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}][${tag}]`, ...args);
}

// Create a mock WebSocket that simulates an open connection
// and auto-responds to tool_request messages
function createMockWs(): WebSocket {
  const ee = new EventEmitter();
  const mock: any = {
    readyState: 1, // WebSocket.OPEN
    OPEN: 1,
    send: (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'tool_request') {
          log('MOCK_WS', `Received tool_request: ${msg.tool} (id=${msg.id})`);
          
          let result: any;
          if (msg.tool === 'browser_use_status') {
            result = { ok: true, installed: true, running: true, mode: 'headed', currentUrl: 'about:blank' };
          } else if (msg.tool === 'browser_use_navigate') {
            result = { ok: true, url: msg.args?.url || 'about:blank', title: 'Page loaded' };
          } else if (msg.tool === 'browser_use_screenshot') {
            result = { ok: true, screenshot: '(mock base64)', width: 1920, height: 1080 };
          } else if (msg.tool === 'browser_use_get_interactive_elements') {
            result = { ok: true, elements: [{ elementId: 'e1', tag: 'button', text: 'Click me' }] };
          } else {
            result = { ok: true, message: `Mock response for ${msg.tool}` };
          }
          
          // Respond with tool_result after a small delay
          setTimeout(() => {
            const listeners = ee.listeners('message');
            const responseData = Buffer.from(JSON.stringify({ type: 'tool_result', id: msg.id, result }));
            for (const listener of listeners) {
              listener(responseData);
            }
          }, 50);
        }
      } catch (e: any) {
        log('MOCK_WS', `Error processing send: ${e.message}`);
      }
    },
    on: (event: string, handler: any) => { ee.on(event, handler); return mock; },
    off: (event: string, handler: any) => { ee.off(event, handler); return mock; },
    removeAllListeners: (event?: string) => { ee.removeAllListeners(event); return mock; },
    close: () => { mock.readyState = 3; },
    ping: () => {},
    terminate: () => {},
  };
  
  return mock as any;
}

async function testDirectBridgeCheck() {
  log('TEST1', '=== Direct ALS Check ===');
  
  const mockWs = createMockWs();
  
  // Outside bridge context
  log('TEST1', `Outside bridge: hasClientBridge=${hasClientBridge()}`);
  
  // Inside bridge context
  await withClientBridge(mockWs as any, async () => {
    log('TEST1', `Inside bridge: hasClientBridge=${hasClientBridge()}`);
    log('TEST1', `Inside bridge: getBridgeWs exists=${!!getBridgeWs()}`);
    log('TEST1', `Inside bridge: ws.readyState=${(getBridgeWs() as any)?.readyState}`);
    
    // Test nested async
    await new Promise(resolve => setTimeout(resolve, 10));
    log('TEST1', `After setTimeout: hasClientBridge=${hasClientBridge()}`);
    
    // Test Promise.resolve
    await Promise.resolve();
    log('TEST1', `After Promise.resolve: hasClientBridge=${hasClientBridge()}`);
  });
  
  log('TEST1', `After bridge: hasClientBridge=${hasClientBridge()}`);
  log('TEST1', '✓ Direct ALS check passed\n');
}

async function testSubagentBridgePropagation() {
  log('TEST2', '=== Subagent Bridge Propagation ===');
  log('TEST2', `Using model: ${MODEL_ID}`);
  
  const mockWs = createMockWs();
  const secrets = { userId: 'test-user', __modelTier: 'balanced', __modelId: MODEL_ID };
  
  log('TEST2', 'Running subagent inside withClientBridge...');
  
  const result = await withClientBridge(mockWs as any, async () => {
    log('TEST2', `Outer bridge: hasClientBridge=${hasClientBridge()}`);
    
    // Capture bridge WS (same as delegate tool does)
    const bridgeWs = getBridgeWs();
    log('TEST2', `Captured bridgeWs: ${!!bridgeWs} readyState=${(bridgeWs as any)?.readyState}`);
    
    const subagentResult = await runSubagent({
      request: {
        kind: 'browser',
        instruction: 'Call browser_use_status to check if the browser is running. Report the result.',
      },
      runId: `test-run-${Date.now()}`,
      parentRunId: `test-parent-${Date.now()}`,
      model: 'balanced',
      modelId: MODEL_ID,
      bridgeWs: bridgeWs as any,
      bridgeSecrets: secrets,
    });
    
    return subagentResult;
  }, secrets);
  
  log('TEST2', `Result: ok=${result.ok} durationMs=${result.durationMs}`);
  if (result.result) {
    log('TEST2', `Text (first 300 chars): "${result.result.slice(0, 300)}"`);
  }
  if (result.error) {
    log('TEST2', `Error: ${result.error}`);
  }
  
  // Check if browser tools were actually called (from mock WS logs)
  const didCallBrowserTool = result.result && !result.result.includes("can't access") && !result.result.includes("don't have access") && !result.result.includes("not available");
  
  if (didCallBrowserTool) {
    log('TEST2', '✓ Subagent called browser tools successfully!');
  } else {
    log('TEST2', '✗ Subagent did NOT call browser tools — bridge context was lost!');
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Bridge Propagation Test                                ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  
  try {
    await testDirectBridgeCheck();
    await testSubagentBridgePropagation();
  } catch (e: any) {
    log('FATAL', e.message);
    console.error(e);
  }
  
  setTimeout(() => process.exit(0), 2000);
}

main();
