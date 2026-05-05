import { describe, expect, it } from 'vitest';
import {
  buildProactiveSessionSummary,
  buildLocalProactiveHiddenContext,
  buildLocalProactivePrompt,
  buildUserFacingProactiveMessage,
  executeAgentToolRequest,
  extractAgentTextFromWsMessage,
  extractAgentToolRequest,
  summarizeProactiveActivity,
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

  it('blocks non-internal tools outside the bot allow-list', async () => {
    const execTool = async () => ({ ok: true });

    await expect(
      executeAgentToolRequest(
        { id: 'req-3', tool: 'run_command', args: {} },
        { agentWsUrl: 'ws://127.0.0.1:8765/ws', cloudAiUrl: 'http://127.0.0.1:8082', logFn: () => {} },
        execTool,
        ['web_search'],
      )
    ).resolves.toEqual({
      type: 'tool_result',
      id: 'req-3',
      result: { ok: false, error: "Tool 'run_command' is not allowed for this bot." },
    });
  });

  it('allows bot task-board tools even with a narrow allow-list', async () => {
    const execTool = async () => ({ ok: true, tasks: [] });

    await expect(
      executeAgentToolRequest(
        { id: 'req-4', tool: 'bot_memory_list', args: {} },
        { agentWsUrl: 'ws://127.0.0.1:8765/ws', cloudAiUrl: 'http://127.0.0.1:8082', logFn: () => {} },
        execTool,
        ['web_search'],
      )
    ).resolves.toEqual({
      type: 'tool_result',
      id: 'req-4',
      result: { ok: true, tasks: [] },
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
    expect(hidden).toContain('Allowed non-internal tools');
    expect(hidden).toContain('web_search');
    expect(hidden).toContain('DO THE WORK');
    expect(hidden).toContain('Email Helper');
  });

  it('injects the last five wake-up summaries with anti-repetition guidance', () => {
    const hidden = buildLocalProactiveHiddenContext({
      context: {
        recentSessionSummaries: [
          '[5m ago] Activity: GitHub · Google Chrome | Intervention: notified the user | Notification: ignored',
        ],
      },
    });

    expect(hidden).toContain('[LAST 5 WAKE-UP SUMMARIES');
    expect(hidden).toContain('change your tack');
    expect(hidden).toContain('Notification: ignored');
  });
});

describe('proactive session summary helpers', () => {
  it('summarizes visible activity from recent windows', () => {
    expect(summarizeProactiveActivity([
      { title: 'Fix tests - StuardAI - Visual Studio Code' },
      { title: 'PR review - GitHub - Google Chrome' },
      { title: 'Team chat - Slack' },
    ])).toContain('Visual Studio Code');
  });

  it('builds a fallback summary when the agent does not write one', () => {
    const summary = buildProactiveSessionSummary({
      openWindows: [
        { title: 'Fix tests - StuardAI - Visual Studio Code' },
        { title: 'PR review - GitHub - Google Chrome' },
      ],
      agentMessage: 'I checked your PR queue and nudged you to finish the open review.',
      taskCount: 2,
    });

    expect(summary).toContain('Activity:');
    expect(summary).toContain('Intervention: notified the user');
    expect(summary).toContain('proactive tasks');
  });

  it('preserves explicit session summaries from the agent', () => {
    expect(buildProactiveSessionSummary({
      existingSummary: 'Activity: Cursor + GitHub | Intervention: skipped — user was already deep in code review.',
      openWindows: [{ title: 'Ignored title' }],
      agentMessage: 'Ignored message',
    })).toBe('Activity: Cursor + GitHub | Intervention: skipped — user was already deep in code review.');
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
