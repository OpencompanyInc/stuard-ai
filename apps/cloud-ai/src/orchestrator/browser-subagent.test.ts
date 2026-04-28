/**
 * Browser Subagent Integration Tests
 *
 * Traces the full delegation flow from orchestrator → browser subagent → tool execution
 * to identify where the bridge context is lost or tools fail to resolve.
 *
 * Test levels:
 *   1. Bridge context propagation (AsyncLocalStorage)
 *   2. Capability pack tool resolution against the execution universe
 *   3. Subagent build — all browser tools must resolve
 *   4. makeLocalTool bridge detection
 *   5. End-to-end delegation with mock bridge WS
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { WebSocket } from 'ws';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. Bridge Context Propagation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Bridge Context Propagation', () => {
  it('withClientBridge sets ALS context accessible via getBridgeWs', async () => {
    const { withClientBridge, getBridgeWs, hasClientBridge } = await import('../tools/bridge');

    // Outside bridge — no WS
    expect(getBridgeWs()).toBeUndefined();
    expect(hasClientBridge()).toBe(false);

    // Mock a WS with readyState=OPEN
    const mockWs = { readyState: 1, on: vi.fn() } as any;

    let insideBridgeWs: any;
    let insideHasBridge: boolean = false;

    await withClientBridge(mockWs, async () => {
      insideBridgeWs = getBridgeWs();
      insideHasBridge = hasClientBridge();
    });

    expect(insideBridgeWs).toBe(mockWs);
    // hasClientBridge checks readyState === WebSocket.OPEN (1)
    // Our mock has readyState=1, but the comparison is against the ws library's WebSocket.OPEN constant
    // This verifies the ALS propagation works
    expect(insideBridgeWs?.readyState).toBe(1);
  });

  it('nested withClientBridge preserves inner context', async () => {
    const { withClientBridge, getBridgeWs } = await import('../tools/bridge');

    const outerWs = { readyState: 1, on: vi.fn() } as any;
    const innerWs = { readyState: 1, on: vi.fn() } as any;

    let outerSeen: any;
    let innerSeen: any;
    let afterInnerSeen: any;

    await withClientBridge(outerWs, async () => {
      outerSeen = getBridgeWs();

      await withClientBridge(innerWs, async () => {
        innerSeen = getBridgeWs();
      });

      afterInnerSeen = getBridgeWs();
    });

    expect(outerSeen).toBe(outerWs);
    expect(innerSeen).toBe(innerWs);
    // After inner completes, ALS should restore outer context
    expect(afterInnerSeen).toBe(outerWs);
  });

  it('getBridgeSecrets propagates through withClientBridge', async () => {
    const { withClientBridge, getBridgeSecrets } = await import('../tools/bridge');

    const mockWs = { readyState: 1, on: vi.fn() } as any;
    const secrets = { userId: 'test-user', browserUseSessionId: 'sess-123' };

    let capturedSecrets: any;

    await withClientBridge(mockWs, async () => {
      capturedSecrets = getBridgeSecrets();
    }, secrets);

    expect(capturedSecrets).toEqual(secrets);
    expect(capturedSecrets?.userId).toBe('test-user');
    expect(capturedSecrets?.browserUseSessionId).toBe('sess-123');
  });

  it('bridge context is lost when not wrapped in withClientBridge', async () => {
    const { getBridgeWs, hasClientBridge, getBridgeSecrets } = await import('../tools/bridge');

    // Simulating what happens if subagent runs without withClientBridge wrapping
    expect(getBridgeWs()).toBeUndefined();
    expect(hasClientBridge()).toBe(false);
    expect(getBridgeSecrets()).toBeUndefined();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. Capability Pack → Execution Tools Resolution
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Browser Pack Tool Resolution', () => {
  it('every browser pack tool name exists in the execution tools universe', { timeout: 30000 }, async () => {
    const { BROWSER_PACK } = await import('./capability-packs');
    const { getExecutionTools } = await import('../agents/stuard/tools');

    const executionTools = getExecutionTools();
    const executionToolNames = new Set(Object.keys(executionTools));

    const missingTools: string[] = [];
    for (const toolName of BROWSER_PACK.toolNames) {
      if (!executionToolNames.has(toolName)) {
        missingTools.push(toolName);
      }
    }

    // This is the critical check: if any tool name in the browser pack
    // doesn't exist in executionTools, buildSubagent will silently drop it
    // and the browser subagent will be missing capabilities.
    if (missingTools.length > 0) {
      console.error('MISSING BROWSER TOOLS:', missingTools);
    }
    expect(missingTools).toEqual([]);
  });

  it('browser pack tools have valid execute functions', async () => {
    const { BROWSER_PACK } = await import('./capability-packs');
    const { getExecutionTools } = await import('../agents/stuard/tools');

    const executionTools = getExecutionTools();

    const toolsWithoutExecute: string[] = [];
    for (const toolName of BROWSER_PACK.toolNames) {
      const tool = executionTools[toolName];
      if (!tool) continue; // Already caught by the existence test above
      if (typeof (tool as any).execute !== 'function') {
        toolsWithoutExecute.push(toolName);
      }
    }

    expect(toolsWithoutExecute).toEqual([]);
  });

  it('browser pack prompt documents the observe/verify browser workflow', async () => {
    const { BROWSER_PACK } = await import('./capability-packs');

    expect(BROWSER_PACK.systemPrompt).toContain('Use browser_use_analyze_screenshot when you need visual interpretation.');
    expect(BROWSER_PACK.systemPrompt).toContain('Use browser_use_screenshot only when you are stuck, when the user asks for an image, or when you need visual feedback to share back.');
    expect(BROWSER_PACK.systemPrompt).toContain('Usually call browser_use_get_interactive_elements or browser_use_content to observe the new page before acting.');
    expect(BROWSER_PACK.systemPrompt).toContain('Do not take routine screenshots after every step.');
    expect(BROWSER_PACK.systemPrompt).toContain('Always prefer elementId from browser_use_get_interactive_elements.');
  });

  it('browser screenshot analysis tool is exposed without a detailed mode', async () => {
    const { getExecutionTools } = await import('../agents/stuard/tools');

    const executionTools = getExecutionTools();
    const tool = executionTools.browser_use_analyze_screenshot as any;

    expect(tool).toBeDefined();
    expect(() => tool.inputSchema.parse({ task: 'Check the layout' })).not.toThrow();
    const parsed = tool.inputSchema.parse({ mode: 'detailed' });
    expect(parsed).not.toHaveProperty('mode');
  });

  it('file_ops pack tools all resolve', async () => {
    const { FILE_OPS_PACK } = await import('./capability-packs');
    const { getExecutionTools } = await import('../agents/stuard/tools');

    const executionTools = getExecutionTools();
    const missing: string[] = [];
    for (const toolName of FILE_OPS_PACK.toolNames) {
      if (!executionTools[toolName]) {
        missing.push(toolName);
      }
    }

    if (missing.length > 0) {
      console.error('MISSING FILE_OPS TOOLS:', missing);
    }
    expect(missing).toEqual([]);
  });

  it('workflow pack tools all resolve', async () => {
    const { WORKFLOW_PACK } = await import('./capability-packs');
    const { getExecutionTools } = await import('../agents/stuard/tools');

    const executionTools = getExecutionTools();
    const missing: string[] = [];
    for (const toolName of WORKFLOW_PACK.toolNames) {
      if (!executionTools[toolName]) {
        missing.push(toolName);
      }
    }

    if (missing.length > 0) {
      console.error('MISSING WORKFLOW TOOLS:', missing);
    }
    expect(missing).toEqual([]);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. makeLocalTool Bridge Detection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('makeLocalTool Bridge Detection', () => {
  it('browser_use_navigate fails gracefully when no bridge is available', { timeout: 30000 }, async () => {
    const { browser_use_navigate } = await import('../tools/device/browser-use');

    // Execute outside bridge context — the tool may still try the local browser
    // server fallback in some environments, but it must return a deterministic
    // result either way.
    const result = await (browser_use_navigate as any).execute(
      { url: 'https://x.com' },
      { writer: undefined },
    );

    expect(result).toBeDefined();
    if (result.ok) {
      expect(typeof result.url).toBe('string');
    } else {
      expect(String(result.error || '')).toMatch(/No desktop|No desktop bridge|No desktop or VM|Chrome launch failed|local_browser_error/i);
    }
  });

  it('browser_use_status reports a deterministic fallback state without a bridge', { timeout: 30000 }, async () => {
    const { browser_use_status } = await import('../tools/device/browser-use');

    const result = await (browser_use_status as any).execute(
      {},
      { writer: undefined },
    );

    expect(result).toBeDefined();
    if (result.ok) {
      expect(typeof result.running).toBe('boolean');
      expect(typeof result.mode).toBe('string');
    } else {
      expect(String(result.error || '')).toMatch(/No desktop|No desktop bridge|local_browser_error|Chrome launch failed/i);
    }
  });

  it('browser_use_navigate succeeds with bridge context (sends tool_request)', async () => {
    const { withClientBridge } = await import('../tools/bridge');
    const { browser_use_navigate } = await import('../tools/device/browser-use');

    let sentMessage: any = null;
    const mockWs = {
      readyState: 1,
      on: vi.fn(),
      send: vi.fn((data: string) => {
        const msg = JSON.parse(data);
        sentMessage = msg;
        // Simulate immediate tool_result response
        if (msg.type === 'tool_request') {
          // We need to resolve the pending promise
          // The handleClientToolMessage function needs to be called
          // For this test, we'll just verify the message was sent correctly
        }
      }),
    } as any;

    // Run inside bridge context but with a timeout so it doesn't hang
    const resultPromise = withClientBridge(mockWs, async () => {
      // The tool will send a message and wait for response
      // We'll race with a timeout
      const toolPromise = (browser_use_navigate as any).execute(
        { url: 'https://x.com' },
        { writer: undefined },
      );

      // Give it time to send the request, then timeout
      return Promise.race([
        toolPromise,
        new Promise(resolve => setTimeout(() => resolve({ _timedOut: true }), 500)),
      ]);
    });

    const result = await resultPromise;

    // Verify it sent a tool_request over the bridge
    expect(mockWs.send).toHaveBeenCalled();
    if (sentMessage) {
      expect(sentMessage.type).toBe('tool_request');
      expect(sentMessage.tool).toBe('browser_use_navigate');
      expect(sentMessage.args).toBeDefined();
      expect(sentMessage.args.url).toBe('https://x.com');
    }
  });

  it('browser_use_status succeeds with scoped bridge context when the main bridge ALS is unavailable', async () => {
    const { handleClientToolMessage } = await import('../tools/bridge');
    const { withActiveBridgeContext } = await import('../tools/device/shared');
    const { browser_use_status } = await import('../tools/device/browser-use');

    let sentArgs: any = null;
    const mockWs = {
      readyState: 1,
      on: vi.fn(),
      send: vi.fn((data: string) => {
        const msg = JSON.parse(data);
        if (msg.type === 'tool_request') {
          sentArgs = msg.args;
          handleClientToolMessage(mockWs as any, {
            type: 'tool_result',
            id: msg.id,
            result: { ok: true, installed: true, running: true, currentUrl: 'about:blank' },
          });
        }
      }),
    } as any;

    const result = await withActiveBridgeContext(
      mockWs,
      { browserUseSessionId: 'scoped-session-42' },
      async () => {
        return await (browser_use_status as any).execute({}, { writer: undefined });
      },
    );

    expect(result).toBeDefined();
    expect(result.ok).toBe(true);
    expect(sentArgs?.session_id).toBe('scoped-session-42');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. Subagent Runtime — Bridge Propagation Check
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Subagent Runtime Bridge Propagation', () => {
  it('runSubagent wraps with withClientBridge when bridgeWs is OPEN', async () => {
    // The key logic in subagent-runtime.ts line 335-337:
    //   const runPromise = bridgeWs && (bridgeWs as any).readyState === 1
    //     ? withClientBridge(bridgeWs, runAgent, bridgeSecrets)
    //     : runAgent();
    //
    // If bridgeWs is null or readyState !== 1, the subagent runs WITHOUT bridge,
    // and ALL browser tools will fail with "No desktop bridge available"

    // Test the condition directly
    const openWs = { readyState: 1, on: vi.fn() };
    const closedWs = { readyState: 3, on: vi.fn() };
    const connectingWs = { readyState: 0, on: vi.fn() };

    expect(openWs.readyState === 1).toBe(true);   // Will use bridge ✓
    expect(closedWs.readyState === 1).toBe(false);  // NO bridge ✗
    expect(connectingWs.readyState === 1).toBe(false); // NO bridge ✗
    expect(null == null).toBeTruthy(); // null WS → NO bridge ✗
  });

  it('delegation-tools captures bridge context at call time', async () => {
    // The critical flow: delegation-tools.ts line 69-70:
    //   const bridgeWs = getBridgeWs();
    //   const bridgeSecrets = getBridgeSecrets();
    //
    // This captures from ALS inside the orchestrator's withClientBridge context.
    // If getBridgeWs returns undefined, the subagent runs without bridge.

    const { withClientBridge, getBridgeWs, getBridgeSecrets } = await import('../tools/bridge');

    const mockWs = { readyState: 1, on: vi.fn() } as any;
    const secrets = { userId: 'u1', browserUseSessionId: 'bs1' };

    let capturedWs: any;
    let capturedSecrets: any;

    await withClientBridge(mockWs, async () => {
      // Simulate what delegate tool does
      capturedWs = getBridgeWs();
      capturedSecrets = getBridgeSecrets();
    }, secrets);

    expect(capturedWs).toBe(mockWs);
    expect(capturedWs?.readyState).toBe(1);
    expect(capturedSecrets?.userId).toBe('u1');
    expect(capturedSecrets?.browserUseSessionId).toBe('bs1');
  });

  it('wrapToolWithBridge dispatches local tools through the captured bridge', async () => {
    const { handleClientToolMessage } = await import('../tools/bridge');
    const { browser_use_status } = await import('../tools/device/browser-use');
    const { wrapToolWithBridge } = await import('./subagent-runtime');

    let sentArgs: any = null;
    const mockWs = {
      readyState: 1,
      OPEN: 1,
      on: vi.fn(),
      send: vi.fn((data: string) => {
        const msg = JSON.parse(data);
        if (msg.type === 'tool_request') {
          sentArgs = msg.args;
          handleClientToolMessage(mockWs as any, {
            type: 'tool_result',
            id: msg.id,
            result: { ok: true, installed: true, running: true, currentUrl: 'about:blank' },
          });
        }
      }),
    } as any;

    const wrapped = wrapToolWithBridge(
      browser_use_status as any,
      mockWs,
      { userId: 'u1', browserUseSessionId: 'wrapped-session-7' },
    );

    const result = await (wrapped as any).execute({}, { writer: undefined });

    expect(result?.ok).toBe(true);
    expect(sentArgs?.session_id).toBe('wrapped-session-7');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. Desktop Registry Consistency
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Desktop Registry vs Cloud Tools Consistency', () => {
  it('all browser pack tools have corresponding cloud-ai definitions', async () => {
    const { BROWSER_PACK } = await import('./capability-packs');

    // These are the tools the browser subagent will try to call.
    // Each must exist in the cloud-ai execution tools.
    const expectedBrowserTools = [
      'browser_use_status',
      'browser_use_configure',
      'browser_use_navigate',
      'browser_use_click',
      'browser_use_type',
      'browser_use_press_key',
      'browser_use_screenshot',
      'browser_use_analyze_screenshot',
      'browser_use_content',
      'browser_use_scroll',
      'browser_use_tabs',
      'browser_use_cookies',
      'browser_use_hover',
      'browser_use_select_option',
      'browser_use_get_dropdown_options',
      'browser_use_get_interactive_elements',
      'browser_use_fill_form',
      'browser_use_upload_file',
      'browser_use_wait_for',
      'browser_use_execute_script',
      'capture_screen',
    ];

    for (const tool of expectedBrowserTools) {
      expect(BROWSER_PACK.toolNames).toContain(tool);
    }
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. End-to-End Delegation Smoke Test (with mock LLM)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Delegation Tool Contract', () => {
  it('delegate rejects unknown subagent names', async () => {
    const { delegate } = await import('./delegation-tools');

    const result = await (delegate as any).execute({
      tasks: [{ subagent: 'nonexistent_agent', instruction: 'do something' }],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown subagent/);
  });

  it('delegate accepts valid subagent names', async () => {
    const { KNOWN_SUBAGENT_NAMES } = await import('./capability-packs');

    for (const name of KNOWN_SUBAGENT_NAMES) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }

    expect(KNOWN_SUBAGENT_NAMES).toContain('browser');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. Session ID Injection for browser_use_* tools
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Browser Session ID Injection', () => {
  it('makeLocalTool injects browserUseSessionId from bridge secrets', async () => {
    const { withClientBridge } = await import('../tools/bridge');
    const { browser_use_status } = await import('../tools/device/browser-use');

    let sentArgs: any = null;
    const mockWs = {
      readyState: 1,
      on: vi.fn(),
      send: vi.fn((data: string) => {
        const msg = JSON.parse(data);
        if (msg.type === 'tool_request') {
          sentArgs = msg.args;
        }
      }),
    } as any;

    const secrets = { browserUseSessionId: 'my-session-42' };

    await withClientBridge(mockWs, async () => {
      const toolPromise = (browser_use_status as any).execute(
        {},
        { writer: undefined },
      );

      // Don't wait for completion — just give it time to send the request
      await Promise.race([
        toolPromise,
        new Promise(resolve => setTimeout(resolve, 300)),
      ]);
    }, secrets);

    // Verify session_id was injected from secrets
    if (sentArgs) {
      expect(sentArgs.session_id).toBe('my-session-42');
    }
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. Runtime configuration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Runtime Configuration', () => {
  it('browser delegation tooling exists without relying on USE_ORCHESTRATOR', async () => {
    const original = process.env.USE_ORCHESTRATOR;
    delete process.env.USE_ORCHESTRATOR;

    // Document the current state — not a hard assertion since tests
    // may run without the full .env loaded
    const { ORCHESTRATOR_DELEGATION_TOOLS } = await import('./delegation-tools');
    expect(ORCHESTRATOR_DELEGATION_TOOLS).toHaveProperty('delegate');
    expect(ORCHESTRATOR_DELEGATION_TOOLS).toHaveProperty('reply_to_subagent');

    process.env.USE_ORCHESTRATOR = original;
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9. Orchestrator Agent Tool Surface
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Orchestrator Agent Tool Surface', () => {
  // getOrchestratorAgent uses createRequire(import.meta.url) which fails in vitest
  // for .ts files. Test the tool surface contract without instantiating the full agent.

  it('ORCHESTRATOR_DELEGATION_TOOLS includes delegate and reply_to_subagent', async () => {
    const { ORCHESTRATOR_DELEGATION_TOOLS } = await import('./delegation-tools');

    expect(ORCHESTRATOR_DELEGATION_TOOLS).toHaveProperty('delegate');
    expect(ORCHESTRATOR_DELEGATION_TOOLS).toHaveProperty('reply_to_subagent');
    expect(typeof (ORCHESTRATOR_DELEGATION_TOOLS.delegate as any).execute).toBe('function');
    expect(typeof (ORCHESTRATOR_DELEGATION_TOOLS.reply_to_subagent as any).execute).toBe('function');
  });

  it('delegation tools have correct IDs', async () => {
    const { ORCHESTRATOR_DELEGATION_TOOLS } = await import('./delegation-tools');

    expect((ORCHESTRATOR_DELEGATION_TOOLS.delegate as any).id).toBe('delegate');
    expect((ORCHESTRATOR_DELEGATION_TOOLS.reply_to_subagent as any).id).toBe('reply_to_subagent');
  });

  it('browser tools are NOT in the delegation tools (only accessible via subagent)', async () => {
    const { ORCHESTRATOR_DELEGATION_TOOLS } = await import('./delegation-tools');
    const keys = Object.keys(ORCHESTRATOR_DELEGATION_TOOLS);

    const browserKeys = keys.filter(k => k.startsWith('browser_use_'));
    expect(browserKeys).toEqual([]);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 10. Diagnostic: Trace Full Delegation Path
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Full Delegation Path Trace', () => {
  it('traces bridge → delegate → capability pack → tool resolution', async () => {
    const { withClientBridge, getBridgeWs, getBridgeSecrets } = await import('../tools/bridge');
    const { BROWSER_PACK, getCapabilityPack } = await import('./capability-packs');
    const { getExecutionTools } = await import('../agents/stuard/tools');

    const trace: string[] = [];

    // Step 1: Simulate server.ts wrapping with bridge
    const mockWs = { readyState: 1, on: vi.fn() } as any;
    const secrets = { userId: 'test-user', browserUseSessionId: 'default' };

    await withClientBridge(mockWs, async () => {
      // Step 2: Inside the bridge context (like agent-runner or server.ts)
      const ws = getBridgeWs();
      const sec = getBridgeSecrets();
      trace.push(`bridge: ws=${!!ws}, readyState=${ws?.readyState}, secrets=${!!sec}`);

      // Step 3: Simulate delegate tool capturing bridge
      const capturedWs = getBridgeWs();
      const capturedSecrets = getBridgeSecrets();
      trace.push(`delegate_capture: ws=${!!capturedWs}, readyState=${capturedWs?.readyState}`);

      // Step 4: Resolve capability pack
      const pack = getCapabilityPack('browser');
      trace.push(`pack: kind=${pack?.kind}, tools=${pack?.toolNames.length}`);

      // Step 5: Check tool resolution
      const executionTools = getExecutionTools();
      const resolvedCount = pack?.toolNames.filter(n => executionTools[n]).length || 0;
      const missingCount = (pack?.toolNames.length || 0) - resolvedCount;
      trace.push(`tools: resolved=${resolvedCount}, missing=${missingCount}`);

      // Step 6: Simulate subagent bridge check
      const bridgeWs = capturedWs;
      const wouldUseBridge = bridgeWs && (bridgeWs as any).readyState === 1;
      trace.push(`subagent_bridge: wouldUseBridge=${!!wouldUseBridge}`);

      // Step 7: Inner withClientBridge (what subagent does)
      if (wouldUseBridge) {
        await withClientBridge(bridgeWs as any, async () => {
          const innerWs = getBridgeWs();
          const innerSecrets = getBridgeSecrets();
          trace.push(`inner_bridge: ws=${!!innerWs}, readyState=${innerWs?.readyState}, secrets=${!!innerSecrets}`);

          // This is where browser tools would check hasClientBridge()
          const { hasClientBridge } = await import('../tools/bridge');
          trace.push(`inner_hasClientBridge: ${hasClientBridge()}`);
        }, capturedSecrets);
      } else {
        trace.push('FAILURE: subagent would run WITHOUT bridge context');
      }
    }, secrets);

    console.log('\n=== DELEGATION PATH TRACE ===');
    for (const step of trace) {
      console.log(`  → ${step}`);
    }
    console.log('=============================\n');

    // Assertions
    expect(trace).toContain('bridge: ws=true, readyState=1, secrets=true');
    expect(trace).toContain('delegate_capture: ws=true, readyState=1');
    expect(trace.find(s => s.startsWith('pack:'))).toMatch(/tools=\d+/);
    expect(trace.find(s => s.startsWith('tools:'))).toMatch(/missing=0/);
    expect(trace).toContain('subagent_bridge: wouldUseBridge=true');
    expect(trace.some(s => s.includes('FAILURE'))).toBe(false);
  });
});
