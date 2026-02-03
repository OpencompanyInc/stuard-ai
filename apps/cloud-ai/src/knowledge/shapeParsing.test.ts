import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const execLocalToolMock = vi.fn();
const hasClientBridgeMock = vi.fn(() => true);
const writeLogMock = vi.fn();

const extractKnowledgeMock = vi.fn();

vi.mock('../tools/bridge', () => ({
  execLocalTool: execLocalToolMock,
  hasClientBridge: hasClientBridgeMock,
}));

vi.mock('../utils/logger', () => ({
  writeLog: writeLogMock,
}));

vi.mock('./extraction', () => ({
  extractKnowledge: extractKnowledgeMock,
}));

let ingestion: typeof import('./ingestion');
let retrieval: typeof import('./retrieval');

beforeAll(async () => {
  ingestion = await import('./ingestion');
  retrieval = await import('./retrieval');
});

beforeEach(() => {
  execLocalToolMock.mockReset();
  hasClientBridgeMock.mockReset();
  hasClientBridgeMock.mockReturnValue(true);
  writeLogMock.mockReset();
  extractKnowledgeMock.mockReset();
});

describe('knowledge tool response shape parsing', () => {
  it('ingestion passes parsed existingContext to extractKnowledge (array results)', async () => {
    execLocalToolMock.mockImplementation(async (tool: string) => {
      if (tool === 'knowledge_get_identity') {
        return [
          { attribute_key: 'name', text: 'Alice' },
          { attribute_key: 'os', text: 'Windows 11' },
        ];
      }
      if (tool === 'knowledge_list_entities') {
        return [
          { name: 'StuardAI', type: 'project', summary: 'Assistant project' },
          { name: 'OpenAI', type: 'company', summary: '' },
        ];
      }
      if (tool === 'knowledge_get_bio') {
        return [
          { text: 'Prefers concise answers', category: 'personal.bio' },
        ];
      }
      throw new Error(`unexpected tool: ${tool}`);
    });

    extractKnowledgeMock.mockResolvedValue({ actions: [], detected_entities: [] });

    await ingestion.ingestConversationTurn(
      [{ role: 'user', content: 'Hello' }],
      { skipExtraction: false, skipEmbeddings: true }
    );

    expect(extractKnowledgeMock).toHaveBeenCalledTimes(1);
    expect(extractKnowledgeMock).toHaveBeenCalledWith(
      [{ role: 'user', content: 'Hello' }],
      {
        profile: { name: 'Alice', os: 'Windows 11' },
        entities: [
          { name: 'StuardAI', type: 'project', summary: 'Assistant project' },
          { name: 'OpenAI', type: 'company', summary: '' },
        ],
        recentFacts: [
          { text: 'Prefers concise answers', category: 'personal.bio' },
        ],
      }
    );
  });

  it('ingestion passes parsed existingContext to extractKnowledge (wrapped results)', async () => {
    execLocalToolMock.mockImplementation(async (tool: string) => {
      if (tool === 'knowledge_get_identity') {
        return {
          facts: [
            { attribute_key: 'timezone', text: 'UTC+1' },
          ],
        };
      }
      if (tool === 'knowledge_list_entities') {
        return {
          entities: [
            { name: 'StuardAI', type: 'project', summary: 'Assistant project' },
          ],
        };
      }
      if (tool === 'knowledge_get_bio') {
        return {
          facts: [
            { text: 'Lives in Lagos', category: 'personal.bio' },
          ],
        };
      }
      throw new Error(`unexpected tool: ${tool}`);
    });

    extractKnowledgeMock.mockResolvedValue({ actions: [], detected_entities: [] });

    await ingestion.ingestConversationTurn(
      [{ role: 'user', content: 'Hello' }],
      { skipExtraction: false, skipEmbeddings: true }
    );

    expect(extractKnowledgeMock).toHaveBeenCalledTimes(1);
    expect(extractKnowledgeMock).toHaveBeenCalledWith(
      [{ role: 'user', content: 'Hello' }],
      {
        profile: { timezone: 'UTC+1' },
        entities: [
          { name: 'StuardAI', type: 'project', summary: 'Assistant project' },
        ],
        recentFacts: [
          { text: 'Lives in Lagos', category: 'personal.bio' },
        ],
      }
    );
  });

  it('retrieval lenses and detectEntities accept wrapped list_entities response', async () => {
    hasClientBridgeMock.mockReturnValue(true);

    execLocalToolMock.mockImplementation(async (tool: string) => {
      if (tool === 'knowledge_list_entities') {
        return {
          entities: [
            { name: 'StuardAI' },
            { name: 'Other' },
          ],
        };
      }
      if (tool === 'knowledge_get_identity') {
        return {
          facts: [{ id: '1', category: 'personal.core', subtype: 'profile', attribute_key: 'name', text: 'Alice', created_at: '', validity: true, source: '' }],
        };
      }
      if (tool === 'knowledge_get_directives') {
        return [];
      }
      if (tool === 'knowledge_get_bio') {
        return [];
      }
      throw new Error(`unexpected tool: ${tool}`);
    });

    const detected = await retrieval.detectEntities('Working on StuardAI today');
    expect(detected).toEqual(['StuardAI']);

    const identity = await retrieval.getIdentityLens();
    expect(Array.isArray(identity)).toBe(true);
    expect(identity.length).toBe(1);
    expect(identity[0]?.text).toBe('Alice');
  });
});
