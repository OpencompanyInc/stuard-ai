import { describe, it, expect } from 'vitest';
import { registerTool, isToolDiscoverableForSurface } from './tool-registry';

// Minimal fake tool factory (registerTool only needs an id + execute fn).
function fakeTool(id: string) {
  return { id, description: id, execute: async () => ({ ok: true }) };
}

describe('isToolDiscoverableForSurface — chat-only categories', () => {
  it('hides Feedback-category tools (submit_feedback) from the workflow surface but keeps them on chat', () => {
    registerTool(fakeTool('submit_feedback'), 'Feedback', 'cloud');
    expect(isToolDiscoverableForSurface('submit_feedback', 'workflow')).toBe(false);
    expect(isToolDiscoverableForSurface('submit_feedback', 'chat')).toBe(true);
  });

  it('still hides chat-only tools (chat_ui) from workflow and workflow-only categories from chat', () => {
    registerTool(fakeTool('chat_ui'), 'Core', 'cloud');
    registerTool(fakeTool('set_variable_x'), 'Variables', 'cloud');
    expect(isToolDiscoverableForSurface('chat_ui', 'workflow')).toBe(false);
    expect(isToolDiscoverableForSurface('chat_ui', 'chat')).toBe(true);
    expect(isToolDiscoverableForSurface('set_variable_x', 'chat')).toBe(false);
    expect(isToolDiscoverableForSurface('set_variable_x', 'workflow')).toBe(true);
  });

  it('keeps an ordinary shared tool discoverable on both surfaces', () => {
    registerTool(fakeTool('http_get_x'), 'Search', 'cloud');
    expect(isToolDiscoverableForSurface('http_get_x', 'workflow')).toBe(true);
    expect(isToolDiscoverableForSurface('http_get_x', 'chat')).toBe(true);
  });
});
