import { describe, expect, it, vi } from 'vitest';

describe('execution tools bootstrap', () => {
  it('registers the execution tool universe on demand', async () => {
    vi.resetModules();

    const resolver = await import('./execution-tools-resolver');
    expect(resolver.hasExecutionToolsRegistered()).toBe(false);
    expect(() => resolver.resolveExecutionTools()).toThrow(/Execution tools not registered/i);

    const { ensureExecutionToolsRegistered } = await import('./execution-tools-bootstrap');
    await ensureExecutionToolsRegistered();

    expect(resolver.hasExecutionToolsRegistered()).toBe(true);

    const tools = resolver.resolveExecutionTools();
    expect(tools.read_file).toBeDefined();
    expect(typeof (tools.read_file as any).execute).toBe('function');
  });

  it('is safe to call repeatedly', async () => {
    vi.resetModules();

    const resolver = await import('./execution-tools-resolver');
    const { ensureExecutionToolsRegistered } = await import('./execution-tools-bootstrap');

    await Promise.all([
      ensureExecutionToolsRegistered(),
      ensureExecutionToolsRegistered(),
      ensureExecutionToolsRegistered(),
    ]);

    expect(resolver.hasExecutionToolsRegistered()).toBe(true);
    expect(() => resolver.resolveExecutionTools()).not.toThrow();
  });
});
