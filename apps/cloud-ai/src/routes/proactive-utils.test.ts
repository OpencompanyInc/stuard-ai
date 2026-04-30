import { describe, expect, it } from 'vitest';
import { buildProactiveUserMessage, buildProactiveMessageContent, detectRetryableToolError, expandProactiveAllowedToolNames, filterProactiveTools, generateWithToolRecovery, isBlockedProactiveToolName } from './proactive-utils';

describe('buildProactiveUserMessage', () => {
  it('uses the explicit prompt when provided', () => {
    const msg = buildProactiveUserMessage({ prompt: 'Reply to the user warmly.', taskCount: 3, screenshot: 'data:image/png;base64,abc' });
    expect(msg).toContain('Reply to the user warmly.');
    expect(msg).toContain('screenshot');
  });

  it('includes task details inline and is directive when tasks are queued', () => {
    const tasks = [
      { id: 'ptask_1', title: 'Research AI news', instructions: 'Find latest', status: 'queued' },
      { id: 'ptask_2', title: 'Check email', instructions: '', status: 'queued' },
    ];
    const message = buildProactiveUserMessage({ taskCount: 2, tasks, screenshot: 'data:image/png;base64,abc' });
    expect(message).toContain('[Proactive Wake-Up]');
    expect(message).toContain('Research AI news');
    expect(message).toContain('ptask_1');
    expect(message).toContain('Work on these silently');
    expect(message).toContain('screenshot');
  });

  it('does not mention screenshot when screenshot is falsy', () => {
    const message = buildProactiveUserMessage({ taskCount: 0 });
    expect(message).not.toContain('screenshot');
  });

  it('handles no tasks gracefully', () => {
    const message = buildProactiveUserMessage({ taskCount: 0, tasks: [] });
    expect(message).toContain('No tasks');
    expect(message).toContain('reading the room');
  });
});

describe('buildProactiveMessageContent', () => {
  it('returns text-only content when no screenshot', () => {
    const content = buildProactiveMessageContent({ taskCount: 1, tasks: [{ id: '1', title: 'Test', instructions: '', status: 'queued' }] });
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('text');
  });

  it('includes image part when screenshot base64 is provided', () => {
    const content = buildProactiveMessageContent({
      taskCount: 1,
      tasks: [{ id: '1', title: 'Test', instructions: '', status: 'queued' }],
      screenshot: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    });
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe('text');
    expect(content[1].type).toBe('image');
    expect(content[1].mimeType).toBe('image/png');
  });
});

describe('filterProactiveTools', () => {
  it('preserves all tools when no allow-list is provided', () => {
    const tools = { proactive_task_list: 1, web_search: 2, execute_tool: 3 };
    expect(filterProactiveTools(tools, [])).toEqual(tools);
  });

  it('always keeps core proactive tools (task tools + meta-tools + web_search) while filtering non-core', () => {
    const tools = {
      proactive_task_list: 1,
      proactive_task_update: 2,
      proactive_task_create: 3,
      proactive_task_delete: 4,
      web_search: 5,
      execute_tool: 6,
      search_tools: 7,
      get_tool_schema: 8,
      get_skill_info: 9,
      deploy_headless_agent: 10,
      search_past_conversations: 11,
      get_conversation_context: 12,
      some_random_tool: 13,
    };

    const result = filterProactiveTools(tools, ['some_random_tool']);
    // Core tools are always kept
    expect(result).toHaveProperty('proactive_task_list');
    expect(result).toHaveProperty('proactive_task_update');
    expect(result).toHaveProperty('proactive_task_create');
    expect(result).toHaveProperty('proactive_task_delete');
    expect(result).toHaveProperty('web_search');
    expect(result).toHaveProperty('execute_tool');
    expect(result).toHaveProperty('search_tools');
    expect(result).toHaveProperty('get_tool_schema');
    expect(result).toHaveProperty('get_skill_info');
    expect(result).toHaveProperty('deploy_headless_agent');
    expect(result).toHaveProperty('search_past_conversations');
    expect(result).toHaveProperty('get_conversation_context');
    // Explicitly allowed tool is kept
    expect(result).toHaveProperty('some_random_tool');
  });

  it('filters out non-core tools not in the allow-list', () => {
    const tools = {
      proactive_task_list: 1,
      web_search: 2,
      some_other_tool: 3,
      another_tool: 4,
    };

    const result = filterProactiveTools(tools, ['another_tool']);
    expect(result).toHaveProperty('proactive_task_list');
    expect(result).toHaveProperty('web_search');
    expect(result).toHaveProperty('another_tool');
    expect(result).not.toHaveProperty('some_other_tool');
  });

  it('never keeps legacy headed browser_* tools for proactive agents', () => {
    const tools = {
      proactive_task_list: 1,
      search_tools: 2,
      browser_get_content: 3,
      browser_use_navigate: 4,
    };

    const result = filterProactiveTools(tools, ['browser_get_content', 'browser_use_navigate']);
    expect(result).not.toHaveProperty('browser_get_content');
    expect(result).toHaveProperty('browser_use_navigate');
  });

  it('preserves conversation memory tools', () => {
    const tools = {
      proactive_task_list: 1,
      web_search: 2,
      get_conversation_context: 3,
      search_past_conversations: 4,
      some_other_tool: 5,
    };

    const result = filterProactiveTools(tools, ['web_search']);
    expect(result).toHaveProperty('proactive_task_list');
    expect(result).toHaveProperty('web_search');
    expect(result).toHaveProperty('get_conversation_context');
    expect(result).toHaveProperty('search_past_conversations');
    expect(result).not.toHaveProperty('some_other_tool');
  });

  it('expands related Google tool families so proactive agents do not lose sibling tools', () => {
    const tools = {
      proactive_task_list: 1,
      search_tools: 2,
      gmail_list_recent_brief: 3,
      tasks_list: 4,
      calendar_list_events: 5,
      docs_get_document: 6,
      unrelated_tool: 7,
    };

    const result = filterProactiveTools(tools, ['gmail_list_recent_brief', 'tasks_list', 'search_tools']);
    expect(result).toHaveProperty('gmail_list_recent_brief');
    expect(result).toHaveProperty('tasks_list');
    expect(result).toHaveProperty('calendar_list_events');
    expect(result).toHaveProperty('docs_get_document');
    expect(result).not.toHaveProperty('unrelated_tool');
  });

  it('expands X tool family when one X tool is allowed', () => {
    const tools = {
      proactive_task_list: 1,
      search_tools: 2,
      x_post_tweet: 3,
      x_search_tweets: 4,
      unrelated_tool: 5,
    };

    const result = filterProactiveTools(tools, ['x_post_tweet']);
    expect(result).toHaveProperty('x_post_tweet');
    expect(result).toHaveProperty('x_search_tweets');
    expect(result).not.toHaveProperty('unrelated_tool');
  });
});

describe('expandProactiveAllowedToolNames', () => {
  it('completes the meta-tool trio and expands provider families', () => {
    const result = expandProactiveAllowedToolNames(['gmail_list_recent_brief', 'search_tools']);

    expect(result).toContain('search_tools');
    expect(result).toContain('get_tool_schema');
    expect(result).toContain('execute_tool');
    expect(result).toContain('gmail_');
    expect(result).toContain('calendar_');
    expect(result).toContain('tasks_');
  });

  it('expands X provider prefixes', () => {
    const result = expandProactiveAllowedToolNames(['x_post_tweet']);
    expect(result).toContain('x_');
  });

  it('drops legacy headed browser_* tools while keeping browser_use_*', () => {
    const result = expandProactiveAllowedToolNames(['browser_get_content', 'browser_use_navigate']);

    expect(result).not.toContain('browser_get_content');
    expect(result).toContain('browser_use_navigate');
  });
});

describe('isBlockedProactiveToolName', () => {
  it('blocks legacy browser tools but allows browser_use tools', () => {
    expect(isBlockedProactiveToolName('browser_get_content')).toBe(true);
    expect(isBlockedProactiveToolName('browser_use_navigate')).toBe(false);
  });
});

describe('detectRetryableToolError', () => {
  it('detects nested missing-tool errors', () => {
    const nested = {
      cause: new Error('Tool get_conversation_context not found'),
    };

    expect(detectRetryableToolError(nested)).toMatchObject({
      toolName: 'get_conversation_context',
      type: 'tool_not_found',
    });
  });
});

describe('generateWithToolRecovery', () => {
  it('retries after a missing tool call and returns the successful response', async () => {
    const agent = {
      generate: async (messages: any[]) => {
        if (messages.length === 1) {
          throw {
            name: 'NoSuchToolError',
            toolName: 'get_conversation_context',
            message: 'Tool get_conversation_context not found',
          };
        }
        return { text: 'Recovered successfully' };
      },
    };

    const result = await generateWithToolRecovery({
      agent,
      baseMessages: [{ role: 'user', content: 'Find the sheet from last night' }],
      maxRetries: 2,
    });

    expect(result).toEqual({ text: 'Recovered successfully' });
  });

  it('injects correction guidance on retry', async () => {
    const calls: any[][] = [];
    const agent = {
      generate: async (messages: any[]) => {
        calls.push(messages);
        if (calls.length === 1) {
          throw {
            name: 'NoSuchToolError',
            toolName: 'bad_tool',
            message: 'Tool bad_tool not found',
          };
        }
        return { text: 'ok' };
      },
    };

    await generateWithToolRecovery({
      agent,
      baseMessages: [{ role: 'user', content: 'Do the task' }],
      maxRetries: 2,
    });

    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toMatchObject({ role: 'assistant', content: 'I tried to use a tool.' });
    expect(String(calls[1][2]?.content || '')).toContain('execute_tool');
    expect(String(calls[1][2]?.content || '')).toContain('bad_tool');
  });

  it('calls onToolNotFound callback when a tool is missing', async () => {
    const registeredTools: string[] = [];
    const agent = {
      generate: async (messages: any[]) => {
        if (messages.length === 1) {
          throw {
            name: 'NoSuchToolError',
            toolName: 'calendar_list_events',
            message: 'Tool calendar_list_events not found',
          };
        }
        return { text: 'ok' };
      },
    };

    await generateWithToolRecovery({
      agent,
      baseMessages: [{ role: 'user', content: 'Check my calendar' }],
      maxRetries: 2,
      onToolNotFound: (name) => registeredTools.push(name),
    });

    expect(registeredTools).toEqual(['calendar_list_events']);
  });
});
