import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, getBridgeSecrets, hasClientBridge } from '../bridge';

export { execLocalTool, getBridgeSecrets, hasClientBridge };

/**
 * Route a tool call to the user's VM agent via HTTP when no desktop bridge is available.
 * This allows browser_use_* and other device tools to run headlessly on the VM.
 */
async function execViaVM(toolId: string, args: any, timeoutMs: number): Promise<any> {
  const secrets = getBridgeSecrets();
  const userId = secrets?.userId;
  if (!userId) return null; // no user context — can't route to VM

  try {
    const { sendVMCommand, resolveVMAddress } = await import('../../services/vm-command');
    const vmIp = await resolveVMAddress(userId);
    if (!vmIp) return null; // no VM running

    // Forward as a tool_exec command to the VM's Python agent via the Node.js relay
    const result = await sendVMCommand(userId, 'tool_exec', { tool: toolId, args }, timeoutMs);
    if (result.ok && result.result) return result.result;
    if (!result.ok && result.error === 'vm_not_reachable') return null;
    return result.result || { ok: false, error: result.error || 'vm_tool_failed' };
  } catch {
    return null; // VM routing failed — fall through to error
  }
}

export function makeLocalTool(
  id: string,
  description: string,
  inputSchema: any,
  outputSchema?: any,
  timeoutMs?: number | ((ctx: any) => number),
  options?: { noFallback?: boolean },
) {
  const noFallback = options?.noFallback ?? false;
  return createTool({
    id,
    description,
    inputSchema,
    outputSchema: outputSchema || z.any(),
    execute: async (inputData, { writer }) => {
      const effectiveInput = (() => {
        if (!id.startsWith('browser_use_')) return inputData;
        const base = inputData && typeof inputData === 'object' ? { ...(inputData as any) } : {};
        const secrets = getBridgeSecrets();
        const injectedSessionId = String(base.session_id || secrets?.browserUseSessionId || '').trim();
        if (injectedSessionId) {
          base.session_id = injectedSessionId;
        }
        return base;
      })();

      // Desktop bridge available — use it (fastest path)
      if (hasClientBridge()) {
        const t = typeof timeoutMs === 'function' ? (timeoutMs as any)(effectiveInput) : timeoutMs;
        return await execLocalTool(id, effectiveInput as any, writer as any, typeof t === 'number' ? t : undefined, { noFallback });
      }

      // No desktop bridge — try routing to VM for tools that can run headless
      if (noFallback && id.startsWith('browser_use_')) {
        const t = typeof timeoutMs === 'function' ? (timeoutMs as any)(effectiveInput) : timeoutMs;
        const vmResult = await execViaVM(id, effectiveInput, typeof t === 'number' ? t : 60000);
        if (vmResult !== null) return vmResult;
        return { ok: false, error: `No desktop or VM available. ${id} requires a running Stuard desktop app or cloud VM.` };
      }

      if (noFallback) {
        return { ok: false, error: `No desktop bridge available. ${id} requires the Stuard desktop app.` };
      }

      const t = typeof timeoutMs === 'function' ? (timeoutMs as any)(effectiveInput) : timeoutMs;
      return await execLocalTool(id, effectiveInput as any, writer as any, typeof t === 'number' ? t : undefined, { noFallback });
    },
  });
}
