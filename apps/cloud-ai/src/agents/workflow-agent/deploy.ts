/**
 * Workflow Deploy Tool
 *
 * Lets the Workflow Architect agent deploy a workflow to one or more targets:
 *   - "desktop" — runs the workflow locally on the user's machine with
 *     autostart enabled (mirrors the Workflow Editor's "Deploy" button).
 *   - "vm"      — deploys the workflow to the user's Cloud VM via the same
 *     deploy-manager pipeline used by the website's Cloud IDE.
 *
 * Pass `targets: ["desktop", "vm"]` to deploy to both at once.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, getBridgeSecrets, hasClientBridge } from '../../tools/bridge';
import { getSessionWorkflow } from '../../tools/workflow';
import { writeLog } from '../../utils/logger';
import { createDeployment, DeploymentValidationError } from '../../services/deploy-manager';

type DeployTarget = 'desktop' | 'vm';

interface DeployTargetResult {
  target: DeployTarget;
  ok: boolean;
  deployId?: string;
  message?: string;
  error?: string;
}

function resolveDeployTimezone(): string {
  const secrets = getBridgeSecrets() || {};
  const candidates = [
    (secrets as any).timezone,
    (secrets as any).userTimezone,
    (secrets as any).user_timezone,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return 'UTC';
}

// Mirrors getCloudTriggerBindings in apps/desktop/src/renderer/workflows/hooks/useWorkflowDeploy.ts
function getCloudTriggerBindings(model: any) {
  if (!model) return [];
  const triggers = Array.isArray(model.triggers) ? model.triggers : [];
  return triggers.flatMap((trigger: any) => {
    const type = String(trigger?.type || '').trim();
    const triggerId = String(trigger?.id || '').trim();
    if (!type || !triggerId) return [];

    if (type === 'gmail.new_email' || type === 'drive.new_file' || type === 'schedule.cron') {
      return [{
        triggerId,
        type,
        args: trigger?.args && typeof trigger.args === 'object' ? trigger.args : {},
      }];
    }

    if (type === 'webhook.cloud') {
      return [{
        triggerId,
        type,
        mode: 'cloud',
        args: trigger?.args && typeof trigger.args === 'object' ? trigger.args : {},
      }];
    }

    if (type === 'webhook') {
      const mode = String(trigger?.args?.mode || 'cloud').trim().toLowerCase();
      if (mode === 'local') return [];
      return [{
        triggerId,
        type,
        mode,
        args: trigger?.args && typeof trigger.args === 'object' ? trigger.args : {},
      }];
    }

    return [];
  });
}

async function loadWorkflowFromBridge(workflowId: string, writer?: any): Promise<any | null> {
  if (!hasClientBridge()) return null;
  try {
    const res = await execLocalTool(
      'read_local_workflow',
      // includeWorkspaceBundle ships the workflow's imported sub-workflows,
      // functions, scripts and assets so the VM runs a self-contained copy.
      { workflowId, includeWorkspaceBundle: true },
      writer,
      15_000,
      { silent: true, noFallback: true },
    );
    if (res?.ok && res?.model) return res.model;
    if (res?.ok && typeof res?.content === 'string') {
      try { return JSON.parse(res.content); } catch { return null; }
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveWorkflowJson(workflowId: string, writer?: any): Promise<any | null> {
  const session = getSessionWorkflow();
  if (session && session.id === workflowId) return session;
  const fromBridge = await loadWorkflowFromBridge(workflowId, writer);
  if (fromBridge) return fromBridge;
  // Fall back to whatever is in session even if the id doesn't match — the
  // architect may have just renamed the workflow before deploying.
  return session || null;
}

async function deployToDesktop(
  workflowId: string,
  undeploy: boolean,
  writer?: any,
): Promise<DeployTargetResult> {
  if (!hasClientBridge()) {
    return { target: 'desktop', ok: false, error: 'No desktop bridge available — the user must have the desktop app open.' };
  }
  try {
    const res = await execLocalTool(
      'deploy_local_workflow',
      { workflowId, undeploy },
      writer,
      30_000,
      { noFallback: true },
    );
    if (res?.ok) {
      return {
        target: 'desktop',
        ok: true,
        message: undeploy
          ? 'Workflow undeployed locally (autostart disabled, runtime stopped).'
          : 'Workflow deployed locally with autostart enabled.',
      };
    }
    return { target: 'desktop', ok: false, error: res?.error || 'desktop_deploy_failed' };
  } catch (e: any) {
    return { target: 'desktop', ok: false, error: e?.message || 'desktop_deploy_failed' };
  }
}

async function deployToVm(
  workflowId: string,
  undeploy: boolean,
  writer?: any,
): Promise<DeployTargetResult> {
  if (undeploy) {
    return {
      target: 'vm',
      ok: false,
      error: 'VM undeploy is not supported via deploy_workflow yet — manage VM deployments from the Cloud Deployments dashboard.',
    };
  }

  const secrets = getBridgeSecrets();
  const userId = String(secrets?.userId || '').trim();
  if (!userId) {
    return { target: 'vm', ok: false, error: 'User not authenticated for VM deploy.' };
  }

  const model = await resolveWorkflowJson(workflowId, writer);
  if (!model) {
    return { target: 'vm', ok: false, error: 'Workflow JSON not available — it must be in session or readable from the desktop.' };
  }

  try {
    const tz = resolveDeployTimezone();
    const cron = (model.triggers || []).find((t: any) => t?.type === 'schedule.cron')?.args?.cron;
    const deployment = await createDeployment(userId, {
      name: model.name || `Workflow ${workflowId}`,
      kind: 'workflow',
      description: model.description || 'Deployed via workflow agent',
      payload: model,
      envVars: { TZ: tz, STUARD_USER_TIMEZONE: tz },
      autoRestart: true,
      schedule: cron || undefined,
      workflowId,
      triggerBindings: getCloudTriggerBindings(model),
    });

    if (deployment.status === 'failed') {
      return {
        target: 'vm',
        ok: false,
        deployId: deployment.id,
        error: deployment.error_message || 'VM deploy failed',
      };
    }

    return {
      target: 'vm',
      ok: true,
      deployId: deployment.id,
      message: `Workflow deployed to VM (status: ${deployment.status}).`,
    };
  } catch (e: any) {
    if (e instanceof DeploymentValidationError) {
      const issues = e.issues.slice(0, 5).map((i) => `${i.type}:${i.name} (${i.reason})`).join('; ');
      return { target: 'vm', ok: false, error: `${e.message} | Issues: ${issues}` };
    }
    return { target: 'vm', ok: false, error: e?.message || 'vm_deploy_failed' };
  }
}

export const deployWorkflow = createTool({
  id: 'deploy_workflow',
  description:
    'Deploy a saved workflow to one or more targets. ' +
    'targets is an array — pass ["desktop"] to enable autostart on the user\'s local machine, ' +
    '["vm"] to push it to the user\'s Cloud VM, or ["desktop", "vm"] to do both. ' +
    'For VM deploys, the workflow must avoid desktop-only tools (mouse, keyboard, screen capture, custom UI, etc.) — ' +
    'validation runs server-side and surfaces conflicting nodes in the result. ' +
    'Set undeploy:true to disable autostart locally (only supported for the "desktop" target).',
  inputSchema: z.object({
    workflowId: z
      .string()
      .describe('Workflow id to deploy (e.g. "flow_morning_brief"). The workflow must already exist on disk — call create_workflow first if not.'),
    targets: z
      .array(z.enum(['desktop', 'vm']))
      .min(1)
      .describe('Deploy targets. Examples: ["desktop"], ["vm"], or ["desktop", "vm"].'),
    undeploy: z
      .boolean()
      .default(false)
      .describe('Set true to undeploy/stop instead of deploy. VM target does not support undeploy via this tool.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    results: z.array(z.object({
      target: z.string(),
      ok: z.boolean(),
      deployId: z.string().optional(),
      message: z.string().optional(),
      error: z.string().optional(),
    })),
  }),
  execute: async (inputData, ctx) => {
    const { workflowId, targets, undeploy } = inputData as any;
    const writer = ctx?.writer;
    writeLog('deploy_workflow', { workflowId, targets, undeploy });

    const uniqueTargets: DeployTarget[] = Array.from(
      new Set((targets || []).map((t: string) => String(t).toLowerCase())),
    ) as DeployTarget[];

    const results: DeployTargetResult[] = [];
    for (const target of uniqueTargets) {
      if (target === 'desktop') {
        results.push(await deployToDesktop(workflowId, !!undeploy, writer));
      } else if (target === 'vm') {
        results.push(await deployToVm(workflowId, !!undeploy, writer));
      } else {
        results.push({ target: target as DeployTarget, ok: false, error: `Unknown target: ${target}` });
      }
    }

    const allOk = results.every((r) => r.ok);
    writeLog('deploy_workflow_done', { workflowId, allOk, results });
    return { ok: allOk, results };
  },
});
