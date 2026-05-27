import { describe, expect, it } from 'vitest';
import { get_tool_schema, initToolRegistry, sanitizeToolResultForModel } from './meta-tools';
import { getToolRegistry } from './tool-registry';
import { WHATSAPP_INTEGRATION_ENABLED } from '../../../../shared/integration-flags';

describe('meta-tools registry', () => {
  it('registers cloud tool families exposed through /tools routes', () => {
    initToolRegistry();

    const registry = getToolRegistry();
    const expectedTools = [
      'telnyx_send_mms',
      ...(WHATSAPP_INTEGRATION_ENABLED ? ['whatsapp_send_message'] : []),
      'facebook_get_me',
      'x_post_tweet',
      'x_search_tweets',
      'cloud_storage_upload',
      'generate_image',
      'proactive_task_create',
      'bot_create',
    ];

    for (const toolName of expectedTools) {
      const tool = registry.get(toolName);
      expect(tool, `${toolName} should be registered`).toBeTruthy();
      expect(typeof (tool as any)?.execute, `${toolName} should be executable`).toBe('function');
    }
  });

  it('exposes generate_image schema through get_tool_schema', async () => {
    initToolRegistry();

    const schema = await (get_tool_schema as any).execute({ tool_name: 'generate_image' });

    expect(schema.name).toBe('generate_image');
    expect(schema.description).toContain('Generate images');
    expect(schema.inputSchema).toBeTruthy();
  });

  it('redacts large base64 payloads before execute_tool returns results to the model', () => {
    const bigPayload = 'a'.repeat(800_000);

    const sanitized = sanitizeToolResultForModel({
      ok: true,
      images: [
        {
          filePath: 'C:/generated/cat.png',
          format: 'png',
          _b64: bigPayload,
        },
      ],
    });

    expect(sanitized.images[0].filePath).toBe('C:/generated/cat.png');
    expect(sanitized.images[0]._b64).toBe('[redacted binary payload: 800000 chars]');
    expect(sanitized.images[0]._b64Bytes).toBe(600000);
  });
});
