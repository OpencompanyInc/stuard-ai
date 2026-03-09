import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, getBridgeSecrets, hasClientBridge } from '../bridge';

export { execLocalTool, getBridgeSecrets, hasClientBridge };

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

      // Check for bridge if noFallback is set
      if (noFallback && !hasClientBridge()) {
        return { ok: false, error: `No desktop bridge available. ${id} requires the Stuard desktop app.` };
      }
      const t = typeof timeoutMs === 'function' ? (timeoutMs as any)(effectiveInput) : timeoutMs;
      // Use client bridge when available; fallback to direct local agent WS when not (unless noFallback)
      const result = await execLocalTool(id, effectiveInput as any, writer as any, typeof t === 'number' ? t : undefined, { noFallback });
      return result;
    },
  });
}
