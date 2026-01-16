import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const waitTool = createTool({
  id: 'wait',
  description: 'Wait for a specified number of milliseconds. Useful to delay between actions.',
  inputSchema: z.object({
    milliseconds: z.number().int().min(0).describe('Time to wait in milliseconds'),
    message: z.string().optional().describe('Optional status message to emit'),
  }),
  outputSchema: z.object({
    waitedMs: z.number(),
  }),
  execute: async ({ context, writer }) => {
    const { milliseconds, message } = context as { milliseconds: number; message?: string };
    const start = Date.now();
    const step = Math.max(250, Math.min(2000, Math.floor(milliseconds / 10) || 250));
    let sent = 0;

    await (writer as any)?.write?.({ type: 'tool_event', tool: 'wait', status: 'started', milliseconds, message });

    while (sent < milliseconds) {
      const remain = Math.max(0, milliseconds - sent);
      await new Promise((r) => setTimeout(r, Math.min(step, remain)));
      sent = Date.now() - start;
      await (writer as any)?.write?.({ type: 'tool_event', tool: 'wait', status: 'progress', elapsedMs: sent, remainingMs: Math.max(0, milliseconds - sent) });
    }

    await (writer as any)?.write?.({ type: 'tool_event', tool: 'wait', status: 'completed', waitedMs: milliseconds });

    return { waitedMs: milliseconds };
  },
});
