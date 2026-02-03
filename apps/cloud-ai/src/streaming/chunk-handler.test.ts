import { describe, it, expect } from 'vitest';
import { parseChunk, updateStreamState, isSISMetaTool } from './chunk-handler';
import { createStreamState } from './types';

describe('parseChunk', () => {
  describe('text-delta events', () => {
    it('should parse text-delta with payload', () => {
      const chunk = { type: 'text-delta', payload: { text: 'Hello' } };
      const result = parseChunk(chunk);
      expect(result).toEqual({ type: 'text-delta', text: 'Hello' });
    });

    it('should parse text-delta with direct text property', () => {
      const chunk = { type: 'text-delta', text: 'World' };
      const result = parseChunk(chunk);
      expect(result).toEqual({ type: 'text-delta', text: 'World' });
    });

    it('should return null for empty text-delta', () => {
      const chunk = { type: 'text-delta', payload: { text: '' } };
      const result = parseChunk(chunk);
      expect(result).toBeNull();
    });

    it('should handle raw string as text-delta', () => {
      const result = parseChunk('Hello world');
      expect(result).toEqual({ type: 'text-delta', text: 'Hello world' });
    });
  });

  describe('tool-call events', () => {
    it('should parse tool-call with payload', () => {
      const chunk = {
        type: 'tool-call',
        payload: {
          toolCallId: 'tc-123',
          toolName: 'web_search',
          args: { query: 'test' },
        },
      };
      const result = parseChunk(chunk);
      expect(result).toEqual({
        type: 'tool-call',
        toolCallId: 'tc-123',
        toolName: 'web_search',
        args: { query: 'test' },
      });
    });

    it('should generate toolCallId if missing', () => {
      const chunk = {
        type: 'tool-call',
        payload: { toolName: 'my_tool', args: {} },
      };
      const result = parseChunk(chunk);
      expect(result?.type).toBe('tool-call');
      expect((result as any).toolCallId).toMatch(/^tc-\d+$/);
    });
  });

  describe('tool-result events', () => {
    it('should parse tool-result with payload', () => {
      const chunk = {
        type: 'tool-result',
        payload: {
          toolCallId: 'tc-123',
          toolName: 'web_search',
          result: { data: 'results' },
        },
      };
      const result = parseChunk(chunk);
      expect(result).toEqual({
        type: 'tool-result',
        toolCallId: 'tc-123',
        toolName: 'web_search',
        result: { data: 'results' },
      });
    });
  });

  describe('finish events', () => {
    it('should parse finish with text and usage', () => {
      const chunk = {
        type: 'finish',
        payload: {
          text: 'Final response',
          usage: { promptTokens: 100, completionTokens: 50 },
          finishReason: 'stop',
        },
      };
      const result = parseChunk(chunk);
      expect(result).toEqual({
        type: 'finish',
        text: 'Final response',
        usage: { promptTokens: 100, completionTokens: 50 },
        finishReason: 'stop',
      });
    });

    it('should extract text from nested response object', () => {
      const chunk = {
        type: 'finish',
        payload: {
          response: { text: 'Nested text' },
        },
      };
      const result = parseChunk(chunk);
      expect(result?.type).toBe('finish');
      expect((result as any).text).toBe('Nested text');
    });
  });

  describe('error events', () => {
    it('should parse error with message', () => {
      const chunk = {
        type: 'error',
        payload: { message: 'Something went wrong', code: 'ERR_001' },
      };
      const result = parseChunk(chunk);
      expect(result).toEqual({
        type: 'error',
        message: 'Something went wrong',
        code: 'ERR_001',
      });
    });
  });

  describe('ignored events', () => {
    it.each([
      'reasoning-start',
      'thinking-start',
      'reasoning-delta',
      'thinking-delta',
      'reasoning-end',
      'thinking-end',
      'step-finish',
      'step-start',
      'response-metadata',
    ])('should return null for %s', (eventType) => {
      const chunk = { type: eventType };
      expect(parseChunk(chunk)).toBeNull();
    });
  });

  describe('legacy formats', () => {
    it('should parse legacy textDelta property', () => {
      const chunk = { textDelta: 'Legacy text' };
      const result = parseChunk(chunk);
      expect(result).toEqual({ type: 'text-delta', text: 'Legacy text' });
    });

    it('should parse legacy delta property', () => {
      const chunk = { delta: 'Delta text' };
      const result = parseChunk(chunk);
      expect(result).toEqual({ type: 'text-delta', text: 'Delta text' });
    });

    it('should parse legacy toolCall format', () => {
      const chunk = {
        toolCall: { id: 'tc-456', name: 'old_tool', args: { foo: 'bar' } },
      };
      const result = parseChunk(chunk);
      expect(result).toEqual({
        type: 'tool-call',
        toolCallId: 'tc-456',
        toolName: 'old_tool',
        args: { foo: 'bar' },
      });
    });
  });

  describe('unknown chunks', () => {
    it('should return null for unknown type', () => {
      const chunk = { type: 'unknown_type' };
      expect(parseChunk(chunk)).toBeNull();
    });

    it('should return null for null input', () => {
      expect(parseChunk(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(parseChunk(undefined)).toBeNull();
    });
  });
});

describe('updateStreamState', () => {
  it('should accumulate text from text-delta events', () => {
    const state = createStreamState();
    updateStreamState(state, { type: 'text-delta', text: 'Hello ' });
    updateStreamState(state, { type: 'text-delta', text: 'World' });

    expect(state.text).toBe('Hello World');
    expect(state.sawTextDelta).toBe(true);
    expect(state.chunks).toHaveLength(1);
    expect(state.chunks[0]).toEqual({ type: 'text', content: 'Hello World' });
  });

  it('should track tool calls', () => {
    const state = createStreamState();
    updateStreamState(state, {
      type: 'tool-call',
      toolCallId: 'tc-1',
      toolName: 'my_tool',
      args: { key: 'value' },
    });

    expect(state.sawToolCall).toBe(true);
    expect(state.toolCalls.size).toBe(1);
    const tracked = state.toolCalls.get('tc-1');
    expect(tracked?.status).toBe('called');
    expect(tracked?.tool).toBe('my_tool');
  });

  it('should update tool call status on result', () => {
    const state = createStreamState();
    updateStreamState(state, {
      type: 'tool-call',
      toolCallId: 'tc-1',
      toolName: 'my_tool',
      args: {},
    });
    updateStreamState(state, {
      type: 'tool-result',
      toolCallId: 'tc-1',
      toolName: 'my_tool',
      result: { success: true },
    });

    const tracked = state.toolCalls.get('tc-1');
    expect(tracked?.status).toBe('completed');
    expect(tracked?.result).toEqual({ success: true });
  });

  it('should set finish reason and usage on finish event', () => {
    const state = createStreamState();
    updateStreamState(state, {
      type: 'finish',
      text: 'Final',
      usage: { promptTokens: 100, completionTokens: 50 },
      finishReason: 'stop',
    });

    expect(state.finishReason).toBe('stop');
    expect(state.usage).toEqual({ promptTokens: 100, completionTokens: 50 });
  });
});

describe('isSISMetaTool', () => {
  it('should return true for SIS meta-tools', () => {
    expect(isSISMetaTool('sis_execute_tool')).toBe(true);
    expect(isSISMetaTool('sis_search_tools')).toBe(true);
    expect(isSISMetaTool('search_past_conversations')).toBe(true);
  });

  it('should return false for regular tools', () => {
    expect(isSISMetaTool('web_search')).toBe(false);
    expect(isSISMetaTool('take_screenshot')).toBe(false);
    expect(isSISMetaTool('run_command')).toBe(false);
  });
});
