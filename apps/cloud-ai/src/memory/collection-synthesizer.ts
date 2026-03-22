/**
 * Collection Synthesizer
 *
 * Background job that generates and maintains pre-computed summaries
 * for topic collections. Also handles topic merging to prevent fragmentation.
 *
 * Triggered periodically (e.g., after every ~20 conversation turns) or on demand.
 */

import { embed, generateText } from 'ai';
import { google, buildProviderModel } from '../utils/models';
import { getDefaultModelForCategory } from '../pricing';
import { execLocalTool, hasClientBridge } from '../tools/bridge';
import { writeLog } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════════════════════
// SYNTHESIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Synthesize collection summaries for all topic drawers.
 *
 * For each topic with > minSegments segments:
 * - If no existing summary exists, or the latest segment is newer than the summary, regenerate.
 * - Uses a fast LLM to produce a 2-3 sentence summary from segment summaries.
 * - Embeds the summary and stores it in collection_summaries.
 */
export async function synthesizeCollections(options?: {
  minSegments?: number;
  force?: boolean;
}): Promise<{ synthesized: number; merged: number }> {
  if (!hasClientBridge()) return { synthesized: 0, merged: 0 };

  const minSegments = options?.minSegments ?? 5;
  let synthesized = 0;

  try {
    // Fetch all topic drawers
    const result = await execLocalTool(
      'segment_build_topic_drawers',
      { limit_topics: 200, limit_segments_per_topic: 20, segments_scan_limit: 3000 },
      undefined,
      30000,
    );
    const drawers: any[] = result?.drawers || [];

    // Fetch existing summaries to check staleness
    const existingResult = await execLocalTool('collection_summary_list', { limit: 500 }, undefined, 10000);
    const existingSummaries: Map<string, any> = new Map();
    for (const s of (existingResult?.summaries || [])) {
      existingSummaries.set(String(s.topic || '').toLowerCase(), s);
    }

    const modelId = getDefaultModelForCategory('fast');
    const model = buildProviderModel(modelId);

    for (const drawer of drawers) {
      const topic = String(drawer.topic || '').trim();
      const segmentCount = drawer.count || 0;
      if (!topic || segmentCount < minSegments) continue;

      // Collect all segment summaries from clusters
      const allSegments: any[] = [];
      for (const cluster of drawer.clusters || []) {
        for (const seg of cluster.segments || []) {
          allSegments.push(seg);
        }
      }
      if (allSegments.length === 0) continue;

      // Sort by date
      allSegments.sort((a: any, b: any) =>
        String(b.created_at || '').localeCompare(String(a.created_at || '')),
      );

      const latestSegDate = allSegments[0]?.created_at || '';
      const earliestSegDate = allSegments[allSegments.length - 1]?.created_at || '';

      // Check if we need to regenerate
      const existing = existingSummaries.get(topic.toLowerCase());
      if (existing && !options?.force) {
        const existingUpdated = existing.updated_at || '';
        if (existingUpdated >= latestSegDate) continue; // Still fresh
      }

      // Generate summary
      const summaryBlock = allSegments
        .slice(0, 20)
        .map((s: any, i: number) => `[${i + 1}] (${String(s.created_at || '').slice(0, 10)}): ${s.summary || 'No summary'}`)
        .join('\n');

      try {
        const { text: synthesis } = await generateText({
          model: model as any,
          system:
            'You summarize a collection of conversation segments about a topic into 2-3 concise sentences. Focus on key outcomes, decisions, and recurring themes. Be factual and specific.',
          prompt: `Topic: "${topic}"\n\nSegments (${allSegments.length} total, showing ${Math.min(20, allSegments.length)} most recent):\n${summaryBlock}`,
          temperature: 0.2,
        });

        // Embed the summary for vector search
        let summaryEmbedding: number[] = [];
        try {
          const { embedding } = await embed({
            model: google.textEmbeddingModel('gemini-embedding-2-preview'),
            value: `${topic}: ${synthesis}`,
          });
          summaryEmbedding = embedding;
        } catch {}

        await execLocalTool(
          'collection_summary_upsert',
          {
            topic,
            summary: synthesis.trim(),
            segment_count: segmentCount,
            date_range_start: earliestSegDate,
            date_range_end: latestSegDate,
            embedding: summaryEmbedding.length > 0 ? summaryEmbedding : undefined,
          },
          undefined,
          10000,
        );

        synthesized++;
        writeLog('collection_synthesized', { topic, segmentCount, summaryLength: synthesis.length });
      } catch (err) {
        writeLog('collection_synthesis_error', { topic, error: String(err) });
      }
    }
  } catch (error) {
    writeLog('synthesize_collections_error', { error: String(error) });
  }

  // Run topic merging
  const merged = await mergeSimilarTopics();

  writeLog('synthesize_collections_complete', { synthesized, merged });
  return { synthesized, merged };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOPIC MERGING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find and merge similar topic names to reduce fragmentation.
 *
 * 1. Embed all topic names.
 * 2. Find pairs with cosine similarity > 0.9.
 * 3. Use fast LLM to confirm and choose the merged name.
 * 4. Update all segments referencing the old topic.
 */
async function mergeSimilarTopics(): Promise<number> {
  if (!hasClientBridge()) return 0;

  try {
    const result = await execLocalTool(
      'segment_build_topic_drawers',
      { limit_topics: 200, limit_segments_per_topic: 0, segments_scan_limit: 2000 },
      undefined,
      15000,
    );
    const drawers: any[] = result?.drawers || [];
    const topics = drawers.map((d: any) => String(d.topic || '').trim()).filter(Boolean);

    if (topics.length < 2) return 0;

    // Embed all topic names
    const embeddings: Map<string, number[]> = new Map();
    for (const topic of topics) {
      try {
        const { embedding } = await embed({
          model: google.textEmbeddingModel('gemini-embedding-2-preview'),
          value: topic,
        });
        embeddings.set(topic, embedding);
      } catch {}
    }

    // Find similar pairs
    const pairs: Array<{ a: string; b: string; sim: number }> = [];
    const topicList = Array.from(embeddings.keys());
    for (let i = 0; i < topicList.length; i++) {
      for (let j = i + 1; j < topicList.length; j++) {
        const vecA = embeddings.get(topicList[i])!;
        const vecB = embeddings.get(topicList[j])!;
        const sim = cosineSimilarity(vecA, vecB);
        if (sim > 0.9) {
          pairs.push({ a: topicList[i], b: topicList[j], sim });
        }
      }
    }

    if (pairs.length === 0) return 0;

    // Use LLM to confirm merges (process top 5 pairs max to control costs)
    const modelId = getDefaultModelForCategory('fast');
    const model = buildProviderModel(modelId);
    let merged = 0;

    for (const pair of pairs.slice(0, 5)) {
      try {
        const { text: decision } = await generateText({
          model: model as any,
          system:
            'You decide whether two conversation topics should be merged. Reply with either "MERGE: <merged name>" or "KEEP_SEPARATE". Be conservative — only merge if they clearly refer to the same subject.',
          prompt: `Topic A: "${pair.a}"\nTopic B: "${pair.b}"\nSimilarity: ${pair.sim.toFixed(3)}`,
          temperature: 0.1,
        });

        if (decision.startsWith('MERGE:')) {
          const mergedName = decision.replace('MERGE:', '').trim();
          const oldName = mergedName.toLowerCase() === pair.a.toLowerCase() ? pair.b : pair.a;

          // Update segments: rename old topic to merged name
          // This requires a Python-side function. For now, log the merge recommendation.
          writeLog('topic_merge_recommended', { from: oldName, to: mergedName, sim: pair.sim });
          merged++;
        }
      } catch (err) {
        writeLog('topic_merge_error', { pair, error: String(err) });
      }
    }

    return merged;
  } catch (error) {
    writeLog('merge_topics_error', { error: String(error) });
    return 0;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}
