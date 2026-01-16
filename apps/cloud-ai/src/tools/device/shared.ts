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
) {
  return createTool({
    id,
    description,
    inputSchema,
    outputSchema: outputSchema || z.any(),
    execute: async ({ context, writer }) => {
      const t = typeof timeoutMs === 'function' ? (timeoutMs as any)(context) : timeoutMs;
      // Use client bridge when available; fallback to direct local agent WS when not
      const result = await execLocalTool(id, context as any, writer as any, typeof t === 'number' ? t : undefined);
      return result;
    },
  });
}
