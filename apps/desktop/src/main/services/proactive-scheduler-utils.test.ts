import { describe, expect, it } from 'vitest';
import {
  buildLocalProactiveHiddenContext,
  buildLocalProactivePrompt,
  buildUserFacingProactiveMessage,
  executeAgentToolRequest,
  extractAgentTextFromWsMessage,
  extractAgentToolRequest,
} from './proactive-scheduler-utils';

describe('extractAgentTextFromWsMessage', () => {
  it('prefers result.text from websocket final payloads', () => {
    expect(extractAgentTextFromWsMessage({ result: { text: '  hello world  ' } }, 'fallback')).toBe('hello world');
  });

  it('falls back through legacy payload shapes', () => {
    expect(extractAgentTextFromWsMessage({ message: { text: 'legacy text' } }, 'fallback')).toBe('legacy text');
    expect(extractAgentTextFromWsMessage({ text: 'plain text' }, 'fallback')).toBe('plain text');
    expect(extractAgentTextFromWsMessage({ result: { response: 'response text' } }, 'fallback')).toBe('response text');
  });

  it('returns the fallback when no usable text is present', () => {
    expect(extractAgentTextFromWsMessage({ result: { text: '   ' } }, 'fallback text')).toBe('fallback text');
  });
});

describe('proactive tool request helpers', () => {
  it('extracts valid tool_request envelopes', () => {
    expect(extractAgentToolRequest({ type: 'tool_request', id: 'req-1', tool: 'proactive_task_list', args: {} })).toEqual({
      id: 'req-1',
      tool: 'proactive_task_list',
      args: {},
    });
  });

  it('ignores incomplete tool_request messages', () => {
    expect(extractAgentToolRequest({ type: 'tool_request', tool: 'proactive_task_list' })).toBeNull();
    expect(extractAgentToolRequest({ type: 'progress', id: 'req-1', tool: 'proactive_task_list' })).toBeNull();
  });

  it('executes tool requests and wraps the result as a tool_result envelope', async () => {
    const execTool = async () => ({ ok: true, tasks: [{ id: '1' }] });

    await expect(
      executeAgentToolRequest(
        { id: 'req-1', tool: 'proactive_task_list', args: {} },
        { agentWsUrl: 'ws://127.0.0.1:8765/ws', cloudAiUrl: 'http://127.0.0.1:8082', logFn: () => {} },
        execTool,
      )
    ).resolves.toEqual({
      type: 'tool_result',
      id: 'req-1',
      result: { ok: true, tasks: [{ id: '1' }] },
    });
  });

  it('turns tool execution failures into local_exec_failed tool_result payloads', async () => {
    const execTool = async () => {
      throw new Error('boom');
    };

    await expect(
      executeAgentToolRequest(
        { id: 'req-2', tool: 'proactive_task_list', args: {} },
        { agentWsUrl: 'ws://127.0.0.1:8765/ws', cloudAiUrl: 'http://127.0.0.1:8082', logFn: () => {} },
        execTool,
      )
    ).resolves.toEqual({
      type: 'tool_result',
      id: 'req-2',
      result: { ok: false, error: 'boom' },
    });
  });
});

describe('local proactive prompt helpers', () => {
  it('includes tasks inline and is directive about working on them', () => {
    const prompt = buildLocalProactivePrompt({
      tasks: [{ id: 'ptask_1', title: 'Draft email', instructions: 'Send a follow-up', status: 'queued' }],
    });
    expect(prompt).toContain('Draft email');
    expect(prompt).toContain('ptask_1');
    expect(prompt).toContain('Task board: 1 queued, 0 in-progress.');
    expect(prompt).toContain('Work on these silently.');
    expect(prompt).toContain('notification');
  });

  it('handles empty task list gracefully', () => {
    const prompt = buildLocalProactivePrompt({ tasks: [] });
    expect(prompt).toContain('No tasks. Focus on reading the room');
  });

  it('puts directive instructions and skills into hidden context', () => {
    const hidden = buildLocalProactiveHiddenContext({
      config: { instructions: 'Keep me focused', allowedTools: ['web_search'] },
      tasks: [{ title: 'Draft email', instructions: 'Send a follow-up' }],
      skills: [{ name: 'Email Helper', trigger: 'draft email' }],
    });

    expect(hidden).toContain('[PROACTIVE MODE]');
    expect(hidden).toContain('proactive_task_update');
    expect(hidden).toContain('web_search');
    expect(hidden).toContain('DO THE WORK');
    expect(hidden).toContain('Email Helper');
  });
});

describe('buildUserFacingProactiveMessage', () => {
  it('keeps normal user-facing check-ins intact', () => {
    expect(buildUserFacingProactiveMessage('I reviewed your board and finished drafting the follow-up email.')).toBe(
      'I reviewed your board and finished drafting the follow-up email.'
    );
  });

  it('strips internal planning chatter from notifications', () => {
    const raw = [
      'From catalog, it\'s List events from a Google Calendar.',
      'Yes.',
      'So, tool call.',
      '',
      'I checked your current screen and I\'m ready to help.'
    ].join('\n');

    expect(buildUserFacingProactiveMessage(raw)).toBe('I checked your current screen and I\'m ready to help.');
  });

  it('falls back when the message is only internal planning noise', () => {
    const raw = ['From catalog, it\'s List events from a Google Calendar.', 'So, tool call.', 'Yes.'].join('\n');
    expect(buildUserFacingProactiveMessage(raw)).toContain('Open Chat');
  });
});
