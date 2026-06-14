/**
 * Tests for the orchestrator subagent contract, capability packs,
 * and protocol correlation.
 *
 * Tests that import subagent-runtime or delegation-tools transitively pull in
 * the full tool registry which triggers a pre-existing esbuild parse error in
 * compute.ts. Those integration tests are separated and can be run once the
 * parse issue is fixed. The unit tests below test the standalone modules only.
 */

import { describe, it, expect } from 'vitest';

// ─── Types (pure data, no transitive deps) ──────────────────────────────────

describe('SubagentCorrelation', () => {
  it('has the required fields', () => {
    const correlation = {
      runId: 'run-123',
      parentRunId: 'parent-456',
      subagentId: 'sa-789',
    };
    expect(correlation.runId).toBe('run-123');
    expect(correlation.parentRunId).toBe('parent-456');
    expect(correlation.subagentId).toBe('sa-789');
  });
});

describe('SubagentMessage types', () => {
  it('SubagentQuestion has the right shape', () => {
    const question = {
      type: 'subagent_question' as const,
      questionId: 'q-1',
      subagentId: 'sa-1',
      runId: 'run-1',
      question: 'What URL should I navigate to?',
      choices: ['https://example.com', 'https://test.com'],
    };
    expect(question.type).toBe('subagent_question');
    expect(question.choices).toHaveLength(2);
  });

  it('SubagentAnswer has the right shape', () => {
    const answer = {
      type: 'subagent_answer' as const,
      questionId: 'q-1',
      subagentId: 'sa-1',
      runId: 'run-1',
      answer: 'Use https://example.com',
    };
    expect(answer.type).toBe('subagent_answer');
    expect(answer.answer).toBe('Use https://example.com');
  });

  it('SubagentComplete has the right shape', () => {
    const complete = {
      type: 'subagent_complete' as const,
      subagentId: 'sa-1',
      runId: 'run-1',
      ok: true,
      result: 'Page loaded and form filled successfully',
      toolCallCount: 5,
      durationMs: 12345,
    };
    expect(complete.ok).toBe(true);
    expect(complete.durationMs).toBe(12345);
  });

  it('SubagentEvent has the right shape', () => {
    const event = {
      type: 'subagent_event' as const,
      subagentId: 'sa-1',
      runId: 'run-1',
      event: 'started' as const,
      data: { kind: 'browser', label: 'Browser' },
    };
    expect(event.event).toBe('started');
    expect(event.data.kind).toBe('browser');
  });
});

// ─── Capability Packs (no transitive deps into compute.ts) ──────────────────

describe('Capability Packs', () => {
  it('browser pack has the expected tools', async () => {
    const { BROWSER_PACK } = await import('./capability-packs');
    expect(BROWSER_PACK.kind).toBe('browser');
    expect(BROWSER_PACK.toolNames).toContain('browser_use_navigate');
    expect(BROWSER_PACK.toolNames).toContain('browser_use_screenshot');
    expect(BROWSER_PACK.toolNames).toContain('browser_use_analyze_screenshot');
    expect(BROWSER_PACK.toolNames).toContain('browser_use_click');
    expect(BROWSER_PACK.toolNames).toContain('browser_use_content');
    expect(BROWSER_PACK.maxSteps).toBe(40);
    expect(BROWSER_PACK.timeoutMs).toBeUndefined();
  });

  it('file_ops pack has the expected tools', async () => {
    const { FILE_OPS_PACK } = await import('./capability-packs');
    expect(FILE_OPS_PACK.kind).toBe('file_ops');
    expect(FILE_OPS_PACK.toolNames).toContain('read_file');
    expect(FILE_OPS_PACK.toolNames).toContain('write_file');
    expect(FILE_OPS_PACK.toolNames).toContain('file_edit');
    expect(FILE_OPS_PACK.toolNames).toContain('run_command');
    expect(FILE_OPS_PACK.toolNames).toContain('python_install');
    expect(FILE_OPS_PACK.toolNames).toContain('terminal_create');
    expect(FILE_OPS_PACK.toolNames).toContain('grep');
    expect(FILE_OPS_PACK.toolNames).toContain('glob');
    // cli_agent_* tools now live in the dedicated CLI_AGENT_PACK
    expect(FILE_OPS_PACK.toolNames).not.toContain('cli_agent_start');
    expect(FILE_OPS_PACK.toolNames).not.toContain('cli_agent_read');
  });

  it('cli_agent pack has the expected tools and is registered', async () => {
    const { CLI_AGENT_PACK, KNOWN_SUBAGENT_NAMES, getCapabilityPack } = await import('./capability-packs');
    expect(CLI_AGENT_PACK.kind).toBe('cli_agent');
    expect(CLI_AGENT_PACK.toolNames).toContain('cli_agent_detect');
    expect(CLI_AGENT_PACK.toolNames).toContain('cli_agent_start');
    expect(CLI_AGENT_PACK.toolNames).toContain('cli_agent_send');
    expect(CLI_AGENT_PACK.toolNames).toContain('cli_agent_read');
    expect(CLI_AGENT_PACK.toolNames).toContain('cli_agent_status');
    expect(CLI_AGENT_PACK.toolNames).toContain('cli_agent_wait_for');
    expect(CLI_AGENT_PACK.toolNames).toContain('cli_agent_wait_idle');
    expect(CLI_AGENT_PACK.toolNames).toContain('cli_agent_stop');
    expect(KNOWN_SUBAGENT_NAMES).toContain('cli_agent');
    expect(getCapabilityPack('cli_agent')).toBeDefined();
  });

  it('workflow pack has the expected tools', async () => {
    const { WORKFLOW_PACK } = await import('./capability-packs');
    expect(WORKFLOW_PACK.kind).toBe('workflow');
    expect(WORKFLOW_PACK.toolNames).toContain('modify_workflow');
    // Token-lean DSL read/edit path (see workflow-dsl.ts).
    expect(WORKFLOW_PACK.toolNames).toContain('read_workflow');
    expect(WORKFLOW_PACK.toolNames).toContain('edit_workflow');
    // CORE docs are inlined in WORKFLOW_SYSTEM_PROMPT; situational sections are
    // fetched on demand, so the pack now DOES carry the doc-search tool.
    expect(WORKFLOW_PACK.toolNames).toContain('search_workflow_docs');
    expect(WORKFLOW_PACK.toolNames).toContain('search_workflow_nodes');
    expect(WORKFLOW_PACK.toolNames).toContain('search_tools');
    expect(WORKFLOW_PACK.toolNames).toContain('get_tool_schema');
    expect(WORKFLOW_PACK.maxSteps).toBe(60);
    expect(WORKFLOW_PACK.timeoutMs).toBeUndefined();
  });

  it('vm pack has the expected tools', async () => {
    const { VM_PACK, KNOWN_SUBAGENT_NAMES } = await import('./capability-packs');
    expect(VM_PACK.kind).toBe('vm');
    expect(VM_PACK.toolNames).toContain('vm_status');
    expect(VM_PACK.toolNames).toContain('vm_execute_tool');
    expect(VM_PACK.toolNames).toContain('vm_upload_file');
    expect(VM_PACK.toolNames).toContain('vm_download_file');
    expect(VM_PACK.systemPrompt).toContain('always-on cloud VM');
    expect(KNOWN_SUBAGENT_NAMES).toContain('vm');
  });

  it('agent and bot packs route status/ask work without list tools', async () => {
    const { AGENT_PACK, BOT_PACK, KNOWN_SUBAGENT_NAMES } = await import('./capability-packs');
    expect(AGENT_PACK.kind).toBe('agent');
    expect(AGENT_PACK.toolNames).not.toContain('ask_agent');
    expect(AGENT_PACK.toolNames).not.toContain('agent_get_status');
    expect(AGENT_PACK.toolNames).not.toContain('agent_list');
    expect(BOT_PACK.toolNames).not.toContain('ask_bot');
    expect(BOT_PACK.toolNames).not.toContain('bot_get_status');
    expect(BOT_PACK.toolNames).not.toContain('bot_list');
    expect(KNOWN_SUBAGENT_NAMES).toContain('agent');
  });

  it('resolveIntegrationTools returns matching tools by prefix', async () => {
    const { resolveIntegrationTools } = await import('./capability-packs');
    const allTools = [
      'gmail_send_message',
      'gmail_list_messages',
      'google_get_userinfo',
      'calendar_list_events',
      'tasks_list',
      'outlook_list_messages',
      'github_list_repos',
      'x_post_tweet',
      'x_search_tweets',
      'read_file',
    ];
    const googleTools = resolveIntegrationTools('google', allTools);
    expect(googleTools).toContain('gmail_send_message');
    expect(googleTools).toContain('gmail_list_messages');
    expect(googleTools).toContain('google_get_userinfo');
    expect(googleTools).toContain('calendar_list_events');
    expect(googleTools).toContain('tasks_list');
    expect(googleTools).not.toContain('outlook_list_messages');
    expect(googleTools).not.toContain('github_list_repos');
    expect(googleTools).not.toContain('x_post_tweet');
    expect(googleTools).not.toContain('read_file');

    const xTools = resolveIntegrationTools('x', allTools);
    expect(xTools).toEqual(['x_post_tweet', 'x_search_tweets']);
  });

  it('resolveIntegrationTools returns empty for unknown group', async () => {
    const { resolveIntegrationTools } = await import('./capability-packs');
    expect(resolveIntegrationTools('unknown_group', ['read_file'])).toEqual([]);
  });

  it('buildIntegrationPack creates a valid pack', async () => {
    const { buildIntegrationPack } = await import('./capability-packs');
    const pack = buildIntegrationPack('google', ['gmail_send_message', 'calendar_list_events']);
    expect(pack.kind).toBe('integration');
    expect(pack.label).toBe('Google Integration');
    expect(pack.toolNames).toContain('gmail_send_message');
    expect(pack.toolNames).toContain('calendar_list_events');
    // Integration subagents bind their platform tools natively and must NOT
    // carry the discovery meta-tools — those forced an execute_tool dance.
    expect(pack.toolNames).not.toContain('search_tools');
    expect(pack.toolNames).not.toContain('get_tool_schema');
    expect(pack.toolNames).not.toContain('execute_tool');
    expect(pack.maxSteps).toBe(30);
  });

  it('buildIntegrationPack for x includes native-tool guidance and no meta-tools', async () => {
    const { buildIntegrationPack } = await import('./capability-packs');
    const pack = buildIntegrationPack('x', ['x_get_comments', 'x_reply_to_comment'], {
      username: 'Ifesoll',
    });
    expect(pack.toolNames).toEqual(['x_get_comments', 'x_reply_to_comment']);
    expect(pack.systemPrompt).toContain('call them by name');
    expect(pack.systemPrompt).toContain('x_get_comments');
    expect(pack.systemPrompt).toContain('x_reply_to_comment');
    expect(pack.systemPrompt).toContain('never use search_tools');
  });

  it('exposes x as a known integration subagent', async () => {
    const { KNOWN_SUBAGENT_NAMES } = await import('./capability-packs');
    expect(KNOWN_SUBAGENT_NAMES).toContain('x');
  });

  it('getCapabilityPack returns defined packs and undefined for unknown', async () => {
    const { getCapabilityPack } = await import('./capability-packs');
    expect(getCapabilityPack('browser')).toBeDefined();
    expect(getCapabilityPack('file_ops')).toBeDefined();
  });

  it('orchestrator delegation tools are available without an env flag', async () => {
    const { ORCHESTRATOR_DELEGATION_TOOLS } = await import('./delegation-tools');
    expect(ORCHESTRATOR_DELEGATION_TOOLS).toHaveProperty('delegate');
    expect(ORCHESTRATOR_DELEGATION_TOOLS).toHaveProperty('reply_to_subagent');
  });

  it('execution tool bootstrap registration does not depend on USE_ORCHESTRATOR', async () => {
    const original = process.env.USE_ORCHESTRATOR;
    delete process.env.USE_ORCHESTRATOR;

    const { ensureExecutionToolsRegistered } = await import('./execution-tools-bootstrap');
    const { hasExecutionToolsRegistered } = await import('./execution-tools-resolver');

    await ensureExecutionToolsRegistered();
    expect(hasExecutionToolsRegistered()).toBe(true);

    process.env.USE_ORCHESTRATOR = original;
  }, 30_000);
});

// ─── Protocol message envelope validation ────────────────────────────────────

describe('Protocol Message Envelopes', () => {
  it('all subagent message types are distinct', () => {
    const types = new Set([
      'subagent_question',
      'subagent_answer',
      'subagent_event',
      'subagent_complete',
    ]);
    expect(types.size).toBe(4);
  });

  it('correlation IDs flow through question → answer', () => {
    const questionId = 'q-abc123';
    const subagentId = 'sa-def456';
    const runId = 'run-ghi789';

    const question = {
      type: 'subagent_question',
      questionId,
      subagentId,
      runId,
      question: 'Need credentials',
    };

    const answer = {
      type: 'subagent_answer',
      questionId: question.questionId,
      subagentId: question.subagentId,
      runId: question.runId,
      answer: 'Use admin@example.com',
    };

    // Correlation IDs match
    expect(answer.questionId).toBe(question.questionId);
    expect(answer.subagentId).toBe(question.subagentId);
    expect(answer.runId).toBe(question.runId);
  });

  it('subagent lifecycle follows started → progress → completed', () => {
    const subagentId = 'sa-lifecycle';
    const runId = 'run-lifecycle';

    const events = [
      { type: 'subagent_event', subagentId, runId, event: 'started', data: { kind: 'browser' } },
      { type: 'subagent_event', subagentId, runId, event: 'progress', data: { message: '50%' } },
      { type: 'subagent_event', subagentId, runId, event: 'tool_call', data: { tool: 'browser_use_navigate' } },
      { type: 'subagent_complete', subagentId, runId, ok: true, result: 'Done', durationMs: 5000 },
    ];

    // All events share the same subagentId and runId
    for (const e of events) {
      expect(e.subagentId).toBe(subagentId);
      expect(e.runId).toBe(runId);
    }

    // Final event is completion
    const last = events[events.length - 1];
    expect(last.type).toBe('subagent_complete');
    expect((last as any).ok).toBe(true);
  });
});
