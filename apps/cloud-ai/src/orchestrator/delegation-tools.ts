/**
 * Delegation Tools
 *
 * Single unified `delegate` tool for routing work to any subagent by name,
 * plus `reply_to_subagent` for answering subagent questions mid-execution.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { runSubagent, answerSubagentQuestion } from './subagent-runtime';
import { writeLog } from '../utils/logger';
import { KNOWN_SUBAGENT_NAMES, type SubagentName } from './capability-packs';
import type { DelegationResult } from './types';
import { getBridgeWs, getBridgeSecrets, withClientBridge } from '../tools/bridge';

// ─── The one delegation tool ─────────────────────────────────────────────────

export const delegate = createTool({
  id: 'delegate',
  description:
    'Delegate a task to a specialized subagent by name.\n' +
    'Available subagents:\n' +
    '  browser     — web browsing, form filling, page scraping, screenshots\n' +
    '  file_ops    — reading/writing files, code editing, terminal, commands\n' +
    '  workflow    — creating/modifying/testing StuardAI automation workflows\n' +
    '  google      — Gmail, Calendar, Drive, Sheets, Docs, Tasks\n' +
    '  outlook     — Outlook mail & calendar\n' +
    '  github      — repos, issues, PRs, branches, actions\n' +
    '  meta        — Facebook, Instagram, Threads\n' +
    '  whatsapp    — WhatsApp messaging\n' +
    '  telnyx      — SMS, voice calls\n' +
    '  reddit      — subreddits, posts, comments\n' +
    '  discord     — Discord bot operations\n' +
    'The subagent can ask you questions mid-task — the tool returns with the question ' +
    'so you can answer via reply_to_subagent.',
  inputSchema: z.object({
    subagent: z
      .string()
      .describe('Name of the subagent to delegate to (e.g. "browser", "file_ops", "google").'),
    instruction: z
      .string()
      .describe('Detailed instruction describing what the subagent should do.'),
    context: z
      .string()
      .optional()
      .describe('Additional context (conversation history, IDs, user preferences).'),
    timeoutMs: z
      .number()
      .optional()
      .describe('Timeout in milliseconds (uses subagent default if omitted).'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    subagentId: z.string().optional(),
    result: z.string().optional(),
    error: z.string().optional(),
    durationMs: z.number().optional(),
  }),
  execute: async ({ subagent, instruction, context, timeoutMs }) => {
    const name = subagent.trim().toLowerCase() as SubagentName;

    if (!KNOWN_SUBAGENT_NAMES.includes(name as any)) {
      return {
        ok: false,
        error: `Unknown subagent "${subagent}". Valid names: ${KNOWN_SUBAGENT_NAMES.join(', ')}`,
      };
    }

    // Capture bridge context NOW (inside the orchestrator's ALS) before handing off
    const bridgeWs = getBridgeWs();
    const bridgeSecrets = getBridgeSecrets();

    // Inherit model selection from the parent agent's bridge secrets
    const parentModelTier = bridgeSecrets?.__modelTier as string | undefined;
    const parentModelId = bridgeSecrets?.__modelId as string | undefined;

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Static packs use their SubagentKind directly; integration names resolve to kind 'integration'
    const isIntegration = !['browser', 'file_ops', 'workflow'].includes(name);
    const kind = isIntegration ? 'integration' as const : name as 'browser' | 'file_ops' | 'workflow';

    writeLog('delegate_start', {
      subagent: name,
      instruction: instruction.slice(0, 200),
      hasBridge: !!bridgeWs,
      parentModelTier,
      parentModelId,
    });

    const runDelegatedTask = () => runSubagent({
      request: {
        kind,
        instruction,
        context: isIntegration
          ? `Integration group: ${name}\n${context || ''}`
          : context,
        timeoutMs,
      },
      runId,
      parentRunId: runId,
      model: (parentModelTier as any) || 'balanced',
      modelId: parentModelId,
      bridgeWs: bridgeWs as any,
      bridgeSecrets,
    });

    // Mirror deploy_headless_agent: capture the live desktop bridge now and keep
    // the delegated run inside that bridge context for the full task.
    const result: DelegationResult = bridgeWs && (bridgeWs as any).readyState === 1
      ? await withClientBridge(bridgeWs as any, runDelegatedTask, bridgeSecrets) as DelegationResult
      : await runDelegatedTask();

    return {
      ok: result.ok,
      subagentId: result.subagentId,
      result: result.result,
      error: result.error,
      durationMs: result.durationMs,
    };
  },
});

// ─── Reply to subagent question ──────────────────────────────────────────────

export const replyToSubagent = createTool({
  id: 'reply_to_subagent',
  description:
    'Reply to a question from a running subagent. ' +
    'When a subagent asks a question, the delegate tool returns with the question. ' +
    'Use this tool to send your answer so the subagent can continue its work.',
  inputSchema: z.object({
    questionId: z.string().describe('The questionId from the subagent question.'),
    answer: z.string().describe('Your answer to the subagent question.'),
  }),
  execute: async ({ questionId, answer }) => {
    const resolved = answerSubagentQuestion(questionId, answer);
    if (!resolved) {
      return { ok: false, error: `No pending question with id ${questionId}` };
    }
    return { ok: true };
  },
});

// ─── Export all orchestrator tools ───────────────────────────────────────────

export const ORCHESTRATOR_DELEGATION_TOOLS = {
  delegate,
  reply_to_subagent: replyToSubagent,
} as const;
