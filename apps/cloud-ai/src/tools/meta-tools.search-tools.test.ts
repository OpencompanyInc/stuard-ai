import { beforeEach, describe, expect, it, vi } from 'vitest';
import { search_tools, search_workflow_nodes } from './meta-tools';

const {
  getSupabaseServiceMock,
  resolveEmbedderMock,
  embedManyMock,
  getBridgeSecretsMock,
} = vi.hoisted(() => ({
  getSupabaseServiceMock: vi.fn(),
  resolveEmbedderMock: vi.fn(),
  embedManyMock: vi.fn(),
  getBridgeSecretsMock: vi.fn(() => undefined as any),
}));

vi.mock('../supabase', () => ({
  getSupabaseService: getSupabaseServiceMock,
}));

vi.mock('../utils/embeddings', () => ({
  resolveEmbedder: resolveEmbedderMock,
}));

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    embedMany: embedManyMock,
  };
});

vi.mock('./bridge', () => ({
  execLocalTool: vi.fn(),
  hasClientBridge: vi.fn(() => false),
  getBridgeSecrets: getBridgeSecretsMock,
}));

describe('search_tools Supabase-backed discovery', () => {
  beforeEach(() => {
    getSupabaseServiceMock.mockReset();
    resolveEmbedderMock.mockReset();
    embedManyMock.mockReset();
    getBridgeSecretsMock.mockReset();
    getBridgeSecretsMock.mockReturnValue(undefined);
  });

  it('requires a non-empty query', async () => {
    getSupabaseServiceMock.mockReturnValue({
      from: vi.fn(),
      rpc: vi.fn(),
    });

    const result = await (search_tools as any).execute({ category: 'System' });

    expect(result.error).toBe(true);
    expect(result.message).toContain('query');
  });

  it('uses the search_tools pgvector RPC for required query search', async () => {
    const longDescription = 'Go to a URL. '.repeat(40);
    const rpcMock = vi.fn(async () => ({
      data: [
        { name: 'browser_use_navigate', description: longDescription, category: 'GUI' },
      ],
      error: null,
    }));

    getSupabaseServiceMock.mockReturnValue({
      from: vi.fn(),
      rpc: rpcMock,
    });
    resolveEmbedderMock.mockResolvedValue({ embedder: { id: 'fake-embedder' } });
    embedManyMock.mockResolvedValue({ embeddings: [[0.11, 0.22, 0.33]] });

    const result = await (search_tools as any).execute({ query: '  open a website  ' });

    expect(resolveEmbedderMock).toHaveBeenCalledTimes(1);
    expect(embedManyMock).toHaveBeenCalledWith({
      model: expect.anything(),
      values: ['open a website'],
    });
    expect(rpcMock).toHaveBeenCalledWith('search_tools', {
      query_embedding: [0.11, 0.22, 0.33],
      match_threshold: 0.25,
      match_count: 8,
      filter_category: null,
      filter_kind: null,
      enabled_only: true,
    });
    expect(result.tools[0]).toMatchObject({
      name: 'browser_use_navigate',
      description: longDescription.slice(0, 240),
      category: 'GUI',
    });
    expect(result.tools[0].description.length).toBe(240);
    // search_tools now inlines a compact input signature for registered tools so
    // the model can call execute_tool directly without a get_tool_schema hop.
    expect(result.tools[0].inputSchema).toBeTruthy();
  });

  it('passes category and kind filters to semantic search', async () => {
    const rpcMock = vi.fn(async () => ({
      data: [
        { name: 'run_command', description: 'Run a shell command', category: 'System' },
      ],
      error: null,
    }));

    getSupabaseServiceMock.mockReturnValue({
      from: vi.fn(),
      rpc: rpcMock,
    });
    resolveEmbedderMock.mockResolvedValue({ embedder: { id: 'fake-embedder' } });
    embedManyMock.mockResolvedValue({ embeddings: [[0.11, 0.22, 0.33]] });

    const result = await (search_tools as any).execute({
      query: 'shell command',
      category: 'System',
      kind: 'local',
    });

    expect(rpcMock).toHaveBeenCalledWith('search_tools', {
      query_embedding: [0.11, 0.22, 0.33],
      match_threshold: 0.25,
      match_count: 8,
      filter_category: 'System',
      filter_kind: 'local',
      enabled_only: true,
    });
    expect(result.tools[0]).toMatchObject(
      { name: 'run_command', description: 'Run a shell command', category: 'System' },
    );
  });

  it('merges local registry keyword matches when vector results are stale', async () => {
    const rpcMock = vi.fn(async () => ({
      data: [],
      error: null,
    }));

    getSupabaseServiceMock.mockReturnValue({
      from: vi.fn(),
      rpc: rpcMock,
    });
    resolveEmbedderMock.mockResolvedValue({ embedder: { id: 'fake-embedder' } });
    embedManyMock.mockResolvedValue({ embeddings: [[0.11, 0.22, 0.33]] });

    const result = await (search_tools as any).execute({ query: 'image generation' });

    expect(result.tools.some((tool: any) => tool.name === 'generate_image')).toBe(true);
  });

  it('matches keyword fallback by useful tokens instead of requiring the whole query phrase', async () => {
    getSupabaseServiceMock.mockReturnValue(null);

    const result = await (search_tools as any).execute({ query: 'video recording webcam capture media recording' });

    expect(result.tools.some((tool: any) => tool.name === 'capture_media')).toBe(true);
  });

  it('surfaces a matching custom-integration tool even when semantic search fills the page', async () => {
    // Semantic RPC returns a full page of native tools — none of them custom.
    const fullPage = Array.from({ length: 8 }, (_, i) => ({
      name: `native_search_tool_${i}`,
      description: 'A native tool that mentions search.',
      category: 'System',
    }));
    const rpcMock = vi.fn(async () => ({ data: fullPage, error: null }));

    getSupabaseServiceMock.mockReturnValue({ from: vi.fn(), rpc: rpcMock });
    resolveEmbedderMock.mockResolvedValue({ embedder: { id: 'fake-embedder' } });
    embedManyMock.mockResolvedValue({ embeddings: [[0.11, 0.22, 0.33]] });

    // A deployed custom integration tool lives only on the request-scoped bag.
    getBridgeSecretsMock.mockReturnValue({
      __customCatalog: [
        {
          name: 'google_search_console_list_sites',
          description: '[Google Search Console] List verified sites and search analytics.',
          category: 'Marketing',
        },
      ],
    });

    const result = await (search_tools as any).execute({ query: 'search console sites' });

    // It must appear despite the semantic page already being full (regression:
    // it used to be appended after the page and truncated by the slice).
    expect(result.tools.some((t: any) => t.name === 'google_search_console_list_sites')).toBe(true);
    expect(result.tools.length).toBeLessThanOrEqual(8);
  });

  it('returns schema-enriched workflow node search results in one call', async () => {
    const rpcMock = vi.fn(async () => ({
      data: [
        { name: 'browser_use_navigate', description: 'Go to a URL', category: 'GUI' },
      ],
      error: null,
    }));

    getSupabaseServiceMock.mockReturnValue({
      from: vi.fn(),
      rpc: rpcMock,
    });
    resolveEmbedderMock.mockResolvedValue({ embedder: { id: 'fake-embedder' } });
    embedManyMock.mockResolvedValue({ embeddings: [[0.11, 0.22, 0.33]] });

    const result = await (search_workflow_nodes as any).execute({ query: 'open a website' });

    expect(result.nodes[0].name).toBe('browser_use_navigate');
    expect(result.nodes[0].category).toBe('GUI');
    expect(result.nodes[0].location).toBe('device');
    expect(result.nodes[0].inputSchema).toBeTruthy();
  });
});
