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
      // Check for bridge if noFallback is set
      if (noFallback && !hasClientBridge()) {
        return { ok: false, error: `No desktop bridge available. ${id} requires the Stuard desktop app.` };
      }
      const t = typeof timeoutMs === 'function' ? (timeoutMs as any)(inputData) : timeoutMs;
      // Use client bridge when available; fallback to direct local agent WS when not (unless noFallback)
      const result = await execLocalTool(id, inputData as any, writer as any, typeof t === 'number' ? t : undefined, { noFallback });
      return result;
    },
  });
}
