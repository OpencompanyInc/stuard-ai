import { describe, expect, it } from 'vitest';
import { initToolRegistry } from './meta-tools';
import { getToolRegistry } from './tool-registry';

describe('meta-tools registry', () => {
  it('registers cloud tool families exposed through /tools routes', () => {
    initToolRegistry();

    const registry = getToolRegistry();
    const expectedTools = [
      'telnyx_send_mms',
      'whatsapp_send_message',
      'facebook_get_me',
      'x_post_tweet',
      'x_search_tweets',
      'cloud_storage_upload',
      'proactive_task_create',
    ];

    for (const toolName of expectedTools) {
      const tool = registry.get(toolName);
      expect(tool, `${toolName} should be registered`).toBeTruthy();
      expect(typeof (tool as any)?.execute, `${toolName} should be executable`).toBe('function');
    }
  });
});
