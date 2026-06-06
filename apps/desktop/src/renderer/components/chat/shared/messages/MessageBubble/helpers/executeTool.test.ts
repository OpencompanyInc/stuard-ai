import { describe, expect, it } from 'vitest';
import type { ToolCall } from '../../../../../../hooks/useAgent';
import { unwrapExecuteTool } from './executeTool';

const base = (over: Partial<ToolCall>): ToolCall => ({
  id: 'tc-1',
  tool: 'execute_tool',
  status: 'completed',
  ...over,
}) as ToolCall;

describe('unwrapExecuteTool', () => {
  it('passes non-wrapper tools through unchanged', () => {
    const tc = base({ tool: 'web_search', args: { query: 'cats' } });
    expect(unwrapExecuteTool(tc)).toBe(tc);
  });

  it('surfaces the real tool name + args from the wrapper', () => {
    const out = unwrapExecuteTool(base({
      args: { tool_name: 'generate_image', args: { prompt: 'a fox' } },
      result: { success: true, tool: 'generate_image', result: { path: '/tmp/fox.png' } },
    }));
    expect(out.tool).toBe('generate_image');
    expect(out.args).toEqual({ prompt: 'a fox' });
    expect(out.result).toEqual({ path: '/tmp/fox.png' });
    expect(out.status).toBe('completed');
  });

  it('promotes a failed envelope to an error step', () => {
    const out = unwrapExecuteTool(base({
      args: { tool_name: 'generate_image', args: { prompt: 'x' } },
      result: { success: false, tool: 'generate_image', error: 'bad path' },
    }));
    expect(out.tool).toBe('generate_image');
    expect(out.status).toBe('error');
    expect(out.error).toBe('bad path');
    expect(out.result).toBeUndefined();
  });

  it('keeps the wrapper while tool_name has not streamed in yet', () => {
    const tc = base({ status: 'running', args: {} });
    expect(unwrapExecuteTool(tc).tool).toBe('execute_tool');
  });

  it('preserves identity fields (id, timestamp, parentToolId)', () => {
    const out = unwrapExecuteTool(base({
      id: 'tc-42',
      timestamp: 123,
      parentToolId: 'parent-1',
      args: { tool_name: 'read_file', args: { path: '/a.txt' } },
      result: { success: true, result: 'contents' },
    } as Partial<ToolCall>));
    expect(out.id).toBe('tc-42');
    expect((out as any).timestamp).toBe(123);
    expect((out as any).parentToolId).toBe('parent-1');
  });
});
