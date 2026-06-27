import { z } from 'zod';
import { makeLocalTool } from './shared';

// ─── ollama_status ───────────────────────────────────────────────────────────

export const ollama_status = makeLocalTool(
  'ollama_status',
  'Check if Ollama is running locally. Returns available models and currently loaded (running) models. Use this to verify Ollama is accessible before calling other ollama_* tools.',
  z.object({}),
  z.object({
    ok: z.boolean(),
    available: z.boolean(),
    host: z.string().optional(),
    modelCount: z.number().optional(),
    models: z.array(z.object({
      name: z.string(),
      size: z.number().optional(),
      parameterSize: z.string().optional(),
      quantization: z.string().optional(),
      family: z.string().optional(),
    })).optional(),
    runningCount: z.number().optional(),
    running: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  5000,
  { noFallback: true },
);

// ─── ollama_chat ─────────────────────────────────────────────────────────────

export const ollama_agent = makeLocalTool(
  'ollama_agent',
  'Run a local Ollama model like a workflow AI agent. Combines text generation, multi-turn chat, optional image inputs, memory injected into the system prompt, and a smart workflow tool bridge for search/describe/run.',
  z.object({
    model: z.string().optional().default('llama3.2').describe('Local Ollama model name (e.g. "llama3.2", "qwen3", "mistral").'),
    prompt: z.string().optional().describe('Main task or user message. Required unless messages are provided.'),
    context: z.string().optional().describe('Extra context appended to the prompt.'),
    messages: z.array(z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
    })).optional().describe('Optional prior conversation messages.'),
    systemPrompt: z.string().optional().describe('Additional system instructions for the local agent.'),
    system: z.string().optional().describe('Alias for systemPrompt.'),
    outputMode: z.enum(['text', 'json']).optional().default('text').describe('Final output mode.'),
    outputSchema: z.record(z.string(), z.any()).optional().describe('Optional target schema when outputMode="json".'),
    toolMode: z.enum(['curated', 'selected', 'none']).optional().default('curated').describe('curated = built-in default tools, selected = only the tools array, none = disable tools entirely.'),
    tools: z.array(z.string()).optional().describe('Allowed workflow tool names. Omit for a curated default set. Use [] for no tools.'),
    maxSteps: z.coerce.number().int().min(1).max(20).optional().default(8).describe('Maximum tool rounds before stopping.'),
    timeoutMs: z.coerce.number().int().min(5000).max(600000).optional().default(300000).describe('Total timeout for the full agent run.'),
    injectMemory: z.boolean().optional().default(false).describe('Legacy toggle to inject local memory into the system prompt.'),
    memory: z.object({
      enabled: z.boolean().optional().default(false),
      lenses: z.object({
        identity: z.boolean().optional().default(true),
        directives: z.boolean().optional().default(true),
        bio: z.boolean().optional().default(true),
        relatedMemories: z.boolean().optional().default(true),
      }).optional(),
      maxFacts: z.number().optional().default(6),
      conversationHistory: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })).optional(),
      customFacts: z.array(z.string()).optional(),
    }).optional().describe('Local memory configuration to inject into the system prompt.'),
    images: z.array(z.object({
      path: z.string().optional().describe('Local file path to an image'),
      data: z.string().optional().describe('Base64 encoded image data'),
    })).optional().describe('Optional images for multimodal models.'),
    imagePath: z.string().optional().describe('Convenience single-image path.'),
    stream: z.boolean().optional().default(false).describe('When true, returns a streamId and writes the final result to a workflow stream.'),
    json_mode: z.boolean().optional().describe('Alias for outputMode="json".'),
    temperature: z.number().optional().describe('Sampling temperature.'),
    num_predict: z.number().optional().describe('Maximum tokens to generate.'),
    top_p: z.number().optional().describe('Nucleus sampling threshold.'),
    top_k: z.number().optional().describe('Top-K sampling.'),
    think: z.boolean().optional().describe('Enable thinking mode for reasoning-capable models.'),
    keep_alive: z.string().optional().describe('How long to keep the model loaded (e.g. "5m").'),
  }),
  z.object({
    ok: z.boolean(),
    model: z.string().optional(),
    text: z.string().optional(),
    json: z.any().optional(),
    thinking: z.string().optional(),
    toolCalls: z.number().optional(),
    usedTools: z.array(z.string()).optional(),
    streamId: z.string().optional(),
    streamed: z.boolean().optional(),
    totalDuration: z.number().optional(),
    evalCount: z.number().optional(),
    error: z.string().optional(),
  }),
  600000,
  { noFallback: true },
);

export const ollama_chat = makeLocalTool(
  'ollama_chat',
  'Multi-turn chat with a local LLM via Ollama. Supports system prompts, temperature, JSON output format, and streaming. Models run privately on-device with no API key needed.',
  z.object({
    model: z.string().describe('Model name (e.g. "llama3.2", "mistral", "deepseek-r1")'),
    messages: z.array(z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
    })).min(1).describe('Conversation messages'),
    system: z.string().optional().describe('System prompt (prepended to messages)'),
    stream: z.boolean().optional().describe('Stream tokens in real-time'),
    think: z.boolean().optional().describe('Enable thinking mode for reasoning models (deepseek-r1, etc). Separates reasoning from output.'),
    tools: z.array(z.object({
      type: z.literal('function'),
      function: z.object({
        name: z.string(),
        description: z.string().optional(),
        parameters: z.record(z.string(), z.any()).optional(),
      }),
    })).optional().describe('Tools/functions for the model to call (requires tool-capable model)'),
    json_mode: z.boolean().optional().describe('Force JSON output (sets format to "json")'),
    temperature: z.number().optional().describe('Sampling temperature (0-2, default 0.7)'),
    num_predict: z.number().optional().describe('Max tokens to generate (-1 = unlimited, default 2048)'),
    top_p: z.number().optional().describe('Nucleus sampling threshold'),
    top_k: z.number().optional().describe('Top-K sampling'),
    format: z.enum(['json']).optional().describe('Force JSON output (deprecated, use json_mode)'),
    keep_alive: z.string().optional().describe('How long to keep model loaded (e.g. "5m", "0" to unload immediately)'),
  }),
  z.object({
    ok: z.boolean(),
    model: z.string().optional(),
    message: z.object({ role: z.string(), content: z.string() }).optional(),
    text: z.string().optional(),
    thinking: z.string().optional().describe('Model\'s reasoning process (when think=true)'),
    toolCalls: z.array(z.object({
      function: z.object({ name: z.string(), arguments: z.record(z.string(), z.any()) }),
    })).optional().describe('Tool calls the model wants to make'),
    streamed: z.boolean().optional(),
    streamId: z.string().optional().describe('Stream ID when stream=true, connect a stream wire to consume'),
    totalDuration: z.number().optional(),
    evalCount: z.number().optional(),
    error: z.string().optional(),
  }),
  600000,
  { noFallback: true },
);

// ─── ollama_generate ─────────────────────────────────────────────────────────

export const ollama_generate = makeLocalTool(
  'ollama_generate',
  'Single-prompt text completion with a local LLM via Ollama. Simpler than chat for one-shot tasks like summarization, extraction, or code generation.',
  z.object({
    model: z.string().describe('Model name (e.g. "llama3.2", "mistral", "deepseek-r1")'),
    prompt: z.string().describe('The prompt text'),
    system: z.string().optional().describe('System prompt'),
    stream: z.boolean().optional().describe('Stream tokens in real-time'),
    think: z.boolean().optional().describe('Enable thinking mode for reasoning models (deepseek-r1, etc). Separates reasoning from output.'),
    json_mode: z.boolean().optional().describe('Force JSON output'),
    temperature: z.number().optional().describe('Sampling temperature (0-2, default 0.7)'),
    num_predict: z.number().optional().describe('Max tokens to generate (default 2048)'),
    format: z.enum(['json']).optional().describe('Force JSON output (deprecated, use json_mode)'),
    keep_alive: z.string().optional().describe('Model keep-alive duration'),
  }),
  z.object({
    ok: z.boolean(),
    model: z.string().optional(),
    text: z.string().optional(),
    thinking: z.string().optional().describe('Model\'s reasoning process (when think=true)'),
    streamed: z.boolean().optional(),
    streamId: z.string().optional().describe('Stream ID when stream=true, connect a stream wire to consume'),
    totalDuration: z.number().optional(),
    evalCount: z.number().optional(),
    error: z.string().optional(),
  }),
  600000,
  { noFallback: true },
);

// ─── ollama_vision ───────────────────────────────────────────────────────────

export const ollama_vision = makeLocalTool(
  'ollama_vision',
  'Analyze images using a local multimodal model via Ollama (e.g. llava, llama3.2-vision). Reads local image files from disk and sends them to the model. Completely private — no cloud upload.',
  z.object({
    model: z.string().optional().default('llava').describe('Vision model (e.g. "llava", "moondream", "bakllava")'),
    imagePath: z.string().optional().describe('Local file path to an image (simpler alternative to images array)'),
    prompt: z.string().optional().default('Describe this image in detail.').describe('What to ask about the image'),
    images: z.array(z.object({
      path: z.string().optional().describe('Local file path to an image'),
      data: z.string().optional().describe('Base64-encoded image data'),
    })).optional().describe('Images to analyze (alternative to imagePath for multiple images)'),
    temperature: z.number().optional().describe('Sampling temperature (default 0.7)'),
    num_predict: z.number().optional().describe('Max tokens to generate (default 2048)'),
  }),
  z.object({
    ok: z.boolean(),
    model: z.string().optional(),
    text: z.string().optional(),
    totalDuration: z.number().optional(),
    imageCount: z.number().optional(),
    error: z.string().optional(),
  }),
  600000,
  { noFallback: true },
);

// ─── ollama_embeddings ───────────────────────────────────────────────────────

export const ollama_embeddings = makeLocalTool(
  'ollama_embeddings',
  'Generate vector embeddings using a local model via Ollama. Useful for semantic search, RAG pipelines, and similarity comparisons — all running privately on-device.',
  z.object({
    model: z.string().optional().default('nomic-embed-text').describe('Embedding model (e.g. "nomic-embed-text", "mxbai-embed-large", "all-minilm")'),
    input: z.union([z.string(), z.array(z.string())]).describe('Text or array of texts to embed'),
  }),
  z.object({
    ok: z.boolean(),
    model: z.string().optional(),
    embeddings: z.array(z.array(z.number())).optional(),
    dimensions: z.number().optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  120000,
  { noFallback: true },
);

// ─── ollama_models ───────────────────────────────────────────────────────────

export const ollama_models = makeLocalTool(
  'ollama_models',
  'Manage local Ollama models: list installed, pull new ones (with progress), delete, show details, see running models, or copy/alias. Pull downloads models from the Ollama registry.',
  z.object({
    action: z.enum(['list', 'pull', 'delete', 'show', 'running', 'copy']).describe('Action to perform'),
    model: z.string().optional().describe('Model name (required for pull, delete, show, copy)'),
    destination: z.string().optional().describe('Destination name (required for copy action)'),
  }),
  z.object({
    ok: z.boolean(),
    action: z.string().optional(),
    models: z.array(z.any()).optional(),
    count: z.number().optional(),
    model: z.string().optional(),
    status: z.string().optional(),
    deleted: z.boolean().optional(),
    modelfile: z.string().optional(),
    parameters: z.string().optional(),
    details: z.any().optional(),
    source: z.string().optional(),
    destination: z.string().optional(),
    error: z.string().optional(),
  }),
  3600000, // 1 hour for pull
  { noFallback: true },
);
