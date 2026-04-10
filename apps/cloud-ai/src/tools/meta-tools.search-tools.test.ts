import { beforeEach, describe, expect, it, vi } from 'vitest';
import { search_tools } from './meta-tools';

const {
  getSupabaseServiceMock,
  resolveEmbedderMock,
  embedManyMock,
} = vi.hoisted(() => ({
  getSupabaseServiceMock: vi.fn(),
  resolveEmbedderMock: vi.fn(),
  embedManyMock: vi.fn(),
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
}));

function createQueryBuilder(response: { data: any; error: any }) {
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (resolve: (value: any) => any, reject?: (reason: any) => any) =>
      Promise.resolve(response).then(resolve, reject),
  };
  return builder;
}

describe('search_tools Supabase-backed discovery', () => {
  beforeEach(() => {
    getSupabaseServiceMock.mockReset();
    resolveEmbedderMock.mockReset();
    embedManyMock.mockReset();
  });

  it('lists categories from tool_embeddings instead of the in-memory registry', async () => {
    const builder = createQueryBuilder({
      data: [
        { category: 'Workflow' },
        { category: 'AI' },
        { category: 'Workflow' },
      ],
      error: null,
    });
    const fromMock = vi.fn(() => builder);

    getSupabaseServiceMock.mockReturnValue({
      from: fromMock,
      rpc: vi.fn(),
    });

    const result = await (search_tools as any).execute({ list_categories: true });

    expect(fromMock).toHaveBeenCalledWith('tool_embeddings');
    expect(builder.select).toHaveBeenCalledWith('category');
    expect(builder.eq).toHaveBeenCalledWith('enabled', true);
    expect(result.tools).toEqual([
      { name: 'AI', description: '', category: 'AI' },
      { name: 'Workflow', description: '', category: 'Workflow' },
    ]);
  });

  it('lists category-filtered tools from tool_embeddings when no free-text query is provided', async () => {
    const builder = createQueryBuilder({
      data: [
        { name: 'run_command', description: 'Run a shell command', category: 'System' },
        { name: 'run_python_script', description: 'Execute Python', category: 'System' },
      ],
      error: null,
    });
    const fromMock = vi.fn(() => builder);

    getSupabaseServiceMock.mockReturnValue({
      from: fromMock,
      rpc: vi.fn(),
    });

    const result = await (search_tools as any).execute({ category: 'System', limit: 5 });

    expect(fromMock).toHaveBeenCalledWith('tool_embeddings');
    expect(builder.select).toHaveBeenCalledWith('name, description, category');
    expect(builder.eq).toHaveBeenCalledWith('enabled', true);
    expect(builder.order).toHaveBeenCalledWith('name', { ascending: true });
    expect(builder.limit).toHaveBeenCalledWith(5);
    expect(builder.eq).toHaveBeenCalledWith('category', 'System');
    expect(result.tools).toEqual([
      { name: 'run_command', description: 'Run a shell command', category: 'System' },
      { name: 'run_python_script', description: 'Execute Python', category: 'System' },
    ]);
  });

  it('uses the search_tools pgvector RPC for free-text tool search', async () => {
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

    const result = await (search_tools as any).execute({ query: 'open a website', limit: 7 });

    expect(resolveEmbedderMock).toHaveBeenCalledTimes(1);
    expect(embedManyMock).toHaveBeenCalledWith({
      model: expect.anything(),
      values: ['open a website'],
    });
    expect(rpcMock).toHaveBeenCalledWith('search_tools', {
      query_embedding: [0.11, 0.22, 0.33],
      match_threshold: 0.25,
      match_count: 7,
      filter_category: null,
      filter_kind: null,
      enabled_only: true,
    });
    expect(result.tools).toEqual([
      { name: 'browser_use_navigate', description: 'Go to a URL', category: 'GUI' },
    ]);
  });
});
