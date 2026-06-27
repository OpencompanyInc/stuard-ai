import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, hasClientBridge } from './bridge';
import { anyJsonValue } from './schema-utils';

export const http_request = createTool({
  id: 'http_request',
  description:
    'Make HTTP requests like curl or Postman. Supports headers, query params, JSON/form/multipart bodies (file upload), cookies, bearer/basic auth, retries, and optional download-to-file.',
  inputSchema: z.object({
    url: z.string().describe('The URL to request'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).optional().default('GET').describe('HTTP method'),
    headers: z.record(z.string(), z.string()).optional().describe('Request headers as key-value pairs'),
    query: z.record(z.string(), z.string()).optional().describe('Query parameters (merged into URL query string)'),
    params: z.record(z.string(), z.string()).optional().describe('Alias for query (merged with query)'),
    cookies: z.record(z.string(), z.string()).optional().describe('Cookies as key-value pairs'),

    bearer_token: z.string().optional().describe('Bearer token to set Authorization header (preferred over auth)'),
    auth: z
      .union([
        z.string().describe('Bearer token (legacy shorthand)'),
        z.object({
          type: z.enum(['basic', 'bearer']).describe('Auth type'),
          username: z.string().optional().describe('Username for basic auth'),
          password: z.string().optional().describe('Password for basic auth'),
          token: z.string().optional().describe('Token for bearer auth'),
        }),
      ])
      .optional()
      .describe('Authentication configuration'),

    body: z.string().optional().describe('Raw request body string'),
    form: z.record(z.string(), z.string()).optional().describe('Form data (application/x-www-form-urlencoded)'),
    json_body: anyJsonValue.optional().describe('JSON body (sent as application/json)'),

    multipart: z.record(z.string(), z.any()).optional().describe('Multipart fields (text fields) for multipart/form-data'),
    files: z
      .array(
        z.object({
          field: z.string().optional().describe('Form field name (defaults to "file")'),
          path: z.string().describe('Local file path to upload'),
          filename: z.string().optional().describe('Override filename'),
          contentType: z.string().optional().describe('Override content-type'),
        }),
      )
      .optional()
      .describe('Multipart files to upload'),

    timeout: z.number().optional().default(30).describe('Request timeout in seconds'),
    timeoutMs: z.number().int().optional().describe('Request timeout in milliseconds (overrides timeout)'),
    follow_redirects: z.boolean().optional().default(true).describe('Follow HTTP redirects'),
    verify_ssl: z.boolean().optional().default(true).describe('Verify SSL certificates'),
    raw_response: z.boolean().optional().default(false).describe('Return raw bytes as base64 instead of decoding'),
    max_response_bytes: z.number().int().optional().describe('Max bytes to read into memory before truncating (default 5MB)'),
    save_to: z.string().optional().describe('If set, stream response body to this local file path'),

    forwardToStreamId: z.string().optional().describe('If set, stream response body chunks to this stream id and close it when complete'),
    stream: z.boolean().optional().default(false).describe('When true, auto-creates a data stream and forwards the response body chunks to it. Returns a streamId for downstream stream wire consumption. Great for SSE/chunked APIs.'),

    retries: z.number().int().optional().default(0).describe('Retry count on transient errors / statuses'),
    retry_delay_ms: z.number().int().optional().default(500).describe('Delay between retries in ms'),
    retry_on_status: z.array(z.number().int()).optional().describe('HTTP statuses to retry on'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    status: z.number().optional(),
    status_text: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.any().optional(),
    body_type: z.enum(['json', 'text', 'base64']).optional(),
    body_length: z.number().optional(),
    url: z.string().optional(),
    elapsed_ms: z.number().optional(),
    truncated: z.boolean().optional(),
    saved_to: z.string().optional(),
    streamId: z.string().optional().describe('Stream ID when stream=true'),
    error: z.string().optional(),
  }),
  execute: async (inputData, { writer }) => {
    if (!hasClientBridge()) {
      return { ok: false, error: 'No desktop bridge available' };
    }

    const args = inputData as any;

    // Stream mode: auto-create a stream and set forwardToStreamId
    if (args?.stream && !args?.forwardToStreamId) {
      const streamResult = await execLocalTool('stream_create', {
        kind: 'text',
        sourceStepId: 'http_request',
        metadata: { url: args.url, method: args.method || 'GET' },
      });

      if (!streamResult?.ok || !streamResult?.streamId) {
        return { ok: false, error: 'Failed to create stream for HTTP response' };
      }

      // Forward to the auto-created stream — the agent-side http_request
      // already supports forwardToStreamId
      args.forwardToStreamId = streamResult.streamId;
      const timeoutMs = Number(args?.timeoutMs);
      const t = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs + 15000, 1800000) : 300000;
      const result = await execLocalTool('http_request', args, writer as any, t);
      return { ...result, streamId: streamResult.streamId };
    }

    const timeoutMs = Number(args?.timeoutMs);
    const t = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs + 15000, 1800000) : 300000;
    return await execLocalTool('http_request', args, writer as any, t);
  },
});
