import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  execLocalToolMock,
  embedMock,
  generateObjectMock,
  generateTextMock,
  writeLogMock,
} = vi.hoisted(() => {
  return {
    execLocalToolMock: vi.fn(),
    embedMock: vi.fn(),
    generateObjectMock: vi.fn(),
    generateTextMock: vi.fn(),
    writeLogMock: vi.fn(),
  };
});

vi.mock('../tools/bridge', () => {
  return {
    execLocalTool: execLocalToolMock,
  };
});

vi.mock('@ai-sdk/openai', () => {
  return {
    openai: {
      embedding: () => ({})
    },
  };
});

vi.mock('@ai-sdk/google', () => {
  return {
    createGoogleGenerativeAI: () => {
      const provider = ((modelId?: string) => ({ modelId })) as any;
      provider.textEmbeddingModel = (modelId?: string) => ({ modelId });
      return provider;
    },
  };
});

vi.mock('ai', () => {
  return {
    embed: embedMock,
    generateObject: generateObjectMock,
    generateText: generateTextMock,
  };
});

vi.mock('../utils/logger', () => {
  return {
    writeLog: writeLogMock,
  };
});

import { processConversationTurn, searchSegments } from './conversations';

describe('Conversation memory pipeline', () => {
  beforeEach(() => {
    execLocalToolMock.mockReset();
    embedMock.mockReset();
    generateObjectMock.mockReset();
    generateTextMock.mockReset();
    writeLogMock.mockReset();
  });

  it('creates a segment with summary/topics and a 3072-dim embedding', async () => {
    const conversationId = 'conv_1';
    const embedding = Array.from({ length: 3072 }, (_, i) => i / 3072);

    generateObjectMock.mockResolvedValue({
      object: {
        action: 'new',
        summary: 'User asked about a calendar bug and possible fixes.',
        topics: ['calendar', 'bug'],
        reason: 'New topic',
      },
    });

    embedMock.mockResolvedValue({ embedding });

    execLocalToolMock.mockImplementation(async (tool: string, args: any) => {
      switch (tool) {
        case 'conversation_get':
          return {
            ok: true,
            conversation: {
              id: conversationId,
              title: 'Existing',
              model: 'test',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              message_count: 0,
              status: 'active',
            },
          };
        case 'segment_list':
          return { ok: true, segments: [] };
        case 'segment_create':
          return {
            ok: true,
            segment: {
              id: 'seg_1',
              conversation_id: conversationId,
              start_turn: args.start_turn,
              end_turn: args.end_turn ?? null,
              summary: args.summary,
              topics: args.topics,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          };
        case 'conversation_update':
          return {
            ok: true,
            conversation: {
              id: conversationId,
              title: 'Existing',
              model: 'test',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              message_count: 0,
              status: 'active',
            },
          };
        default:
          return { ok: false, error: `unexpected tool: ${tool}` };
      }
    });

    await processConversationTurn(conversationId, [
      { role: 'user', content: 'Do you remember the calendar bug we discussed?' },
      { role: 'assistant', content: 'Yes, we looked at the reschedule flow.' },
    ]);

    const segmentCreateCall = execLocalToolMock.mock.calls.find(([tool]) => tool === 'segment_create');
    expect(segmentCreateCall).toBeTruthy();

    const [, segmentArgs] = segmentCreateCall!;
    expect(segmentArgs.summary).toContain('calendar bug');
    expect(segmentArgs.topics).toEqual(['calendar', 'bug']);
    expect(Array.isArray(segmentArgs.embedding)).toBe(true);
    expect(segmentArgs.embedding).toHaveLength(3072);

    const embedValueCalls = embedMock.mock.calls.map((c) => c?.[0]?.value).filter(Boolean);
    expect(embedValueCalls.some((v: string) => String(v).includes('Topics: calendar, bug'))).toBe(true);
  });

  it('creates a segment but omits embedding if embedding generation fails', async () => {
    const conversationId = 'conv_2';

    generateObjectMock.mockResolvedValue({
      object: {
        action: 'new',
        summary: 'Conversation about workflows.',
        topics: ['workflows'],
        reason: 'New topic',
      },
    });

    embedMock.mockImplementation(async () => {
      throw new Error('embedding failed');
    });

    execLocalToolMock.mockImplementation(async (tool: string, args: any) => {
      switch (tool) {
        case 'conversation_get':
          return {
            ok: true,
            conversation: {
              id: conversationId,
              title: 'Existing',
              model: 'test',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              message_count: 0,
              status: 'active',
            },
          };
        case 'segment_list':
          return { ok: true, segments: [] };
        case 'segment_create':
          return {
            ok: true,
            segment: {
              id: 'seg_2',
              conversation_id: conversationId,
              start_turn: args.start_turn,
              end_turn: args.end_turn ?? null,
              summary: args.summary,
              topics: args.topics,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          };
        case 'conversation_update':
          return { ok: true, conversation: { id: conversationId } };
        default:
          return { ok: false };
      }
    });

    await processConversationTurn(conversationId, [
      { role: 'user', content: 'Lets talk about workflow testing.' },
      { role: 'assistant', content: 'Sure.' },
    ]);

    const segmentCreateCall = execLocalToolMock.mock.calls.find(([tool]) => tool === 'segment_create');
    expect(segmentCreateCall).toBeTruthy();

    const [, segmentArgs] = segmentCreateCall!;
    expect(segmentArgs.embedding).toBeUndefined();

    const missingLog = writeLogMock.mock.calls.some(([event]) => event === 'segment_embedding_missing');
    expect(missingLog).toBe(true);
  });

  it('passes threshold 0.0 through to segment_search (does not default to 0.6)', async () => {
    const embedding = Array.from({ length: 3072 }, () => 0);
    embedMock.mockResolvedValue({ embedding });

    execLocalToolMock.mockResolvedValue({
      ok: true,
      results: [],
    });

    await searchSegments('airport', { limit: 5, threshold: 0.0 });

    expect(execLocalToolMock).toHaveBeenCalledTimes(1);
    const [tool, args] = execLocalToolMock.mock.calls[0];
    expect(tool).toBe('segment_search');
    expect(args.limit).toBe(5);
    expect(args.threshold).toBe(0.0);
  });

});
