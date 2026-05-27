import type { ScheduleInterval } from './proactive-types';
import type { IBotsPlatform } from './platform';
import type { BotBlueprint, BlueprintStreamEvent } from './types';
import { BOT_TOOL_RULES, COMMON_EMOJIS } from './constants';
import {
  compactWhitespace,
  hasAnyKeyword,
  inferInterval,
  isInternalBotTool,
  titleFromGoal,
} from './helpers';

export function pickBlueprintTools(goal: string, availableTools: string[]): { tools: string[]; emoji: string } {
  const text = goal.toLowerCase();
  const available = new Set(availableTools);
  const picked = new Set<string>();
  let emoji = COMMON_EMOJIS[0];

  for (const rule of BOT_TOOL_RULES) {
    if (!hasAnyKeyword(text, rule.keywords)) continue;
    if (typeof rule.emojiIndex === 'number') emoji = COMMON_EMOJIS[rule.emojiIndex] || emoji;
    for (const tool of rule.tools) {
      if (available.has(tool)) picked.add(tool);
    }
  }

  if (picked.size === 0) {
    for (const tool of ['web_search', 'scrape_url', 'search_past_conversations']) {
      if (available.has(tool)) picked.add(tool);
    }
  }

  return { tools: Array.from(picked).slice(0, 10), emoji };
}

function inferClarifyingQuestions(goal: string): string[] {
  const text = goal.toLowerCase();
  const questions: string[] = [];
  const mentionsMedia = hasAnyKeyword(text, ['video', 'recording', 'camera', 'webcam', 'mp4', 'mov']);
  const hasPathHint = /([a-z]:\\|\/users\/|\/home\/|downloads|desktop|camera roll|folder|directory|path)/i.test(goal);
  if (mentionsMedia && !hasPathHint) {
    questions.push('Which folder should I watch for new recordings, or should I ask you for the video each time?');
  }
  if (hasAnyKeyword(text, ['email', 'send to my email', 'mail me']) && !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(goal)) {
    questions.push('Should I send the rundown to your connected default email address, or a specific recipient?');
  }
  if (hasAnyKeyword(text, ['random', 'weekly', 'multiple times a day', 'multiple days a week']) && !hasAnyKeyword(text, ['morning', 'afternoon', 'evening', 'night', 'business hours'])) {
    questions.push('Are random check-ins allowed any time, or only during certain hours?');
  }
  return questions.slice(0, 5);
}

function inferSetupChecks(goal: string, tools: string[]): string[] {
  const text = goal.toLowerCase();
  const checks: string[] = [];
  if (tools.some(tool => tool.startsWith('ffmpeg_'))) checks.push('Verify FFmpeg is available before the first media conversion.');
  if (tools.includes('analyze_media')) checks.push('Run a small sample media file through transcription before trusting unattended runs.');
  if (tools.some(tool => tool === 'gmail_send_message' || tool === 'gmail_send' || tool === 'outlook_send_mail')) checks.push('Confirm the connected email account can send messages before launch.');
  if (hasAnyKeyword(text, ['folder', 'directory', 'path', 'recording', 'video']) && tools.some(tool => ['file_search', 'semantic_file_search', 'list_directory'].includes(tool))) {
    checks.push('Confirm the recording folder is accessible from the desktop and VM target you deploy to.');
  }
  return checks.slice(0, 6);
}

export function buildBotBlueprint(goal: string, availableTools: string[], preferredName?: string): BotBlueprint {
  const objective = compactWhitespace(goal) || 'Help with recurring work and notify me when action is useful.';
  const name = compactWhitespace(preferredName || '') || titleFromGoal(objective);
  const { tools, emoji } = pickBlueprintTools(objective, availableTools);
  const interval = inferInterval(objective);
  const systemPrompt = [
    `You are ${name}, a proactive background agent.`,
    '',
    'Objective:',
    `- ${objective}`,
    '',
    'Operating rules:',
    '- Review the trigger context and recent agent memory before acting.',
    '- Use granted tools to verify facts or complete actions before guessing.',
    '- Keep actions focused on the objective and avoid unrelated work.',
    '- Record useful durable findings in agent memory.',
    '- Notify the user only for completed work, decisions, risks, or useful findings.',
    '',
    'Success criteria:',
    '- The user can trust the agent to run with minimal babysitting.',
    '- Each run produces either a concrete result, a concise status update, or no notification when nothing changed.',
  ].join('\n');
  const instructions = [
    'At each wake-up, inspect the trigger payload, recent agent memory, and open tasks.',
    'Decide whether action is needed for the objective.',
    'Use the allowed tools to complete the next useful step, update memory/tasks when relevant, and send a concise app notification when there is something worth interrupting the user for.',
  ].join(' ');

  return {
    name,
    emoji,
    systemPrompt,
    instructions,
    allowedTools: tools,
    interval,
    clarifyingQuestions: inferClarifyingQuestions(objective),
    setupChecks: inferSetupChecks(objective, tools),
  };
}

export function normalizeAiBlueprint(raw: any, goal: string, availableTools: string[], preferredName?: string): BotBlueprint {
  const fallback = buildBotBlueprint(goal, availableTools, preferredName);
  const available = new Set(availableTools);
  const canUseTool = (tool: string) => {
    if (!tool || isInternalBotTool(tool)) return false;
    if (tool.startsWith('browser_') && !tool.startsWith('browser_use_')) return false;
    return available.size === 0 || available.has(tool);
  };

  const tools: string[] = Array.isArray(raw?.allowedTools)
    ? Array.from(new Set<string>(raw.allowedTools.map((tool: any) => String(tool || '').trim()).filter(canUseTool))).slice(0, 12)
    : fallback.allowedTools;

  const interval = ['10m', '15m', '30m', '1h', '2h', 'random', 'manual'].includes(String(raw?.interval || ''))
    ? String(raw.interval) as ScheduleInterval
    : fallback.interval;

  const toolRationale = Array.isArray(raw?.toolRationale)
    ? raw.toolRationale
        .map((entry: any) => ({
          tool: String(entry?.tool || '').trim(),
          reason: compactWhitespace(String(entry?.reason || '')),
        }))
        .filter((entry: { tool: string; reason: string }) => canUseTool(entry.tool) && entry.reason)
        .slice(0, 12)
    : undefined;
  const clarifyingQuestions: string[] | undefined = Array.isArray(raw?.clarifyingQuestions)
    ? Array.from(new Set<string>(raw.clarifyingQuestions.map((q: any) => compactWhitespace(String(q || ''))).filter(Boolean))).slice(0, 5)
    : fallback.clarifyingQuestions;
  const clarifyingAnswers: Array<{ question: string; answer: string }> | undefined = Array.isArray(raw?.clarifyingAnswers)
    ? Array.from(new Map<string, { question: string; answer: string }>(
        raw.clarifyingAnswers
          .map((entry: any) => ({
            question: compactWhitespace(String(entry?.question || '')),
            answer: compactWhitespace(String(entry?.answer || '')),
          }))
          .filter((entry: { question: string; answer: string }) => entry.question && entry.answer)
          .map((entry: { question: string; answer: string }) => [entry.question.toLowerCase(), entry] as const),
      ).values()).slice(0, 10)
    : undefined;
  const setupChecks: string[] | undefined = Array.isArray(raw?.setupChecks)
    ? Array.from(new Set<string>(raw.setupChecks.map((q: any) => compactWhitespace(String(q || ''))).filter(Boolean))).slice(0, 6)
    : fallback.setupChecks;
  const validTriggerTypes = new Set(['schedule.interval', 'schedule.cron', 'webhook', 'fs.watch', 'command.watch', 'manual']);
  const triggers = Array.isArray(raw?.triggers)
    ? raw.triggers
        .map((trigger: any) => {
          const type = compactWhitespace(String(trigger?.type || ''));
          if (!validTriggerTypes.has(type)) return null;
          const argsValue = trigger?.args && typeof trigger.args === 'object' && !Array.isArray(trigger.args)
            ? trigger.args
            : undefined;
          const label = compactWhitespace(String(trigger?.label || '')).slice(0, 80) || undefined;
          const rationale = compactWhitespace(String(trigger?.rationale || '')).slice(0, 280) || undefined;
          return { type: type as any, args: argsValue, label, rationale };
        })
        .filter((trigger: any): trigger is NonNullable<typeof trigger> => !!trigger)
        .slice(0, 5)
    : undefined;
  const validProbes = new Set(['tool_available', 'binary_available', 'folder_access', 'oauth_connected', 'capture_devices_available', 'dry_run_tool']);
  const preflightSteps = Array.isArray(raw?.preflightSteps)
    ? raw.preflightSteps
        .map((step: any, idx: number) => {
          const probe = compactWhitespace(String(step?.probe || ''));
          if (!validProbes.has(probe)) return null;
          const label = compactWhitespace(String(step?.label || '')) || probe.replace(/_/g, ' ');
          const rationale = compactWhitespace(String(step?.rationale || '')).slice(0, 280) || undefined;
          const id = compactWhitespace(String(step?.id || '')) || `step-${idx + 1}`;
          const argsValue = step?.args && typeof step.args === 'object' && !Array.isArray(step.args)
            ? step.args
            : undefined;
          return { id, probe: probe as any, label, rationale, args: argsValue };
        })
        .filter((step: any): step is NonNullable<typeof step> => !!step)
        .slice(0, 8)
    : [];

  return {
    name: compactWhitespace(String(raw?.name || '')) || fallback.name,
    emoji: compactWhitespace(String(raw?.emoji || '')) || fallback.emoji,
    description: compactWhitespace(String(raw?.description || '')) || fallback.description,
    systemPrompt: String(raw?.systemPrompt || '').trim() || fallback.systemPrompt,
    instructions: compactWhitespace(String(raw?.instructions || '')) || fallback.instructions,
    allowedTools: tools.length > 0 ? tools : fallback.allowedTools,
    interval,
    toolRationale,
    clarifyingQuestions,
    clarifyingAnswers,
    setupChecks,
    preflightSteps,
    triggers,
  };
}

async function blueprintAuthHeaders(platform: IBotsPlatform): Promise<Record<string, string>> {
  const token = (await platform.getAccessToken?.()) || '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function blueprintCloudBase(platform: IBotsPlatform): string {
  const base = platform.getCloudAiBaseUrl?.() || 'http://127.0.0.1:8082';
  return String(base).replace(/\/$/, '');
}

async function postBlueprintTestRunResult(
  platform: IBotsPlatform,
  runId: string,
  status: 'pass' | 'fail' | 'warn' | 'unsupported',
  detail: string,
): Promise<void> {
  const headers = await blueprintAuthHeaders(platform);
  try {
    await fetch(`${blueprintCloudBase(platform)}/inference/ai/bot-blueprint/test-run-result`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ runId, status, detail }),
    });
  } catch { /* server will time-out the pending Promise on its end */ }
}

export async function runBlueprintPreflightStep(
  platform: IBotsPlatform,
  step: {
    probe: string;
    args?: Record<string, any>;
  },
): Promise<{ status: 'pass' | 'fail' | 'warn' | 'unsupported'; detail: string }> {
  if (!platform.runPreflightProbe) {
    return { status: 'unsupported', detail: 'Preflight probes are not available on this host.' };
  }
  const token = (await platform.getAccessToken?.()) || null;
  const res = await platform.runPreflightProbe({
    request: { probe: step.probe, args: step.args },
    cloudHttpBase: blueprintCloudBase(platform),
    authToken: token,
  });
  return {
    status: res?.status || (res?.ok === false ? 'fail' : 'warn'),
    detail: res?.detail || '',
  };
}

export async function submitBlueprintClarifyAnswers(
  platform: IBotsPlatform,
  clarifyId: string,
  answers: Array<{ question: string; answer: string }>,
): Promise<{ ok: boolean; accepted?: number; error?: string }> {
  const trimmed = (answers || [])
    .map(item => ({
      question: compactWhitespace(String(item?.question || '')),
      answer: compactWhitespace(String(item?.answer || '')),
    }))
    .filter(item => item.question && item.answer);
  if (!clarifyId) return { ok: false, error: 'clarify_id_required' };
  const headers = await blueprintAuthHeaders(platform);
  try {
    const res = await fetch(`${blueprintCloudBase(platform)}/inference/ai/bot-blueprint/clarify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ clarifyId, answers: trimmed }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `http ${res.status}: ${detail.slice(0, 160) || 'no_body'}` };
    }
    const json = await res.json().catch(() => ({}));
    return { ok: !!json?.ok, accepted: Number(json?.accepted || 0) };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'network_error' };
  }
}

export async function streamBotBlueprintWithAi(
  platform: IBotsPlatform,
  goal: string,
  availableTools: string[],
  preferredName: string | undefined,
  onEvent: (event: BlueprintStreamEvent) => void,
): Promise<BotBlueprint> {
  const token = (await platform.getAccessToken?.()) || '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const hasToken = Boolean(token);

  let response: Response;
  try {
    response = await fetch(`${blueprintCloudBase(platform)}/inference/ai/bot-blueprint`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ goal, preferredName, availableTools }),
    });
  } catch (e: any) {
    const reason = e?.message || String(e || 'network_error');
    throw new Error(`network: ${reason}${hasToken ? '' : ' (no auth token)'}`);
  }

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    throw new Error(`http ${response.status}: ${detail.slice(0, 200) || 'no_body'}${hasToken ? '' : ' (no auth token)'}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let blueprintEvent: Extract<BlueprintStreamEvent, { type: 'blueprint' }> | null = null;
  let errorEvent: Extract<BlueprintStreamEvent, { type: 'error' }> | null = null;

  const runProbeAndReport = async (
    runId: string,
    probe: string,
    args: Record<string, any> | null | undefined,
  ) => {
    try {
      if (!platform.runPreflightProbe) {
        await postBlueprintTestRunResult(platform, runId, 'unsupported', 'Preflight probes are not available on this host.');
        return;
      }
      const localToken = (await platform.getAccessToken?.()) || null;
      const res = await platform.runPreflightProbe({
        request: { probe, args: args || undefined },
        cloudHttpBase: blueprintCloudBase(platform),
        authToken: localToken,
      });
      const status = (res?.status || (res?.ok === false ? 'fail' : 'warn')) as 'pass' | 'fail' | 'warn' | 'unsupported';
      const detail = res?.detail || '';
      await postBlueprintTestRunResult(platform, runId, status, detail);
    } catch (e: any) {
      await postBlueprintTestRunResult(platform, runId, 'fail', e?.message || 'probe_failed');
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      let event: BlueprintStreamEvent | null = null;
      try { event = JSON.parse(payload) as BlueprintStreamEvent; } catch { continue; }
      if (!event) continue;
      onEvent(event);
      if (event.type === 'blueprint') blueprintEvent = event;
      else if (event.type === 'error') errorEvent = event;
      else if (event.type === 'test_run.start') {
        void runProbeAndReport(event.runId, event.probe, event.args || undefined);
      }
    }
  }

  if (errorEvent) throw new Error(errorEvent.error || 'bot_blueprint_failed');
  if (!blueprintEvent) throw new Error('stream_ended_without_blueprint');

  return normalizeAiBlueprint(blueprintEvent.blueprint, goal, availableTools, preferredName);
}
