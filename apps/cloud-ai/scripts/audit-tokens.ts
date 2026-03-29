/**
 * Token Audit Script — breaks down exactly where input tokens come from.
 *
 * Simulates the two main request paths (WebSocket agent-runner + serverless cloud-sync)
 * and measures each component's token contribution.
 *
 * Run with:  npx tsx scripts/audit-tokens.ts
 * Env:       Needs .env loaded (for OPENROUTER_API_KEY, SUPABASE_URL, etc.)
 */
import 'dotenv/config';

// ── Helpers ──────────────────────────────────────────────────────────────────

// Try to use gpt-tokenizer for accurate counts, fall back to chars/3.5 estimate
let _encoder: ((text: string) => number[]) | null = null;
try {
  const mod = await import('gpt-tokenizer');
  _encoder = mod.encode;
  console.log('  (using gpt-tokenizer for accurate counts)\n');
} catch {
  console.log('  (gpt-tokenizer not found — using chars/3.5 estimate. Install with: pnpm add -D gpt-tokenizer)\n');
}

function countTokens(text: string): number {
  if (!text) return 0;
  if (_encoder) return _encoder(text).length;
  // Rough estimate: ~3.5 chars per token for English/code mix
  return Math.ceil(text.length / 3.5);
}

let _zodToJsonSchema: ((schema: any) => any) | null = null;
try {
  const mod = await import('../src/tools/zod-utils');
  _zodToJsonSchema = mod.zodToJsonSchema;
} catch {}

function countToolSchemaTokens(tool: any): number {
  // Mastra/AI SDK tools have .description + inputSchema (Zod)
  // We serialize similarly to how the AI SDK does for the API call
  const parts: string[] = [];
  const name = tool?.id || tool?.name || 'unknown';
  parts.push(name);
  if (tool?.description) parts.push(String(tool.description));
  // Zod schemas get converted to JSON Schema by the SDK
  try {
    if (tool?.inputSchema && _zodToJsonSchema) {
      parts.push(JSON.stringify(_zodToJsonSchema(tool.inputSchema)));
    } else if (tool?.parameters) {
      parts.push(JSON.stringify(tool.parameters));
    }
  } catch {
    // fallback: just stringify the whole thing
    try { parts.push(JSON.stringify(tool)); } catch {}
  }
  return countTokens(parts.join('\n'));
}

interface AuditEntry {
  component: string;
  tokens: number;
  detail?: string;
}

function printReport(entries: AuditEntry[], label: string) {
  const total = entries.reduce((s, e) => s + e.tokens, 0);
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${label}`);
  console.log(`${'═'.repeat(70)}`);
  console.log(`${'Component'.padEnd(45)} ${'Tokens'.padStart(8)}  ${'%'.padStart(5)}`);
  console.log(`${'─'.repeat(45)} ${'─'.repeat(8)}  ${'─'.repeat(5)}`);
  for (const e of entries.sort((a, b) => b.tokens - a.tokens)) {
    const pct = total > 0 ? ((e.tokens / total) * 100).toFixed(1) : '0.0';
    console.log(`${e.component.padEnd(45)} ${String(e.tokens).padStart(8)}  ${pct.padStart(5)}%`);
    if (e.detail) {
      // Wrap detail lines
      for (const line of e.detail.split('\n')) {
        console.log(`  ${line}`);
      }
    }
  }
  console.log(`${'─'.repeat(45)} ${'─'.repeat(8)}  ${'─'.repeat(5)}`);
  console.log(`${'TOTAL'.padEnd(45)} ${String(total).padStart(8)}  100.0%`);
  console.log();
}

// ── Path 1: WebSocket Agent Runner (desktop app) ────────────────────────────

async function auditDesktopPath() {
  const entries: AuditEntry[] = [];

  // 1. System prompt
  const { buildSystemInstructions } = await import('../src/agents/stuard/prompts');

  // Simulate with Google integration enabled (common case)
  const sysPromptNoIntegrations = buildSystemInstructions([]);
  const sysPromptWithGoogle = buildSystemInstructions(['google']);

  entries.push({
    component: 'System Prompt (base)',
    tokens: countTokens(sysPromptNoIntegrations),
    detail: `chars: ${sysPromptNoIntegrations.length}`,
  });

  // Tool catalog was removed from system prompt (was ~11k tokens).
  // Now tools are discovered via search_tools meta-tool.

  // 2. Tier-1 tool schemas (these get full JSON schema sent to API)
  const { getToolsForQuery, TIER_1_PARAMOUNT_TOOLS } = await import('../src/agents/stuard/tools');

  // Simulate a simple query with no integrations
  const tools = await getToolsForQuery('hello how are you', [], {}, undefined, []);
  const toolNames = Object.keys(tools);
  let totalToolTokens = 0;
  const toolBreakdown: string[] = [];

  for (const [name, tool] of Object.entries(tools)) {
    const tokens = countToolSchemaTokens(tool);
    totalToolTokens += tokens;
    toolBreakdown.push(`    ${name}: ${tokens} tokens`);
  }

  entries.push({
    component: `Tool Schemas (${toolNames.length} tools)`,
    tokens: totalToolTokens,
    detail: toolBreakdown.sort((a, b) => {
      const ta = parseInt(a.split(':')[1]) || 0;
      const tb = parseInt(b.split(':')[1]) || 0;
      return tb - ta;
    }).slice(0, 15).join('\n') + (toolBreakdown.length > 15 ? `\n    ... and ${toolBreakdown.length - 15} more` : ''),
  });

  // 3. With Google integration tools (common bloat scenario)
  const toolsWithGoogle = await getToolsForQuery('check my email', ['google'], {}, undefined, []);
  let googleToolTokens = 0;
  const googleToolNames: string[] = [];
  for (const [name, tool] of Object.entries(toolsWithGoogle)) {
    if (!tools[name]) {
      const t = countToolSchemaTokens(tool);
      googleToolTokens += t;
      googleToolNames.push(name);
    }
  }
  if (googleToolTokens > 0) {
    entries.push({
      component: `  └─ Additional Google tools (+${googleToolNames.length})`,
      tokens: googleToolTokens,
    });
  }

  // 4. Simulate a typical conversation history (3 turns)
  const fakeHistory = [
    { role: 'user', content: 'Hey Stuard, can you help me organize my files?' },
    { role: 'assistant', content: 'Of course! I\'d be happy to help you organize your files. Could you tell me which directory you\'d like me to look at? I can list the contents and suggest an organization structure.' },
    { role: 'user', content: 'Yeah check my Downloads folder' },
    { role: 'assistant', content: 'Let me take a look at your Downloads folder.\n\n[Tool call: list_directory]\n\nHere\'s what I found in your Downloads folder:\n- 23 PDF files\n- 15 images\n- 8 installer executables\n- 5 zip archives\n\nWould you like me to sort these into subfolders by type?' },
    { role: 'user', content: 'yes please do that' },
  ];
  const historyTokens = fakeHistory.reduce((s, m) => s + countTokens(m.content) + 4, 0);
  entries.push({
    component: 'Conversation History (3 turns, 5 msgs)',
    tokens: historyTokens,
    detail: `Simulated typical conversation`,
  });

  // 5. Context prefix (file paths)
  const contextPrefix = `[Context: The user has provided these local file/folder paths for reference]\n- [DIR] C:/Users/solar/Downloads\n\n`;
  entries.push({
    component: 'Context Prefix (1 path)',
    tokens: countTokens(contextPrefix),
  });

  // 6. User message
  const userMsg = 'yes please do that';
  entries.push({
    component: 'Current User Message',
    tokens: countTokens(userMsg),
  });

  // 7. Overhead (framing, role tokens, etc.)
  entries.push({
    component: 'API framing overhead (est.)',
    tokens: 50,
    detail: 'Role tokens, message separators, etc.',
  });

  printReport(entries, 'PATH 1: Desktop WebSocket Agent (agent-runner.ts)');
}

// ── Path 2: Serverless Cloud Sync ───────────────────────────────────────────

async function auditCloudSyncPath() {
  const entries: AuditEntry[] = [];

  // 1. Cloud sync system prompt (static part)
  const staticPrompt = `You are Stuard — a proactive, warm AI assistant operating in cloud-sync mode.
You do NOT have access to the user's local machine (no terminal, no file system, no screen capture, no GUI).
You ARE able to use cloud-based tools: web search, integrations (email, calendar, messaging), knowledge search, and more.

**Available Capabilities**:
- Web search and URL scraping
- Email (Gmail, Outlook) via connected integrations
- Calendar management via connected integrations
- GitHub, Reddit via connected integrations
- SMS and WhatsApp messaging
- Voice calls (outbound)
- Memory search across past conversations
- Knowledge graph (facts, entities, user profile)
- Workflow execution
- Tool discovery (search_tools → get_tool_schema → execute_tool)

**NOT Available** (cloud-sync mode — no local bridge):
- File system operations (read_file, write_file, list_directory)
- Terminal / command execution
- Screen capture or GUI automation
- Browser automation on user's machine
- Any tool requiring a desktop or VM bridge

**Tool Discovery**:
You have a few tools loaded natively. For anything else, use:
1. search_tools with a query or category
2. get_tool_schema with the exact tool name
3. execute_tool with the tool name and matching args
IMPORTANT: Do NOT guess tool arguments. Always call get_tool_schema first.
IMPORTANT: Do NOT attempt to use local/device tools — they will fail. Only use cloud-based tools.

**Behavior**: Be warm, concise, actionable. Complete requests end-to-end using available cloud tools.
When you can't do something because it requires local access, explain that and suggest the user switch to desktop or VM mode.

**Memory**: Conversations are stored in the cloud. You can search past conversations for context.
Information you learn about the user is stored in the knowledge graph automatically.`;

  entries.push({
    component: 'System Prompt (static)',
    tokens: countTokens(staticPrompt),
    detail: `chars: ${staticPrompt.length}`,
  });

  // 2. Knowledge context — simulate realistic data
  // This is the suspected main culprit.
  // Simulate what buildCloudKnowledgeContext returns with real-ish data.

  const simulatedIdentityFacts = Array.from({ length: 20 }, (_, i) => ({
    key: `identity_${i}`,
    text: `This is identity fact #${i} about the user. It contains information about their preferences, background, and personal details that help personalize the experience. Each fact can be quite verbose since there are no length limits on the text column. The user mentioned this during conversation ${Math.floor(Math.random() * 100)} and it was stored without truncation.`,
  }));

  const simulatedDirectives = Array.from({ length: 10 }, (_, i) => ({
    text: `Directive #${i}: When the user asks about ${['coding', 'emails', 'scheduling', 'files', 'weather', 'news', 'music', 'shopping', 'health', 'finance'][i]}, prefer to ${['use web search first', 'check their calendar', 'look at recent files', 'provide detailed explanations', 'be brief', 'offer multiple options', 'use step-by-step format', 'ask clarifying questions', 'provide sources', 'be proactive'][i]}. This was set by the user on ${new Date(2026, 0, i + 1).toLocaleDateString()} and should be followed consistently.`,
  }));

  const simulatedBioFacts = Array.from({ length: 10 }, (_, i) => ({
    text: `Bio fact #${i}: The user is a ${['software developer', 'student', 'entrepreneur', 'designer', 'data scientist', 'product manager', 'researcher', 'freelancer', 'teacher', 'engineer'][i]} who ${['works on AI projects', 'is learning TypeScript', 'runs a startup', 'designs UIs', 'analyzes data', 'manages products', 'publishes papers', 'builds websites', 'teaches programming', 'develops embedded systems'][i]}. They mentioned this in a previous conversation and it was recorded for personalization purposes.`,
  }));

  const simulatedMemoryResults = Array.from({ length: 8 }, (_, i) => ({
    text: `Memory match #${i}: In a previous conversation (${new Date(2026, 2, 20 - i).toLocaleDateString()}), the user discussed ${['setting up a new project with React and TypeScript', 'debugging a WebSocket connection issue', 'organizing their file system', 'writing a Python script for data analysis', 'configuring their email integrations', 'planning a workflow automation', 'reviewing code changes', 'deploying to production'][i]}. The conversation included detailed technical discussion about implementation approaches, error messages encountered, and the resolution that was eventually found. This context may be relevant to the current query.`,
  }));

  const simulatedRecentMsgs = [
    { role: 'user', content: 'Can you check if my deployment went through?' },
    { role: 'assistant', content: 'Let me check the status of your deployment. Based on the logs, it completed successfully about 30 minutes ago. All health checks are passing.' },
    { role: 'user', content: 'Great, can you also send that summary email we discussed?' },
    { role: 'assistant', content: 'I\'ll draft and send the summary email now. Let me pull up the key points from our earlier conversation...' },
    { role: 'user', content: 'Thanks!' },
  ];

  // Build the knowledge context string exactly like buildCloudKnowledgeContext does
  const sections: string[] = [];

  const identityLines = ['[USER IDENTITY]'];
  for (const f of simulatedIdentityFacts) {
    identityLines.push(`${f.key}: ${f.text}`);
  }
  sections.push(identityLines.join('\n'));

  const directiveLines = ['[SYSTEM INSTRUCTIONS]'];
  for (const f of simulatedDirectives) {
    directiveLines.push(`- ${f.text}`);
  }
  sections.push(directiveLines.join('\n'));

  const bioLines = ['[ABOUT USER]'];
  for (const f of simulatedBioFacts) {
    bioLines.push(`- ${f.text}`);
  }
  sections.push(bioLines.join('\n'));

  const memoryLines = ['[RELEVANT MEMORIES]'];
  for (const r of simulatedMemoryResults) {
    memoryLines.push(`- ${r.text}`);
  }
  sections.push(memoryLines.join('\n'));

  const recentLines = ['[RECENT CONVERSATION CONTEXT]'];
  for (const m of simulatedRecentMsgs) {
    const role = m.role === 'assistant' ? 'You' : 'User';
    recentLines.push(`${role}: ${String(m.content).slice(0, 200)}`);
  }
  sections.push(recentLines.join('\n'));

  const fullKnowledgeContext = sections.join('\n\n');

  entries.push({
    component: 'Knowledge Context (TOTAL)',
    tokens: countTokens(fullKnowledgeContext),
    detail: `chars: ${fullKnowledgeContext.length}`,
  });

  // Break down knowledge context sub-components
  entries.push({
    component: '  ├─ Identity Facts (20)',
    tokens: countTokens(identityLines.join('\n')),
  });
  entries.push({
    component: '  ├─ Directive Facts (10)',
    tokens: countTokens(directiveLines.join('\n')),
  });
  entries.push({
    component: '  ├─ Bio Facts (10)',
    tokens: countTokens(bioLines.join('\n')),
  });
  entries.push({
    component: '  ├─ Semantic Memory Results (8)',
    tokens: countTokens(memoryLines.join('\n')),
  });
  entries.push({
    component: '  └─ Recent Conversation Msgs (5)',
    tokens: countTokens(recentLines.join('\n')),
  });

  // 3. Cloud-sync tools (subset)
  const cloudToolNames = [
    'web_search', 'scrape_url', 'search_tools', 'get_tool_schema',
    'execute_tool', 'search_past_conversations', 'wait',
    'run_sequential', 'run_parallel',
    'telnyx_send_sms', 'telnyx_voice_call', 'whatsapp_send_message',
    'deploy_headless_agent',
  ];
  entries.push({
    component: `Cloud-Sync Tool Schemas (${cloudToolNames.length} tools)`,
    tokens: 800, // estimate — these are smaller than desktop tools
    detail: `Estimated; tools: ${cloudToolNames.join(', ')}`,
  });

  // 4. Conversation history (loaded from DB, up to 10 messages)
  const simulatedHistory = Array.from({ length: 9 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `This is message ${i + 1} in the conversation. It contains a ${i % 2 === 0 ? 'user request' : 'assistant response'} with moderate detail about the topic being discussed.`,
  }));
  const historyTokens = simulatedHistory.reduce((s, m) => s + countTokens(m.content) + 4, 0);
  entries.push({
    component: 'Conversation History (9 msgs from DB)',
    tokens: historyTokens,
  });

  // 5. User message
  entries.push({
    component: 'Current User Message',
    tokens: countTokens('Can you send a follow up email?'),
  });

  printReport(entries, 'PATH 2: Serverless Cloud Sync (serverless-agent.ts)');
}

// ── Path 3: Live audit with real Supabase data ──────────────────────────────

async function auditLiveKnowledgeContext(userId?: string) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('\n⚠ Skipping live audit — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    return;
  }

  const { getSupabaseService, initSupabase } = await import('../src/supabase');
  initSupabase();
  const supabase = getSupabaseService();
  if (!supabase) {
    console.log('\n⚠ Supabase client not available');
    return;
  }

  // Find a userId to audit
  let targetUser = userId;
  if (!targetUser) {
    const { data } = await supabase
      .from('knowledge_facts')
      .select('owner')
      .eq('validity', true)
      .limit(1);
    targetUser = data?.[0]?.owner;
  }

  if (!targetUser) {
    console.log('\n⚠ No users with knowledge facts found');
    return;
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  LIVE AUDIT: Real knowledge data for user ${targetUser.slice(0, 8)}...`);
  console.log(`${'═'.repeat(70)}`);

  const entries: AuditEntry[] = [];

  // Identity facts
  const { data: identityFacts } = await supabase
    .from('knowledge_facts')
    .select('category, attribute_key, text')
    .eq('owner', targetUser)
    .eq('category', 'identity')
    .eq('validity', true)
    .limit(20);

  if (identityFacts && identityFacts.length > 0) {
    const lines = ['[USER IDENTITY]'];
    let maxLen = 0;
    let totalChars = 0;
    for (const f of identityFacts) {
      const line = `${f.attribute_key || 'info'}: ${f.text}`;
      lines.push(line);
      maxLen = Math.max(maxLen, f.text.length);
      totalChars += f.text.length;
    }
    const block = lines.join('\n');
    entries.push({
      component: `Identity Facts (${identityFacts.length})`,
      tokens: countTokens(block),
      detail: `total chars: ${totalChars}, avg: ${Math.round(totalChars / identityFacts.length)}, max: ${maxLen}`,
    });
  }

  // Directive facts
  const { data: directiveFacts } = await supabase
    .from('knowledge_facts')
    .select('text')
    .eq('owner', targetUser)
    .eq('category', 'directive')
    .eq('validity', true)
    .limit(10);

  if (directiveFacts && directiveFacts.length > 0) {
    const lines = ['[SYSTEM INSTRUCTIONS]'];
    let totalChars = 0;
    for (const f of directiveFacts) {
      lines.push(`- ${f.text}`);
      totalChars += f.text.length;
    }
    entries.push({
      component: `Directive Facts (${directiveFacts.length})`,
      tokens: countTokens(lines.join('\n')),
      detail: `total chars: ${totalChars}, avg: ${Math.round(totalChars / directiveFacts.length)}`,
    });
  }

  // Bio facts
  const { data: bioFacts } = await supabase
    .from('knowledge_facts')
    .select('text')
    .eq('owner', targetUser)
    .eq('category', 'bio')
    .eq('validity', true)
    .limit(10);

  if (bioFacts && bioFacts.length > 0) {
    const lines = ['[ABOUT USER]'];
    let totalChars = 0;
    for (const f of bioFacts) {
      lines.push(`- ${f.text}`);
      totalChars += f.text.length;
    }
    entries.push({
      component: `Bio Facts (${bioFacts.length})`,
      tokens: countTokens(lines.join('\n')),
      detail: `total chars: ${totalChars}, avg: ${Math.round(totalChars / bioFacts.length)}`,
    });
  }

  // Count ALL knowledge facts for this user (not just what's fetched)
  const { count: totalFactCount } = await supabase
    .from('knowledge_facts')
    .select('*', { count: 'exact', head: true })
    .eq('owner', targetUser)
    .eq('validity', true);

  // Recent messages (to check how the recent conversation context would look)
  const { data: recentMsgs } = await supabase
    .from('messages')
    .select('role, content')
    .eq('user_id', targetUser)
    .order('created_at', { ascending: false })
    .limit(5);

  if (recentMsgs && recentMsgs.length > 0) {
    const lines = ['[RECENT CONVERSATION CONTEXT]'];
    for (const m of [...recentMsgs].reverse()) {
      const role = m.role === 'assistant' ? 'You' : 'User';
      lines.push(`${role}: ${String(m.content || '').slice(0, 200)}`);
    }
    entries.push({
      component: `Recent Msgs (${recentMsgs.length})`,
      tokens: countTokens(lines.join('\n')),
    });
  }

  const knowledgeTotal = entries.reduce((s, e) => s + e.tokens, 0);

  console.log(`\nTotal valid facts for user: ${totalFactCount || '?'}`);
  console.log(`Knowledge context tokens: ${knowledgeTotal}`);
  console.log(`(Semantic search results not included — would add more)\n`);

  printReport(entries, `LIVE: Knowledge Context Breakdown (user ${targetUser.slice(0, 8)}...)`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              STUARD AI — TOKEN USAGE AUDIT                          ║');
  console.log('║  Breaks down input tokens by component for each request path        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  try {
    await auditDesktopPath();
  } catch (e: any) {
    console.error('Desktop path audit failed:', e.message);
  }

  try {
    await auditCloudSyncPath();
  } catch (e: any) {
    console.error('Cloud sync path audit failed:', e.message);
  }

  // Live audit with real data
  const userId = process.argv[2]; // optional: pass userId as arg
  try {
    await auditLiveKnowledgeContext(userId);
  } catch (e: any) {
    console.error('Live audit failed:', e.message);
  }

  // Summary recommendations
  console.log(`\n${'═'.repeat(70)}`);
  console.log('  QUICK WINS (in order of impact)');
  console.log(`${'═'.repeat(70)}`);
  console.log(`
  1. CAP KNOWLEDGE FACTS — each fact text is unlimited today.
     Add: .slice(0, 300) per fact, or a total budget of ~4000 tokens.
     Location: serverless-agent.ts:buildCloudKnowledgeContext()

  2. REDUCE LIMITS — 20 identity + 10 directive + 10 bio + 8 memory = 48 facts
     Try: 5 identity + 5 directive + 3 bio + 3 memory = 16 facts
     Saves ~60% of knowledge context tokens.

  3. SKIP REDUNDANT RECENT MSGS — the conversation history is already loaded
     separately (line 301). The "recent conversation context" in knowledge
     is a duplicate. Remove it entirely.
     Location: serverless-agent.ts:216-233

  4. CACHE KNOWLEDGE PER CONVERSATION — don't rebuild identity/directives
     every turn. These rarely change mid-conversation. Cache on first turn.

  5. ADD TOKEN BUDGET TO KNOWLEDGE — after building all sections, truncate
     the combined string to a max token budget (e.g., 3000 tokens).
`);
}

main().catch(console.error);
