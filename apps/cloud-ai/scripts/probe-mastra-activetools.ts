/**
 * Does Mastra's agent.stream() serialize ALL tools to the provider, or only the
 * activeTools subset? Build a real Mastra Agent with 6 tools + activeTools=[3],
 * swap in a mock model that captures opts.tools, and see how many it receives.
 */
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

function mk(id: string) {
  return createTool({
    id,
    description: `tool ${id}`,
    inputSchema: z.object({ x: z.string().optional() }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async () => ({ ok: true }),
  });
}

const tools = {
  alpha: mk('alpha'), bravo: mk('bravo'), charlie: mk('charlie'),
  delta: mk('delta'), echo: mk('echo'), foxtrot: mk('foxtrot'),
};

let captured: any[] | undefined;
const mockModel: any = {
  specificationVersion: 'v2',
  provider: 'mock',
  modelId: 'mock/model',
  supportedUrls: {},
  async doStream(opts: any) { captured = opts.tools; throw new Error('__CAP__'); },
  async doGenerate(opts: any) { captured = opts.tools; throw new Error('__CAP__'); },
};

async function main() {
  const agent = new Agent({
    id: 'probe', name: 'probe',
    instructions: 'test',
    model: mockModel,
    tools,
  });

  const activeTools = ['alpha', 'bravo', 'charlie'];
  try {
    const r: any = await (agent as any).stream(
      [{ role: 'user', content: 'hi' }],
      { activeTools },
    );
    // drain whichever stream shape Mastra returns
    if (r?.textStream) { for await (const _ of r.textStream) { /* */ } }
    else if (r?.fullStream) { for await (const _ of r.fullStream) { /* */ } }
  } catch (e: any) {
    // expected __CAP__
  }

  if (!captured) { console.log('No capture (stream shape differs). Trying generate...'); }
  try {
    if (!captured) {
      await (agent as any).generate([{ role: 'user', content: 'hi' }], { activeTools });
    }
  } catch {}

  if (!captured) { console.log('STILL no capture.'); console.log('Done.'); return; }
  const names = captured.map((t: any) => t?.name);
  console.log(`activeTools passed: [${activeTools.join(',')}] (3)`);
  console.log(`tools serialized to model: ${captured.length} → [${names.join(',')}]`);
  console.log(captured.length === 3 ? 'RESULT: Mastra FILTERS by activeTools (only active serialized).'
                                    : 'RESULT: Mastra serializes ALL tools (activeTools only gates calls).');
  console.log('Done.');
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
