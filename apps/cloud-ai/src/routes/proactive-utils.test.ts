import { describe, expect, it } from 'vitest';
import { buildProactiveUserMessage, buildProactiveMessageContent, filterProactiveTools } from './proactive-utils';

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
    expect(message).toContain('ACTION REQUIRED');
    expect(message).toContain('proactive_task_update');
    expect(message).toContain('screenshot');
  });

  it('does not mention screenshot when screenshot is falsy', () => {
    const message = buildProactiveUserMessage({ taskCount: 0 });
    expect(message).not.toContain('screenshot');
  });

  it('handles no tasks gracefully', () => {
    const message = buildProactiveUserMessage({ taskCount: 0, tasks: [] });
    expect(message).toContain('No tasks');
    expect(message).toContain('Check in');
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
      some_random_tool: 11,
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
});