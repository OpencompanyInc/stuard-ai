import { TOOL_REGISTRY, type ToolKind } from '../tools/registry';

export type BotSetupPreflightStatus = 'pass' | 'warn' | 'fail';

export interface BotSetupPreflightCheck {
  id: string;
  label: string;
  status: BotSetupPreflightStatus;
  detail?: string;
}

export interface BotSetupPreflightInput {
  allowedTools?: string[];
  interval?: string;
  executionTarget?: 'local' | 'vm' | string;
  clarifyingQuestions?: string[];
  clarifyingAnswers?: Record<string, string>;
  setupChecks?: string[];
}

export interface BotSetupPreflightResult {
  ok: boolean;
  summary: string;
  checks: BotSetupPreflightCheck[];
}

const LOCAL_ONLY_TOOL_PREFIXES = [
  'capture_',
  'stop_capture',
  'ffmpeg_',
  'file_search',
  'semantic_file_search',
  'folder_permission_',
  'list_directory',
  'read_file',
  'write_file',
  'open_file',
  'move_file',
  'copy_file',
];

const EMAIL_TOOLS = new Set([
  'gmail_send',
  'gmail_send_message',
  'outlook_send_mail',
]);

function compact(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueTools(value: unknown): string[] {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((toolName) => compact(toolName))
      .filter(Boolean)
  )).slice(0, 50);
}

function isLocalOnlyTool(toolName: string, kind: ToolKind | undefined): boolean {
  if (kind === 'local') return true;
  return LOCAL_ONLY_TOOL_PREFIXES.some((prefix) => toolName === prefix || toolName.startsWith(prefix));
}

function addCheck(checks: BotSetupPreflightCheck[], check: BotSetupPreflightCheck) {
  if (!checks.some((existing) => existing.id === check.id)) checks.push(check);
}

export function testBotSetupPreflight(
  input: BotSetupPreflightInput,
  availableTools: string[] = Object.keys(TOOL_REGISTRY).filter((toolName) => !toolName.startsWith('proactive_task_')),
): BotSetupPreflightResult {
  const checks: BotSetupPreflightCheck[] = [];
  const tools = uniqueTools(input?.allowedTools);
  const available = new Set(uniqueTools(availableTools));
  const answers = input?.clarifyingAnswers && typeof input.clarifyingAnswers === 'object'
    ? input.clarifyingAnswers
    : {};
  const questions = Array.isArray(input?.clarifyingQuestions)
    ? input.clarifyingQuestions.map((question) => compact(question)).filter(Boolean)
    : [];
  const setupChecks = Array.isArray(input?.setupChecks)
    ? input.setupChecks.map((check) => compact(check)).filter(Boolean)
    : [];

  const missingTools = tools.filter((toolName) => !available.has(toolName));
  addCheck(checks, {
    id: 'tool-availability',
    label: 'Tool allow-list',
    status: missingTools.length > 0 ? 'fail' : 'pass',
    detail: missingTools.length > 0
      ? `Unavailable tools: ${missingTools.join(', ')}`
      : tools.length > 0 ? `${tools.length} selected tool${tools.length === 1 ? '' : 's'} can be added.` : 'No extra tools selected.',
  });

  const unknownRoutes = tools.filter((toolName) => !TOOL_REGISTRY[toolName]);
  addCheck(checks, {
    id: 'tool-routing',
    label: 'Tool routing',
    status: unknownRoutes.length > 0 ? 'warn' : 'pass',
    detail: unknownRoutes.length > 0
      ? `These default to the local agent route: ${unknownRoutes.join(', ')}`
      : 'All selected tools have explicit desktop routes.',
  });

  const routeKinds = Array.from(new Set(
    tools.map((toolName) => TOOL_REGISTRY[toolName]?.kind || 'local')
  ));
  if (tools.length > 0) {
    addCheck(checks, {
      id: 'runtime-routes',
      label: 'Runtime paths',
      status: 'pass',
      detail: `Selected tools route through ${routeKinds.join(', ')}.`,
    });
  }

  const unanswered = questions.filter((_, idx) => !compact(answers[String(idx)]));
  if (questions.length > 0) {
    addCheck(checks, {
      id: 'clarifications',
      label: 'Clarifications',
      status: unanswered.length > 0 ? 'fail' : 'pass',
      detail: unanswered.length > 0
        ? `Answer ${unanswered.length} question${unanswered.length === 1 ? '' : 's'} before launch.`
        : 'All builder questions have answers.',
    });
  }

  if (tools.some((toolName) => toolName.startsWith('ffmpeg_'))) {
    addCheck(checks, {
      id: 'ffmpeg',
      label: 'FFmpeg readiness',
      status: available.has('ffmpeg_status') ? 'warn' : 'fail',
      detail: available.has('ffmpeg_status')
        ? 'FFmpeg tools are available; run ffmpeg_status or a sample conversion before unattended media work.'
        : 'Media conversion tools were selected but ffmpeg_status is not available for verification.',
    });
  }

  if (tools.includes('analyze_media')) {
    addCheck(checks, {
      id: 'media-sample',
      label: 'Media sample',
      status: 'warn',
      detail: 'Use a short sample recording on first run to verify transcription and summary quality.',
    });
  }

  if (tools.some((toolName) => EMAIL_TOOLS.has(toolName))) {
    addCheck(checks, {
      id: 'email-auth',
      label: 'Email send access',
      status: 'warn',
      detail: 'The connected mail account should be verified before the first unattended send.',
    });
  }

  const target = compact(input?.executionTarget || 'local').toLowerCase();
  const localOnly = tools.filter((toolName) => isLocalOnlyTool(toolName, TOOL_REGISTRY[toolName]?.kind));
  if (localOnly.length > 0 || setupChecks.some((check) => /\b(vm|deploy|folder|path|permission)\b/i.test(check))) {
    addCheck(checks, {
      id: 'deployment-parity',
      label: target === 'vm' ? 'VM compatibility' : 'Local/VM parity',
      status: target === 'vm' && localOnly.length > 0 ? 'warn' : 'warn',
      detail: localOnly.length > 0
        ? `Confirm the production runtime has the same files, permissions, and binaries for: ${localOnly.slice(0, 6).join(', ')}${localOnly.length > 6 ? '...' : ''}`
        : 'Confirm deployment target permissions and paths match the desktop setup.',
    });
  }

  for (const [idx, check] of setupChecks.entries()) {
    addCheck(checks, {
      id: `builder-check-${idx}`,
      label: 'Builder check',
      status: 'warn',
      detail: check,
    });
  }

  const hardFailures = checks.filter((check) => check.status === 'fail');
  const warnings = checks.filter((check) => check.status === 'warn');
  return {
    ok: hardFailures.length === 0,
    summary: hardFailures.length > 0
      ? `${hardFailures.length} launch blocker${hardFailures.length === 1 ? '' : 's'} found.`
      : warnings.length > 0
        ? `No hard blockers. ${warnings.length} setup warning${warnings.length === 1 ? '' : 's'} to verify.`
        : 'Setup checks passed.',
    checks,
  };
}
