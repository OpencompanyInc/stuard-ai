import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { embedMany } from "ai";
import { execLocalTool, hasClientBridge } from "./shared";
import { resolveEmbedder } from "../../utils/embeddings";

/**
 * Knowledge Packs — sandboxed, attachable RAG.
 *
 * A "pack" is an isolated namespace of source-derived text chunks + embeddings.
 * Embedding is done here (same gemini-embedding model as the knowledge graph)
 * and the vectors are shipped to the device-local store (`rag_db` via the
 * `rag_pack_*` dispatch handlers). Retrieval is scoped strictly to one pack id,
 * so packs never leak into each other or into the personal knowledge graph.
 *
 * Pack contents are personal user documents → they live device-local, never in
 * Supabase. These tools require the desktop bridge (slice 1); VM parity is a
 * follow-up.
 */

const MAX_FILE_READ_WINDOW = 500; // matches MAX_READ_FILE_LINES on the device
const EMBED_BATCH = 96; // sub-batch size for embedMany calls
const ADD_CHUNK_BATCH = 200; // how many chunks per bridge round-trip
const PROJECT_LAZY_INGEST_FILE_LIMIT = 2;
const PROJECT_LAZY_INGEST_CHUNK_LIMIT = 60;

// ── Chunking ─────────────────────────────────────────────────────────────────

/**
 * Split text into overlapping chunks, preferring paragraph then sentence
 * boundaries so chunks stay semantically coherent.
 */
export function chunkText(
  text: string,
  opts?: { maxChars?: number; overlap?: number },
): string[] {
  const maxChars = Math.max(200, opts?.maxChars ?? 1200);
  const overlap = Math.max(
    0,
    Math.min(opts?.overlap ?? 150, Math.floor(maxChars / 2)),
  );
  const clean = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  // Split into paragraph-ish units, then greedily pack into chunks.
  const units = clean.split(/\n\s*\n/);
  const chunks: string[] = [];
  let buf = "";

  const flush = () => {
    const trimmed = buf.trim();
    if (trimmed) chunks.push(trimmed);
    buf = "";
  };

  for (const unitRaw of units) {
    const unit = unitRaw.trim();
    if (!unit) continue;

    if (unit.length > maxChars) {
      // A single oversized paragraph — break it on sentence boundaries.
      flush();
      const sentences = unit.split(/(?<=[.!?])\s+/);
      let sBuf = "";
      for (const s of sentences) {
        if ((sBuf + " " + s).trim().length > maxChars && sBuf) {
          chunks.push(sBuf.trim());
          // carry overlap tail into the next sentence buffer
          sBuf = overlap > 0 ? sBuf.slice(-overlap) + " " + s : s;
        } else {
          sBuf = sBuf ? `${sBuf} ${s}` : s;
        }
      }
      if (sBuf.trim()) chunks.push(sBuf.trim());
      continue;
    }

    if ((buf + "\n\n" + unit).length > maxChars && buf) {
      flush();
      // seed the next buffer with an overlap tail of the previous chunk
      const prev = chunks[chunks.length - 1] || "";
      buf = overlap > 0 && prev ? prev.slice(-overlap) + "\n\n" + unit : unit;
    } else {
      buf = buf ? `${buf}\n\n${unit}` : unit;
    }
  }
  flush();

  return chunks.filter(Boolean);
}

// ── Source text extraction ───────────────────────────────────────────────────

/**
 * Read a file's text via the device `read_file` handler, paging through large
 * files (which the device caps at 500 lines per read). `read_file` extracts
 * text from PDFs/XLSX/DOCX as well as plain text.
 */
async function readFileText(
  path: string,
  writer: any,
): Promise<{ text: string; error?: string }> {
  const first = await execLocalTool("read_file", { path }, writer, 30000);
  if (first?.ok && typeof first.content === "string") {
    return { text: first.content };
  }
  if (first?.error === "file_too_large" && Number(first.total_lines) > 0) {
    const total = Number(first.total_lines);
    const parts: string[] = [];
    for (let start = 1; start <= total; start += MAX_FILE_READ_WINDOW) {
      const end = Math.min(start + MAX_FILE_READ_WINDOW - 1, total);
      const page = await execLocalTool(
        "read_file",
        { path, line_start: start, line_end: end },
        writer,
        30000,
      );
      if (page?.ok && typeof page.content === "string")
        parts.push(page.content);
      else break;
    }
    if (parts.length) return { text: parts.join("") };
  }
  return { text: "", error: first?.error || first?.message || "read_failed" };
}

async function embedTexts(texts: string[], writer: any): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embedder } = await resolveEmbedder(writer);
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const { embeddings } = await embedMany({
      model: embedder as any,
      values: batch,
    });
    out.push(...(embeddings as number[][]));
  }
  return out;
}

function normalizeSourceRef(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^file:\/+/, "");
}

function basenameFromPath(raw: string): string {
  const clean = normalizeSourceRef(raw).replace(/[\\/]+$/, "");
  return clean.split(/[\\/]/).pop() || clean || "Document";
}

async function addEmbeddedChunksToPack(args: {
  packId: string;
  chunks: Array<{ text: string; source_ref: string }>;
  vectors: number[][];
  writer?: any;
}): Promise<number> {
  let chunksAdded = 0;
  for (let i = 0; i < args.chunks.length; i += ADD_CHUNK_BATCH) {
    const slice = args.chunks.slice(i, i + ADD_CHUNK_BATCH);
    const payload = slice.map((c, j) => ({
      text: c.text,
      source_ref: c.source_ref,
      vector: args.vectors[i + j],
    }));
    const res = await execLocalTool(
      "rag_pack_add_chunks",
      { pack_id: args.packId, chunks: payload },
      args.writer,
      60000,
      { silent: true },
    );
    if (res?.ok) chunksAdded += Number(res.inserted || 0);
  }
  return chunksAdded;
}

export async function ensureProjectDocumentPack(args: {
  projectId: string;
  projectName?: string | null;
  writer?: any;
}): Promise<{ ok: boolean; packId?: string; stats?: any; error?: string }> {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) return { ok: false, error: "projectId is required" };
  if (!hasClientBridge())
    return { ok: false, error: "No desktop bridge available." };

  const title = args.projectName
    ? `${args.projectName} documents`
    : "Project documents";
  const res = await execLocalTool(
    "rag_project_pack_get_or_create",
    {
      project_id: projectId,
      title,
    },
    args.writer,
    15000,
    { silent: true },
  );

  if (!res?.ok || !res?.id)
    return {
      ok: false,
      error: res?.error || "project_document_context_unavailable",
    };
  return { ok: true, packId: String(res.id), stats: res.stats };
}

export async function ingestProjectContextPath(args: {
  projectId: string;
  projectName?: string | null;
  path: string;
  writer?: any;
  replaceExisting?: boolean;
  maxChunks?: number;
}): Promise<{
  ok: boolean;
  projectId: string;
  path: string;
  packId?: string;
  chunksAdded?: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
}> {
  const projectId = String(args.projectId || "").trim();
  const sourceRef = normalizeSourceRef(args.path);
  if (!projectId)
    return {
      ok: false,
      projectId,
      path: sourceRef,
      error: "projectId is required",
    };
  if (!sourceRef)
    return { ok: false, projectId, path: sourceRef, error: "path is required" };
  if (!hasClientBridge())
    return {
      ok: false,
      projectId,
      path: sourceRef,
      error: "No desktop bridge available.",
    };

  const read = await readFileText(sourceRef, args.writer);
  if (!read.text) {
    return {
      ok: false,
      projectId,
      path: sourceRef,
      skipped: true,
      reason: read.error || "no text extracted",
    };
  }

  let chunks = chunkText(read.text).map((text) => ({
    text,
    source_ref: sourceRef,
  }));
  if (typeof args.maxChunks === "number" && args.maxChunks > 0) {
    chunks = chunks.slice(0, Math.floor(args.maxChunks));
  }
  if (chunks.length === 0) {
    return {
      ok: false,
      projectId,
      path: sourceRef,
      skipped: true,
      reason: "no chunks produced",
    };
  }

  const pack = await ensureProjectDocumentPack({
    projectId,
    projectName: args.projectName,
    writer: args.writer,
  });
  if (!pack.ok || !pack.packId)
    return {
      ok: false,
      projectId,
      path: sourceRef,
      error: pack.error || "pack_create_failed",
    };

  let vectors: number[][];
  try {
    vectors = await embedTexts(
      chunks.map((c) => c.text),
      args.writer,
    );
  } catch (e: any) {
    return {
      ok: false,
      projectId,
      path: sourceRef,
      packId: pack.packId,
      error: `embedding_failed: ${e?.message || e}`,
    };
  }

  if (args.replaceExisting !== false) {
    await execLocalTool(
      "rag_pack_delete_source",
      {
        pack_id: pack.packId,
        source_ref: sourceRef,
      },
      args.writer,
      20000,
      { silent: true },
    ).catch(() => null);
  }

  const chunksAdded = await addEmbeddedChunksToPack({
    packId: pack.packId,
    chunks,
    vectors,
    writer: args.writer,
  });

  return {
    ok: chunksAdded > 0,
    projectId,
    path: sourceRef,
    packId: pack.packId,
    chunksAdded,
    ...(chunksAdded > 0 ? {} : { error: "No chunks were stored." }),
  };
}

export async function syncProjectDocumentContext(args: {
  projectId: string;
  projectName?: string | null;
  paths: string[];
  writer?: any;
  maxFiles?: number;
  maxChunksPerFile?: number;
}): Promise<{
  ok: boolean;
  attempted: number;
  indexed: number;
  skipped: Array<{ path: string; reason: string }>;
  error?: string;
}> {
  const projectId = String(args.projectId || "").trim();
  const paths = Array.isArray(args.paths)
    ? args.paths.map(normalizeSourceRef).filter(Boolean)
    : [];
  if (!projectId || paths.length === 0 || !hasClientBridge()) {
    return { ok: true, attempted: 0, indexed: 0, skipped: [] };
  }

  let existing = new Set<string>();
  try {
    const stats = await execLocalTool(
      "rag_project_pack_stats",
      { project_id: projectId },
      args.writer,
      10000,
      { silent: true },
    );
    existing = new Set(
      Array.isArray(stats?.source_refs)
        ? stats.source_refs.map((s: any) => String(s || ""))
        : [],
    );
  } catch {
    existing = new Set();
  }

  const maxFiles = Math.max(
    1,
    Math.min(args.maxFiles ?? PROJECT_LAZY_INGEST_FILE_LIMIT, 10),
  );
  const missing = paths.filter((p) => !existing.has(p)).slice(0, maxFiles);
  let indexed = 0;
  const skipped: Array<{ path: string; reason: string }> = [];

  for (const p of missing) {
    const res = await ingestProjectContextPath({
      projectId,
      projectName: args.projectName,
      path: p,
      writer: args.writer,
      replaceExisting: false,
      maxChunks: args.maxChunksPerFile ?? PROJECT_LAZY_INGEST_CHUNK_LIMIT,
    });
    if (res.ok) indexed++;
    else
      skipped.push({
        path: p,
        reason: res.reason || res.error || "not indexed",
      });
  }

  return { ok: true, attempted: missing.length, indexed, skipped };
}

export async function queryProjectDocumentContext(args: {
  projectId: string;
  query: string;
  vector?: number[];
  writer?: any;
  limit?: number;
  threshold?: number;
}): Promise<{
  ok: boolean;
  results: Array<{
    text: string;
    source: string;
    score?: number | null;
    ordinal?: number | null;
  }>;
  error?: string;
}> {
  const projectId = String(args.projectId || "").trim();
  const query = String(args.query || "").trim();
  if (!projectId || !query || !hasClientBridge())
    return { ok: true, results: [] };

  let vector = args.vector;
  if (!Array.isArray(vector) || vector.length === 0) {
    try {
      const { embedder } = await resolveEmbedder(args.writer);
      const { embeddings } = await embedMany({
        model: embedder as any,
        values: [query],
      });
      vector = embeddings[0] as number[];
    } catch (e: any) {
      return {
        ok: false,
        results: [],
        error: `embedding_failed: ${e?.message || e}`,
      };
    }
  }

  const res = await execLocalTool(
    "rag_project_pack_query",
    {
      project_id: projectId,
      vector,
      limit: Math.max(1, Math.min(args.limit ?? 5, 20)),
      threshold: args.threshold ?? 0.12,
    },
    args.writer,
    12000,
    { silent: true },
  );

  if (!res?.ok)
    return { ok: false, results: [], error: res?.error || "query_failed" };
  const results = (Array.isArray(res.results) ? res.results : [])
    .map((r: any) => ({
      text: String(r?.text || "").trim(),
      source:
        String(r?.source_ref || "").trim() ||
        basenameFromPath(String(r?.source_ref || "")),
      score: typeof r?.score === "number" ? r.score : null,
      ordinal: typeof r?.ordinal === "number" ? r.ordinal : null,
    }))
    .filter((r: any) => r.text);
  return { ok: true, results };
}

// ── Tools ────────────────────────────────────────────────────────────────────

const sourceSchema = z.object({
  type: z
    .enum(["text", "file"])
    .describe(
      '"text" for inline content, "file" for a local path (PDF/DOCX/XLSX/txt/md are extracted).',
    ),
  title: z
    .string()
    .optional()
    .describe(
      "Friendly label for this source — shown as the citation when chunks are retrieved.",
    ),
  content: z
    .string()
    .optional()
    .describe('The raw text (required when type="text").'),
  path: z
    .string()
    .optional()
    .describe('Absolute local file path (required when type="file").'),
});

export const create_knowledge_pack = createTool({
  id: "create_knowledge_pack",
  description: `Build a sandboxed knowledge pack (a private RAG namespace) from one or more sources, then return its packId.

Use this to "ragify" documents the user wants to study, quiz on, or interview-prep with. After creating a pack, query it with query_knowledge_pack (and you can attach the same packId to a live session later).

Sources can be inline text ({type:"text", content}) or local files ({type:"file", path}) — PDFs/DOCX/XLSX/txt/md are text-extracted automatically. Pass an existing packId to add more sources to a pack instead of creating a new one. Set scope:"ephemeral" for a throwaway pack or "saved" (default) to keep it.`,
  inputSchema: z.object({
    title: z
      .string()
      .optional()
      .describe(
        'Name for the pack (e.g. "CS Interview Prep"). Required when creating a new pack.',
      ),
    persona: z
      .string()
      .optional()
      .describe(
        'Optional one-line description of how the pack should be used (e.g. "technical interviewer for a backend role").',
      ),
    scope: z
      .enum(["ephemeral", "saved"])
      .default("saved")
      .describe(
        '"saved" persists the pack; "ephemeral" marks it as throwaway.',
      ),
    packId: z
      .string()
      .optional()
      .describe("Existing pack to add sources to. Omit to create a new pack."),
    sources: z
      .array(sourceSchema)
      .min(1)
      .describe("The sources to ingest into the pack."),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    packId: z.string().optional(),
    title: z.string().optional(),
    scope: z.string().optional(),
    sourcesIngested: z.number().optional(),
    chunksAdded: z.number().optional(),
    skipped: z
      .array(z.object({ source: z.string(), reason: z.string() }))
      .optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, runCtx) => {
    const writer = (runCtx as any)?.writer;
    const input = (inputData as any) || {};

    if (!hasClientBridge()) {
      return {
        ok: false,
        error:
          "No desktop bridge available. Knowledge packs require the Stuard desktop app.",
      };
    }

    const sources: any[] = Array.isArray(input.sources) ? input.sources : [];
    if (sources.length === 0)
      return { ok: false, error: "At least one source is required." };

    // Resolve / create the target pack.
    let packId = String(input.packId || "").trim();
    let title = String(input.title || "").trim();
    const scope = input.scope === "ephemeral" ? "ephemeral" : "saved";

    if (!packId) {
      if (!title) title = "Knowledge pack";
      const created = await execLocalTool(
        "rag_pack_create",
        {
          title,
          persona: String(input.persona || ""),
          scope,
        },
        writer,
        15000,
      );
      if (!created?.ok || !created?.id) {
        return { ok: false, error: created?.error || "pack_create_failed" };
      }
      packId = String(created.id);
    }

    // Extract text per source → chunk → tag with a source_ref for citations.
    const skipped: Array<{ source: string; reason: string }> = [];
    const allChunks: Array<{ text: string; source_ref: string }> = [];
    let sourcesIngested = 0;

    for (let i = 0; i < sources.length; i++) {
      const src = sources[i] || {};
      const label = String(src.title || src.path || `source ${i + 1}`);
      let text = "";

      if (src.type === "file") {
        const path = String(src.path || "").trim();
        if (!path) {
          skipped.push({ source: label, reason: "missing path" });
          continue;
        }
        const read = await readFileText(path, writer);
        if (!read.text) {
          skipped.push({
            source: label,
            reason: read.error || "no text extracted",
          });
          continue;
        }
        text = read.text;
      } else {
        text = String(src.content || "").trim();
        if (!text) {
          skipped.push({ source: label, reason: "empty content" });
          continue;
        }
      }

      const chunks = chunkText(text);
      if (chunks.length === 0) {
        skipped.push({ source: label, reason: "no chunks produced" });
        continue;
      }
      for (const c of chunks) allChunks.push({ text: c, source_ref: label });
      sourcesIngested++;
    }

    if (allChunks.length === 0) {
      return {
        ok: false,
        packId,
        title,
        error: "No ingestible text found in the provided sources.",
        skipped,
      };
    }

    // Embed all chunks, then ship to the device store in bounded batches.
    let vectors: number[][];
    try {
      vectors = await embedTexts(
        allChunks.map((c) => c.text),
        writer,
      );
    } catch (e: any) {
      return {
        ok: false,
        packId,
        title,
        error: `embedding_failed: ${e?.message || e}`,
        skipped,
      };
    }

    let chunksAdded = 0;
    for (let i = 0; i < allChunks.length; i += ADD_CHUNK_BATCH) {
      const slice = allChunks.slice(i, i + ADD_CHUNK_BATCH);
      const payload = slice.map((c, j) => ({
        text: c.text,
        source_ref: c.source_ref,
        vector: vectors[i + j],
      }));
      const res = await execLocalTool(
        "rag_pack_add_chunks",
        { pack_id: packId, chunks: payload },
        writer,
        60000,
      );
      if (res?.ok) chunksAdded += Number(res.inserted || 0);
    }

    return {
      ok: chunksAdded > 0,
      packId,
      title: title || undefined,
      scope,
      sourcesIngested,
      chunksAdded,
      ...(skipped.length ? { skipped } : {}),
      ...(chunksAdded > 0 ? {} : { error: "No chunks were stored." }),
    };
  },
});

export const list_knowledge_packs = createTool({
  id: "list_knowledge_packs",
  description:
    "List the user's saved knowledge packs (RAG namespaces), most recently used first. Use this to find a packId to query or attach to a live session.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe("Max packs to return."),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    packs: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          persona: z.string().optional(),
          scope: z.string().optional(),
          chunk_count: z.number().optional(),
          updated_at: z.string().optional(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, runCtx) => {
    const writer = (runCtx as any)?.writer;
    if (!hasClientBridge()) {
      return {
        ok: false,
        error:
          "No desktop bridge available. Knowledge packs require the Stuard desktop app.",
        packs: [],
      };
    }
    const res = await execLocalTool(
      "rag_pack_list",
      { limit: (inputData as any)?.limit || 50 },
      writer,
      15000,
    );
    if (!res?.ok)
      return { ok: false, error: res?.error || "list_failed", packs: [] };
    return { ok: true, packs: Array.isArray(res.packs) ? res.packs : [] };
  },
});

export const query_knowledge_pack = createTool({
  id: "query_knowledge_pack",
  description: `Semantic search inside one knowledge pack. Returns the most relevant text chunks (with their source labels) for grounding answers, quiz questions, or interview prompts.

Retrieval is scoped strictly to the given packId — it never reads other packs or the user's personal memory. Call this whenever you need facts from the pack's documents; cite the returned source labels.`,
  inputSchema: z.object({
    packId: z
      .string()
      .describe(
        "The pack to search (from create_knowledge_pack or list_knowledge_packs).",
      ),
    query: z
      .string()
      .describe("Natural-language query to retrieve relevant passages for."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(6)
      .describe("Max chunks to return."),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    packId: z.string().optional(),
    results: z
      .array(
        z.object({
          text: z.string(),
          source: z.string().optional(),
          score: z.number().optional(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, runCtx) => {
    const writer = (runCtx as any)?.writer;
    const input = (inputData as any) || {};
    const packId = String(input.packId || "").trim();
    const query = String(input.query || "").trim();
    const limit = Math.max(1, Math.min(Number(input.limit || 6), 20));

    if (!hasClientBridge()) {
      return {
        ok: false,
        error:
          "No desktop bridge available. Knowledge packs require the Stuard desktop app.",
        results: [],
      };
    }
    if (!packId) return { ok: false, error: "packId is required", results: [] };
    if (!query) return { ok: false, error: "query is required", results: [] };

    let vector: number[];
    try {
      const { embedder } = await resolveEmbedder(writer);
      const { embeddings } = await embedMany({
        model: embedder as any,
        values: [query],
      });
      vector = embeddings[0] as number[];
    } catch (e: any) {
      return {
        ok: false,
        packId,
        error: `embedding_failed: ${e?.message || e}`,
        results: [],
      };
    }

    const res = await execLocalTool(
      "rag_pack_query",
      { pack_id: packId, vector, limit },
      writer,
      20000,
    );
    if (!res?.ok)
      return {
        ok: false,
        packId,
        error: res?.error || "query_failed",
        results: [],
      };

    const results = (Array.isArray(res.results) ? res.results : []).map(
      (r: any) => ({
        text: String(r?.text || ""),
        source: r?.source_ref ? String(r.source_ref) : undefined,
        score: typeof r?.score === "number" ? r.score : undefined,
      }),
    );
    return { ok: true, packId, results };
  },
});

export const start_live_session = createTool({
  id: "start_live_session",
  description: `Open a real-time VOICE session on the user's desktop, optionally attaching knowledge packs so the live assistant can query them out loud.

Use this for a spoken quiz, an interview simulation, or a tutoring session grounded in the user's documents — e.g. "quiz me on these notes" or "run a mock interview from my prep pack". Pass knowledgePackIds (from create_knowledge_pack / list_knowledge_packs) to attach packs; the live model gets a scoped query_knowledge_pack tool for them. Use 'persona' to shape how the assistant behaves and 'initialMessage' for its opening line.

Requires the Stuard desktop app (voice needs a microphone). This opens the voice pill; the spoken conversation then happens live — you don't continue it from chat.`,
  inputSchema: z.object({
    knowledgePackIds: z
      .array(z.string())
      .optional()
      .describe("Knowledge pack ids to attach to the session."),
    persona: z
      .string()
      .optional()
      .describe(
        'How the live assistant should behave (e.g. "a technical interviewer for a backend SWE role; ask one question at a time and probe follow-ups").',
      ),
    initialMessage: z
      .string()
      .optional()
      .describe("The first line the assistant speaks when the session opens."),
    provider: z
      .string()
      .optional()
      .describe(
        "Optional voice provider override. Leave blank for the default.",
      ),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    started: z.boolean().optional(),
    attachedPacks: z
      .array(z.object({ id: z.string(), title: z.string().optional() }))
      .optional(),
    note: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, runCtx) => {
    const writer = (runCtx as any)?.writer;
    const input = (inputData as any) || {};

    if (!hasClientBridge()) {
      return {
        ok: false,
        error:
          "No desktop bridge available. Live voice sessions require the Stuard desktop app.",
      };
    }

    const ids: string[] = Array.isArray(input.knowledgePackIds)
      ? input.knowledgePackIds
          .map((s: any) => String(s || "").trim())
          .filter(Boolean)
      : [];

    // Best-effort: resolve pack titles so the live prompt can name them.
    let knowledgePacks: Array<{ id: string; title?: string }> = ids.map(
      (id) => ({ id }),
    );
    if (ids.length) {
      try {
        const list = await execLocalTool(
          "rag_pack_list",
          { limit: 100 },
          writer,
          10000,
        );
        const byId = new Map<string, string>(
          (Array.isArray(list?.packs) ? list.packs : []).map((p: any) => [
            String(p.id),
            String(p.title || ""),
          ]),
        );
        knowledgePacks = ids.map((id) => ({
          id,
          title: byId.get(id) || undefined,
        }));
      } catch {
        /* keep id-only */
      }
    }

    // Dispatched to the renderer (live session bus) which opens the voice pill.
    const res = await execLocalTool(
      "start_live_session",
      {
        knowledgePackIds: ids.length ? ids : undefined,
        knowledgePacks: knowledgePacks.length ? knowledgePacks : undefined,
        systemPrompt: input.persona ? String(input.persona) : undefined,
        initialMessage: input.initialMessage
          ? String(input.initialMessage)
          : undefined,
        provider: input.provider ? String(input.provider) : undefined,
      },
      writer,
      20000,
    );

    if (res?.ok) {
      return {
        ok: true,
        started: true,
        ...(knowledgePacks.length ? { attachedPacks: knowledgePacks } : {}),
        note: "The session is now live by voice — it runs independently, so do not keep waiting on it. When it ends, its summary and feedback will arrive as a follow-up message you can relay to the user. Briefly tell the user the voice session has started.",
      };
    }
    return { ok: false, error: res?.error || "failed_to_start_live_session" };
  },
});
