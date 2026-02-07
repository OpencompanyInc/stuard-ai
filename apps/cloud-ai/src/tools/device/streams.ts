import { z } from 'zod';
import { makeLocalTool } from './shared';

export const stream_create = makeLocalTool(
  'stream_create',
  'Create a named data stream for real-time chunk processing. Returns a streamId that downstream steps can subscribe to via stream wires.',
  z.object({
    kind: z.enum(['video_frames', 'audio_chunks', 'text', 'json', 'bytes']).default('bytes').describe('Type of data this stream carries'),
    flowId: z.string().optional().describe('Workflow run ID that owns this stream'),
    sourceStepId: z.string().optional().describe('Step ID that produces data into this stream'),
    bufferSize: z.number().optional().default(500).describe('Max chunks in ring buffer'),
    metadata: z.record(z.any()).optional().describe('Stream metadata (fps, samplerate, etc.)'),
  }),
);

export const stream_write = makeLocalTool(
  'stream_write',
  'Push a chunk of data to a stream. The chunk passes through any attached transforms before reaching subscribers.',
  z.object({
    streamId: z.string().describe('Target stream ID'),
    chunk: z.any().describe('The data chunk to push'),
    chunkType: z.enum(['raw', 'base64', 'json']).optional().describe('How to interpret the chunk data'),
  }),
);

export const stream_read = makeLocalTool(
  'stream_read',
  'Read next chunk(s) from a stream using cursor-based pagination. Returns new chunks since last read.',
  z.object({
    streamId: z.string().describe('Stream to read from'),
    subscriberId: z.string().describe('Subscriber ID (must have subscribed first)'),
    maxChunks: z.number().optional().default(50).describe('Max chunks to return'),
    waitMs: z.number().optional().default(0).describe('Wait up to this many ms for new data if none available'),
    asBase64: z.boolean().optional().default(false).describe('Encode binary chunks as base64'),
  }),
);

export const stream_close = makeLocalTool(
  'stream_close',
  'Close a stream, signaling end-of-data to all subscribers. Downstream stream wire consumers will receive a close signal.',
  z.object({
    streamId: z.string().describe('Stream to close'),
    cleanup: z.boolean().optional().default(false).describe('Remove stream from registry after closing'),
  }),
);

export const stream_subscribe = makeLocalTool(
  'stream_subscribe',
  'Subscribe to a stream to receive chunks. Returns a subscriberId and starting cursor position.',
  z.object({
    streamId: z.string().describe('Stream to subscribe to'),
    subscriberId: z.string().optional().describe('Unique subscriber ID (auto-generated if not provided)'),
    label: z.string().optional().describe('Human-readable label'),
    fromStart: z.boolean().optional().default(false).describe('Start reading from the beginning of the buffer'),
  }),
);

export const stream_unsubscribe = makeLocalTool(
  'stream_unsubscribe',
  'Unsubscribe from a stream. Stops receiving chunks.',
  z.object({
    streamId: z.string().describe('Stream to unsubscribe from'),
    subscriberId: z.string().describe('Subscriber ID to remove'),
  }),
);

export const stream_add_transform = makeLocalTool(
  'stream_add_transform',
  'Add a transform function to the stream pipeline. Each chunk passes through the transform chain before reaching subscribers.',
  z.object({
    streamId: z.string().describe('Target stream'),
    transformId: z.string().optional().describe('Unique ID for this transform'),
    type: z.enum(['python', 'builtin']).default('python').describe('Transform type'),
    code: z.string().describe('Python code defining a transform(chunk, params) function'),
    params: z.record(z.any()).optional().describe('Parameters passed to the transform function'),
    order: z.number().optional().default(0).describe('Position in the chain (lower = earlier)'),
  }),
);

export const stream_remove_transform = makeLocalTool(
  'stream_remove_transform',
  'Remove a transform from the stream pipeline.',
  z.object({
    streamId: z.string().describe('Target stream'),
    transformId: z.string().describe('Transform to remove'),
  }),
);

export const stream_update_transform = makeLocalTool(
  'stream_update_transform',
  'Update transform parameters live. Changes are applied to the next chunk processed.',
  z.object({
    streamId: z.string().describe('Target stream'),
    transformId: z.string().describe('Transform to update'),
    params: z.record(z.any()).describe('New parameters (merged with existing)'),
  }),
);

export const stream_list = makeLocalTool(
  'stream_list',
  'List active streams, optionally filtered by workflow run ID.',
  z.object({
    flowId: z.string().optional().describe('Filter by workflow run ID'),
  }),
);

export const stream_get_status = makeLocalTool(
  'stream_get_status',
  'Get detailed stream stats including subscriber info, transform chain, chunks/sec, and buffer usage.',
  z.object({
    streamId: z.string().describe('Stream to query'),
  }),
);

export const stream_from_script = makeLocalTool(
  'stream_from_script',
  'Run a Python script that emits chunks into a real-time stream. The script receives an emit_chunk(data) function to push data. Returns immediately with a streamId; the script runs in the background.',
  z.object({
    code: z.string().describe('Python source code. Call emit_chunk(data) to push chunks to the stream.'),
    kind: z.enum(['video_frames', 'audio_chunks', 'text', 'json', 'bytes']).default('json').describe('Type of data this stream carries'),
    flowId: z.string().optional().describe('Workflow run ID'),
    sourceStepId: z.string().optional().describe('Step ID'),
    bufferSize: z.number().optional().default(500).describe('Max chunks in ring buffer'),
    metadata: z.record(z.any()).optional().describe('Stream metadata'),
  }),
);

export const stream_from_api = makeLocalTool(
  'stream_from_api',
  'Subscribe to a streaming API (SSE, chunked HTTP, or line-delimited JSON) and push each event into a workflow stream. Returns immediately with a streamId.',
  z.object({
    url: z.string().describe('API endpoint URL'),
    method: z.enum(['sse', 'chunked_http', 'lines']).default('lines').describe('How to consume the API response'),
    headers: z.record(z.string()).optional().describe('HTTP headers to send'),
    chunkType: z.enum(['json', 'text', 'bytes']).default('text').describe('How to parse incoming chunks'),
    kind: z.string().optional().describe('Stream kind (defaults to chunkType)'),
    flowId: z.string().optional().describe('Workflow run ID'),
    sourceStepId: z.string().optional().describe('Step ID'),
    bufferSize: z.number().optional().default(500).describe('Max chunks in ring buffer'),
    metadata: z.record(z.any()).optional().describe('Stream metadata'),
    timeoutSec: z.number().optional().default(60).describe('Connection timeout in seconds'),
  }),
);

export const stream_from_llm = makeLocalTool(
  'stream_from_llm',
  'Stream LLM text generation token-by-token into a workflow stream. Each token is pushed as a text chunk. Returns immediately with a streamId.',
  z.object({
    prompt: z.string().describe('The prompt to send to the LLM'),
    model: z.string().optional().default('gpt-4o-mini').describe('Model name'),
    systemPrompt: z.string().optional().describe('System prompt'),
    temperature: z.number().optional().default(0.7).describe('Sampling temperature'),
    maxTokens: z.number().optional().default(2048).describe('Max output tokens'),
    flowId: z.string().optional().describe('Workflow run ID'),
    sourceStepId: z.string().optional().describe('Step ID'),
    bufferSize: z.number().optional().default(500).describe('Max chunks in ring buffer'),
    metadata: z.record(z.any()).optional().describe('Stream metadata'),
  }),
);
