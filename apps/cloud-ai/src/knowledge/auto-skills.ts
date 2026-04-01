/**
 * Auto-Skills — AI-Driven Skill Generation from Conversation Analysis
 *
 * After every significant conversation, an LLM analyzes the full exchange to:
 *   1. Detect if the user had to guide/correct the AI through a procedure
 *   2. Separate signal from noise — what the user actually wanted vs AI mistakes
 *   3. Synthesize a clean, reusable skill from the successful path
 *   4. Store it as an auto-skill (inactive by default) for user review
 *
 * The entire detection + extraction + generation is done by the AI model,
 * not hardcoded heuristics. This lets it understand nuance, context, and intent.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { buildProviderModel } from '../utils/models';
import { getDefaultModelForCategory } from '../pricing';
import { execLocalTool, hasClientBridge } from '../tools/bridge';
import { writeLog } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface AutoSkillStep {
  type: 'prompt' | 'tool' | 'condition' | 'output';
  label: string;
  content: string;
  toolName?: string;
}

export interface AutoSkillToolUsage {
  toolName: string;
  purpose: string;
  correctArgs?: Record<string, any>;
  wrongArgs?: Record<string, any>;
}

export interface AutoSkillInjection {
  context: string;
  correction: string;
  lesson: string;
}

export interface AutoSkillDraft {
  name: string;
  description: string;
  trigger: string;
  icon: string;
  color: string;
  steps: AutoSkillStep[];
  antiPatterns: string[];
  toolUsage: AutoSkillToolUsage[];
  userInjections: AutoSkillInjection[];
  sourceConversationId?: string;
  confidence: number;
}

export interface ConversationMessage {
  role: string;
  content: any;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTENT HELPERS — Rich transcript with tool calls & user injections
// ═══════════════════════════════════════════════════════════════════════════════

export function contentToText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p?.type === 'text')
      .map((p: any) => p.text || '')
      .join(' ')
      .slice(0, 4000);
  }
  try { return JSON.stringify(content ?? '').slice(0, 2000); } catch { return ''; }
}

/**
 * Extract tool call details from a message's content array.
 * Returns structured info: tool name, args, and results.
 */
export function extractToolCalls(content: any): Array<{ toolName: string; args: any; id?: string }> {
  if (!Array.isArray(content)) return [];
  return content
    .filter((p: any) => p?.type === 'tool-call')
    .map((p: any) => ({
      toolName: p.toolName || p.tool || 'unknown',
      args: p.args || {},
      id: p.toolCallId || p.id,
    }));
}

/**
 * Extract tool results from a message's content array.
 */
export function extractToolResults(content: any): Array<{ toolName: string; result: string; id?: string }> {
  if (!Array.isArray(content)) return [];
  return content
    .filter((p: any) => p?.type === 'tool-result')
    .map((p: any) => ({
      toolName: p.toolName || 'unknown',
      result: typeof p.result === 'string' ? p.result.slice(0, 600) : JSON.stringify(p.result ?? '').slice(0, 600),
      id: p.toolCallId || p.id,
    }));
}

/**
 * Build a rich transcript that preserves:
 *   - User messages with position context (injections between tool calls)
 *   - Assistant text AND tool calls with their arguments
 *   - Tool results with tool name
 *   - The interleaved sequence showing when the user intervened
 *
 * This gives the analyzing LLM full visibility into the conversation dynamics.
 */
export function buildTranscript(messages: ConversationMessage[]): string {
  const lines: string[] = [];
  let lastRole = '';
  let pendingToolCalls: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const role = msg.role;

    if (role === 'user') {
      // If user speaks after tool calls, mark it as an injection/correction
      const isInjection = lastRole === 'tool' || lastRole === 'assistant';
      const prefix = isInjection && pendingToolCalls.length > 0
        ? '[USER INJECTION — interrupted tool flow] '
        : '';

      // Flush any pending tool context
      if (pendingToolCalls.length > 0) {
        pendingToolCalls = [];
      }

      const text = contentToText(msg.content).slice(0, 2000);
      lines.push(`${prefix}User: ${text}`);
      lastRole = 'user';

    } else if (role === 'assistant') {
      const text = contentToText(msg.content);
      const toolCalls = extractToolCalls(msg.content);

      // Build assistant entry with both text and tool calls
      const parts: string[] = [];

      if (text.trim()) {
        parts.push(text.slice(0, 1500));
      }

      if (toolCalls.length > 0) {
        for (const tc of toolCalls) {
          const argsStr = typeof tc.args === 'object'
            ? JSON.stringify(tc.args, null, 0).slice(0, 500)
            : String(tc.args).slice(0, 500);
          parts.push(`  [TOOL CALL] ${tc.toolName}(${argsStr})`);
          pendingToolCalls.push(tc.toolName);
        }
      }

      if (parts.length > 0) {
        lines.push(`Assistant: ${parts.join('\n')}`);
      }
      lastRole = 'assistant';

    } else if (role === 'tool') {
      const results = extractToolResults(msg.content);
      const text = contentToText(msg.content);

      if (results.length > 0) {
        for (const tr of results) {
          lines.push(`  [TOOL RESULT] ${tr.toolName}: ${tr.result}`);
        }
      } else if (text.trim()) {
        lines.push(`  [TOOL RESULT]: ${text.slice(0, 600)}`);
      }
      lastRole = 'tool';

    } else if (role === 'system') {
      // Include system messages — they contain context injections
      const text = contentToText(msg.content).slice(0, 500);
      if (text.trim()) {
        lines.push(`[SYSTEM]: ${text}`);
      }
      lastRole = 'system';
    }
  }

  return lines.join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED AI ANALYSIS — Detection + Extraction + Skill Generation
// ═══════════════════════════════════════════════════════════════════════════════

const SkillStepSchema = z.object({
  type: z.enum(['prompt', 'tool', 'condition', 'output']),
  label: z.string().describe('Short human-readable step name'),
  content: z.string().describe('Detailed instructions for this step — what to do, how to do it, and what to avoid'),
  toolName: z.string().optional().describe('Tool name if type is "tool"'),
});

const ToolUsageSchema = z.object({
  toolName: z.string().describe('Name of the tool that was used'),
  purpose: z.string().describe('What this tool was used for in the successful approach'),
  correct_args: z.record(z.string(), z.any()).optional().describe('The argument pattern that worked (generalized, not literal values)'),
  wrong_args: z.record(z.string(), z.any()).optional().describe('Argument patterns that failed (if the user corrected tool usage)'),
});

const UserInjectionSchema = z.object({
  context: z.string().describe('What was happening when the user intervened (e.g., "after AI called web_search with wrong query")'),
  correction: z.string().describe('What the user said or directed'),
  lesson: z.string().describe('The generalizable lesson from this injection (e.g., "always ask for search terms before searching")'),
});

const AutoSkillAnalysisSchema = z.object({
  // Phase 1: Detection
  has_teachable_pattern: z.boolean().describe(
    'Does this conversation contain a repeatable procedure that the user had to teach, correct, or guide the AI through? ' +
    'True if: user corrected the AI multiple times, interrupted tool flows, gave step-by-step guidance, or the conversation reveals a reusable workflow. ' +
    'False if: simple Q&A, one-off task, casual chat, or corrections were about factual content not procedure.'
  ),
  pattern_reasoning: z.string().describe(
    'Explain your analysis: What corrections/guidance did the user give? Which tool calls failed and why? ' +
    'Where did the user inject corrections between AI actions? What was the successful approach? ' +
    'If no teachable pattern exists, explain why.'
  ),

  // Phase 2: Golden Path Extraction (only if has_teachable_pattern)
  user_intent: z.string().optional().describe('What the user was ultimately trying to accomplish'),
  failed_approaches: z.array(z.string()).optional().describe('Brief list of what went wrong — the AI mistakes, wrong tool calls, bad arguments'),
  successful_approach: z.string().optional().describe('What finally worked — the correct tool sequence, arguments, and method the user established'),

  // Phase 2b: Tool & Injection Analysis
  tool_usage: z.array(ToolUsageSchema).optional().describe(
    'Tools used in the conversation — what worked, what failed, and the correct way to call them'
  ),
  user_injections: z.array(UserInjectionSchema).optional().describe(
    'Moments where the user intervened between AI actions to correct course. ' +
    'These are the most valuable teaching moments — each one is a lesson.'
  ),

  // Phase 3: Skill Synthesis (only if has_teachable_pattern)
  skill: z.object({
    name: z.string().describe('Short, action-oriented skill name (e.g., "Deploy to Staging", "Format CSV Report")'),
    description: z.string().describe('One-line description of what this skill does'),
    trigger: z.string().describe('When should this skill activate (e.g., "When the user asks to deploy to staging")'),
    icon: z.string().describe('Lucide icon name (e.g., "Rocket", "FileText", "Code", "Wand2", "Brain", "Zap")'),
    color: z.enum(['blue', 'green', 'red', 'purple', 'orange', 'yellow', 'pink', 'cyan', 'indigo']),
    steps: z.array(SkillStepSchema).describe(
      'Clean step-by-step procedure that captures ONLY what worked. ' +
      'For tool steps, include the correct toolName and describe the right arguments in content. ' +
      'Encode user injections as explicit instructions within the relevant steps.'
    ),
    anti_patterns: z.array(z.string()).describe(
      'Mistakes to explicitly avoid, learned from the failed attempts and wrong tool calls. ' +
      'Include: wrong tool choices, bad arguments, incorrect sequences, format mistakes.'
    ),
    confidence: z.number().min(0).max(1).describe(
      'How confident are you that this is a genuinely reusable skill (not a one-off)? ' +
      '1.0 = clearly reusable procedure, 0.5 = might be useful, below 0.5 = probably too specific.'
    ),
  }).optional().describe('The generated skill definition — only present if has_teachable_pattern is true'),
});

const ANALYSIS_SYSTEM_PROMPT = `You are an expert conversation analyst for StuardAI. Your job is to analyze completed AI conversations and determine if they contain a TEACHABLE PATTERN — a procedure or workflow that the user had to guide the AI through, often with corrections, retries, and mid-flow injections.

## TRANSCRIPT FORMAT

The transcript you receive is enriched with metadata:
- **[TOOL CALL] toolName({args})** — shows which tool the AI called and with what arguments
- **[TOOL RESULT] toolName: result** — shows the tool's output
- **[USER INJECTION — interrupted tool flow]** — marks where the user interrupted the AI mid-execution to correct course
- **[SYSTEM]** — system context injections

Pay close attention to:
1. **Tool call sequences** — which tools were called, in what order, with what args
2. **User injections between tool calls** — these are the most valuable teaching moments
3. **Repeated tool calls with different args** — indicates the user corrected the approach
4. **The final successful sequence** — this is the golden path

## YOUR TASK — THREE PHASES

### Phase 1: DETECT
Look for signals that the user was TEACHING the AI how to do something:
- User corrected the AI's approach, output, or tool usage
- User said things like "no, do it this way", "not like that", "try X instead"
- User injected corrections between tool calls ("use X not Y", "that's the wrong tool")
- User provided step-by-step guidance after AI failures
- User had to repeat or rephrase their request because the AI misunderstood
- User showed the AI the correct format, structure, or method
- User explicitly told the AI what NOT to do
- AI called the same tool multiple times with different args (trial and error)

Signals that this is NOT teachable (set has_teachable_pattern=false):
- Simple factual Q&A (even if the AI got facts wrong)
- One-off creative tasks (write me a poem, etc.)
- Casual conversation / small talk
- Debugging a specific, unique error
- User corrections about personal preferences already handled by the knowledge system

### Phase 2: EXTRACT (only if teachable)

**2a. Path Analysis** — Trace through the conversation and separate:
- **User's true intent**: What they were ultimately trying to accomplish
- **Failed approaches**: What the AI tried that didn't work — including wrong tool calls, bad arguments, incorrect sequences
- **Successful approach**: What finally worked — the correct tools, arguments, and sequence

**2b. Tool Usage Analysis** — For each tool used:
- What was it used for?
- What argument patterns worked vs. failed?
- Did the user redirect to a different tool?

**2c. User Injection Analysis** — For each time the user intervened:
- What was the AI doing when interrupted?
- What did the user correct?
- What's the generalizable lesson?

Key principle: The USER'S CORRECTIONS ARE GROUND TRUTH. When the user says "no, do X", X is correct. Everything before that correction was wrong.

### Phase 3: SYNTHESIZE (only if teachable)
Create a clean, reusable skill definition by:
1. Taking ONLY the successful path (tools, arguments, sequence)
2. Encoding user corrections/injections as explicit step instructions
3. For tool steps: specify the correct toolName and describe the right argument patterns in the content
4. Adding anti-patterns from failed tool calls and wrong approaches as guardrails
5. Making steps specific and actionable — no vague "process the data" steps
6. Generalizing where possible so the skill works for similar future requests

## STEP TYPES
- prompt: Instructions/guidance for the AI to follow (include user injection lessons here)
- tool: Execute a specific tool (include toolName, describe correct args in content)
- condition: Decision point or branching logic
- output: Define expected output format or final response structure

## COMMON TOOL NAMES
web_search, http_request, ai_inference, run_python_script, run_node_script,
run_command, read_file, write_file, take_screenshot, analyze_image, analyze_media,
analyze_current_screen, cloud_ai_vision, gmail_send_message, gmail_list_messages,
calendar_create_event, calendar_list_events, custom_ui, send_notification,
text_to_speech, db_store, db_retrieve, db_search, glob, grep, capture_media,
ffmpeg_convert_media, telnyx_send_sms, ask_confirmation, show_choices,
memory_retrieval, run_shell, execute_script, set_variable, get_variable

## QUALITY CHECKS
- Would this skill save time if the user asks for the same thing again? If not, skip it.
- Are tool steps specific enough (right toolName, described args) that the AI won't repeat the same wrong calls?
- Do user injection lessons appear as instructions in the relevant steps?
- Do the anti-patterns capture the actual failed tool calls and wrong approaches?`;

// ═══════════════════════════════════════════════════════════════════════════════
// SKILL STORAGE
// ═══════════════════════════════════════════════════════════════════════════════

async function storeAutoSkillDraft(draft: AutoSkillDraft): Promise<boolean> {
  if (!hasClientBridge()) return false;

  try {
    const result = await execLocalTool('auto_skill_store', {
      skill: {
        name: draft.name,
        description: draft.description,
        trigger: draft.trigger,
        icon: draft.icon,
        color: draft.color,
        steps: draft.steps.map((s, i) => ({
          id: `s${i + 1}`,
          ...s,
        })),
        isActive: false, // User must review & activate
        source: 'auto',
        metadata: {
          sourceConversationId: draft.sourceConversationId,
          confidence: draft.confidence,
          antiPatterns: draft.antiPatterns,
          toolUsage: draft.toolUsage,
          userInjections: draft.userInjections,
          generatedAt: new Date().toISOString(),
        },
      },
    }, undefined, 10000);

    return result?.ok || false;
  } catch (error) {
    writeLog('auto_skill_store_error', { error: String(error) });
    // Fallback: persist as a knowledge fact so it's not lost
    try {
      const skillSummary = [
        `Auto-Skill: "${draft.name}"`,
        `Description: ${draft.description}`,
        `Trigger: ${draft.trigger}`,
        `Steps: ${draft.steps.map(s => `${s.label}${s.toolName ? ` [${s.toolName}]` : ''}`).join(' → ')}`,
        draft.antiPatterns.length > 0
          ? `Avoid: ${draft.antiPatterns.join('; ')}`
          : '',
        draft.toolUsage.length > 0
          ? `Tools: ${draft.toolUsage.map(t => `${t.toolName} (${t.purpose})`).join(', ')}`
          : '',
        draft.userInjections.length > 0
          ? `Lessons: ${draft.userInjections.map(i => i.lesson).join('; ')}`
          : '',
      ].filter(Boolean).join('\n');

      await execLocalTool('knowledge_add_fact', {
        category: 'skill',
        subtype: 'auto_generated',
        text: skillSummary,
        vector: [],
      }, undefined, 10000);
    } catch { }
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

// Minimum token usage to analyze — teachable patterns can happen in short exchanges,
// so we gate on engagement (tokens used) rather than message count.
const MIN_TOTAL_TOKENS = 50_000;
// Maximum messages to feed the model
const MAX_ANALYSIS_MESSAGES = 60;

/**
 * Analyze a completed conversation for auto-skill generation.
 *
 * Called from the post-stream pipeline in server.ts.
 * Runs in background — never blocks the response.
 *
 * The entire analysis (detection → extraction → generation) is done by
 * a single LLM call. No regex heuristics — the model understands context,
 * nuance, and intent.
 */
export async function analyzeForAutoSkill(
  conversationHistory: ConversationMessage[],
  conversationId?: string,
  totalTokensUsed?: number
): Promise<AutoSkillDraft | null> {
  // Gate: minimum engagement — need enough back-and-forth to contain a teachable pattern
  if (Number.isFinite(totalTokensUsed) && (totalTokensUsed as number) < MIN_TOTAL_TOKENS) {
    return null;
  }

  // Gate: need bridge for storage
  if (!hasClientBridge()) {
    return null;
  }

  // Build transcript for analysis
  const trimmed = conversationHistory.slice(-MAX_ANALYSIS_MESSAGES);
  const transcript = buildTranscript(trimmed);

  // Skip very short transcripts (likely no real interaction)
  if (Number.isFinite(totalTokensUsed) && transcript.length < 200) {
    return null;
  }

  console.log(`[auto-skills] Analyzing conversation (${conversationHistory.length} messages) for teachable patterns...`);

  try {
    // Single LLM call does detection + extraction + generation
    const modelId = getDefaultModelForCategory('smart');
    const model = buildProviderModel(modelId);

    const { object: analysis } = await generateObject({
      model: model as any,
      schema: AutoSkillAnalysisSchema,
      system: ANALYSIS_SYSTEM_PROMPT,
      prompt: `Analyze this conversation for teachable patterns:\n\n${transcript}`,
      temperature: 0.15,
    });

    writeLog('auto_skill_analysis', {
      hasPattern: analysis.has_teachable_pattern,
      reasoning: analysis.pattern_reasoning?.slice(0, 200),
      conversationId,
    });

    // Gate: no teachable pattern detected
    if (!analysis.has_teachable_pattern || !analysis.skill) {
      console.log(`[auto-skills] No teachable pattern found: ${analysis.pattern_reasoning?.slice(0, 100)}`);
      return null;
    }

    const skill = analysis.skill;

    // Gate: low confidence
    if (skill.confidence < 0.5) {
      writeLog('auto_skill_low_confidence', {
        confidence: skill.confidence,
        name: skill.name,
        conversationId,
      });
      console.log(`[auto-skills] Skill "${skill.name}" confidence too low (${skill.confidence}), skipping`);
      return null;
    }

    // Build the draft with full analysis context
    const draft: AutoSkillDraft = {
      name: skill.name,
      description: skill.description,
      trigger: skill.trigger,
      icon: skill.icon,
      color: skill.color,
      steps: skill.steps,
      antiPatterns: skill.anti_patterns || [],
      toolUsage: (analysis.tool_usage || []).map(t => ({
        toolName: t.toolName,
        purpose: t.purpose,
        correctArgs: t.correct_args,
        wrongArgs: t.wrong_args,
      })),
      userInjections: (analysis.user_injections || []).map(inj => ({
        context: inj.context,
        correction: inj.correction,
        lesson: inj.lesson,
      })),
      sourceConversationId: conversationId,
      confidence: skill.confidence,
    };

    // Prepend anti-patterns as a guidelines step if present
    if (draft.antiPatterns.length > 0) {
      draft.steps.unshift({
        type: 'prompt',
        label: 'Guidelines & Anti-Patterns',
        content: `IMPORTANT — Learned from previous mistakes, avoid these:\n${draft.antiPatterns.map(ap => `• ${ap}`).join('\n')}\n\nFollow the steps below carefully.`,
      });
    }

    // Store the draft
    const stored = await storeAutoSkillDraft(draft);

    writeLog('auto_skill_created', {
      name: draft.name,
      stepCount: draft.steps.length,
      confidence: draft.confidence,
      antiPatterns: draft.antiPatterns.length,
      toolsAnalyzed: draft.toolUsage.length,
      userInjections: draft.userInjections.length,
      stored,
      conversationId,
      userIntent: analysis.user_intent?.slice(0, 200),
      failedApproaches: analysis.failed_approaches?.length || 0,
    });

    console.log(`[auto-skills] Created skill "${draft.name}" (${draft.steps.length} steps, confidence=${draft.confidence}, stored=${stored})`);

    return draft;
  } catch (error) {
    writeLog('auto_skill_analysis_error', { error: String(error), conversationId });
    console.error('[auto-skills] Analysis failed:', error);
    return null;
  }
}
