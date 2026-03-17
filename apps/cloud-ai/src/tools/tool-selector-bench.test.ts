/**
 * Tool Selector Architecture Benchmark (Integration Test)
 *
 * Compares 3 approaches for selecting the right tools from 480+ in the DB:
 *   1. Keyword baseline (string matching, no API)
 *   2. Real pgvector embeddings (Supabase search_tools RPC + Gemini)
 *   3. LLM-based selection (Llama Scout via OpenRouter)
 *
 * Run:  npx vitest run src/tools/tool-selector-bench.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { embed, generateText } from 'ai';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const TOP_K = 7;                  // max tools returned per approach
const EMBEDDING_THRESHOLD = 0.25; // minimum cosine similarity for embeddings
const KEYWORD_MIN_SCORE = 2;      // minimum keyword score to include

// ═══════════════════════════════════════════════════════════════════════════
// TEST CASES — natural language, no keyword bias
// All expected tool names verified against the actual registry + DB
// ═══════════════════════════════════════════════════════════════════════════

interface TestCase {
  query: string;
  expectedTools: string[];
  category: string;
}

const TEST_CASES: TestCase[] = [
  // ─── Google / Gmail ─────────────────────────────────────────────────
  { query: 'Can you shoot john@example.com a quick note about tomorrow\'s sync?', expectedTools: ['gmail_send_message'], category: 'Google' },
  { query: 'Anything new in my inbox today?', expectedTools: ['gmail_list_messages'], category: 'Google' },
  { query: 'I need to respond to Sarah\'s last message', expectedTools: ['gmail_send_message', 'gmail_list_messages'], category: 'Google' },
  { query: 'Grab the files attached to that last email', expectedTools: ['gmail_retrieve_messages_with_attachments'], category: 'Google' },
  { query: 'Block off Friday at 3 for a team standup', expectedTools: ['calendar_create_event', 'calendar_crud'], category: 'Google' },
  { query: 'Nevermind about that 2pm thing tomorrow, cancel it', expectedTools: ['calendar_delete_event', 'calendar_crud'], category: 'Google' },
  { query: 'I need a fresh spreadsheet for tracking expenses', expectedTools: ['sheets_create_spreadsheet'], category: 'Google' },
  { query: 'Start a new doc called Project Plan', expectedTools: ['docs_create_document'], category: 'Google' },
  { query: 'Put this report in my Drive', expectedTools: ['drive_upload_file'], category: 'Google' },
  { query: 'What does my week look like?', expectedTools: ['calendar_crud'], category: 'Google' },

  // ─── Vision / Screen ────────────────────────────────────────────────
  { query: 'What\'s currently showing on my monitor?', expectedTools: ['analyze_current_screen', 'take_screenshot'], category: 'Vision' },
  { query: 'There\'s an error popup but I can\'t read it, help me out', expectedTools: ['analyze_current_screen', 'get_screen_text'], category: 'Vision' },
  { query: 'Tell me what\'s in this picture', expectedTools: ['analyze_image'], category: 'Vision' },
  { query: 'Grab a snapshot of what I\'m looking at right now', expectedTools: ['take_screenshot', 'capture_screen'], category: 'Vision' },

  // ─── Web / Search ───────────────────────────────────────────────────
  { query: 'What\'s the latest on the OpenAI situation?', expectedTools: ['web_search'], category: 'Search' },
  { query: 'Can you pull the content from this page for me?', expectedTools: ['scrape_url'], category: 'Search' },
  { query: 'I heard there was a big earthquake, find out more', expectedTools: ['web_search'], category: 'Search' },

  // ─── FileSystem ─────────────────────────────────────────────────────
  { query: 'Make me a hello world python script', expectedTools: ['write_file'], category: 'FileSystem' },
  { query: 'Show me what\'s in the config file', expectedTools: ['read_file', 'file_read'], category: 'FileSystem' },
  { query: 'Where in my codebase do we reference the database connection?', expectedTools: ['grep', 'file_search'], category: 'FileSystem' },
  { query: 'This old config needs a new name, change it to settings.json', expectedTools: ['move_file'], category: 'FileSystem' },
  { query: 'Get rid of that temp directory, I don\'t need it anymore', expectedTools: ['delete_file'], category: 'FileSystem' },
  { query: 'What\'s inside the src folder?', expectedTools: ['list_directory'], category: 'FileSystem' },

  // ─── GitHub ─────────────────────────────────────────────────────────
  { query: 'Show me all my repos', expectedTools: ['github_list_repos'], category: 'GitHub' },
  { query: 'There\'s a login bug we need to track, file it', expectedTools: ['github_create_issue'], category: 'GitHub' },
  { query: 'Are there any open PRs I should review?', expectedTools: ['github_list_pulls'], category: 'GitHub' },
  { query: 'What changed in the last few commits on main?', expectedTools: ['github_list_commits'], category: 'GitHub' },

  // ─── Discord ────────────────────────────────────────────────────────
  { query: 'Did anyone message me on Discord?', expectedTools: ['discord_read_messages', 'discord_list_dms'], category: 'Discord' },
  { query: 'Ping Alex on Discord and say hi', expectedTools: ['discord_send_dm'], category: 'Discord' },
  { query: 'What servers am I part of on Discord?', expectedTools: ['discord_list_guilds'], category: 'Discord' },

  // ─── System / Terminal ──────────────────────────────────────────────
  { query: 'I need to install some packages', expectedTools: ['run_command', 'run_system_command'], category: 'System' },
  { query: 'Spin up a new terminal for me', expectedTools: ['terminal_create'], category: 'System' },
  { query: 'Something is hogging port 3000, kill it', expectedTools: ['run_command', 'run_system_command'], category: 'System' },
  { query: 'Fire up the calculator', expectedTools: ['launch_application_or_uri'], category: 'System' },

  // ─── Memory / Context ──────────────────────────────────────────────
  { query: 'What were we working on last time?', expectedTools: ['search_past_conversations', 'get_conversation_context'], category: 'Memory' },
  { query: 'Remember that I like dark mode in all my editors', expectedTools: ['knowledge_remember_about_user'], category: 'Memory' },

  // ─── Media / FFmpeg ────────────────────────────────────────────────
  { query: 'Turn this video into an mp4', expectedTools: ['ffmpeg_convert_media'], category: 'FFmpeg' },
  { query: 'Rip the audio track out of this clip', expectedTools: ['ffmpeg_extract_audio'], category: 'FFmpeg' },
  { query: 'Give me a summary of that YouTube link', expectedTools: ['analyze_media'], category: 'Media' },

  // ─── Reddit ─────────────────────────────────────────────────────────
  { query: 'Share my project on r/webdev', expectedTools: ['reddit_create_post'], category: 'Reddit' },
  { query: 'What are people saying about TypeScript on Reddit?', expectedTools: ['reddit_search'], category: 'Reddit' },

  // ─── GUI / Computer Use ────────────────────────────────────────────
  { query: 'Hit the submit button for me', expectedTools: ['computer_use', 'find_and_click_text', 'click_at_coordinates'], category: 'GUI' },
  { query: 'Log in to Instagram for me', expectedTools: ['computer_use', 'computer_use_agent'], category: 'GUI' },
  { query: 'Type in my credentials on this login page', expectedTools: ['type_text', 'computer_use'], category: 'GUI' },
  { query: 'Go down a bit on this page', expectedTools: ['scroll', 'computer_use'], category: 'GUI' },
  { query: 'Fill out this form with my info', expectedTools: ['computer_use', 'browser_use_fill_form'], category: 'GUI' },

  // ─── Messaging ─────────────────────────────────────────────────────
  { query: 'Text this number: +1234567890', expectedTools: ['telnyx_send_sms', 'whatsapp_send_message'], category: 'Messaging' },
  { query: 'Message mom on WhatsApp', expectedTools: ['whatsapp_send_message'], category: 'Messaging' },

  // ─── AI / Generation ──────────────────────────────────────────────
  { query: 'Create a picture of a sunset over mountains', expectedTools: ['generate_image'], category: 'AI' },
  { query: 'Make me a logo for my coffee shop', expectedTools: ['generate_image'], category: 'AI' },

  // ─── Headless Agents ──────────────────────────────────────────────
  { query: 'Set up something to watch my inbox in the background', expectedTools: ['deploy_headless_agent'], category: 'Headless' },
  { query: 'How are my background tasks doing?', expectedTools: ['get_headless_agent_status', 'list_headless_agent_tasks'], category: 'Headless' },

  // ─── Utils / Misc ─────────────────────────────────────────────────
  { query: 'What\'s today\'s date?', expectedTools: ['get_datetime'], category: 'Utils' },
  { query: 'Remind me to call the dentist at 4', expectedTools: ['task_reminders'], category: 'Utils' },

  // ─── Workflows / Automation ───────────────────────────────────────
  { query: 'Kick off my daily report thing', expectedTools: ['run_automation', 'invoke_workflow'], category: 'Workflow' },
  { query: 'What automations do I have set up?', expectedTools: ['search_local_workflows'], category: 'Workflow' },

  // ─── Window Management ───────────────────────────────────────────
  { query: 'Bring Chrome to the front', expectedTools: ['smart_bring_window_to_foreground', 'bring_window_to_foreground'], category: 'Window' },
  { query: 'What apps do I have open right now?', expectedTools: ['list_open_windows'], category: 'Window' },

  // ─── Outlook ──────────────────────────────────────────────────────
  { query: 'Check my work email in Outlook', expectedTools: ['outlook_list_messages'], category: 'Outlook' },
  { query: 'Draft an Outlook email to the whole team', expectedTools: ['outlook_send_mail'], category: 'Outlook' },

  // ─── Multi-step / Ambiguous ───────────────────────────────────────
  { query: 'Look up cheap flights to Tokyo and email me what you find', expectedTools: ['web_search', 'gmail_send_message'], category: 'Multi' },
  { query: 'Take a screenshot and throw it in my Drive', expectedTools: ['take_screenshot', 'drive_upload_file'], category: 'Multi' },
  { query: 'Summarize my recent emails and save the summary to a file', expectedTools: ['gmail_list_messages', 'write_file'], category: 'Multi' },
  { query: 'Find that bug report on GitHub and leave a comment', expectedTools: ['github_list_issues', 'github_create_issue_comment'], category: 'Multi' },
];

// ═══════════════════════════════════════════════════════════════════════════
// SHARED STATE
// ═══════════════════════════════════════════════════════════════════════════

let supabase: SupabaseClient;
let googleEmbedder: any;
let dbTools: { name: string; description: string; category: string; semantic_hints: string[]; schema: any }[];

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function computeAccuracy(selected: string[], expected: string[]) {
  const selectedSet = new Set(selected);
  const hits = expected.filter(t => selectedSet.has(t)).length;
  const recall = expected.length > 0 ? hits / expected.length : 0;
  const precision = selected.length > 0 ? hits / selected.length : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, hits, total: expected.length };
}

function bar(value: number, max: number, width: number = 20): string {
  const filled = Math.round((value / Math.max(max, 0.01)) * width);
  return '█'.repeat(Math.min(filled, width)) + '░'.repeat(Math.max(width - filled, 0));
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`.padStart(4);
}

function statusIcon(recall: number): string {
  if (recall >= 1.0) return 'PASS';
  if (recall > 0) return 'PART';
  return 'MISS';
}

// ═══════════════════════════════════════════════════════════════════════════
// APPROACH 1: KEYWORD BASELINE
// ═══════════════════════════════════════════════════════════════════════════

function keywordSelect(query: string, catalog: typeof dbTools, topK: number = TOP_K): string[] {
  const q = query.toLowerCase();
  const scores = catalog.map(tool => {
    let score = 0;
    for (const word of tool.name.split('_')) {
      if (word.length > 2 && q.includes(word)) score += 2;
    }
    for (const word of (tool.description || '').toLowerCase().split(/\s+/)) {
      if (word.length > 3 && q.includes(word)) score += 1;
    }
    for (const hint of (tool.semantic_hints || [])) {
      if (q.includes(hint.toLowerCase())) score += 3;
    }
    return { name: tool.name, score };
  });
  return scores
    .filter(s => s.score >= KEYWORD_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => s.name);
}

// ═══════════════════════════════════════════════════════════════════════════
// APPROACH 2: REAL SUPABASE PGVECTOR EMBEDDINGS
// ═══════════════════════════════════════════════════════════════════════════

async function embeddingSelectReal(
  query: string,
  topK: number = TOP_K,
  threshold: number = EMBEDDING_THRESHOLD,
): Promise<{ tools: string[]; latencyMs: number; scores: { name: string; score: number }[] }> {
  const start = performance.now();
  const { embedding } = await embed({ model: googleEmbedder, value: query });
  const { data, error } = await supabase.rpc('search_tools', {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: topK,
    filter_category: null,
    filter_kind: null,
    enabled_only: true,
  });
  const latencyMs = performance.now() - start;
  if (error) return { tools: [], latencyMs, scores: [] };
  const scores = (data || []).map((row: any) => ({ name: row.name as string, score: row.similarity as number }));
  return { tools: scores.map((s: { name: string; score: number }) => s.name), latencyMs, scores };
}

// ═══════════════════════════════════════════════════════════════════════════
// APPROACH 3: LLM SELECTION (LLAMA SCOUT)
// ═══════════════════════════════════════════════════════════════════════════

async function llmSelect(
  query: string,
  catalog: typeof dbTools,
  topK: number = TOP_K,
): Promise<{ tools: string[]; inputTokens: number; outputTokens: number; latencyMs: number }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');
  const openrouter = createOpenRouter({ apiKey });

  const toolNames = catalog.map(t => t.name).join(', ');
  const prompt = `You are a tool selection system for an AI agent. The agent has access to the following tools:

${toolNames}

Given the user's query below, return the tools needed for the agent to answer it. Return up to ${topK} tool names as a JSON array. Return ONLY the JSON array, nothing else.

User query: "${query}"`;

  const inputTokenEstimate = estimateTokens(prompt);
  const start = performance.now();
  const result = await generateText({
    model: openrouter('meta-llama/llama-4-scout-17b-16e-instruct'),
    prompt,
    maxOutputTokens: 500,
    temperature: 0,
  });
  const latencyMs = performance.now() - start;

  let tools: string[] = [];
  try {
    const jsonMatch = result.text.trim().match(/\[[\s\S]*?\]/);
    if (jsonMatch) tools = JSON.parse(jsonMatch[0]);
  } catch { /* ignore parse errors */ }

  const validNames = new Set(catalog.map(t => t.name));
  tools = tools.filter(t => validNames.has(t)).slice(0, topK);

  return { tools, inputTokens: inputTokenEstimate, outputTokens: estimateTokens(result.text), latencyMs };
}

// ═══════════════════════════════════════════════════════════════════════════
// BENCHMARK
// ═══════════════════════════════════════════════════════════════════════════

interface BenchResult {
  approach: string;
  query: string;
  category: string;
  selectedTools: string[];
  expectedTools: string[];
  precision: number;
  recall: number;
  f1: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  topScores?: { name: string; score: number }[];
}

describe('Tool Selector Architecture Benchmark', () => {
  const results: BenchResult[] = [];

  beforeAll(async () => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY required');
    supabase = createClient(url, key, { auth: { persistSession: false } });

    const { data, error } = await supabase
      .from('tool_embeddings')
      .select('name, description, category, semantic_hints, schema')
      .eq('enabled', true);
    if (error) throw new Error(`Failed to load tools: ${error.message}`);
    dbTools = (data || []) as typeof dbTools;

    const googleApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!googleApiKey) throw new Error('GOOGLE_API_KEY required');
    const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
    googleEmbedder = google.textEmbeddingModel('gemini-embedding-2-preview');
  }, 30_000);

  // ─── Diagnostic ──────────────────────────────────────────────────────

  it('diagnostic: show tool embedding data quality', async () => {
    const withHints = dbTools.filter(t => t.semantic_hints && t.semantic_hints.length > 0);
    const withDesc = dbTools.filter(t => t.description && t.description.length > 20);
    const categories = [...new Set(dbTools.map(t => t.category))];
    const catCounts = categories.map(c => ({ cat: c, count: dbTools.filter(t => t.category === c).length }))
      .sort((a, b) => b.count - a.count);

    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║  TOOL EMBEDDING DATABASE DIAGNOSTICS                                ║');
    console.log('╠══════════════════════════════════════════════════════════════════════╣');
    console.log(`║  Total tools in DB:          ${String(dbTools.length).padStart(4)}`);
    console.log(`║  Tools with semantic hints:  ${String(withHints.length).padStart(4)} (${(withHints.length / dbTools.length * 100).toFixed(0)}%)`);
    console.log(`║  Tools with descriptions:    ${String(withDesc.length).padStart(4)} (${(withDesc.length / dbTools.length * 100).toFixed(0)}%)`);
    console.log(`║  Config: TOP_K=${TOP_K}  THRESHOLD=${EMBEDDING_THRESHOLD}  KEYWORD_MIN=${KEYWORD_MIN_SCORE}`);
    console.log('║');

    const allExpected = [...new Set(TEST_CASES.flatMap(tc => tc.expectedTools))];
    const dbNameSet = new Set(dbTools.map(t => t.name));
    const missing = allExpected.filter(n => !dbNameSet.has(n));
    if (missing.length > 0) {
      console.log(`║  WARNING: ${missing.length} expected tools NOT IN DB:`);
      for (const m of missing) console.log(`║    - ${m}`);
    } else {
      console.log(`║  All ${allExpected.length} expected tools found in DB`);
    }
    console.log('╚══════════════════════════════════════════════════════════════════════╝');

    expect(dbTools.length).toBeGreaterThan(0);
  });

  // ─── Run all 3 approaches ────────────────────────────────────────────

  for (const tc of TEST_CASES) {
    const label = tc.query.length > 55 ? tc.query.slice(0, 55) + '...' : tc.query;

    it(`[${tc.category}] ${label}`, async () => {
      // 1. Keyword
      const kwStart = performance.now();
      const kwTools = keywordSelect(tc.query, dbTools);
      const kwMs = performance.now() - kwStart;
      const kwAcc = computeAccuracy(kwTools, tc.expectedTools);

      // 2. Embedding
      const { tools: embTools, latencyMs: embMs, scores: embScores } =
        await embeddingSelectReal(tc.query);
      const embAcc = computeAccuracy(embTools, tc.expectedTools);

      // 3. LLM Scout
      let llmTools: string[] = [];
      let llmMs = 0;
      let llmIn = 0;
      let llmOut = 0;
      let llmAcc = { precision: 0, recall: 0, f1: 0, hits: 0, total: tc.expectedTools.length };
      if (process.env.OPENROUTER_API_KEY) {
        const llmResult = await llmSelect(tc.query, dbTools);
        llmTools = llmResult.tools;
        llmMs = llmResult.latencyMs;
        llmIn = llmResult.inputTokens;
        llmOut = llmResult.outputTokens;
        llmAcc = computeAccuracy(llmTools, tc.expectedTools);
      }

      // Token cost: include the full tool data that gets loaded into agent context
      const toolDataTokens = (selectedNames: string[]) => {
        return selectedNames.reduce((sum, name) => {
          const tool = dbTools.find(t => t.name === name);
          if (!tool) return sum;
          const schemaStr = tool.schema ? JSON.stringify(tool.schema) : '';
          return sum + estimateTokens(`${tool.name}: ${tool.description || ''} ${schemaStr}`);
        }, 0);
      };

      const kwOutputTokens = toolDataTokens(kwTools);
      const embOutputTokens = toolDataTokens(embTools);
      const llmOutputTokens = llmOut + toolDataTokens(llmTools);

      results.push(
        { approach: 'keyword', query: tc.query, category: tc.category, selectedTools: kwTools, expectedTools: tc.expectedTools, ...kwAcc, latencyMs: kwMs, inputTokens: estimateTokens(tc.query), outputTokens: kwOutputTokens },
        { approach: 'embedding', query: tc.query, category: tc.category, selectedTools: embTools, expectedTools: tc.expectedTools, ...embAcc, latencyMs: embMs, inputTokens: estimateTokens(tc.query), outputTokens: embOutputTokens, topScores: embScores },
        { approach: 'llm-scout', query: tc.query, category: tc.category, selectedTools: llmTools, expectedTools: tc.expectedTools, ...llmAcc, latencyMs: llmMs, inputTokens: llmIn, outputTokens: llmOutputTokens },
      );

      // ─── Visual per-case output ───────────────────────────────────
      const expected = tc.expectedTools.join(', ');
      console.log('');
      console.log(`  ┌─ "${tc.query}"`);
      console.log(`  │  Expected: [${expected}]`);
      console.log(`  │`);
      console.log(`  │  KEYWORD   ${statusIcon(kwAcc.recall)}  recall ${bar(kwAcc.recall, 1, 10)} ${pct(kwAcc.recall)}  prec ${pct(kwAcc.precision)}  F1 ${pct(kwAcc.f1)}  ${kwMs.toFixed(0)}ms  → [${kwTools.join(', ')}]`);
      console.log(`  │  EMBEDDING ${statusIcon(embAcc.recall)}  recall ${bar(embAcc.recall, 1, 10)} ${pct(embAcc.recall)}  prec ${pct(embAcc.precision)}  F1 ${pct(embAcc.f1)}  ${embMs.toFixed(0)}ms  → [${embTools.join(', ')}]`);
      if (embScores.length > 0) {
        const scoreStr = embScores.slice(0, 5).map(s => `${s.name}(${s.score.toFixed(2)})`).join(', ');
        console.log(`  │            scores: ${scoreStr}`);
      }
      console.log(`  │  LLM-SCOUT ${statusIcon(llmAcc.recall)}  recall ${bar(llmAcc.recall, 1, 10)} ${pct(llmAcc.recall)}  prec ${pct(llmAcc.precision)}  F1 ${pct(llmAcc.f1)}  ${llmMs.toFixed(0)}ms  → [${llmTools.join(', ')}]`);
      console.log(`  └──`);

      expect(true).toBe(true);
    }, 60_000);
  }

  // ─── Final Summary ───────────────────────────────────────────────────

  it('SUMMARY: aggregate benchmark results', () => {
    if (results.length === 0) { console.log('No results'); return; }

    const approaches = ['keyword', 'embedding', 'llm-scout'];
    const totalCases = TEST_CASES.length;

    console.log('\n');
    console.log('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
    console.log('┃                        TOOL SELECTOR ARCHITECTURE BENCHMARK                                ┃');
    console.log(`┃                        ${dbTools.length} tools  |  ${totalCases} queries  |  top-${TOP_K}  |  threshold ${EMBEDDING_THRESHOLD}              ┃`);
    console.log('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫');

    for (const approach of approaches) {
      const ar = results.filter(r => r.approach === approach);
      if (ar.length === 0) continue;
      const avgRecall = ar.reduce((s, r) => s + r.recall, 0) / ar.length;
      const avgPrecision = ar.reduce((s, r) => s + r.precision, 0) / ar.length;
      const avgF1 = ar.reduce((s, r) => s + r.f1, 0) / ar.length;
      const avgLatency = ar.reduce((s, r) => s + r.latencyMs, 0) / ar.length;
      const totalIn = ar.reduce((s, r) => s + r.inputTokens, 0);
      const totalOut = ar.reduce((s, r) => s + r.outputTokens, 0);
      const avgToolsReturned = ar.reduce((s, r) => s + r.selectedTools.length, 0) / ar.length;
      const perfect = ar.filter(r => r.recall === 1.0).length;
      const partial = ar.filter(r => r.recall > 0 && r.recall < 1.0).length;
      const miss = ar.filter(r => r.recall === 0).length;

      const label = approach.toUpperCase().padEnd(12);
      console.log(`┃  ${label}                                                                               ┃`);
      console.log(`┃    Recall:    ${bar(avgRecall, 1, 25)} ${pct(avgRecall)}                                           ┃`);
      console.log(`┃    Precision: ${bar(avgPrecision, 1, 25)} ${pct(avgPrecision)}                                           ┃`);
      console.log(`┃    F1 Score:  ${bar(avgF1, 1, 25)} ${pct(avgF1)}                                           ┃`);
      console.log(`┃    Latency:   ${avgLatency.toFixed(0)}ms avg                                                           ┃`);
      console.log(`┃    Tokens:    ${totalIn} in / ${totalOut} out                                                          ┃`);
      console.log(`┃    Avg tools: ${avgToolsReturned.toFixed(1)} per query (max ${TOP_K})                                              ┃`);
      console.log(`┃    Results:   ${perfect} PASS  ${partial} PARTIAL  ${miss} MISS  (of ${ar.length})                                 ┃`);
      console.log('┃                                                                                         ┃');
    }

    // ─── Per-category breakdown ──────────────────────────────────────
    console.log('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫');
    console.log('┃  PER-CATEGORY RECALL                    keyword  embedding  llm-scout                     ┃');
    console.log('┃  ─────────────────────────────────────  ───────  ─────────  ─────────                     ┃');

    const categories = [...new Set(TEST_CASES.map(tc => tc.category))];
    for (const cat of categories) {
      const catResults = results.filter(r => r.category === cat);
      const kwN = catResults.filter(r => r.approach === 'keyword').length || 1;
      const kwAvg = catResults.filter(r => r.approach === 'keyword').reduce((s, r) => s + r.recall, 0) / kwN;
      const embAvg = catResults.filter(r => r.approach === 'embedding').reduce((s, r) => s + r.recall, 0) / kwN;
      const llmAvg = catResults.filter(r => r.approach === 'llm-scout').reduce((s, r) => s + r.recall, 0) / kwN;

      const catLabel = `${cat} (${kwN})`.padEnd(40);
      console.log(`┃  ${catLabel} ${pct(kwAvg)}     ${pct(embAvg)}      ${pct(llmAvg)}                       ┃`);
    }

    // ─── Per-case recall heatmap ─────────────────────────────────────
    console.log('┃                                                                                         ┃');
    console.log('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫');
    console.log('┃  RECALL HEATMAP                         keyword  embedding  llm-scout                     ┃');
    console.log('┃  ─────────────────────────────────────  ───────  ─────────  ─────────                     ┃');

    const queries = [...new Set(results.map(r => r.query))];
    for (const q of queries) {
      const qr = results.filter(r => r.query === q);
      const kwR = qr.find(r => r.approach === 'keyword')?.recall ?? 0;
      const embR = qr.find(r => r.approach === 'embedding')?.recall ?? 0;
      const llmR = qr.find(r => r.approach === 'llm-scout')?.recall ?? 0;

      const block = (r: number) => {
        if (r >= 1.0) return `  PASS `;
        if (r > 0) return `  ${pct(r)} `;
        return `  MISS `;
      };

      const label = q.length > 38 ? q.slice(0, 38) + '..' : q.padEnd(40);
      console.log(`┃  ${label} ${block(kwR)}    ${block(embR)}    ${block(llmR)}                   ┃`);
    }

    // ─── Winner analysis ─────────────────────────────────────────────
    console.log('┃                                                                                         ┃');
    console.log('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫');

    let kwWins = 0, embWins = 0, llmWins = 0;
    let kwF1Wins = 0, embF1Wins = 0, llmF1Wins = 0;
    for (const q of queries) {
      const qr = results.filter(r => r.query === q);
      const kwR = qr.find(r => r.approach === 'keyword')?.recall ?? 0;
      const embR = qr.find(r => r.approach === 'embedding')?.recall ?? 0;
      const llmR = qr.find(r => r.approach === 'llm-scout')?.recall ?? 0;
      const maxR = Math.max(kwR, embR, llmR);
      if (kwR === maxR) kwWins++;
      if (embR === maxR) embWins++;
      if (llmR === maxR) llmWins++;

      const kwF = qr.find(r => r.approach === 'keyword')?.f1 ?? 0;
      const embF = qr.find(r => r.approach === 'embedding')?.f1 ?? 0;
      const llmF = qr.find(r => r.approach === 'llm-scout')?.f1 ?? 0;
      const maxF = Math.max(kwF, embF, llmF);
      if (kwF === maxF) kwF1Wins++;
      if (embF === maxF) embF1Wins++;
      if (llmF === maxF) llmF1Wins++;
    }

    console.log(`┃  WINNER BY RECALL:                                                                      ┃`);
    console.log(`┃    Keyword:   ${bar(kwWins, queries.length, 20)} ${kwWins}/${queries.length}                                        ┃`);
    console.log(`┃    Embedding: ${bar(embWins, queries.length, 20)} ${embWins}/${queries.length}                                        ┃`);
    console.log(`┃    LLM Scout: ${bar(llmWins, queries.length, 20)} ${llmWins}/${queries.length}                                        ┃`);
    console.log(`┃                                                                                         ┃`);
    console.log(`┃  WINNER BY F1:                                                                          ┃`);
    console.log(`┃    Keyword:   ${bar(kwF1Wins, queries.length, 20)} ${kwF1Wins}/${queries.length}                                        ┃`);
    console.log(`┃    Embedding: ${bar(embF1Wins, queries.length, 20)} ${embF1Wins}/${queries.length}                                        ┃`);
    console.log(`┃    LLM Scout: ${bar(llmF1Wins, queries.length, 20)} ${llmF1Wins}/${queries.length}                                        ┃`);

    // Cases where ALL approaches failed
    const allFailed = queries.filter(q => {
      const qr = results.filter(r => r.query === q);
      return qr.every(r => r.recall === 0);
    });
    if (allFailed.length > 0) {
      console.log(`┃                                                                                         ┃`);
      console.log(`┃  ALL FAILED (0% recall):                                                                ┃`);
      for (const q of allFailed) {
        const expected = results.find(r => r.query === q)?.expectedTools.join(', ') ?? '';
        console.log(`┃    "${q.slice(0, 45)}" → [${expected.slice(0, 30)}]          ┃`);
      }
    }

    console.log('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');

    expect(results.length).toBeGreaterThan(0);
  });
});
