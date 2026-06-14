import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateText, streamText, embed } from 'ai';
import { buildProviderModel, buildProviderEmbeddingModel } from '../utils/models';
import { safeToolWrite, execLocalTool, hasClientBridge, getBridgeSecrets } from './bridge';
import { logUsageEvent } from '../supabase';
import { writeLog } from '../utils/logger';
import { buildKnowledgeContext, buildQuickContext } from '../knowledge/retrieval';
import {
  loadMediaSources,
  cleanupUploadedMedia,
  inferMimeType,
  normalizeAudioMimeForOpenRouter,
  isAudioMimeOpenRouterCompatible,
  type MediaSource,
} from './media-loader';
import { transcribeAudio, DEFAULT_STT_MODEL } from '../media/transcription';
import { runStreamingTranscription } from '../media/streaming-transcription';
import { sttCostUsd } from '../pricing';

// ── OpenRouter audio pre-processing ─────────────────────────────────────────
// OpenRouter only accepts audio/mpeg (MP3) and audio/wav. When the user
// supplies an incompatible audio file (m4a, ogg, opus, aac, flac, wma, etc.)
// we auto-convert to MP3 via the local ffmpeg_convert_media tool before
// sending the parts.

function isOpenRouterModel(modelId: string): boolean {
  return modelId.startsWith('openrouter/');
}

/**
 * Log usage for an ai_inference call so credit grants get debited.
 * The /tools/<name> route doesn't bill on its own — each LLM-touching tool
 * must log its own usage. Best-effort: never throws.
 */
async function logAiInferenceUsage(
  model: string,
  usage: any,
  sourceLabel: string,
): Promise<void> {
  try {
    const userId = getBridgeSecrets()?.userId;
    if (!userId || typeof userId !== 'string') return;
    if (!usage) return;
    await logUsageEvent(userId, null, model, {
      ...usage,
      sourceType: 'workflow_inference',
      source_label: sourceLabel,
    });
  } catch {
    // best-effort billing — never break the tool result
  }
}

/**
 * For each audio source whose MIME type is not OpenRouter-compatible,
 * convert the file to .mp3 on the user's machine via ffmpeg and
 * replace the source entry in-place so loadMediaSources picks up the
 * converted file.
 */
async function convertIncompatibleAudioForOpenRouter(
  sources: MediaSource[],
  writer: any,
): Promise<{ convertedPaths: string[]; warnings: string[] }> {
  const convertedPaths: string[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];

    // Handle data-based sources (pre-loaded base64 from desktop) —
    // we can't convert on the cloud, but we should normalize MIME and warn.
    if (!s.path && s.data) {
      const mime = s.mimeType || 'application/octet-stream';
      if (!mime.startsWith('audio/')) continue;
      if (isAudioMimeOpenRouterCompatible(mime)) {
        s.mimeType = normalizeAudioMimeForOpenRouter(mime);
      } else {
        const msg = `Audio format ${mime} is not supported by OpenRouter (requires mp3/wav). Pre-convert on desktop before sending.`;
        warnings.push(msg);
        writeLog('ai_inference_audio_incompatible_data', { mime });
      }
      continue;
    }

    if (!s.path) continue;
    const mime = s.mimeType || inferMimeType(s.path);
    if (!mime.startsWith('audio/')) continue;
    if (isAudioMimeOpenRouterCompatible(mime)) {
      // Already compatible — just normalize the mime string
      s.mimeType = normalizeAudioMimeForOpenRouter(mime);
      continue;
    }

    // Need conversion — derive an output path next to the original file
    const outputPath = s.path.replace(/\.[^.]+$/, '_openrouter.mp3');

    await safeToolWrite(writer, {
      type: 'tool_event',
      tool: 'ai_inference',
      status: 'converting_audio',
      originalMime: mime,
      targetMime: 'audio/mpeg',
      path: s.path,
      outputPath,
    });

    try {
      const result = await execLocalTool(
        'ffmpeg_convert_media',
        { inputPath: s.path, outputPath, overwrite: true },
        writer,
      );

      if (result?.ok) {
        // Swap the source to the converted file
        sources[i] = { ...s, path: outputPath, mimeType: 'audio/mpeg' };
        convertedPaths.push(outputPath);
        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: 'ai_inference',
          status: 'audio_converted',
          path: outputPath,
        });
      } else {
        const msg = `Failed to convert ${s.path} (${mime}) to MP3 for OpenRouter: ${result?.error || 'unknown'}`;
        warnings.push(msg);
        writeLog('ai_inference_audio_convert_fail', { path: s.path, mime, error: result?.error });
        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: 'ai_inference',
          status: 'audio_convert_failed',
          path: s.path,
          error: result?.error || 'ffmpeg_failed',
        });
      }
    } catch (err: any) {
      const msg = `Audio conversion error for ${s.path}: ${err?.message || 'unknown'}`;
      warnings.push(msg);
      writeLog('ai_inference_audio_convert_error', { path: s.path, error: err?.message });
    }
  }

  return { convertedPaths, warnings };
}

/**
 * ai_inference - General purpose AI text/structured inference tool
 * 
 * Use cases:
 * - Text summarization
 * - Classification/categorization
 * - Entity extraction
 * - Data transformation
 * - Question answering
 * - JSON generation from natural language
 */

// Dynamic schema builder for structured output
function buildZodSchema(shape: Record<string, any>): z.ZodObject<any> {
  const entries: Record<string, any> = {};
  
  for (const [key, spec] of Object.entries(shape)) {
    const type = typeof spec === 'string' ? spec : spec?.type;
    const description = typeof spec === 'object' ? spec?.description : undefined;
    
    let zodType: any;
    switch (type) {
      case 'string':
        zodType = z.string();
        break;
      case 'number':
        zodType = z.number();
        break;
      case 'boolean':
        zodType = z.boolean();
        break;
      case 'string[]':
        zodType = z.array(z.string());
        break;
      case 'number[]':
        zodType = z.array(z.number());
        break;
      case 'boolean[]':
        zodType = z.array(z.boolean());
        break;
      case 'object':
        zodType = z.record(z.string(), z.any());
        break;
      default:
        zodType = z.any();
    }
    
    if (description) {
      zodType = zodType.describe(description);
    }
    
    entries[key] = zodType;
  }
  
  return z.object(entries);
}

export const aiInferenceTool = createTool({
  id: 'ai_inference',
  description:
    'Unified AI inference — text, multimodal (image / audio / video / PDF / current screen), structured JSON, embeddings, or dedicated speech-to-text transcription (mode: "transcription" with a whisper-style model). Models routed via OpenRouter; vision-capable models required when sources are provided. Use for summarization, classification, extraction, Q&A, screen analysis, transcription, OCR, or any text/media → text/JSON transformation.',
  inputSchema: z.object({
    prompt: z
      .string()
      .optional()
      .default('')
      .describe('The instruction/question for the AI. Be specific about what you want. For embedding mode, this is the text to embed. Not required for transcription mode.'),
    input: z
      .string()
      .optional()
      .describe('Optional input text to process. Can also be embedded in prompt.'),
    sources: z
      .array(
        z.object({
          url: z.string().url().optional().describe('YouTube URL or direct media URL (video/PDF/image/audio)'),
          path: z.string().optional().describe('Local file path to image, audio, video, or PDF'),
          data: z.string().optional().describe('Base64-encoded media payload'),
          mimeType: z.string().optional().describe('MIME type (auto-detected from extension when omitted)'),
          captureScreen: z.boolean().optional().describe('If true, capture the current screen and analyze it (ignores other source fields)'),
        }),
      )
      .optional()
      .describe('Optional media inputs. When provided, the AI receives the prompt plus the media payload(s). Requires a vision-capable model.'),
    mode: z
      .enum(['text', 'json', 'embedding', 'transcription'])
      .default('text')
      .describe('Output mode: "text" for plain text, "json" for structured output, "embedding" for vector embeddings, "transcription" for audio → text via OpenRouter STT (e.g. openai/whisper-1)'),
    language: z
      .string()
      .optional()
      .describe('Optional ISO-639-1 language code (e.g. "en", "ja") for transcription mode. Auto-detected when omitted.'),
    audioStreamId: z
      .string()
      .optional()
      .describe('For transcription mode: a live audio streamId (e.g. from capture_media stream mode, wired in as {{capture.streamId}}). Enables real-time streaming speech-to-text — the audio is windowed and transcribed continuously. Combine with stream:true to emit a transcript stream.'),
    windowMs: z
      .number()
      .optional()
      .default(8000)
      .describe('Streaming transcription only: hard cap (ms) on each transcription window. Windows also flush early on a short silence gap so whole utterances are transcribed together. Default 8000.'),
    maxDurationMs: z
      .number()
      .optional()
      .default(0)
      .describe('Streaming transcription only: stop after this many ms of audio (0 = run until the audio stream closes). When set with stopSessionId, the capture session is stopped automatically.'),
    stopSessionId: z
      .string()
      .optional()
      .describe('Streaming transcription only: capture_media sessionId to stop_capture when maxDurationMs elapses, so the workflow ends cleanly.'),
    flowId: z
      .string()
      .optional()
      .describe('Internal: owning workflow id (threaded by the engine). Scopes the transcript output stream so it is cleaned up when the run stops.'),
    streamWindow: z
      .boolean()
      .optional()
      .describe('Internal: set by the desktop windowed-STT loop on each per-window transcription call. Skips per-window usage logging; the whole session is billed once via billUsageOnly so short windows do not each hit the 0.1-credit floor.'),
    billUsageOnly: z
      .boolean()
      .optional()
      .describe('Internal: when true (transcription mode), log a single STT usage event for `audioSeconds` of audio and return — no transcription is performed. Used by the desktop windowed-STT loop to bill the whole session once at the end.'),
    audioSeconds: z
      .number()
      .optional()
      .describe('Internal: total transcribed audio seconds, used with billUsageOnly to price one accumulated STT usage event.'),
    schema: z
      .record(z.string(), z.any())
      .optional()
      .describe('For json mode: define output shape. Keys are field names, values are types: "string", "number", "boolean", "string[]", etc. Example: { "category": "string", "confidence": "number", "tags": "string[]" }'),
    model: z
      .string()
      .default('openai/gpt-4.1-mini')
      .describe('Model selection: any OpenRouter model ID, e.g. "openai/gpt-4.1-mini", "google/gemini-3.1-pro-preview", "anthropic/claude-sonnet-4-20250514". Pick a vision-capable model when supplying sources.'),
    transcriptionModel: z
      .string()
      .optional()
      .describe('Speech-to-text model used when mode="transcription" (routed via OpenRouter STT). Examples: "openai/whisper-1", "openai/gpt-4o-transcribe", "elevenlabs/scribe_v1". Falls back to DEFAULT_STT_MODEL when omitted.'),
    temperature: z
      .number()
      .min(0)
      .max(2)
      .default(0.3)
      .describe('Creativity/randomness. 0 = deterministic, 1+ = creative'),
    systemPrompt: z
      .string()
      .optional()
      .describe('Optional system prompt to set AI behavior/persona'),
    stream: z
      .boolean()
      .optional()
      .default(false)
      .describe('When true, returns a streamId immediately and pushes tokens to the stream in real-time. Connect a stream wire to consume.'),
    injectMemory: z
      .boolean()
      .optional()
      .default(false)
      .describe('Legacy: When true, injects full memory context. Prefer the `memory` object for per-lens control.'),
    memory: z.object({
      enabled: z.boolean().describe('Master toggle for memory injection'),
      lenses: z.object({
        identity: z.boolean().optional().default(true).describe('Include user identity context'),
        directives: z.boolean().optional().default(true).describe('Include user directives/instructions'),
        bio: z.boolean().optional().default(true).describe('Include user bio'),
        relatedMemories: z.boolean().optional().default(true).describe('Include relevant past memories'),
        entities: z.boolean().optional().default(true).describe('Detect and include entity context'),
      }).optional(),
      maxFacts: z.number().optional().default(6).describe('Max global search facts to retrieve'),
      conversationHistory: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })).optional().describe('Conversation history pairs to inject as context'),
      customFacts: z.array(z.string()).optional().describe('Custom facts to inject into memory context'),
    }).optional().describe('Rich memory configuration with per-lens control, conversation history, and custom facts'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    text: z.string().optional().describe('Plain text result (text mode)'),
    json: z.any().optional().describe('Structured JSON result (json mode)'),
    embedding: z.array(z.number()).optional().describe('Vector embedding result (embedding mode)'),
    model: z.string().describe('Model used'),
    streamId: z.string().optional().describe('Stream ID when stream=true'),
    error: z.string().optional(),
  }),
  execute: async (inputData: any, { writer }: any) => {
    const {
      prompt,
      input,
      sources,
      mode,
      schema,
      model: modelId,
      transcriptionModel,
      temperature,
      systemPrompt,
      stream: streamMode = false,
      injectMemory = false,
      memory: memoryConfig,
      language,
      audioStreamId,
      windowMs = 8000,
      maxDurationMs = 0,
      stopSessionId,
      flowId,
      streamWindow = false,
      billUsageOnly = false,
      audioSeconds,
    } = (inputData || {}) as {
      prompt: string;
      input?: string;
      sources?: MediaSource[];
      mode: 'text' | 'json' | 'embedding' | 'transcription';
      schema?: Record<string, any>;
      model: string;
      transcriptionModel?: string;
      temperature: number;
      systemPrompt?: string;
      stream?: boolean;
      injectMemory?: boolean;
      memory?: { enabled: boolean; lenses?: Record<string, boolean>; maxFacts?: number; conversationHistory?: { role: string; content: string }[]; customFacts?: string[] };
      language?: string;
      audioStreamId?: string;
      windowMs?: number;
      maxDurationMs?: number;
      stopSessionId?: string;
      flowId?: string;
      streamWindow?: boolean;
      billUsageOnly?: boolean;
      audioSeconds?: number;
    };

    const hasMedia = Array.isArray(sources) && sources.length > 0;

    await safeToolWrite(writer, {
      type: 'tool_event',
      tool: 'ai_inference',
      status: 'started',
      mode,
      model: modelId,
    });

    if (mode === 'embedding') {
      const embeddingModelId = modelId.includes('embedding') ? modelId : 'google/gemini-embedding-2-preview';
      const aiEmbeddingModel = buildProviderEmbeddingModel(embeddingModelId);
      
      if (!aiEmbeddingModel) {
        throw new Error(`Failed to initialize embedding model: ${embeddingModelId}`);
      }

      const textToEmbed = input ? `${prompt}\n${input}` : prompt;

      try {
        const { embedding: resultEmbedding, usage: embedUsage } = await embed({
          model: aiEmbeddingModel,
          value: textToEmbed,
        });

        await logAiInferenceUsage(embeddingModelId, embedUsage, 'ai_inference:embedding');

        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: 'ai_inference',
          status: 'completed',
          mode: 'embedding',
        });

        return { ok: true, embedding: resultEmbedding, model: embeddingModelId };
      } catch (err: any) {
        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: 'ai_inference',
          status: 'error',
          error: err?.message || 'embedding_failed',
        });

        return { ok: false, error: err?.message || 'embedding_failed', model: embeddingModelId };
      }
    }

    if (mode === 'transcription') {
      // Dedicated audio → text via OpenRouter /audio/transcriptions.
      // Prefer the dedicated `transcriptionModel` field from the workflow UI.
      // Fall back to `modelId` only when it looks like an STT slug, else default.
      const sttModel =
        (typeof transcriptionModel === 'string' && transcriptionModel.trim())
          ? transcriptionModel.trim()
          : /whisper|transcribe|scribe/i.test(modelId)
            ? modelId
            : DEFAULT_STT_MODEL;

      // ── Bill-only finalize ──────────────────────────────────────────────────
      // The desktop windowed-STT loop runs the windowing locally (the live audio
      // stream only exists on the device) and transcribes each window via the
      // per-window path below with streamWindow:true (which skips billing). It
      // then sends ONE bill-only call with the total transcribed seconds so the
      // session is billed as a single usage event instead of flooring every short
      // window at 0.1 credits. No transcription is performed here.
      if (billUsageOnly) {
        const billSec = Number(audioSeconds) || 0;
        if (billSec > 0) {
          await logAiInferenceUsage(
            sttModel,
            { costUsd: sttCostUsd(sttModel, billSec), audioSeconds: billSec },
            'ai_inference:transcription_stream',
          );
        }
        await safeToolWrite(writer, { type: 'tool_event', tool: 'ai_inference', status: 'completed', mode: 'transcription' });
        return { ok: true, model: sttModel };
      }

      // ── Streaming speech-to-text: consume a live audio stream window-by-window ──
      // Works for any STT model (each window is a one-shot transcribe). With
      // stream:true the transcript is emitted to an output stream in real time;
      // otherwise the audio stream is drained and the joined transcript returned.
      if (typeof audioStreamId === 'string' && audioStreamId.trim()) {
        const streamResult = await runStreamingTranscription({
          audioStreamId: audioStreamId.trim(),
          sttModel,
          language,
          windowMs,
          maxDurationMs,
          stopSessionId,
          flowId,
          streamOut: !!streamMode,
          writer,
          logUsage: (model, usage) => logAiInferenceUsage(model, usage, 'ai_inference:transcription_stream'),
        });
        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: 'ai_inference',
          status: streamResult.ok ? (streamMode ? 'streaming' : 'completed') : 'error',
          mode: 'transcription',
          ...(streamResult.streamId ? { streamId: streamResult.streamId } : {}),
          ...(streamResult.error ? { error: streamResult.error } : {}),
        });
        return streamResult;
      }

      if (!Array.isArray(sources) || sources.length === 0) {
        const err = 'transcription mode requires at least one audio source';
        await safeToolWrite(writer, { type: 'tool_event', tool: 'ai_inference', status: 'error', error: err });
        return { ok: false, error: err, model: sttModel };
      }

      let uploadedForStt: string[] = [];
      try {
        const loaded = await loadMediaSources([...sources], writer, 'ai_inference');
        uploadedForStt = loaded.uploadedObjects;

        const audioPart = loaded.parts.find(p => p.mediaType.startsWith('audio/'));
        if (!audioPart) {
          const err = 'transcription mode requires an audio source (no audio/* part found)';
          await safeToolWrite(writer, { type: 'tool_event', tool: 'ai_inference', status: 'error', error: err });
          return { ok: false, error: err, model: sttModel };
        }

        // loadMediaSources returns base64 for inlined audio, or a URL for video.
        // We require base64 here — audio always inlines via shouldReadDirectly.
        if (/^https?:\/\//i.test(audioPart.data)) {
          const err = 'transcription audio was not inlined as base64 (unexpected URL part)';
          await safeToolWrite(writer, { type: 'tool_event', tool: 'ai_inference', status: 'error', error: err });
          return { ok: false, error: err, model: sttModel };
        }

        const buffer = Buffer.from(audioPart.data, 'base64');
        const result = await transcribeAudio(buffer, audioPart.mediaType, language, sttModel);

        // OpenRouter STT returns usage.cost in USD directly — pass it through as
        // costUsd. When the provider reports only duration (ElevenLabs) or no
        // usage at all, fall back to duration-based STT pricing so we bill the
        // real audio cost instead of $0 / a mis-priced token estimate.
        const providerCost = Number(result.usage?.cost);
        const audioSec = Number(result.usage?.seconds ?? result.duration);
        const billUsd =
          Number.isFinite(providerCost) && providerCost > 0
            ? providerCost
            : Number.isFinite(audioSec) && audioSec > 0
              ? sttCostUsd(sttModel, audioSec)
              : undefined;
        // streamWindow: this is one window of a desktop windowed-STT session —
        // skip per-window billing; the session is billed once via billUsageOnly.
        if (!streamWindow) {
          await logAiInferenceUsage(
            result.model,
            result.usage || billUsd != null
              ? {
                  ...(billUsd != null ? { costUsd: billUsd } : {}),
                  promptTokens: result.usage?.input_tokens,
                  completionTokens: result.usage?.output_tokens,
                  totalTokens: result.usage?.total_tokens,
                  audioSeconds: result.usage?.seconds,
                }
              : null,
            'ai_inference:transcription',
          );
        }

        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: 'ai_inference',
          status: 'completed',
          mode: 'transcription',
          length: result.transcript.length,
        });

        return { ok: true, text: result.transcript, model: sttModel };
      } catch (err: any) {
        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: 'ai_inference',
          status: 'error',
          error: err?.message || 'transcription_failed',
        });
        return { ok: false, error: err?.message || 'transcription_failed', model: sttModel };
      } finally {
        if (uploadedForStt.length > 0) {
          await cleanupUploadedMedia(uploadedForStt);
        }
      }
    }

    // Select model directly
    const aiModel = buildProviderModel(modelId);

    if (!aiModel) {
      throw new Error(`Failed to initialize model: ${modelId}`);
    }

    // Build full prompt
    const fullPrompt = input 
      ? `${prompt}\n\n---\nInput:\n${input}`
      : prompt;

    const messages: any[] = [];

    // ── MEMORY INJECTION: fetch user identity, directives, bio, relevant facts ──
    // Resolve memory config: new `memory` object takes precedence over legacy `injectMemory` boolean
    const memCfg = memoryConfig?.enabled
      ? memoryConfig
      : injectMemory
        ? { enabled: true, lenses: { identity: true, directives: true, bio: true, relatedMemories: true, entities: true }, maxFacts: 6, conversationHistory: [] as any[], customFacts: [] as string[] }
        : null;

    let memoryContext = '';
    if (memCfg?.enabled) {
      try {
        const lenses = memCfg.lenses ?? {};
        writeLog('ai_inference_memory_start', { prompt: prompt.slice(0, 50), lenses });
        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: 'ai_inference',
          status: 'loading_memory',
        });

        if (!hasClientBridge()) {
          try {
            const quickCtx = await buildQuickContext();
            if (quickCtx.trim()) {
              memoryContext = quickCtx.trim();
            }
          } catch {}
        } else {
          const knowledgeCtx = await buildKnowledgeContext(prompt, {
            includeIdentity: lenses.identity !== false,
            includeDirectives: lenses.directives !== false,
            includeBio: lenses.bio !== false,
            maxGlobalFacts: memCfg.maxFacts ?? 6,
            detectEntities: lenses.entities !== false,
          });
          if (knowledgeCtx && knowledgeCtx.text.trim()) {
            memoryContext = knowledgeCtx.text.trim();
          }
        }

        if (memoryContext) {
          messages.push({ role: 'system', content: memoryContext });
          writeLog('ai_inference_memory_injected', { length: memoryContext.length });
        }

        // Append custom facts
        if (Array.isArray(memCfg.customFacts) && memCfg.customFacts.length > 0) {
          const validFacts = memCfg.customFacts.filter((f: string) => typeof f === 'string' && f.trim());
          if (validFacts.length > 0) {
            const factsBlock = '\n\n[CUSTOM FACTS]\n' + validFacts.map((f: string) => `- ${f.trim()}`).join('\n');
            if (memoryContext) {
              // Amend the last system message
              messages[messages.length - 1].content += factsBlock;
            } else {
              messages.push({ role: 'system', content: factsBlock.trim() });
            }
          }
        }

        // Inject conversation history as context messages
        if (Array.isArray(memCfg.conversationHistory) && memCfg.conversationHistory.length > 0) {
          for (const msg of memCfg.conversationHistory) {
            if (msg.role && msg.content?.trim()) {
              messages.push({ role: msg.role as 'user' | 'assistant', content: msg.content.trim() });
            }
          }
        }
      } catch (memErr: any) {
        writeLog('ai_inference_memory_error', { error: memErr?.message });
        // Non-fatal: continue without memory
      }
    }

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // Load media sources (image / audio / video / PDF / current screen) if provided.
    // The cleanup callback removes any temporary GCS objects after the call settles.
    let uploadedObjects: string[] = [];
    let convertedAudioPaths: string[] = [];
    if (hasMedia) {
      const mutableSources = [...sources!];

      // ── OpenRouter audio pre-processing ──────────────────────────────────
      // Convert unsupported audio formats (m4a/ogg/opus/aac/flac/…) → MP3
      // and normalize MIME types before loadMediaSources runs.
      if (isOpenRouterModel(modelId)) {
        const { convertedPaths, warnings } =
          await convertIncompatibleAudioForOpenRouter(mutableSources, writer);
        convertedAudioPaths = convertedPaths;

        if (warnings.length > 0) {
          await safeToolWrite(writer, {
            type: 'tool_event',
            tool: 'ai_inference',
            status: 'audio_warnings',
            warnings,
          });
        }
      }

      const loaded = await loadMediaSources(mutableSources, writer, 'ai_inference');
      uploadedObjects = loaded.uploadedObjects;

      // Emit a media_attached event so users/workflows can see what was sent
      await safeToolWrite(writer, {
        type: 'tool_event',
        tool: 'ai_inference',
        status: 'media_attached',
        count: loaded.parts.length,
        mediaTypes: loaded.parts.map((p: any) => p.mediaType),
      });

      messages.push({
        role: 'user',
        content: [{ type: 'text', text: fullPrompt }, ...loaded.parts],
      });
    } else {
      messages.push({ role: 'user', content: fullPrompt });
    }

    try {
      // ── STREAM MODE: create stream, push tokens in background, return immediately ──
      if (streamMode && mode === 'text') {
        const streamResult = await execLocalTool('stream_create', {
          kind: 'text',
          sourceStepId: 'ai_inference',
          metadata: { model: modelId, prompt: prompt.slice(0, 100) },
        });

        if (!streamResult?.ok || !streamResult?.streamId) {
          return { ok: false, error: 'Failed to create stream', model: modelId };
        }

        const streamId = streamResult.streamId;

        // Fire and forget — stream tokens in background.
        // Defer media cleanup until the stream finishes so the model can
        // still fetch GCS-hosted URLs while generating.
        const uploadedForStream = uploadedObjects;
        const convertedForStream = convertedAudioPaths;
        uploadedObjects = [];
        convertedAudioPaths = [];
        (async () => {
          try {
            const result = await streamText({
              model: aiModel as any,
              messages,
              temperature,
            });

            for await (const chunk of result.textStream) {
              if (chunk) {
                await execLocalTool('stream_write', { streamId, chunk, chunkType: 'raw' }).catch(() => {});
              }
            }

            // Stream done — usage is now resolvable. Log it so credits debit.
            try {
              const streamUsage = await result.usage;
              await logAiInferenceUsage(modelId, streamUsage, 'ai_inference:stream');
            } catch { /* best-effort billing */ }
          } catch (err: any) {
            writeLog('ai_inference_stream_error', { streamId, error: err?.message });
          } finally {
            await execLocalTool('stream_close', { streamId }).catch(() => {});
            if (uploadedForStream.length > 0) {
              await cleanupUploadedMedia(uploadedForStream);
            }
            // Clean up converted audio temp files
            for (const p of convertedForStream) {
              try { await execLocalTool('delete_file', { path: p }, writer); } catch { /* best-effort */ }
            }
          }
        })();

        return { ok: true, streamId, model: modelId };
      }

      if (mode === 'json' && schema) {
        // Structured JSON output — augment the existing user message (which may
        // contain media parts) with the schema instruction instead of replacing it.
        const schemaDesc = JSON.stringify(schema);
        const jsonInstruction = `\n\nRespond with a valid JSON object matching this schema: ${schemaDesc}\nOutput ONLY the JSON, no markdown or explanation.`;

        const last = messages[messages.length - 1];
        if (last?.role === 'user') {
          if (Array.isArray(last.content)) {
            const textPart = last.content.find((p: any) => p?.type === 'text');
            if (textPart) {
              textPart.text += jsonInstruction;
            } else {
              last.content.unshift({ type: 'text', text: jsonInstruction.trim() });
            }
          } else if (typeof last.content === 'string') {
            last.content += jsonInstruction;
          }
        }

        const result = await generateText({
          model: aiModel as any,
          messages,
          temperature,
        });

        await logAiInferenceUsage(modelId, result.usage, 'ai_inference:json');

        let jsonResult: any;
        try {
          // Try to parse JSON from response
          const text = result.text.trim();
          // Handle markdown code blocks
          const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
          const jsonStr = jsonMatch ? jsonMatch[1].trim() : text;
          jsonResult = JSON.parse(jsonStr);
        } catch (parseErr) {
          // Try to extract JSON object/array
          const text = result.text.trim();
          const start = text.indexOf('{');
          const end = text.lastIndexOf('}');
          if (start >= 0 && end > start) {
            jsonResult = JSON.parse(text.slice(start, end + 1));
          } else {
            throw new Error('Failed to parse JSON from response');
          }
        }

        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: 'ai_inference',
          status: 'completed',
          mode: 'json',
        });

        return { ok: true, json: jsonResult, model: modelId };
      } else {
        // Plain text output
        const result = await generateText({
          model: aiModel as any,
          messages,
          temperature,
        });

        await logAiInferenceUsage(modelId, result.usage, 'ai_inference:text');

        const text = result.text?.trim() || '';

        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: 'ai_inference',
          status: 'completed',
          mode: 'text',
          length: text.length,
        });

        return { ok: true, text, model: modelId };
      }
    } catch (err: any) {
      await safeToolWrite(writer, {
        type: 'tool_event',
        tool: 'ai_inference',
        status: 'error',
        error: err?.message || 'inference_failed',
      });

      return { ok: false, error: err?.message || 'inference_failed', model: modelId };
    } finally {
      if (uploadedObjects.length > 0) {
        await cleanupUploadedMedia(uploadedObjects);
      }
      // Clean up temporary converted audio files
      if (convertedAudioPaths.length > 0) {
        for (const p of convertedAudioPaths) {
          try {
            await execLocalTool('delete_file', { path: p }, writer);
          } catch {
            // best-effort cleanup
          }
        }
      }
    }
  },
} as any);
